/**
 * Payment constants — single source of truth.
 * The UPI ID is fixed on the SERVER (env UPI_VPA, default below): every payment link is built from it,
 * the browser never gets to choose the payee.
 */
export const UPI_VPA = process.env.UPI_VPA || 'zikreameen@okhdfcbank';
export const UPI_PAYEE_NAME = 'Zikriyon AI';

/** An unpaid order stays valid this long. */
export const ORDER_TTL_MS = 30 * 60 * 1000;

/** Max simultaneously open (unpaid) orders per user. */
export const MAX_OPEN_ORDERS = 5;

export type OrderStatus =
  | 'created' // order made, waiting for the user to pay + submit the UTR
  | 'pending_verification' // UTR submitted, waiting for admin
  | 'approved' // credits granted
  | 'rejected'; // could not be matched to a real payment

export interface OrderDoc {
  uid: string;
  email: string | null;
  planId: string;
  planName: string;
  /** plan price (what the wallet is credited for) */
  amountInr: number;
  /** exact amount the payer must send: price + 0..49 paise so concurrent orders are distinguishable in bank alerts */
  payAmountInr: number;
  custom: boolean;
  status: OrderStatus;
  createdAt: number;
  expiresAt: number;
  utr?: string;
  submittedAt?: number;
  decidedAt?: number;
  decidedBy?: string;
  /** approved automatically from a bank credit alert (see /api/payments/webhook) */
  autoVerified?: boolean;
  note?: string;
}
