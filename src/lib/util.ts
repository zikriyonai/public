export function escapeHtml(str: unknown): string {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function formatTime(ts: number = Date.now()): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatRelative(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today ' + formatTime(ts);
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday ' + formatTime(ts);
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' · ' + formatTime(ts);
}

export function makeSessionId(email?: string | null): string {
  const d = new Date();
  const date = d.toISOString().slice(0, 10).replace(/-/g, '');
  const time = d.toTimeString().slice(0, 8).replace(/:/g, '');
  const who = email ? email.split('@')[0].replace(/[^a-z0-9]/gi, '') : 'guest';
  return `T-${who}-chat-${date}-${time}`;
}

export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return new Promise((resolve, reject) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      resolve();
    } catch (e) {
      reject(e);
    }
    document.body.removeChild(ta);
  });
}

export function download(filename: string, content: string, mime = 'text/plain'): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    const v = JSON.parse(raw);
    return v == null ? fallback : (v as T);
  } catch {
    return fallback;
  }
}

export function lsSet(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

let audioCtx: AudioContext | null = null;
export function beep(enabled: boolean, freq = 660, dur = 0.08): void {
  if (!enabled) return;
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = audioCtx || new AC();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'sine';
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.06, audioCtx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    o.connect(g);
    g.connect(audioCtx.destination);
    o.start();
    o.stop(audioCtx.currentTime + dur);
  } catch {
    /* audio is optional */
  }
}

/** local-storage keys owned by the wallet — never wiped by "Reset app" */
export const WALLET_KEYS = ['zikriyon-wallet-v1', 'zikriyon-notes-v1'];

/** "Reset" button: wipe everything except the wallet (it holds paid credits). */
export function resetLocalData(): void {
  const keep = WALLET_KEYS.map((k) => [k, localStorage.getItem(k)] as const);
  localStorage.clear();
  keep.forEach(([k, v]) => {
    if (v != null) localStorage.setItem(k, v);
  });
}
