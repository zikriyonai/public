import 'server-only';
import { randomInt } from 'node:crypto';

// no 0/O/1/I — easy to read out loud and to match in a bank statement
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newOrderId(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return 'ZK' + s;
}
