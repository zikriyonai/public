// @ts-nocheck
import C from '../billing/catalog';
import { getFirebase } from '../firebase/client';

/** Price text shown on plan cards: INR from the catalog (payments are UPI / INR only). */
export const priceLabel = (plan) => (plan.price == null ? 'Custom' : C.fmtInr(plan.price));

/** Authenticated fetch to our own API routes. */
export async function apiPost(path: string, body: unknown) {
  const u = getFirebase()?.auth.currentUser;
  if (!u) throw Object.assign(new Error('Please sign in to continue.'), { code: 'auth' });
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await u.getIdToken()}` },
    body: JSON.stringify(body),
  });
  let j: any = {};
  try { j = await res.json(); } catch { /* empty */ }
  if (!res.ok) throw Object.assign(new Error(j.message || `Request failed (${res.status})`), { code: j.code });
  return j;
}
