'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  GithubAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  sendSignInLinkToEmail,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  signOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { getFirebase } from '@/lib/firebase/client';
import { toast } from '@/lib/ui-bus';
import { projectsStore } from '@/lib/projects-store';
import { walletStore } from '@/lib/wallet-store';

interface AuthCtx {
  user: User | null;
  /** auth state resolved at least once */
  ready: boolean;
  firebaseReady: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, name?: string) => Promise<void>;
  signInGoogle: () => Promise<void>;
  signInGithub: () => Promise<void>;
  /** passwordless: e-mails a one-tap sign-in link */
  sendLink: (email: string) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  verifyEmail: () => Promise<void>;
  getIdToken: () => Promise<string | null>;
}

const LINK_EMAIL_KEY = 'zikriyon-email-for-signin';
const Ctx = createContext<AuthCtx | null>(null);
export const useAuth = (): AuthCtx => {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside provider');
  return v;
};

/** Human-readable Firebase auth errors (same wording as the original app). */
export function prettyAuthError(err: unknown): string {
  const e = err as { code?: string; message?: string };
  const m = e?.code || '';
  if (m.includes('user-not-found')) return 'No account found with that email.';
  if (m.includes('wrong-password') || m.includes('invalid-credential')) return 'Incorrect email or password. Please try again.';
  if (m.includes('invalid-email')) return 'That email address looks invalid.';
  if (m.includes('email-already-in-use') || m.includes('email-in-use')) return 'That email is already registered.';
  if (m.includes('weak-password')) return 'Password must be at least 6 characters.';
  if (m.includes('popup-closed')) return 'Sign-in popup was closed.';
  if (m.includes('network')) return 'Network error — check your connection.';
  if (m.includes('account-exists-with-different-credential')) return 'This e-mail is already registered with another sign-in method (Google / e-mail / GitHub). Use that method.';
  if (m.includes('too-many-requests')) return 'Too many attempts. Please wait a few minutes and try again.';
  if (m.includes('operation-not-allowed')) return 'This sign-in method is not enabled in Firebase yet (Authentication → Sign-in method).';
  if (m.includes('unauthorized-domain')) return 'This website is not in Firebase “Authorized domains”. Add it in Authentication → Settings.';
  if (m.includes('popup-blocked')) return 'Your browser blocked the sign-in popup. Allow popups and try again.';
  if (m.includes('cancelled-popup') || m.includes('user-cancelled')) return 'Sign-in was cancelled.';
  if (m.includes('expired-action-code') || m.includes('invalid-action-code')) return 'That sign-in link is invalid or expired. Request a new one.';
  if (m.includes('user-disabled')) return 'This account has been disabled.';
  return e?.message || 'Authentication failed. Please try again.';
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [firebaseReady, setFirebaseReady] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem('zikriyon-account-created')) localStorage.setItem('zikriyon-account-created', Date.now().toString());
    walletStore.start();
    projectsStore.start();
    const fb = getFirebase();
    if (!fb) {
      setReady(true);
      return;
    }
    setFirebaseReady(true);

    /* passwordless: the user came back from the e-mailed sign-in link */
    if (isSignInWithEmailLink(fb.auth, window.location.href)) {
      let email = localStorage.getItem(LINK_EMAIL_KEY) || '';
      if (!email) email = window.prompt('Confirm your e-mail address to finish signing in:') || '';
      if (email) {
        signInWithEmailLink(fb.auth, email.trim(), window.location.href)
          .then(() => {
            localStorage.removeItem(LINK_EMAIL_KEY);
            toast('Signed in 🎉', 'success');
            window.history.replaceState({}, '', window.location.pathname);
          })
          .catch((e) => toast(prettyAuthError(e), 'error', 5000));
      }
    }
    return onAuthStateChanged(fb.auth, (u) => {
      setUser(u);
      setReady(true);
      projectsStore.setUser(u);
      void walletStore.attach(u);
    });
  }, []);

  const need = () => {
    const fb = getFirebase();
    if (!fb) throw new Error('Authentication service unavailable.');
    return fb;
  };

  const signIn = useCallback(async (email: string, password: string) => {
    await signInWithEmailAndPassword(need().auth, email, password);
  }, []);
  const signUp = useCallback(async (email: string, password: string, name?: string) => {
    const cred = await createUserWithEmailAndPassword(need().auth, email, password);
    if (name) await updateProfile(cred.user, { displayName: name });
    sendEmailVerification(cred.user).catch(() => {}); // verified accounts unlock credit advances
  }, []);
  const signInGoogle = useCallback(async () => {
    await signInWithPopup(need().auth, new GoogleAuthProvider());
  }, []);
  const signInGithub = useCallback(async () => {
    await signInWithPopup(need().auth, new GithubAuthProvider());
  }, []);
  const sendLink = useCallback(async (email: string) => {
    const e = email.trim();
    await sendSignInLinkToEmail(need().auth, e, { url: `${window.location.origin}/`, handleCodeInApp: true });
    localStorage.setItem(LINK_EMAIL_KEY, e);
  }, []);
  const resetPassword = useCallback(async (email: string) => {
    await sendPasswordResetEmail(need().auth, email.trim());
  }, []);
  const logout = useCallback(async () => {
    const fb = getFirebase();
    if (fb) await signOut(fb.auth);
  }, []);
  const verifyEmail = useCallback(async () => {
    const u = getFirebase()?.auth.currentUser;
    if (u) await sendEmailVerification(u);
  }, []);
  const getIdToken = useCallback(async () => {
    try {
      return (await getFirebase()?.auth.currentUser?.getIdToken()) ?? null;
    } catch {
      return null;
    }
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({ user, ready, firebaseReady, signIn, signUp, signInGoogle, signInGithub, sendLink, resetPassword, logout, verifyEmail, getIdToken }),
    [user, ready, firebaseReady, signIn, signUp, signInGoogle, signInGithub, sendLink, resetPassword, logout, verifyEmail, getIdToken],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
