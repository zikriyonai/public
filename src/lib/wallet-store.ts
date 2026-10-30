import { collection, doc, getDoc, onSnapshot, setDoc, type Unsubscribe } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import E from './billing/engine';
import C from './billing/catalog';
import { CONFIG } from './config';
import { getFirebase } from './firebase/client';
import { toast } from './ui-bus';

/* eslint-disable @typescript-eslint/no-explicit-any */
export const WALLET_KEY = 'zikriyon-wallet-v1';
export const NOTES_KEY = 'zikriyon-notes-v1';

export interface Note {
  id: string;
  key?: string;
  ts: number;
  read: boolean;
  icon: string;
  type: 'info' | 'success' | 'warn' | 'error';
  title: string;
  text: string;
  push?: boolean;
}

const now = () => Date.now();
const safeParse = <T,>(s: string | null, d: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : d;
  } catch {
    return d;
  }
};

/**
 * Wallet store: persists the billing state (localStorage), syncs it to Firestore for signed-in users,
 * merges guest + cloud wallets safely and applies SERVER-ISSUED grants (UPI payments, referrals).
 * React reads it with useSyncExternalStore (see providers/WalletProvider).
 */
class WalletStore {
  state: any = E.newState(now());
  notes: Note[] = [];
  version = 0;
  ready = false;
  sync = { status: 'local' as 'local' | 'syncing' | 'synced' | 'offline' | 'server', uid: null as string | null, lastPush: 0, readOnly: false, error: null as string | null };

  private listeners = new Set<() => void>();
  private changeListeners = new Set<(why: string) => void>();
  private started = false;
  private pushTimer: ReturnType<typeof setTimeout> | null = null;
  private unsubs: Unsubscribe[] = [];
  private applyingRemote = false;

  /* ---------- React subscription ---------- */
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = () => this.version;
  onChange(fn: (why: string) => void) {
    this.changeListeners.add(fn);
    return () => {
      this.changeListeners.delete(fn);
    };
  }
  private emit(why: string) {
    this.version++;
    this.listeners.forEach((l) => l());
    this.changeListeners.forEach((l) => {
      try {
        l(why);
      } catch (e) {
        console.error(e);
      }
    });
  }

  /* ---------- lifecycle ---------- */
  start() {
    if (this.started || typeof window === 'undefined') return;
    this.started = true;
    this.state = E.migrate(safeParse(localStorage.getItem(WALLET_KEY), null), now());
    this.notes = safeParse<Note[]>(localStorage.getItem(NOTES_KEY), []);
    this.ready = true;

    window.addEventListener('storage', (e) => {
      if (e.key === WALLET_KEY && e.newValue) {
        this.state = E.migrate(safeParse(e.newValue, null), now());
        this.emit('tab');
      }
      if (e.key === NOTES_KEY) {
        this.notes = safeParse<Note[]>(e.newValue, []);
        this.emit('notes');
      }
    });
    window.addEventListener('online', () => {
      if (this.sync.uid) void this.pushNow();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.refresh();
    });
    setInterval(() => this.refresh(), 30000);
    this.refresh();
    this.emit('init');
  }

  get() {
    return this.state;
  }

  /* ---------- persistence ---------- */
  private persist() {
    try {
      localStorage.setItem(WALLET_KEY, JSON.stringify(this.state));
    } catch (e) {
      console.warn('[store] localStorage full', e);
    }
  }
  commit(why = 'commit') {
    this.state.rev = (this.state.rev || 0) + 1;
    this.persist();
    if (!this.applyingRemote) this.schedulePush();
    this.emit(why);
  }
  mutate<T>(fn: (s: any) => T, why = 'mutate'): T {
    const r = fn(this.state);
    this.commit(why);
    return r;
  }

  /* ---------- notifications ---------- */
  private saveNotes() {
    try {
      localStorage.setItem(NOTES_KEY, JSON.stringify(this.notes.slice(0, 60)));
    } catch {
      /* ignore */
    }
  }
  addNote(n: Partial<Note> & { title: string; text: string }): boolean {
    if (n.key && this.notes.some((x) => x.key === n.key)) return false;
    const note: Note = {
      id: 'n' + now().toString(36) + Math.random().toString(36).slice(2, 5),
      ts: now(),
      read: false,
      icon: 'notifications',
      type: 'info',
      ...n,
    };
    this.notes.unshift(note);
    this.notes = this.notes.slice(0, 60);
    this.saveNotes();
    if (n.push && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification(n.title, { body: n.text, icon: '/zikriyon.png', tag: n.key || note.id });
      } catch {
        /* ignore */
      }
    }
    this.emit('notes');
    return true;
  }
  unread = () => this.notes.filter((n) => !n.read).length;
  markAllRead() {
    if (!this.notes.some((n) => !n.read)) return;
    this.notes.forEach((n) => {
      n.read = true;
    });
    this.saveNotes();
    this.emit('notes');
  }
  clearNotes() {
    this.notes = [];
    this.saveNotes();
    this.emit('notes');
  }

  private handleEvents(events: any[]) {
    (events || []).forEach((ev) => {
      const day = E.dayKey(now());
      if (ev.type === 'expired') this.addNote({ key: `exp:${ev.planId}:${day}`, icon: 'hourglass_bottom', type: 'warn', title: 'Credits expired', text: `${C.fmtCredits(ev.credits)} ZIK Credits expired. Recharge to keep full access.`, push: true });
      else if (ev.type === 'sub_expired') this.addNote({ key: `sub:${ev.planId}:${day}`, icon: 'event_busy', type: 'warn', title: 'Subscription ended', text: `${(C.byId[ev.planId] || {}).name || 'Your plan'} has ended. Renew from Plans.`, push: true });
      else if (ev.type === 'addon_expired') this.addNote({ key: `addon:${ev.planId}:${day}`, icon: 'extension_off', type: 'warn', title: 'Add-on ended', text: `${(C.byId[ev.planId] || {}).name || 'Add-on'} has ended.` });
      else if (ev.type === 'trial_ended') this.addNote({ key: 'trial-end', icon: 'redeem', type: 'info', title: 'Pro trial ended', text: 'You are now on Free Forever (50 credits/day). Upgrade anytime from Plans.', push: true });
      else if (ev.type === 'clock_skew') this.addNote({ key: `clock:${day}`, icon: 'schedule', type: 'error', title: 'Device clock looks wrong', text: 'Rewards and daily credits pause until date & time are correct.' });
    });
  }

  /** sweep (expiry, daily refill) + persist if anything changed */
  refresh() {
    if (!this.ready) return;
    const sig = () => JSON.stringify([this.state.buckets.length, this.state.counters.day.key, this.state.sub && this.state.sub.status, this.state.trial && this.state.trial.status, this.state.free.lastRefillDay]);
    const before = sig();
    const ev = E.sweep(this.state, now());
    this.handleEvents(ev);
    if (before !== sig()) this.commit('sweep');
    else this.persist();
    return ev;
  }

  /* ---------- Firestore sync ---------- */
  private fs() {
    const fb = getFirebase();
    return fb && CONFIG.syncWallet ? fb.db : null;
  }
  private schedulePush() {
    if (!this.sync.uid || this.sync.readOnly || !this.fs()) return;
    if (this.pushTimer) clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => void this.pushNow(), 1500);
  }
  async pushNow() {
    const db = this.fs();
    if (!this.sync.uid || this.sync.readOnly || !db) return;
    try {
      await setDoc(doc(db, 'users', this.sync.uid, 'billing', 'state'), { rev: this.state.rev, updatedAt: now(), data: JSON.stringify(this.state) });
      this.sync.lastPush = now();
      this.sync.status = 'synced';
      this.sync.error = null;
    } catch (e: any) {
      this.sync.error = e?.code || e?.message;
      if (e?.code === 'permission-denied') {
        this.sync.readOnly = true;
        this.sync.status = 'server';
      } else this.sync.status = 'offline';
    }
    this.emit('sync');
  }
  private applyRemote(remote: any, why: string) {
    this.applyingRemote = true;
    try {
      this.state = E.mergeStates(this.state, remote, now());
      this.commit(why);
    } finally {
      this.applyingRemote = false;
    }
  }

  /** Called by the auth provider whenever the signed-in user changes. */
  async attach(user: User | null) {
    this.unsubs.forEach((u) => {
      try {
        u();
      } catch {
        /* ignore */
      }
    });
    this.unsubs = [];
    const db = this.fs();
    if (!user || !db) {
      this.sync.uid = null;
      this.sync.status = 'local';
      this.emit('sync');
      return;
    }
    this.sync.uid = user.uid;
    this.sync.status = 'syncing';
    this.sync.readOnly = false;
    this.emit('sync');
    try {
      const snap = await getDoc(doc(db, 'users', user.uid, 'billing', 'state'));
      if (snap.exists()) {
        const remote = safeParse<any>(snap.data().data, null);
        if (remote) this.applyRemote(remote, 'signin-merge');
      }
      await this.pushNow();
      this.unsubs.push(
        onSnapshot(
          doc(db, 'users', user.uid, 'billing', 'state'),
          (s) => {
            if (!s.exists() || s.metadata.hasPendingWrites) return;
            const d = s.data();
            if ((d.rev || 0) <= (this.state.rev || 0) && !this.sync.readOnly) return; // our own echo
            const remote = safeParse<any>(d.data, null);
            if (remote) this.applyRemote(remote, 'remote');
          },
          () => {},
        ),
      );
    } catch (e: any) {
      this.sync.error = e?.code || e?.message;
      this.sync.status = e?.code === 'permission-denied' ? 'server' : 'offline';
      if (e?.code === 'permission-denied') this.sync.readOnly = true;
      this.emit('sync');
    }

    /* server-issued grants: approved UPI payments + confirmed referrals */
    this.unsubs.push(
      onSnapshot(
        collection(db, 'users', user.uid, 'grants'),
        (snap) => {
          let changed = false;
          snap.forEach((d) => {
            if (this.applyGrant({ id: d.id, ...d.data() })) changed = true;
          });
          if (changed) this.commit('grant');
        },
        () => {},
      ),
    );

    /* student verification decision (written by an admin) */
    this.unsubs.push(
      onSnapshot(
        doc(db, 'studentVerifications', user.uid),
        (s) => {
          const status = s.exists() ? (s.data().status as string) : null;
          if (status && status !== this.state.student.status) {
            this.mutate((st) => {
              st.student.status = status;
            }, 'student');
            if (status === 'verified') this.addNote({ key: 'student-ok', icon: 'verified', type: 'success', title: 'Student verified 🎓', text: 'Student plans are now unlocked.', push: true });
          }
        },
        () => {},
      ),
    );
  }

  /** Apply one server grant to the local wallet. Idempotent (engine.processed). Returns true if state changed. */
  private applyGrant(g: any): boolean {
    const t = now();
    if (g.type === 'purchase') {
      const plan = C.byId[g.planId];
      const r: any = E.applyPurchase(this.state, g.planId, { orderId: g.orderId, inr: g.inr, token: g.utr, gateway: 'upi' }, t);
      if (r.ok && !r.duplicate) {
        const total = (r.granted || 0) + (r.bonus || 0);
        this.addNote({ key: `buy:${g.orderId}`, icon: 'check_circle', type: 'success', title: 'Payment approved', text: `${plan ? plan.name : 'Plan'} activated${total ? ` · +${C.fmtCredits(total)} credits` : ''}`, push: true });
        toast(`Payment approved — ${plan ? plan.name : 'plan'} activated`, 'success', 4500);
        return true;
      }
      if (!r.ok) this.addNote({ key: `grantfail:${g.orderId}`, icon: 'error', type: 'error', title: 'Payment approved, not applied yet', text: `${r.message || 'Could not apply the purchase.'} Order ${g.orderId} — contact support if this stays.` });
      return false;
    }
    if (g.type === 'referral') {
      const r = E.applyReferralReward(this.state, g.role, g.ref, t);
      if (r.ok && !r.duplicate) {
        toast(`+${r.credits} referral credits 🎉`, 'success');
        return true;
      }
    }
    return false;
  }

  replace(s: any) {
    this.state = E.migrate(s, now());
    this.commit('replace');
  }
}

export const walletStore = new WalletStore();
