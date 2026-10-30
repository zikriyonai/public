import { collection, deleteDoc, doc, getDocs, limit, orderBy, query, setDoc } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { getFirebase } from './firebase/client';
import { lsGet, lsSet } from './util';

export interface EditVersion {
  text: string;
  timestamp: number;
}
/** Same shape the original app stored — old chats keep loading. */
export interface ChatItem {
  role: 'user' | 'model';
  parts: { text: string; imageUrl?: string }[];
  editHistory?: EditVersion[];
}
export interface SessionDoc {
  id: string;
  title: string;
  timestamp: number;
  lastUpdated: number;
  messages: ChatItem[];
  messageCount: number;
  model: string;
}

const LOCAL_KEY = 'zikriyonLocalHistory';
const MAX_LOCAL = 30;

const strip = <T,>(v: T): T => JSON.parse(JSON.stringify(v)); // Firestore rejects `undefined`

export function readLocalSessions(): SessionDoc[] {
  return lsGet<SessionDoc[]>(LOCAL_KEY, []);
}

function saveLocal(s: SessionDoc) {
  const list = readLocalSessions().filter((x) => x.id !== s.id);
  list.unshift(s);
  if (list.length > MAX_LOCAL) list.length = MAX_LOCAL;
  lsSet(LOCAL_KEY, list);
}

export async function saveSession(user: User | null, s: SessionDoc): Promise<void> {
  const fb = getFirebase();
  if (user && fb) {
    try {
      const { id, ...rest } = s;
      await setDoc(doc(fb.db, 'users', user.uid, 'sessions', id), strip(rest));
      return;
    } catch (e) {
      console.warn('Firestore save failed, falling back to local', e);
    }
  }
  saveLocal(s);
}

export async function listSessions(user: User | null): Promise<SessionDoc[]> {
  const fb = getFirebase();
  if (user && fb) {
    try {
      const snap = await getDocs(query(collection(fb.db, 'users', user.uid, 'sessions'), orderBy('timestamp', 'desc'), limit(30)));
      return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SessionDoc, 'id'>) }));
    } catch {
      /* fall through to local */
    }
  }
  return readLocalSessions();
}

export async function deleteSession(user: User | null, id: string): Promise<void> {
  const fb = getFirebase();
  if (user && fb) {
    try {
      await deleteDoc(doc(fb.db, 'users', user.uid, 'sessions', id));
      return;
    } catch (e) {
      console.warn(e);
    }
  }
  lsSet(
    LOCAL_KEY,
    readLocalSessions().filter((s) => s.id !== id),
  );
}

export async function clearAllSessions(user: User | null): Promise<void> {
  const fb = getFirebase();
  if (user && fb) {
    try {
      const snap = await getDocs(collection(fb.db, 'users', user.uid, 'sessions'));
      await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
    } catch (e) {
      console.warn(e);
    }
  }
  try {
    localStorage.removeItem(LOCAL_KEY);
  } catch {
    /* ignore */
  }
}
