import type { OrderDoc } from '@/lib/constants';
import { requireAdmin } from '@/lib/server/auth';
import { adminDb } from '@/lib/server/firebase-admin';
import { HttpError, handle, json, rateLimit, readJson } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = new Set(['created', 'pending_verification', 'approved', 'rejected']);

/** GET /api/admin?kind=orders&status=pending_verification | kind=students */
export const GET = handle(async (req) => {
  const admin = await requireAdmin(req);
  rateLimit(`admin:${admin.uid}`, 60, 60_000);
  const url = new URL(req.url);
  const kind = url.searchParams.get('kind') || 'orders';
  const db = adminDb();

  if (kind === 'orders') {
    const status = url.searchParams.get('status') || 'pending_verification';
    if (!STATUSES.has(status)) throw new HttpError(400, 'Bad status');
    const snap = await db.collection('orders').where('status', '==', status).limit(200).get();
    const items = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as OrderDoc) }))
      .sort((a, b) => (b.submittedAt ?? b.createdAt) - (a.submittedAt ?? a.createdAt));
    return json({ ok: true, items });
  }

  if (kind === 'students') {
    const snap = await db.collection('studentVerifications').where('status', '==', 'pending').limit(50).get();
    return json({ ok: true, items: snap.docs.map((d) => ({ id: d.id, ...d.data() })) });
  }

  if (kind === 'alerts') {
    const snap = await db.collection('bankAlerts').where('status', '==', 'unmatched').limit(50).get();
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a: any, b: any) => b.ts - a.ts);
    return json({ ok: true, items });
  }

  throw new HttpError(400, 'Unknown kind');
});

interface ActionBody {
  action?: 'approve_order' | 'reject_order' | 'student_approve' | 'student_reject';
  orderId?: string;
  uid?: string;
  note?: string;
}

/** POST — approve / reject a payment or a student verification. All writes are idempotent. */
export const POST = handle(async (req) => {
  const admin = await requireAdmin(req);
  rateLimit(`admin:${admin.uid}`, 60, 60_000);
  const body = await readJson<ActionBody>(req);
  const db = adminDb();
  const now = Date.now();

  if (body.action === 'approve_order' || body.action === 'reject_order') {
    const orderId = String(body.orderId || '');
    if (!/^ZK[A-Z0-9]{8}$/.test(orderId)) throw new HttpError(400, 'Invalid order');
    const note = String(body.note || '').slice(0, 300);

    await db.runTransaction(async (tx) => {
      const oref = db.doc(`orders/${orderId}`);
      const snap = await tx.get(oref);
      if (!snap.exists) throw new HttpError(404, 'Order not found');
      const o = snap.data() as OrderDoc;
      if (o.status === (body.action === 'approve_order' ? 'approved' : 'rejected')) return; // idempotent
      if (o.status !== 'pending_verification') throw new HttpError(409, `Order is ${o.status}, not pending verification.`);

      if (body.action === 'approve_order') {
        const gref = db.doc(`users/${o.uid}/grants/${orderId}`);
        tx.set(gref, { type: 'purchase', orderId, planId: o.planId, inr: o.amountInr, utr: o.utr ?? null, createdAt: now });
        tx.update(oref, { status: 'approved', decidedAt: now, decidedBy: admin.email, note });
      } else {
        if (o.utr) tx.delete(db.doc(`utrs/${o.utr}`)); // free the UTR so the user can resubmit a corrected one on a new order
        tx.update(oref, { status: 'rejected', decidedAt: now, decidedBy: admin.email, note });
      }
    });
    return json({ ok: true });
  }

  if (body.action === 'student_approve' || body.action === 'student_reject') {
    const uid = String(body.uid || '');
    if (!uid || uid.length > 128) throw new HttpError(400, 'Invalid uid');
    const ref = db.doc(`studentVerifications/${uid}`);
    if (!(await ref.get()).exists) throw new HttpError(404, 'Not found');
    await ref.update({ status: body.action === 'student_approve' ? 'verified' : 'rejected', decidedAt: now, decidedBy: admin.email });
    return json({ ok: true });
  }

  throw new HttpError(400, 'Unknown action');
});
