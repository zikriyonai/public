'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { lsGet, lsSet } from '@/lib/util';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Theme = 'light' | 'dark' | 'blue';
export type ModalId = 'model' | 'settings' | 'profile' | 'auth' | 'editHistory' | 'export';
export type PanelId = 'wallet' | 'plans' | 'checkout' | 'limit' | 'billing' | 'usage' | 'rewards' | 'student' | 'contact' | 'notifs' | 'apikeys' | 'help' | 'projects';
export type DrawerId = 'sidebar' | 'auth';
export type ModalState = { kind: 'modal'; id: ModalId; arg?: any } | { kind: 'panel'; id: PanelId; arg?: any } | null;

export interface Settings {
  sound: boolean;
  autoScroll: boolean;
  enterToSend: boolean;
}
export interface Colors {
  color1: string;
  color2: string;
}

interface UICtx {
  theme: Theme;
  setTheme: (t: Theme) => void;
  colors: Colors;
  applyColors: (c: Colors) => void;
  settings: Settings;
  saveSettings: (s: Settings) => void;
  drawer: DrawerId | null;
  openDrawer: (d: DrawerId) => void;
  closeDrawer: (d?: DrawerId) => void;
  modal: ModalState;
  openModal: (id: ModalId, arg?: any) => void;
  openPanel: (id: PanelId, arg?: any) => void;
  closeModal: () => void;
  closeAll: () => void;
}

const Ctx = createContext<UICtx | null>(null);
export const useUI = (): UICtx => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useUI outside provider');
  return v;
};

const THEME_COLOR: Record<Theme, string> = { light: '#E3FDFF', dark: '#0b1020', blue: '#0015FF' };
const DEFAULT_COLORS: Colors = { color1: '#080BFF', color2: '#026692' };

export function UIProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>('light');
  const [colors, setColors] = useState<Colors>(DEFAULT_COLORS);
  const [settings, setSettings] = useState<Settings>({ sound: true, autoScroll: true, enterToSend: true });
  const [drawer, setDrawer] = useState<DrawerId | null>(null);
  const [modal, setModal] = useState<ModalState>(null);

  /* restore persisted preferences once on the client */
  useEffect(() => {
    const t = (localStorage.getItem('zikriyon-theme') as Theme) || 'light';
    setThemeState(['light', 'dark', 'blue'].includes(t) ? t : 'light');
    const c = lsGet<Colors>('zikriyon-colors', DEFAULT_COLORS);
    setColors({ ...DEFAULT_COLORS, ...c });
    const p = lsGet<Partial<Settings>>('zikriyon-prefs', {});
    setSettings({ sound: p.sound !== false, autoScroll: p.autoScroll !== false, enterToSend: p.enterToSend !== false });
  }, []);

  /* theme → <body data-theme> + browser chrome colour */
  useEffect(() => {
    document.body.setAttribute('data-theme', theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[theme] || '#080BFF');
  }, [theme]);

  /* custom accent colours */
  useEffect(() => {
    document.documentElement.style.setProperty('--primary', colors.color1);
    document.documentElement.style.setProperty('--primary-2', colors.color2);
  }, [colors]);

  const setTheme = useCallback((t: Theme) => {
    setThemeState(t);
    try {
      localStorage.setItem('zikriyon-theme', t);
    } catch {
      /* ignore */
    }
  }, []);
  const applyColors = useCallback((c: Colors) => {
    setColors(c);
    lsSet('zikriyon-colors', c);
  }, []);
  const saveSettings = useCallback((s: Settings) => {
    setSettings(s);
    lsSet('zikriyon-prefs', s);
  }, []);

  const openDrawer = useCallback((d: DrawerId) => setDrawer(d), []);
  const closeDrawer = useCallback((d?: DrawerId) => setDrawer((cur) => (d && cur !== d ? cur : null)), []);
  const openModal = useCallback((id: ModalId, arg?: any) => setModal({ kind: 'modal', id, arg }), []);
  const openPanel = useCallback((id: PanelId, arg?: any) => {
    setDrawer(null); // panels replace whatever is open (same as the original)
    setModal({ kind: 'panel', id, arg });
  }, []);
  const closeModal = useCallback(() => setModal(null), []);
  const closeAll = useCallback(() => {
    setDrawer(null);
    setModal(null);
  }, []);

  /* Esc closes everything */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeAll();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [closeAll]);

  const value = useMemo<UICtx>(
    () => ({ theme, setTheme, colors, applyColors, settings, saveSettings, drawer, openDrawer, closeDrawer, modal, openModal, openPanel, closeModal, closeAll }),
    [theme, setTheme, colors, applyColors, settings, saveSettings, drawer, openDrawer, closeDrawer, modal, openModal, openPanel, closeModal, closeAll],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
