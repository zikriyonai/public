import { CATALOG as C } from '@/lib/billing/catalog';
import { ORDER_TTL_MS, MAX_OPEN_ORDERS, UPI_PAYEE_NAME, UPI_VPA, type OrderDoc } from '@/lib/constants';
import { buildUpiUri, paymentNote } from '@/lib/upi';
import { requireUser } from '@/lib/server/auth';
import { adminDb } from '@/lib/server/firebase-admin';
import { HttpError, handle, json, rateLimit, readJson } from '@/lib/server/http';
import { newOrderId } from '@/lib/server/ids';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PURCHASABLE = new Set(['bucket', 'custom', 'sub', 'addon', 'pass']);

/**
 * Creates a UPI order. The price ALWAYS comes from the server-side catalog — the browser only names the plan.
 * Response contains the UPI deep link (payee is hard-wired to UPI_VPA).
 */
export const POST = handle(async (req) => {
  const user = await requireUser(req);
  rateLimit(`order:${user.uid}`, 10, 60_000);

  const body = await readJson<{ planId?: string; inr?: number }>(req);
  const plan = C.byId[String(body.planId || '')];
  if (!plan || !PURCHASABLE.has(plan.kind) || C.PHASES[plan.phase] === false) {
    throw new HttpError(400, 'This plan cannot be purchased.', 'bad_plan');
  }

  let amountInr: number;
  if (plan.kind === 'custom') {
    const cr = C.customRecharge(body.inr);
    if (!cr) throw new HttpError(400, 'Enter an amount between ₹1 and ₹1,00,000.', 'bad_amount');
    amountInr = cr.inr;
  } else {
    if (!(plan.price > 0)) throw new HttpError(400, 'This plan is not a paid plan.', 'bad_plan');
    amountInr = plan.price;
  }

  const db = adminDb();

  if (plan.studentOnly) {
    const s = await db.doc(`studentVerifications/${user.uid}`).get();
    if (s.data()?.status !== 'verified') throw new HttpError(403, 'Verify your Student ID to buy this plan.', 'student_only');
  }

  const now = Date.now();
  const open = await db.collection('orders').where('uid', '==', user.uid).where('status', '==', 'created').get();
  const live = open.docs.filter((d) => (d.data().expiresAt ?? 0) > now);
  if (live.length >= MAX_OPEN_ORDERS) {
    throw new HttpError(429, 'You already have several unpaid orders. Finish or wait for them to expire.', 'too_many_orders');
  }

  /* unique payable amount: price + k paise, so every open order is distinguishable in the bank's credit alert */
  const openPay = await db.collection('orders').where('status', 'in', ['created', 'pending_verification']).limit(500).get();
  const taken = new Set(openPay.docs.filter((d) => (d.data().expiresAt ?? 0) > now - 24 * 3600_000).map((d) => Math.round((d.data().payAmountInr ?? d.data().amountInr) * 100)));
  const basePaise = Math.round(amountInr * 100);
  let k = 0;
  while (k < 50 && taken.has(basePaise + k)) k++;
  if (k >= 50) throw new HttpError(429, 'Too many payments in progress for this amount. Try again in a few minutes.', 'busy');
  const payAmountInr = (basePaise + k) / 100;

  const orderId = newOrderId();
  const order: OrderDoc = {
    uid: user.uid,
    email: user.email,
    planId: plan.id,
    planName: plan.name,
    amountInr,
    payAmountInr,
    custom: plan.kind === 'custom',
    status: 'created',
    createdAt: now,
    expiresAt: now + ORDER_TTL_MS,
  };
  await db.doc(`orders/${orderId}`).create(order);

  return json({
    ok: true,
    orderId,
    amountInr,
    payAmountInr,
    expiresAt: order.expiresAt,
    vpa: UPI_VPA,
    payee: UPI_PAYEE_NAME,
    note: paymentNote(orderId),
    upiUri: buildUpiUri({ vpa: UPI_VPA, payeeName: UPI_PAYEE_NAME, amountInr: payAmountInr, note: paymentNote(orderId), ref: orderId }),
  });
});
