/* eslint-disable @typescript-eslint/no-explicit-any */
import C from '../billing/catalog';
import { toast } from '../ui-bus';

/**
 * Panel framework.
 * Panels are the original app's template renderers (render(arg) → HTML string, actions via data-a delegation).
 * React only hosts them (components/PanelHost.tsx): it mounts the modal chrome, injects the HTML, and wires events.
 */
export interface PanelDef {
  title: string;
  cls?: string;
  sheet?: boolean;
  arg?: any;
  _loading?: boolean;
  render: (arg?: any) => string;
  init?: (el: HTMLElement) => void;
  after?: (body: HTMLElement, el: HTMLElement) => void;
  input?: (t: any, e: Event) => void;
  change?: (t: any, e: Event) => void;
  submit?: (form: any, e: Event) => void;
  actions?: Record<string, (b: any, e: Event) => any>;
}
export const panels: Record<string, PanelDef> = {};
export const registerPanel = (id: string, def: PanelDef) => {
  panels[id] = def;
};

/** wired by React providers */
export const bridge = {
  open: (_id: string) => {},
  close: (_id: string) => {},
  rerender: (_id: string) => {},
  isOpen: (_id: string): boolean => false,
  openModal: (_id: string, _arg?: any) => {},
  closeAll: () => {},
  getUser: (): any => null,
  loadSession: (_s: any) => {},
  resetChat: () => {},
  setModel: (_key: string) => {},
};

export function open(id: string, arg?: any) {
  const def = panels[id];
  if (!def) return;
  if (arg !== undefined) def.arg = arg;
  bridge.open(id);
}
export const close = (id: string) => bridge.close(id);
export const render = (id: string) => bridge.rerender(id);
export const isOpen = (id: string) => bridge.isOpen(id);
export const user = (): any => bridge.getUser();
export const T = (m: string, t: 'success' | 'error' | 'warning' | 'info' = 'info') => toast(m, t);

/* ---------- shared view helpers (verbatim from the original) ---------- */
export const esc = (s: unknown) =>
  String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
export const ic = (n: string, cls?: string) => `<span class="material-symbols-rounded${cls ? ' ' + cls : ''}">${n}</span>`;
export const fmtC = (n: number) => C.fmtCredits(n);
export const inr = (n: number) => C.fmtInr(n);
export const now = () => Date.now();
export const $ = (s: string, r: ParentNode = document) => r.querySelector(s) as any;
export const $$ = (s: string, r: ParentNode = document) => Array.from(r.querySelectorAll(s)) as any[];
export const val = (id: string) => {
  const e = document.getElementById(id) as HTMLInputElement | null;
  return e ? e.value.trim() : '';
};

export const fmtDate = (ts: number) => new Date(ts).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' });
export const fmtDateTime = (ts: number) => new Date(ts).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export function fmtCompact(n: number) {
  n = Math.floor(n);
  if (n < 1000) return String(n);
  if (n < 1e5) return (n / 1000).toFixed(n < 1e4 ? 1 : 0).replace(/\.0$/, '') + 'K';
  if (n < 1e7) return (n / 1e5).toFixed(n < 1e6 ? 1 : 0).replace(/\.0$/, '') + 'L';
  return (n / 1e7).toFixed(1).replace(/\.0$/, '') + 'Cr';
}
export function until(ts: number) {
  const ms = ts - now();
  if (ms <= 0) return 'now';
  const d = Math.floor(ms / 864e5), h = Math.floor((ms % 864e5) / 36e5), m = Math.floor((ms % 36e5) / 6e4);
  return d >= 1 ? d + 'd ' + h + 'h' : h >= 1 ? h + 'h ' + m + 'm' : m + 'm';
}
export const modelLabel = (id: string) => (C.MODELS[id] || {}).label || id;
export const modelShort = (models: string[]) => (models.length >= 4 ? 'All ZIT models' : 'ZIT ' + models.map((m) => modelLabel(m).replace('ZIT-', '')).join(' · '));

export const switchBtn = (action: string, on: boolean, extra?: string) =>
  `<button type="button" class="zik-switch${on ? ' on' : ''}" data-a="${action}" ${extra || ''} role="switch" aria-checked="${!!on}"></button>`;
export const rowSwitch = (label: string, sub: string, action: string, on: boolean) =>
  `<div class="row"><span class="k">${esc(label)}${sub ? `<span class="zik-row-sub">${esc(sub)}</span>` : ''}</span>${switchBtn(action, on)}</div>`;
export const empty = (icon: string, text: string) => `<div class="zik-empty">${ic(icon)}${text}</div>`;
