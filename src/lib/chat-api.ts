import { CONFIG } from './config';

export interface HistoryPair {
  user: string;
  bot: string;
}

export interface CallOptions {
  message: string;
  history: HistoryPair[];
  userId: string;
  signal: AbortSignal;
  /** Firebase ID token (proxy mode: lets the server rate-limit per user) */
  idToken?: string | null;
}

/**
 * Streams a reply from the model server (SSE: `data: {"content": "..."}` … `data: [DONE]`).
 * `onChunk` receives the full text so far. Returns the final text.
 *   direct mode → POST {api}/api/chat with X-API-Key (public key)
 *   proxy  mode → POST /api/chat (same-origin Next route, key stays on the server)
 */
export async function callZikriyon(opts: CallOptions, onChunk?: (full: string) => void): Promise<string> {
  const proxy = CONFIG.chatMode === 'proxy';
  const url = proxy ? '/api/chat' : `${CONFIG.api}/api/chat`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (proxy) {
    if (opts.idToken) headers.Authorization = `Bearer ${opts.idToken}`;
  } else {
    if (!CONFIG.apiKey) throw new Error('NEXT_PUBLIC_ZIK_API_KEY set nahi hai (.env.local check karo).');
    headers['X-API-Key'] = CONFIG.apiKey;
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ message: opts.message, history: opts.history, user_id: opts.userId }),
      signal: opts.signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new Error(`ZIKOS server nahi mil raha (${proxy ? 'proxy' : CONFIG.api}). Internet ya server status check karo.`);
  }

  if (!res.ok) {
    let errText = '';
    try {
      errText = await res.text();
      try {
        const j = JSON.parse(errText);
        errText = j.detail || j.message || JSON.stringify(j);
      } catch {
        /* plain text */
      }
    } catch {
      /* ignore */
    }
    if (res.status === 401) throw new Error('401 Unauthorized — API key match nahi kar rahi.');
    if (res.status === 429) throw new Error('Bahut zyada requests — thodi der ruk kar try karo.');
    if (res.status === 503) throw new Error('503 — server busy ya ZIK_API_KEY set nahi hai.');
    if (res.status === 404) throw new Error('404 — /api/chat route exist nahi karta.');
    throw new Error(`HTTP ${res.status}: ${errText}`);
  }

  if (!res.body) throw new Error('Server ne streaming response nahi di.');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';
    for (const evt of events) {
      if (!evt.startsWith('data:')) continue;
      const payload = evt.slice(5).trim();
      if (payload === '[DONE]') return fullText;
      let j: { error?: string; content?: string };
      try {
        j = JSON.parse(payload);
      } catch {
        continue; // partial / non-JSON keep-alive
      }
      if (j.error) throw new Error(j.error);
      if (j.content) {
        fullText += j.content;
        onChunk?.(fullText);
      }
    }
  }
  return fullText;
}

/** Fire-and-forget wake-up ping (the model server may be cold). */
export function warmUp(): void {
  if (CONFIG.chatMode === 'proxy') return;
  fetch(`${CONFIG.api}/health`).catch(() => {});
}
