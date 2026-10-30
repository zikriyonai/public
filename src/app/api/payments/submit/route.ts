import type { OrderDoc } from '@/lib/constants';
import { isValidUtr } from '@/lib/upi';
import { requireUser } from '@/lib/server/auth';
import { adminDb } from '@/lib/server/firebase-admin';
import { HttpError, handle, json, rateLimit, readJson } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** the QR is valid for ORDER_TTL_MS, but a payer may submit the UTR a bit later */
const SUBMIT_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * The payer submits the 12-digit UTR (UPI reference number) of the payment they made.
 * Credits are NOT granted here — an admin matches the UTR against the bank statement first (see /admin).
 * A UTR can be used for one order only (utrs/{utr} document, created in the same transaction).
 */
export const POST = handle(async (req) => {
  const user = await requireUser(req);
  rateLimit(`utr:${user.uid}`, 10, 60_000);

  const body = await readJson<{ orderId?: string; utr?: string }>(req);
  const orderId = String(body.orderId || '');
  const utr = String(body.utr || '').replace(/\s+/g, '');
  if (!/^ZK[A-Z0-9]{8}$/.test(orderId)) throw new HttpError(400, 'Invalid order.', 'bad_order');
  if (!isValidUtr(utr)) throw new HttpError(400, 'UTR must be exactly 12 digits (UPI Ref No. in your payment app).', 'bad_utr');

  const db = adminDb();
  await db.runTransaction(async (tx) => {
    const oref = db.doc(`orders/${orderId}`);
    const snap = await tx.get(oref);
    const o = snap.data() as OrderDoc | undefined;
    if (!snap.exists || !o || o.uid !== user.uid) throw new HttpError(404, 'Order not found.', 'not_found');

    if (o.status === 'pending_verification') {
      if (o.utr === utr) return; // idempotent re-submit
      throw new HttpError(409, 'A UTR was already submitted for this order.', 'already_submitted');
    }
    if (o.status !== 'created') throw new HttpError(409, `This order is already ${o.status}.`, 'bad_state');
    if (Date.now() > o.expiresAt + SUBMIT_GRACE_MS) throw new HttpError(410, 'This order has expired. Please create a new one.', 'expired');

    const uref = db.doc(`utrs/${utr}`);
    if ((await tx.get(uref)).exists) throw new HttpError(409, 'This UTR was already used for another order.', 'utr_used');

    tx.create(uref, { orderId, uid: user.uid, ts: Date.now() });
    tx.update(oref, { status: 'pending_verification', utr, submittedAt: Date.now() });
  });

  return json({ ok: true, status: 'pending_verification' });
});
