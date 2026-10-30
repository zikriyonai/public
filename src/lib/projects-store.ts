import { deleteDoc, doc, setDoc } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { getFirebase } from './firebase/client';
import { lsGet, lsSet } from './util';
import { toast } from './ui-bus';

/* eslint-disable @typescript-eslint/no-explicit-any */
const PKEY = 'zikriyon-projects-v1';
export const KB_CAP = 1_500_000;

export interface ProjectFile {
  name: string;
  chars: number;
  chunks: string[];
}
export interface Project {
  id: string;
  name: string;
  emoji: string;
  description: string;
  instructions: string;
  model: string;
  files: ProjectFile[];
  pinned: unknown[];
  archived?: boolean;
}
interface PData {
  projects: Project[];
  active: string | null;
  chats: Record<string, string>;
}

/* ---------- chunk + BM25-lite retrieval ---------- */
const tok = (s: string): string[] => s.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [];

export function chunkText(text: string): string[] {
  const out: string[] = [];
  const size = 900;
  const step = 780;
  for (let i = 0; i < text.length; i += step) {
    out.push(text.slice(i, i + size));
    if (i + size >= text.length) break;
  }
  return out;
}

export function retrieve(p: Project, queryText: string, k = 4): { f: string; c: string }[] {
  const chunks: { f: string; c: string }[] = [];
  (p.files || []).forEach((f) => f.chunks.forEach((c) => chunks.push({ f: f.name, c })));
  if (!chunks.length) return [];
  const q = Array.from(new Set(tok(queryText)));
  if (!q.length) return [];
  const docs = chunks.map((x) => {
    const t = tok(x.c);
    const tf: Record<string, number> = {};
    t.forEach((w) => {
      tf[w] = (tf[w] || 0) + 1;
    });
    return { x, tf, len: t.length || 1 };
  });
  const avg = docs.reduce((n, d) => n + d.len, 0) / docs.length;
  const N = docs.length;
  const df: Record<string, number> = {};
  q.forEach((w) => {
    df[w] = docs.filter((d) => d.tf[w]).length;
  });
  return docs
    .map((d) => ({
      x: d.x,
      s: q.reduce((sum, w) => {
        const f = d.tf[w] || 0;
        if (!f) return sum;
        const idf = Math.log(1 + (N - df[w] + 0.5) / (df[w] + 0.5));
        return sum + (idf * (f * 2.2)) / (f + 1.2 * (0.25 + (0.75 * d.len) / avg));
      }, 0),
    }))
    .filter((d) => d.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, k)
    .map((d) => d.x);
}

/* ---------- file reading (txt/md/csv/json/pdf/docx) ---------- */
function loadScript(src: string): Promise<void> {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => res();
    s.onerror = () => rej(new Error('Could not load the reader — check your connection'));
    document.head.appendChild(s);
  });
}

export async function readFileText(file: File): Promise<string> {
  const ext = (file.name.split('.').pop() || '').toLowerCase();
  if (['txt', 'md', 'csv', 'json', 'html', 'js', 'py', 'css', 'xml', 'log', 'tsv', 'yaml', 'yml'].includes(ext)) return file.text();
  const w = window as any;
  if (ext === 'pdf') {
    if (!w.pdfjsLib) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      w.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }
    const pdf = await w.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    let out = '';
    for (let i = 1; i <= Math.min(pdf.numPages, 200); i++) {
      const pg = await pdf.getPage(i);
      const tc = await pg.getTextContent();
      out += tc.items.map((x: any) => x.str).join(' ') + '\n';
    }
    return out;
  }
  if (ext === 'docx') {
    if (!w.mammoth) await loadScript('https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js');
    return (await w.mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() })).value;
  }
  throw new Error('Unsupported file type (use PDF, DOCX, TXT, MD, CSV or JSON)');
}

/* ---------- store ---------- */
class ProjectsStore {
  data: PData = { projects: [], active: null, chats: {} };
  version = 0;
  private started = false;
  private user: User | null = null;
  private listeners = new Set<() => void>();

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = () => this.version;
  private emit() {
    this.version++;
    this.listeners.forEach((l) => l());
  }

  start() {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    this.data = lsGet<PData>(PKEY, { projects: [], active: null, chats: {} });
    this.emit();
  }
  setUser(u: User | null) {
    this.user = u;
  }

  proj = (id: string | null) => (id ? this.data.projects.find((p) => p.id === id) : undefined);
  active = () => this.proj(this.data.active);
  kbSize = () => this.data.projects.reduce((n, p) => n + (p.files || []).reduce((m, f) => m + f.chunks.reduce((k, c) => k + c.length, 0), 0), 0);

  /** persist locally + mirror project metadata (no file chunks) to Firestore */
  save() {
    if (!lsSet(PKEY, this.data)) toast('Storage is full — remove some knowledge files', 'error');
    const fb = getFirebase();
    if (fb && this.user) {
      const uid = this.user.uid;
      this.data.projects.forEach((p) => {
        void setDoc(
          doc(fb.db, 'users', uid, 'projects', p.id),
          {
            name: p.name,
            emoji: p.emoji,
            description: p.description,
            instructions: p.instructions,
            model: p.model,
            archived: !!p.archived,
            pinned: p.pinned || [],
            files: (p.files || []).map((f) => ({ name: f.name, chars: f.chars })),
            updatedAt: Date.now(),
          },
          { merge: true },
        ).catch(() => {});
      });
    }
    this.emit();
  }

  upsert(p: Project) {
    const i = this.data.projects.findIndex((x) => x.id === p.id);
    if (i < 0) this.data.projects.unshift(p);
    else this.data.projects[i] = p;
    this.save();
  }
  setActive(id: string | null) {
    this.data.active = id;
    lsSet(PKEY, this.data);
    this.emit();
  }
  remove(id: string) {
    this.data.projects = this.data.projects.filter((p) => p.id !== id);
    if (this.data.active === id) this.data.active = null;
    Object.keys(this.data.chats).forEach((k) => {
      if (this.data.chats[k] === id) delete this.data.chats[k];
    });
    lsSet(PKEY, this.data);
    const fb = getFirebase();
    if (fb && this.user) void deleteDoc(doc(fb.db, 'users', this.user.uid, 'projects', id)).catch(() => {});
    this.emit();
  }
  /** remember which project a saved chat belongs to */
  link(sessionId: string) {
    if (this.data.active && sessionId) {
      this.data.chats[sessionId] = this.data.active;
      lsSet(PKEY, this.data);
      const fb = getFirebase();
      if (fb && this.user) void setDoc(doc(fb.db, 'users', this.user.uid, 'sessions', sessionId), { projectId: this.data.active }, { merge: true }).catch(() => {});
    }
  }

  /** text that is prepended to the user's message when a project is active */
  buildContext(message: string, ent: { files: number } | null): { prefix: string; chunks: number } {
    const p = this.active();
    if (!p) return { prefix: '', chunks: 0 };
    let prefix = `[Project: ${p.name}]`;
    if (p.instructions) prefix += `\nProject instructions: ${p.instructions}`;
    const hits = ent && ent.files > 0 ? retrieve(p, message) : [];
    if (hits.length) prefix += '\nRelevant excerpts from the project files:\n' + hits.map((h, i) => `${i + 1}) (${h.f}) ${h.c}`).join('\n');
    return { prefix, chunks: hits.length };
  }
}

export const projectsStore = new ProjectsStore();
export const newProjectId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
