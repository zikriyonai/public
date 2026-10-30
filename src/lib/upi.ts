/**
 * UPI helpers (NPCI "UPI Linking Specification" deep link).
 *   upi://pay?pa=<vpa>&pn=<name>&am=<amount>&cu=INR&tn=<note>&tr=<ref>
 * Pure functions — no network, fully unit-tested. QR rendering lives in components (qrcode package).
 */

const VPA_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,255}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;
const UTR_RE = /^\d{12}$/;

export const MIN_UPI_AMOUNT = 1;
export const MAX_UPI_AMOUNT = 100000;

export interface UpiParams {
  vpa: string;
  payeeName: string;
  amountInr: number;
  /** shown to the payer & in the bank statement (max 50 chars, no special characters) */
  note?: string;
  /** merchant transaction reference (our order id) */
  ref?: string;
}

export const isValidVpa = (v: string): boolean => VPA_RE.test(v);
export const isValidUtr = (v: string): boolean => UTR_RE.test(v);

/** "49.00" — UPI wants a plain decimal with at most 2 places. */
export function formatAmount(amountInr: number): string {
  if (!Number.isFinite(amountInr)) throw new Error('Invalid amount');
  const cents = Math.round(amountInr * 100);
  if (cents < MIN_UPI_AMOUNT * 100 || cents > MAX_UPI_AMOUNT * 100) {
    throw new Error(`Amount must be between ₹${MIN_UPI_AMOUNT} and ₹${MAX_UPI_AMOUNT}`);
  }
  return (cents / 100).toFixed(2);
}

/** Keep only characters every UPI app accepts; cap the length. */
export function sanitizeNote(note: string, max = 50): string {
  return note.replace(/[^a-zA-Z0-9 ._-]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function buildUpiUri(p: UpiParams): string {
  if (!isValidVpa(p.vpa)) throw new Error('Invalid UPI ID');
  const enc = (s: string) => encodeURIComponent(s);
  const parts = [
    // '@' is kept literal in pa= — older UPI apps do not decode %40 reliably
    `pa=${enc(p.vpa).replace(/%40/g, '@')}`,
    `pn=${enc(sanitizeNote(p.payeeName, 40) || 'Merchant')}`,
    `am=${formatAmount(p.amountInr)}`,
    'cu=INR',
  ];
  if (p.note) parts.push(`tn=${enc(sanitizeNote(p.note))}`);
  if (p.ref) parts.push(`tr=${enc(p.ref.replace(/[^a-zA-Z0-9]/g, '').slice(0, 35))}`);
  return `upi://pay?${parts.join('&')}`;
}

/** Note that appears in the payer's UPI app and bank statement — lets the admin match payments quickly. */
export const paymentNote = (orderId: string): string => sanitizeNote(`Zikriyon ${orderId}`);
