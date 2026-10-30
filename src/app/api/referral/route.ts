import { requireUser } from '@/lib/server/auth';
import { adminDb } from '@/lib/server/firebase-admin';
import { HttpError, handle, json, rateLimit, readJson } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_REFERRALS = 50; // keep in sync with REWARDS.referral.maxReferrals

/**
 * Redeem a friend's referral code. The server confirms it and writes one reward grant for each side
 * (users/{uid}/grants/…); the clients apply those grants to their wallet (idempotent by `ref`).
 */
export const POST = handle(async (req) => {
  const user = await requireUser(req);
  rateLimit(`ref:${user.uid}`, 5, 60_000);
  const body = await readJson<{ code?: string }>(req);
  const code = String(body.code || '').trim().toUpperCase();
  if (!/^ZIK[A-Z0-9]{6}$/.test(code)) throw new HttpError(400, 'That referral code looks invalid.', 'bad_code');

  const db = adminDb();
  const codeSnap = await db.doc(`referralCodes/${code}`).get();
  const inviterUid = codeSnap.data()?.uid as string | undefined;
  if (!codeSnap.exists || !inviterUid) throw new HttpError(404, 'Referral code not found.', 'not_found');
  if (inviterUid === user.uid) throw new HttpError(400, "That's your own code 🙂", 'self');

  const count = (
    await db.collection('referralClaims').where('inviterUid', '==', inviterUid).where('status', '==', 'confirmed').count().get()
  ).data().count;
  if (count >= MAX_REFERRALS) throw new HttpError(409, 'This code has reached its referral limit.', 'cap');

  const ref = `${code}:${user.uid}`;
  const now = Date.now();
  await db.runTransaction(async (tx) => {
    const claimRef = db.doc(`referralClaims/${user.uid}`);
    if ((await tx.get(claimRef)).exists) throw new HttpError(409, 'You already used a referral code.', 'already');
    tx.create(claimRef, { uid: user.uid, code, inviterUid, status: 'confirmed', ts: now });
    tx.set(db.doc(`users/${user.uid}/grants/ref-in-${user.uid}`), { type: 'referral', role: 'invitee', ref, createdAt: now });
    tx.set(db.doc(`users/${inviterUid}/grants/ref-out-${user.uid}`), { type: 'referral', role: 'inviter', ref, createdAt: now });
  });

  return json({ ok: true });
});
