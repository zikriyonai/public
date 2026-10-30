/** Tiny event bus so non-React modules (wallet store, projects store) can raise toasts. */
export type ToastType = 'success' | 'error' | 'warning' | 'info';
export interface ToastEvent {
  id: number;
  message: string;
  type: ToastType;
  duration: number;
}

const listeners = new Set<(t: ToastEvent) => void>();
let seq = 0;

export function toast(message: string, type: ToastType = 'info', duration = 3000): void {
  const evt: ToastEvent = { id: ++seq, message, type, duration };
  listeners.forEach((fn) => fn(evt));
}

export function onToast(fn: (t: ToastEvent) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
