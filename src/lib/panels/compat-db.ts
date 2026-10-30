/* eslint-disable @typescript-eslint/no-explicit-any */
import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, setDoc } from 'firebase/firestore';
import { getFirebase } from '../firebase/client';

/**
 * Tiny adapter that gives the (verbatim-ported) panel code the familiar
 * db.collection(..).doc(..).set/get/delete, .add, .orderBy().get() surface on top of the modular SDK.
 */
type Ref = { path: string[] };
function docApi(path: string[]) {
  const fb = getFirebase()!;
  const ref = () => doc(fb.db, path[0], ...path.slice(1));
  return {
    set: (data: any, opts?: { merge?: boolean }) => setDoc(ref(), data, opts || {}),
    get: async () => {
      const s = await getDoc(ref());
      return { exists: s.exists(), data: () => s.data(), id: s.id };
    },
    delete: () => deleteDoc(ref()),
    collection: (name: string) => colApi([...path, name]),
  };
}
function colApi(path: string[], order?: [string, 'asc' | 'desc']): any {
  const fb = getFirebase()!;
  const colRef = () => collection(fb.db, path[0], ...path.slice(1));
  return {
    doc: (id: string) => docApi([...path, id]),
    add: (data: any) => addDoc(colRef(), data),
    orderBy: (f: string, dir: 'asc' | 'desc' = 'asc') => colApi(path, [f, dir]),
    get: async () => {
      const q = order ? query(colRef(), orderBy(order[0], order[1])) : colRef();
      const s = await getDocs(q);
      return { forEach: (fn: (d: any) => void) => s.forEach((d) => fn({ id: d.id, data: () => d.data() })), docs: s.docs };
    },
  };
}
/** null when Firebase is unavailable (SSR / config missing) — callers already guard for that. */
export function DB(): { collection: (name: string) => any } | null {
  return getFirebase() ? { collection: (name: string) => colApi([name]) } : null;
}
export type { Ref };
