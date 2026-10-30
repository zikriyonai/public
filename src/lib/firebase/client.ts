import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { CONFIG } from '../config';

export interface FirebaseHandles {
  app: FirebaseApp;
  auth: Auth;
  db: Firestore;
}

let cached: FirebaseHandles | null | undefined;

/** Browser-only. Returns null (→ the app runs in local mode) if Firebase cannot start. */
export function getFirebase(): FirebaseHandles | null {
  if (typeof window === 'undefined') return null;
  if (cached !== undefined) return cached;
  try {
    const app = getApps().length ? getApp() : initializeApp(CONFIG.firebase);
    cached = { app, auth: getAuth(app), db: getFirestore(app) };
  } catch (e) {
    console.warn('Firebase failed to initialise — running in local mode.', e);
    cached = null;
  }
  return cached;
}
