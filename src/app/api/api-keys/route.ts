
import { randomBytes, createHash } from 'node:crypto';
import { requireUser } from '@/lib/server/auth';
import { adminDb } from '@/lib/server/firebase-admin';
import {
  HttpError,
  handle,
  json,
  readJson,
  rateLimit,
} from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const hashKey = (key: string) =>
  createHash('sha256').update(key).digest('hex');

export const POST = handle(async (req) => {
  const user = await requireUser(req);

  rateLimit(`api-keys:${user.uid}`, 10, 60_000);

  const body = await readJson<{
    action?: string;
    name?: string;
    id?: string;
  }>(req);

  const db = adminDb();
  const collection = db
    .collection('users')
    .doc(user.uid)
    .collection('apiKeys');

  if (body.action === 'create') {
    const name = String(body.name || 'key')
      .trim()
      .slice(0, 40);

    if (!name) {
      throw new HttpError(400, 'Enter a key name.');
    }

    const existing = await collection
      .where('revoked', '==', false)
      .get();

    if (existing.size >= 10) {
      throw new HttpError(400, 'Maximum 10 active keys allowed.');
    }

    const key = 'zik_' + randomBytes(32).toString('hex');
    const doc = collection.doc();

    await doc.set({
      name,
      prefix: key.slice(0, 12),
      hash: hashKey(key),
      ts: Date.now(),
      calls: 0,
      revoked: false,
    });

    return json({
      ok: true,
      id: doc.id,
      key,
    });
  }

  if (body.action === 'revoke') {
    const id = String(body.id || '');

    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) {
      throw new HttpError(400, 'Invalid key ID.');
    }

    const ref = collection.doc(id);
    const snap = await ref.get();

    if (!snap.exists) {
      throw new HttpError(404, 'API key not found.');
    }

    await ref.update({
      revoked: true,
      revokedAt: Date.now(),
    });

    return json({ ok: true });
  }

  throw new HttpError(400, 'Invalid action.');
});
