import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseBankAlert } from '../src/lib/bank-alert';

// NOTE: wording below is representative; tune with a real masked SMS from your bank.
test('typical credit SMS', () => {
  const r = parseBankAlert('Rs.49.07 Credited to your A/c XXXXXX1234 on 27-10-26 by UPI Ref No 123456789012. -BOB');
  assert.deepEqual(r, { credit: true, amountPaise: 4907, utr: '123456789012' });
});
test('INR with commas, labelled UTR', () => {
  const r = parseBankAlert('INR 1,299.00 credited in a/c ending 4321. UTR: 998877665544 Avl Bal INR 5,000.00');
  assert.equal(r.amountPaise, 129900);
  assert.equal(r.utr, '998877665544');
  assert.ok(r.credit);
});
test('payment-app notification without UTR', () => {
  const r = parseBankAlert('Received ₹49 from RAHUL KUMAR');
  assert.deepEqual(r, { credit: true, amountPaise: 4900, utr: null });
});
test('debit SMS is not a credit', () => {
  const r = parseBankAlert('Rs.500.00 debited from A/c XX1234 on 27-10-26 UPI Ref 123456789012 paid to SHOP');
  assert.equal(r.credit, false);
});
test('garbage', () => {
  const r = parseBankAlert('hello');
  assert.deepEqual(r, { credit: false, amountPaise: null, utr: null });
});
