import { optionalUser } from '@/lib/server/auth';
import { HttpError, clientIp, handle, json, rateLimit, readJson } from '@/lib/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const MODEL_API = (process.env.NEXT_PUBLIC_ZIK_API || 'https://api.zikriyonai.linkpc.net').replace(/\/+$/, '');

interface ChatBody {
  message?: string;
  history?: { user?: string; bot?: string }[];
  user_id?: string;
}

/**
 * Optional same-origin proxy for the model server (NEXT_PUBLIC_CHAT_MODE=proxy).
 * The X-API-Key never reaches the browser. Streams the SSE body straight through.
 * NOTE: the model answers slowly on CPU — host this on a platform that allows long streaming responses.
 */
export const POST = handle(async (req) => {
  const key = process.env.ZIK_API_KEY;
  if (!key) throw new HttpError(503, 'Server is not configured (ZIK_API_KEY).', 'not_configured');

  const user = await optionalUser(req);
  const ip = clientIp(req);
  rateLimit(`chat:ip:${ip}`, 12, 60_000);
  if (user) rateLimit(`chat:uid:${user.uid}`, 20, 60_000);

  const body = await readJson<ChatBody>(req, 256 * 1024);
  const message = String(body.message || '').slice(0, 12000);
  if (!message.trim()) throw new HttpError(400, 'Empty message.', 'empty');
  const history = (Array.isArray(body.history) ? body.history : [])
    .slice(-10)
    .map((h) => ({ user: String(h?.user ?? '').slice(0, 6000), bot: String(h?.bot ?? '').slice(0, 6000) }));
  const userId = user ? user.uid : `guest_${String(body.user_id || ip).slice(0, 64)}`;

  const upstream = await fetch(`${MODEL_API}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-API-Key': key },
    body: JSON.stringify({ message, history, user_id: userId }),
    signal: req.signal,
  }).catch(() => null);

  if (!upstream) return json({ ok: false, code: 'upstream_down', message: 'Model server is unreachable.' }, 502);
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    return json({ ok: false, code: 'upstream_error', message: text.slice(0, 300) || `HTTP ${upstream.status}` }, upstream.status === 429 ? 429 : 502);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
});
