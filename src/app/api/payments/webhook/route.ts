import { createHash, timingSafeEqual } from 'node:crypto';
import type { OrderDoc } from '@/lib/constants';
import { parseBankAlert } from '@/lib/bank-alert';
import { adminDb } from '@/lib/server/firebase-admin';
import { HttpError, clientIp, handle, json, rateLimit } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** an order whose QR expired can still be paid a little later */
const MATCH_GRACE_MS = 15 * 60 * 1000;

function secretOk(req: Request): boolean {
  const want = process.env.PAYMENT_WEBHOOK_SECRET || '';
  const got = req.headers.get('x-webhook-secret') || new URL(req.url).searchParams.get('secret') || '';
  if (want.length < 16) throw new HttpError(503, 'PAYMENT_WEBHOOK_SECRET not configured (min 16 chars).', 'not_configured');
  const a = Buffer.from(want), b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * POST /api/payments/webhook   (called by the phone that receives the bank SMS / payment-app notification)
 * Header: X-Webhook-Secret: <PAYMENT_WEBHOOK_SECRET>      Body: {"text": "<sms text>", "ts": <optional unix ms>}
 *
 * Matching (all inside one Firestore transaction per order, idempotent):
 *   1. alert has a UTR that a user already submitted  → that order (amount must match)
 *   2. otherwise exactly ONE open order whose payable amount equals the credited amount → that order
 *   3. anything else → stored as "unmatched" for the admin page (nothing is granted)
 */
export const POST = handle(async (req) => {
  rateLimit(`wh:${clientIp(req)}`, 120, 60_000);
  if (!secretOk(req)) throw new HttpError(401, 'Bad secret.', 'unauthorized');

  /* accepts JSON {"text": "..."} or a plain-text body (easier in MacroDroid: SMS text can contain quotes that break JSON) */
  const raw = (await req.text()).slice(0, 8 * 1024);
  let body: { text?: string; ts?: number } = {};
  try {
    const j = JSON.parse(raw);
    body = j && typeof j === 'object' ? j : { text: String(j) };
  } catch {
    body = { text: raw };
  }
  const text = String(body.text || '').trim();
  if (!text) throw new HttpError(400, 'text required');

  const p = parseBankAlert(text);
  if (!p.credit || !p.amountPaise) return json({ ok: true, status: 'ignored' });

  const db = adminDb();
  const now = Date.now();
  // identical alerts retried within the same minute (or with the same ts) are one event
  const alertId = createHash('sha256').update(`${text}|${body.ts ?? Math.floor(now / 60000)}`).digest('hex').slice(0, 32);
  const aref = db.doc(`bankAlerts/${alertId}`);
  try {
    await aref.create({ text: text.slice(0, 500), amountPaise: p.amountPaise, utr: p.utr, status: 'received', ts: now });
  } catch {
    return json({ ok: true, status: 'duplicate' });
  }

  /* ---- find the order ---- */
  let orderId: string | null = null;
  if (p.utr) {
    const u = await db.doc(`utrs/${p.utr}`).get();
    if (u.exists) orderId = (u.data() as { orderId?: string }).orderId ?? null;
  }
  if (!orderId) {
    const snap = await db.collection('orders').where('status', 'in', ['created', 'pending_verification']).limit(500).get();
    const hits = snap.docs.filter((d) => {
      const o = d.data() as OrderDoc;
      return Math.round((o.payAmountInr ?? o.amountInr) * 100) === p.amountPaise && o.expiresAt + MATCH_GRACE_MS > now;
    });
    if (hits.length === 1) orderId = hits[0].id;
  }
  if (!orderId) {
    /* same payment announced twice (bank SMS + Google Pay/PhonePe notification) → already approved moments ago */
    const recent = await db.collection('orders').where('decidedAt', '>', now - MATCH_GRACE_MS).limit(100).get();
    if (recent.docs.some((d) => (d.data() as OrderDoc).status === 'approved' && Math.round(((d.data() as OrderDoc).payAmountInr ?? 0) * 100) === p.amountPaise && (d.data() as OrderDoc).decidedBy === 'auto:bank-alert')) {
      await aref.update({ status: 'matched', result: 'duplicate_of_approved' });
      return json({ ok: true, status: 'already_approved' });
    }
    await aref.update({ status: 'unmatched' });
    return json({ ok: true, status: 'unmatched' });
  }

  /* ---- approve atomically ---- */
  const result = await db.runTransaction(async (tx) => {
    const oref = db.doc(`orders/${orderId}`);
    const snap = await tx.get(oref);
    const o = snap.data() as OrderDoc | undefined;
    if (!snap.exists || !o) return 'unmatched';
    if (o.status === 'approved') return 'already_approved';
    if (o.status !== 'created' && o.status !== 'pending_verification') return 'unmatched';
    if (Math.round((o.payAmountInr ?? o.amountInr) * 100) !== p.amountPaise) return 'amount_mismatch';

    let utr = o.utr ?? null;
    if (p.utr) {
      if (utr && utr !== p.utr) return 'utr_mismatch'; // user typed another UTR → admin decides
      if (!utr) {
        const uref = db.doc(`utrs/${p.utr}`);
        if ((await tx.get(uref)).exists) return 'utr_used';
        tx.create(uref, { orderId, uid: o.uid, ts: now, auto: true });
        utr = p.utr;
      }
    }
    tx.set(db.doc(`users/${o.uid}/grants/${orderId}`), { type: 'purchase', orderId, planId: o.planId, inr: o.amountInr, utr, createdAt: now });
    tx.update(oref, { status: 'approved', utr, decidedAt: now, decidedBy: 'auto:bank-alert', autoVerified: true });
    return 'approved';
  });

  await aref.update({ status: result === 'approved' || result === 'already_approved' ? 'matched' : 'unmatched', orderId, result });
  return json({ ok: true, status: result, orderId });
});
