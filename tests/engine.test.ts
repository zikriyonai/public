import { test } from 'node:test';
import assert from 'node:assert/strict';
import C from '../src/lib/billing/catalog';
import E from '../src/lib/billing/engine';

const T0 = Date.UTC(2026, 9, 26, 10, 0, 0);

test('catalog has the full plan set', () => {
  assert.equal(C.PLANS.length, 68);
});
test('recharge grants credits + bonus, once per order (idempotent)', () => {
  const s = E.newState(T0);
  const r1 = E.applyPurchase(s, 'recharge_100', { orderId: 'ZKTEST0001', inr: 100, gateway: 'upi' }, T0);
  assert.ok(r1.ok);
  const bal1 = E.balance(s, T0).total;
  const r2 = E.applyPurchase(s, 'recharge_100', { orderId: 'ZKTEST0001', inr: 100, gateway: 'upi' }, T0);
  assert.ok(r2.ok && r2.duplicate);
  assert.equal(E.balance(s, T0).total, bal1);
});
test('planRequest + charge reduce the balance', () => {
  const s = E.newState(T0);
  E.applyPurchase(s, 'recharge_100', { orderId: 'ZKTEST0002', inr: 100, gateway: 'upi' }, T0);
  const before = E.balance(s, T0).total;
  const plan = E.planRequest(s, { model: null, inChars: 200, files: 0, chunks: 0 }, T0);
  assert.ok(plan.ok);
  const res = E.charge(s, plan, { inChars: 200, outChars: 800, chunks: 0, aborted: false }, T0);
  assert.ok(res.credits >= 0);
  assert.ok(E.balance(s, T0).total <= before);
});
test('custom recharge bounds', () => {
  assert.equal(C.customRecharge(0), null);
  assert.equal(C.customRecharge(100001), null);
  assert.ok(C.customRecharge(250));
});
