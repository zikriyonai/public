import 'server-only';
import { adminAuth } from './firebase-admin';
import { HttpError } from './http';

export interface AuthedUser {
  uid: string;
  email: string | null;
  emailVerified: boolean;
}

function bearer(req: Request): string | null {
  const h = req.headers.get('authorization') || '';
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

/** Verifies the Firebase ID token in `Authorization: Bearer …`. */
export async function requireUser(req: Request): Promise<AuthedUser> {
  const token = bearer(req);
  if (!token) throw new HttpError(401, 'Please sign in.', 'unauthenticated');
  try {
    const d = await adminAuth().verifyIdToken(token);
    return { uid: d.uid, email: d.email ?? null, emailVerified: !!d.email_verified };
  } catch {
    throw new HttpError(401, 'Session expired. Please sign in again.', 'unauthenticated');
  }
}

/** Same as requireUser but returns null for guests instead of throwing. */
export async function optionalUser(req: Request): Promise<AuthedUser | null> {
  if (!bearer(req)) return null;
  try {
    return await requireUser(req);
  } catch {
    return null;
  }
}

export const adminEmails = (): string[] =>
  (process.env.ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/** Admin = verified e-mail that is listed in ADMIN_EMAILS. */
export async function requireAdmin(req: Request): Promise<AuthedUser> {
  const u = await requireUser(req);
  if (!u.email || !u.emailVerified || !adminEmails().includes(u.email.toLowerCase())) {
    throw new HttpError(403, 'Admin access only.', 'forbidden');
  }
  return u;
}
