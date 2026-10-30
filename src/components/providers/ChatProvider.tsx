'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import E from '@/lib/billing/engine';
import { callZikriyon, warmUp, type HistoryPair } from '@/lib/chat-api';
import { noteExtras, planNow, settle } from '@/lib/metering';
import { projectsStore } from '@/lib/projects-store';
import { clearAllSessions, deleteSession, listSessions, saveSession, type ChatItem, type EditVersion, type SessionDoc } from '@/lib/sessions';
import { toast } from '@/lib/ui-bus';
import { beep, lsGet, makeSessionId } from '@/lib/util';
import { bridge, open as openPanelDef } from '@/lib/panels';
import { readFileText } from '@/lib/projects-store';
import { useAuth } from './AuthProvider';
import { useUI } from './UIProvider';

/* eslint-disable @typescript-eslint/no-explicit-any */
export interface AttachedFile {
  name: string;
  type: string;
  size: number;
  isImage: boolean;
  dataURL: string;
  /** extracted text (txt/csv/json/md/pdf/docx) — appended to the prompt */
  text?: string;
}
export interface Msg {
  id: string;
  role: 'user' | 'bot';
  text: string;
  files?: AttachedFile[];
  loading?: boolean;
  streaming?: boolean;
  error?: boolean;
  cost?: string;
  versions?: EditVersion[];
  /** set when the user edited this prompt (shows the Regenerate row until a newer answer exists) */
  editedAt?: number;
  time: number;
}

export const MODEL_LABELS: Record<string, string> = { 'zikos-tiny': 'ZIKOS-Tiny', 'zikos-lite': 'ZIKOS-Lite', 'zikos-base': 'ZIKOS-Base', 'zikos-delta': 'ZIKOS-Delta', image: 'ZIKOS-Img' };
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const TEXT_EXT = ['txt', 'md', 'csv', 'json', 'pdf', 'docx'];
const uid = () => Math.random().toString(36).slice(2, 10);

interface ChatCtx {
  items: Msg[];
  responding: boolean;
  model: string;
  setModel: (m: string) => void;
  files: AttachedFile[];
  addFiles: (list: FileList | File[]) => void;
  removeFile: (i: number) => void;
  send: (text: string) => boolean;
  stop: () => void;
  regenerateFrom: (index: number) => void;
  regenerateLast: () => void;
  editMessage: (index: number, text: string) => void;
  restoreVersion: (index: number, v: number) => void;
  newChat: () => void;
  loadSession: (s: SessionDoc) => void;
  sessions: SessionDoc[];
  sessionId: string;
  refreshSessions: () => Promise<void>;
  removeSession: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  toHistory: () => ChatItem[];
  scrollTick: number;
}
const Ctx = createContext<ChatCtx | null>(null);
export const useChat = (): ChatCtx => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useChat outside provider');
  return v;
};

export function ChatProvider({ children }: { children: ReactNode }) {
  const { user, getIdToken, ready } = useAuth();
  const ui = useUI();
  const [items, setItems] = useState<Msg[]>([]);
  const [responding, setResponding] = useState(false);
  const [model, setModelState] = useState('zikos-lite');
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [sessions, setSessions] = useState<SessionDoc[]>([]);
  const [sessionId, setSessionId] = useState('');
  const [scrollTick, setScrollTick] = useState(0);

  const itemsRef = useRef<Msg[]>([]);
  const ctl = useRef<AbortController | null>(null);
  const userRef = useRef(user);
  const sidRef = useRef('');
  const modelRef = useRef(model);
  const settingsRef = useRef(ui.settings);
  userRef.current = user;
  modelRef.current = model;
  settingsRef.current = ui.settings;
  itemsRef.current = items;

  const commit = useCallback((next: Msg[] | ((p: Msg[]) => Msg[])) => {
    setItems((p) => {
      const n = typeof next === 'function' ? next(p) : next;
      itemsRef.current = n;
      return n;
    });
  }, []);
  const bump = () => setScrollTick((t) => t + 1);

  /* ---------------- derived chat history (same shape the original stored) ---------------- */
  const toHistory = useCallback((src: Msg[] = itemsRef.current): ChatItem[] =>
    src
      .filter((m) => !m.loading && !(m.role === 'bot' && m.error))
      .map((m) => {
        const c: ChatItem = { role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] };
        if (m.versions && m.versions.length) c.editHistory = m.versions;
        return c;
      }), []);

  const pairsBefore = (src: Msg[], endExclusive: number): HistoryPair[] => {
    const pairs: HistoryPair[] = [];
    const arr = src.slice(0, endExclusive).filter((m) => !m.loading && !m.error);
    for (let i = 0; i < arr.length - 1; i++) {
      if (arr[i].role === 'user' && arr[i + 1].role === 'bot') {
        pairs.push({ user: arr[i].text, bot: arr[i + 1].text });
        i++;
      }
    }
    return pairs.slice(-10);
  };

  /* ---------------- sessions ---------------- */
  const refreshSessions = useCallback(async () => {
    setSessions(await listSessions(userRef.current));
  }, []);

  const persist = useCallback(async () => {
    const hist = toHistory();
    if (!hist.length) return;
    const first = hist.find((m) => m.role === 'user')?.parts[0].text || 'New Chat';
    const s: SessionDoc = {
      id: sidRef.current,
      title: first.length > 55 ? first.slice(0, 55) + '…' : first,
      timestamp: Date.now(),
      lastUpdated: Date.now(),
      messages: hist,
      messageCount: hist.length,
      model: modelRef.current,
    };
    await saveSession(userRef.current, s);
    projectsStore.link(sidRef.current);
    await refreshSessions();
  }, [toHistory, refreshSessions]);

  /* ---------------- generation ---------------- */
  const generate = useCallback(
    async (botId: string, userText: string, attached: AttachedFile[], userIndex: number, plan: any) => {
      const controller = new AbortController();
      ctl.current = controller;
      setResponding(true);
      const patch = (p: Partial<Msg>) => commit((arr) => arr.map((m) => (m.id === botId ? { ...m, ...p } : m)));
      const finish = () => {
        setResponding(false);
        ctl.current = null;
      };

      if (!navigator.onLine) {
        patch({ loading: false, text: "I can't reach the Zikriyon AI service right now — please check your internet connection.", error: true });
        toast('No internet connection', 'error');
        finish();
        return;
      }
      if (modelRef.current === 'image') {
        patch({ loading: false, error: true, text: 'Image generation is not available on this model yet. Switch to a chat model.' });
        finish();
        return;
      }

      /* 1) plan was computed (and limits enforced) before the message was added */
      if (plan) noteExtras(plan);

      /* 2) compose: project context + attached text files */
      const fileText = attached
        .filter((f) => f.text)
        .map((f) => `\n\n[Attached file: ${f.name}]\n${(f.text as string).slice(0, 20000)}`)
        .join('');
      const base = userText + fileText;
      const composed = plan.project && plan.project.prefix ? `${plan.project.prefix}\n\n${base}` : base;
      const history = E.fitHistory(pairsBefore(itemsRef.current, userIndex), plan.ctxK, plan.msgChars || 0);

      let got = '';
      let aborted = false;
      try {
        const idToken = await getIdToken();
        const full = await callZikriyon(
          { message: composed, history, userId: userRef.current ? userRef.current.uid : 'guest_' + sidRef.current, signal: controller.signal, idToken },
          (partial) => {
            got = partial;
            patch({ loading: false, streaming: true, text: partial });
            if (settingsRef.current.autoScroll) bump();
          },
        );
        got = full;
        if (!full.trim()) {
          patch({ loading: false, streaming: false, text: 'Koi jawab nahi aaya. Dobara try karo.', error: true });
        } else {
          const cost = settle(plan, composed, full.length, false);
          patch({ loading: false, streaming: false, text: full, cost });
          beep(settingsRef.current.sound, 780, 0.07);
          await persist();
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          aborted = true;
          const partial = got.trim();
          if (partial.length > 20) {
            const cost = settle(plan, composed, got.length, true);
            patch({ loading: false, streaming: false, text: got, cost });
            await persist();
          } else {
            patch({ loading: false, streaming: false, text: 'Response stopped.' });
          }
        } else {
          console.error(err);
          patch({ loading: false, streaming: false, error: true, text: err?.message || 'Something went wrong.' });
        }
      } finally {
        finish();
        bump();
        void aborted;
      }
    },
    [commit, getIdToken, persist],
  );

  /* ---------------- public actions ---------------- */
  const send = useCallback(
    (text: string) => {
      const t = text.trim();
      if (!t || responding) return false;
      const attached = files;
      let plan: any = null;
      if (modelRef.current !== 'image') {
        plan = planNow(t, attached.length, modelRef.current);
        if (!plan.ok) {
          openPanelDef('limit', plan);
          return false;
        }
      }
      const userMsg: Msg = { id: uid(), role: 'user', text: t, files: attached, time: Date.now() };
      const botMsg: Msg = { id: uid(), role: 'bot', text: '', loading: true, time: Date.now() };
      const userIndex = itemsRef.current.length;
      commit((p) => [...p, userMsg, botMsg]);
      setFiles([]);
      beep(settingsRef.current.sound, 520, 0.05);
      bump();
      window.setTimeout(() => void generate(botMsg.id, t, attached, userIndex, plan), 380);
      return true;
    },
    [responding, files, commit, generate],
  );

  const stop = useCallback(() => {
    ctl.current?.abort();
    toast('Response stopped', 'warning');
  }, []);

  const regenerateFrom = useCallback(
    (index: number) => {
      if (responding) return;
      const cur = itemsRef.current;
      const u = cur[index];
      if (!u || u.role !== 'user') return;
      let plan: any = null;
      if (modelRef.current !== 'image') {
        plan = planNow(u.text, (u.files || []).length, modelRef.current);
        if (!plan.ok) return openPanelDef('limit', plan);
      }
      const botMsg: Msg = { id: uid(), role: 'bot', text: '', loading: true, time: Date.now() };
      commit([...cur.slice(0, index + 1), botMsg]);
      bump();
      window.setTimeout(() => void generate(botMsg.id, u.text, u.files || [], index, plan), 260);
    },
    [responding, commit, generate],
  );
  const regenerateLast = useCallback(() => {
    const cur = itemsRef.current;
    for (let i = cur.length - 1; i >= 0; i--) {
      if (cur[i].role === 'user') {
        toast('Regenerating…', 'info');
        return regenerateFrom(i);
      }
    }
    toast('Nothing to refresh', 'info');
  }, [regenerateFrom]);

  const editMessage = useCallback(
    (index: number, text: string) => {
      const cur = itemsRef.current;
      const m = cur[index];
      const val = text.trim();
      if (!m || !val || val === m.text) return;
      commit(cur.map((x, i) => (i === index ? { ...x, text: val, editedAt: Date.now(), versions: [...(x.versions || []), { text: m.text, timestamp: Date.now() }] } : x)));
      toast('Message updated', 'success');
      void persist();
    },
    [commit, persist],
  );
  const restoreVersion = useCallback(
    (index: number, v: number) => {
      const cur = itemsRef.current;
      const m = cur[index];
      const ver = m?.versions?.[v];
      if (!m || !ver) return;
      commit(cur.map((x, i) => (i === index ? { ...x, text: ver.text, editedAt: Date.now(), versions: [...(x.versions || []), { text: m.text, timestamp: Date.now() }] } : x)));
      toast('Version restored', 'success');
      void persist();
    },
    [commit, persist],
  );

  const newChat = useCallback(() => {
    ctl.current?.abort();
    commit([]);
    setFiles([]);
    const id = makeSessionId(userRef.current?.email);
    sidRef.current = id;
    setSessionId(id);
    setResponding(false);
    void refreshSessions();
  }, [commit, refreshSessions]);

  const loadSession = useCallback(
    (s: SessionDoc) => {
      ctl.current?.abort();
      sidRef.current = s.id;
      setSessionId(s.id);
      commit(
        (s.messages || []).map((m) => ({
          id: uid(),
          role: m.role === 'user' ? 'user' : 'bot',
          text: m.parts?.[0]?.text || '',
          versions: m.editHistory,
          time: s.timestamp,
        })) as Msg[],
      );
      ui.closeAll();
      bump();
      toast('Conversation loaded', 'success');
    },
    [commit, ui],
  );

  const removeSession = useCallback(
    async (id: string) => {
      await deleteSession(userRef.current, id);
      if (id === sidRef.current) newChat();
      else await refreshSessions();
      toast('Conversation deleted', 'success');
    },
    [newChat, refreshSessions],
  );
  const clearHistory = useCallback(async () => {
    await clearAllSessions(userRef.current);
    newChat();
    toast('All history cleared', 'success');
  }, [newChat]);

  const setModel = useCallback((m: string) => {
    setModelState(m);
    try {
      localStorage.setItem('zikriyon-model', m);
    } catch {
      /* ignore */
    }
  }, []);

  /* ---------------- files ---------------- */
  const addFiles = useCallback((list: FileList | File[]) => {
    Array.from(list).forEach((file) => {
      if (file.size > MAX_FILE_SIZE) return toast(`${file.name} is too large (max 5 MB)`, 'error');
      const reader = new FileReader();
      reader.onerror = () => toast(`Could not read ${file.name}`, 'error');
      reader.onload = async () => {
        const isImage = file.type.startsWith('image/');
        const ext = (file.name.split('.').pop() || '').toLowerCase();
        let text: string | undefined;
        if (!isImage && TEXT_EXT.includes(ext)) {
          try {
            text = (await readFileText(file)).trim();
          } catch (e: any) {
            toast(e?.message || `Could not read text of ${file.name}`, 'warning');
          }
        }
        setFiles((p) => [...p, { name: file.name, type: file.type, size: file.size, isImage, dataURL: String(reader.result), text }]);
      };
      reader.readAsDataURL(file);
    });
  }, []);
  const removeFile = useCallback((i: number) => setFiles((p) => p.filter((_, k) => k !== i)), []);

  /* ---------------- lifecycle ---------------- */
  useEffect(() => {
    const m = localStorage.getItem('zikriyon-model');
    if (m && MODEL_LABELS[m]) setModelState(m);
    const id = makeSessionId(null);
    sidRef.current = id;
    setSessionId(id);
    warmUp();
  }, []);
  useEffect(() => {
    if (ready) void refreshSessions();
  }, [ready, user, refreshSessions]);

  /* body classes the original CSS depends on */
  useEffect(() => {
    document.body.classList.toggle('chats-active', items.length > 0);
    document.body.classList.toggle('bot-responding', responding);
  }, [items.length, responding]);

  /* let the (framework-free) panels reach into chat */
  useEffect(() => {
    bridge.loadSession = loadSession;
    bridge.resetChat = newChat;
    bridge.setModel = setModel;
  }, [loadSession, newChat, setModel]);

  const value = useMemo<ChatCtx>(
    () => ({ items, responding, model, setModel, files, addFiles, removeFile, send, stop, regenerateFrom, regenerateLast, editMessage, restoreVersion, newChat, loadSession, sessions, sessionId, refreshSessions, removeSession, clearHistory, toHistory, scrollTick }),
    [items, responding, model, setModel, files, addFiles, removeFile, send, stop, regenerateFrom, regenerateLast, editMessage, restoreVersion, newChat, loadSession, sessions, sessionId, refreshSessions, removeSession, clearHistory, toHistory, scrollTick],
  );
  void lsGet;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
