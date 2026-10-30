/**
 * Parses a bank credit alert (SMS / e-mail / payment-app notification text) forwarded from the owner's phone.
 * Pure + tolerant: banks change wording, so we look for the *facts* (credit keyword, amount, 12-digit UPI ref).
 */
export interface ParsedAlert {
  /** true only for money RECEIVED (credit) */
  credit: boolean;
  amountPaise: number | null;
  /** 12-digit UPI reference (UTR / RRN) when the alert contains one */
  utr: string | null;
}

const CREDIT_RE = /\b(credited|credit|received|deposited|cr\b)/i;
const DEBIT_RE = /\b(debited|debit|withdrawn|sent to|paid to|purchase|spent|dr\b)/i;
const AMOUNT_RE = /(?:rs\.?|inr|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;
const UTR_LABELLED_RE = /(?:upi\s*ref(?:erence)?(?:\s*(?:no|number|id))?|ref(?:erence)?\s*(?:no|number)|utr|rrn|txn\s*id)\.?\s*[:\-]?\s*(\d{12})\b/i;
const UTR_ANY_RE = /(?<!\d)(\d{12})(?!\d)/;

export function parseBankAlert(textRaw: string): ParsedAlert {
  const text = String(textRaw || '').replace(/\s+/g, ' ').trim().slice(0, 1000);
  const hasCredit = CREDIT_RE.test(text);
  const hasDebit = DEBIT_RE.test(text);
  // "Credited" wins unless the text is clearly a debit and has no credit wording
  const credit = hasCredit && !(hasDebit && !/\b(credited|received|deposited)\b/i.test(text));

  const m = AMOUNT_RE.exec(text);
  const amountPaise = m ? Math.round(parseFloat(m[1].replace(/,/g, '')) * 100) : null;

  const u = UTR_LABELLED_RE.exec(text) || UTR_ANY_RE.exec(text);
  return { credit, amountPaise: Number.isFinite(amountPaise as number) ? amountPaise : null, utr: u ? u[1] : null };
}
