import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUpiUri, formatAmount, isValidUtr, isValidVpa, paymentNote, sanitizeNote } from '../src/lib/upi';
import { UPI_VPA } from '../src/lib/constants';

test('permanent UPI id is valid and exact', () => {
  assert.equal(UPI_VPA, 'zikreameen@okhdfcbank');
  assert.ok(isValidVpa(UPI_VPA));
});
test('vpa / utr validation', () => {
  assert.ok(!isValidVpa('nope'));
  assert.ok(!isValidVpa('a@b'));
  assert.ok(isValidUtr('123456789012'));
  assert.ok(!isValidUtr('12345678901'));
  assert.ok(!isValidUtr('12345678901a'));
});
test('amount formatting + bounds', () => {
  assert.equal(formatAmount(49), '49.00');
  assert.equal(formatAmount(0.5 + 0.5), '1.00');
  assert.throws(() => formatAmount(0));
  assert.throws(() => formatAmount(100001));
  assert.throws(() => formatAmount(NaN));
});
test('upi uri', () => {
  const u = buildUpiUri({ vpa: UPI_VPA, payeeName: 'Zikriyon AI', amountInr: 49, note: paymentNote('ZKABCD1234'), ref: 'ZKABCD1234' });
  assert.equal(u, 'upi://pay?pa=zikreameen@okhdfcbank&pn=Zikriyon%20AI&am=49.00&cu=INR&tn=Zikriyon%20ZKABCD1234&tr=ZKABCD1234');
});
test('note sanitising strips unsafe chars', () => {
  assert.equal(sanitizeNote('a&b=c?<x>'), 'abcx');
  assert.ok(sanitizeNote('x'.repeat(200)).length <= 50);
});
test('invalid payee vpa rejected', () => {
  assert.throws(() => buildUpiUri({ vpa: 'bad', payeeName: 'x', amountInr: 5 }));
});
