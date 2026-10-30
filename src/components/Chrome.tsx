'use client';

import { useEffect, useState } from 'react';
import E from '@/lib/billing/engine';
import C from '@/lib/billing/catalog';
import { open as openPanel, fmtCompact, fmtC, inr, until, ic } from '@/lib/panels';
import { onToast, toast, type ToastEvent } from '@/lib/ui-bus';
import { Icon } from './Icon';
import { useAuth } from './providers/AuthProvider';
import { useChat } from './providers/ChatProvider';
import { useUI } from './providers/UIProvider';
import { useWallet } from './providers/stores';
import { walletStore } from '@/lib/wallet-store';
import { formatRelative } from '@/lib/util';

/* eslint-disable @typescript-eslint/no-explicit-any */
const Logo = (p: React.ImgHTMLAttributes<HTMLImageElement>) => <img src="/zikriyon.png" className="zikriyon-logo" alt="Zikriyon" {...p} />;

/* ============================ SPLASH ============================ */
export function Splash() {
  const [gone, setGone] = useState(false);
  const [hide, setHide] = useState(false);
  useEffect(() => {
    const t1 = setTimeout(() => setHide(true), 3000);
    return () => clearTimeout(t1);
  }, []);
  useEffect(() => {
    if (!hide) return;
    const t = setTimeout(() => setGone(true), 700);
    return () => clearTimeout(t);
  }, [hide]);
  if (gone) return null;
  return (
    <div id="splash" className={hide ? 'hide' : ''} onClick={() => setHide(true)}>
      <Logo id="zikriyon-logo" />
      <h1>Zikriyon AI</h1>
      <p>Intelligence, Reimagined</p>
      <div className="splash-bar"><span /></div>
    </div>
  );
}

/* ============================ OFFLINE ============================ */
export function OfflineBanner() {
  const [off, setOff] = useState(false);
  useEffect(() => {
    setOff(!navigator.onLine);
    const on = () => { setOff(false); toast('Back online', 'success'); };
    const of = () => setOff(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', of);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', of); };
  }, []);
  return (
    <div id="offline-banner" className={off ? 'show' : ''}>
      <Icon name="wifi_off" style={{ fontSize: 16 }} />
      You&apos;re offline — some features may be unavailable
    </div>
  );
}

/* ============================ HEADER ============================ */
export function Header() {
  const ui = useUI();
  const { user } = useAuth();
  const { s } = useWallet();
  const [notifPerm, setNotifPerm] = useState<NotificationPermission | 'na'>('na');
  useEffect(() => setNotifPerm('Notification' in window ? Notification.permission : 'na'), []);
  const t = Date.now();
  const bal = E.balance(s, t);
  const reward = !E.dailyRewardStatus(s, t).claimedToday && !E.clockTampered(s, t);
  const unread = walletStore.unread();
  const showDot = notifPerm === 'default' || unread > 0;
  const pillCls = `zik-pill${bal.total <= 0 ? ' empty' : ''}${bal.total > 0 && E.isLow(s, t) ? ' low' : ''}${reward ? ' has-dot' : ''}`;

  const bell = async () => {
    if (!('Notification' in window)) return toast('Notifications not supported', 'warning');
    if (Notification.permission === 'granted') return openPanel('notifs');
    const p = await Notification.requestPermission();
    setNotifPerm(p);
    if (p === 'granted') {
      toast('Notifications enabled', 'success');
      try { new Notification('Zikriyon AI', { body: "You're all set! 🎉", icon: '/zikriyon.png' }); } catch { /* ignore */ }
    } else toast('Notification permission denied', 'warning');
  };

  return (
    <header className="head">
      <div className="head-left">
        <button className="icon-btn" id="sidebar-toggle" aria-label="Menu" onClick={() => ui.openDrawer('sidebar')}>
          <div className="half-menu-icon"><span /><span /></div>
        </button>
        <div className="brand" id="brand-home">
          <Logo />
          <div className="brand-text"><b>Zikriyon AI</b><small>by ZEAIPC</small></div>
        </div>
      </div>
      <div className="head-right">
        <button className={pillCls} id="zik-pill" aria-label="Wallet" title={`${fmtC(bal.total)} ZIK Credits ≈ ${inr(bal.inr)}`} onClick={() => openPanel('wallet')}>
          <Icon name="bolt" />
          <b id="zik-pill-n">{fmtCompact(bal.total)}</b>
          <i className="zik-dot" />
        </button>
        <button className="icon-btn" id="notification-btn-header" aria-label="Notifications" onClick={bell}>
          <Icon name="notifications" />
          <span className="dot" id="notif-dot" style={{ display: showDot ? 'block' : 'none' }} />
        </button>
        <button className="icon-btn" id="settings-btn" aria-label="Settings" onClick={() => ui.openModal('settings')}>
          <Icon name="tune" />
        </button>
        {user ? (
          <button className="icon-btn" id="user-profile-btn" aria-label="Profile" style={{ display: 'grid' }} onClick={() => ui.openModal('profile')}>
            <Icon name="person" />
          </button>
        ) : (
          <button className="auth-btn" id="auth-toggle-btn" onClick={() => ui.openDrawer('auth')}>Log In</button>
        )}
      </div>
    </header>
  );
}

/* ============================ SIDEBAR (HISTORY + ACCOUNT NAV) ============================ */
const NAV: [string, string, string][] = [
  ['projects', 'folder_special', 'Projects'], ['wallet', 'account_balance_wallet', 'Wallet & Credits'], ['plans', 'workspace_premium', 'Plans'],
  ['billing', 'receipt_long', 'Billing Account'], ['usage', 'monitoring', 'Usage & Limits'], ['rewards', 'redeem', 'Rewards'],
  ['apikeys', 'key', 'API Keys'], ['help', 'help', 'Help & Policies'],
];
export function Sidebar() {
  const ui = useUI();
  const chat = useChat();
  const { user, logout, firebaseReady } = useAuth();
  const { s } = useWallet();
  const [q, setQ] = useState('');
  const ent = E.entitlement(s, Date.now());
  const bal = E.balance(s, Date.now());
  const list = chat.sessions.filter((x) => !q.trim() || (x.title || '').toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <aside className={`drawer${ui.drawer === 'sidebar' ? ' active' : ''}`} id="sidebar">
      <div className="drawer-head">
        <h2>Chat History</h2>
        <button className="modal-close" id="close-sidebar" onClick={() => ui.closeDrawer('sidebar')}><Icon name="close" /></button>
      </div>
      <div className="drawer-body">
        <div className="zik-nav-title">Account &amp; Billing</div>
        <div className="zik-nav">
          {NAV.map(([id, icon, label]) => (
            <button key={id} className={`zik-nav-item${id === 'apikeys' && !(ent.api > 0) ? ' hidden' : ''}`} id={`zik-nav-${id}`} onClick={() => openPanel(id)}>
              <span className="ni"><Icon name={icon} /></span>
              <span>{label}</span>
              {id === 'wallet' ? <span className="nb">{fmtCompact(bal.total)}</span> : <span className="nb" style={{ display: 'none' }} />}
            </button>
          ))}
        </div>
        <div className="history-toolbar">
          <div className="search-wrap">
            <Icon name="search" />
            <input type="text" id="history-search" placeholder="Search chats..." value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button
            className="icon-btn"
            id="clear-history-btn"
            title="Clear all"
            style={{ flex: '0 0 42px', height: 42, width: 42 }}
            onClick={() => { if (confirm('Delete ALL conversations? This cannot be undone.')) void chat.clearHistory(); }}
          >
            <Icon name="delete_sweep" style={{ fontSize: 19 }} />
          </button>
        </div>
        <div id="history-list">
          {!chat.sessions.length ? (
            <div className="empty-state">
              <Icon name="forum" />
              <p>No conversations yet.<br />Start chatting and your history will appear here.</p>
            </div>
          ) : (
            list.map((x, idx) => {
              const preview = (x.messages?.[0]?.parts?.[0]?.text || 'Conversation').replace(/```[\s\S]*?```/g, '[code]').slice(0, 90);
              return (
                <div
                  key={x.id}
                  className={`history-item${x.id === chat.sessionId ? ' active' : ''}`}
                  style={{ animationDelay: Math.min(idx * 30, 300) + 'ms' }}
                  onClick={() => chat.loadSession(x)}
                >
                  <div className="history-item-top">
                    <div className="history-item-title">{x.title || 'Untitled'}</div>
                    <div className="history-item-date">{formatRelative(x.timestamp)}</div>
                  </div>
                  <div className="history-item-preview">{preview}</div>
                  <div className="history-item-foot">
                    <span className="chip"><Icon name="chat_bubble" />{x.messageCount || x.messages?.length || 0}</span>
                    <button
                      className="msg-action-btn act-del"
                      title="Delete"
                      style={{ marginLeft: 'auto', width: 26, height: 26 }}
                      onClick={(e) => { e.stopPropagation(); if (confirm('Delete this conversation?')) void chat.removeSession(x.id); }}
                    >
                      <Icon name="delete" style={{ fontSize: 14 }} />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      <div className="drawer-foot">
        {user && firebaseReady ? (
          <button className="btn btn-ghost btn-block" id="logout-btn" style={{ display: 'flex' }} onClick={async () => { await logout(); ui.closeDrawer('sidebar'); toast('Signed out', 'success'); }}>
            <Icon name="logout" /> Sign Out
          </button>
        ) : null}
        <button className="btn btn-primary btn-block" id="new-chat-sidebar" style={{ marginTop: 8 }} onClick={() => { chat.newChat(); ui.closeAll(); }}>
          <Icon name="add_comment" /> New Chat
        </button>
      </div>
    </aside>
  );
}

export function AuthDrawer() {
  const ui = useUI();
  return (
    <aside className={`drawer${ui.drawer === 'auth' ? ' active' : ''}`} id="auth-sidebar">
      <div className="drawer-head">
        <h2>Welcome</h2>
        <button className="modal-close" id="close-auth-sidebar" onClick={() => ui.closeDrawer('auth')}><Icon name="close" /></button>
      </div>
      <div className="drawer-body" style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 14 }}>
        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <Logo style={{ width: 80, height: 80, borderRadius: '50%', boxShadow: '0 16px 40px var(--primary-soft)' }} />
          <h3 style={{ marginTop: 16, fontSize: '1.15rem', fontWeight: 800, color: 'var(--text)' }}>Sign in to Zikriyon AI</h3>
          <p style={{ fontSize: '.82rem', color: 'var(--text-2)', marginTop: 6, lineHeight: 1.5 }}>Sync your chats across devices and unlock the full experience.</p>
        </div>
        <button className="btn btn-primary btn-block" id="google-auth-btn" onClick={() => { ui.closeDrawer('auth'); ui.openModal('auth'); }}>
          <Icon name="mail" /> Sign in with Email
        </button>
        <button className="btn btn-ghost btn-block" id="guest-auth-btn" onClick={() => { ui.closeDrawer('auth'); toast('Continuing as guest', 'info'); }}>
          <Icon name="person" /> Continue as Guest
        </button>
      </div>
    </aside>
  );
}

/* ============================ ALERT BANNER (credits, rewards …) ============================ */
const DIS_KEY = 'zik-banner-dis';
const readDis = (): Record<string, string> => { try { return JSON.parse(localStorage.getItem(DIS_KEY) || '{}'); } catch { return {}; } };
export function Banner() {
  const { s } = useWallet();
  const [, force] = useState(0);
  const [hiddenKey, setHiddenKey] = useState<string | null>(null);
  useEffect(() => { const i = setInterval(() => force((x) => x + 1), 60000); return () => clearInterval(i); }, []);
  const t = Date.now();
  const bal = E.balance(s, t);
  let m: { key: string; cls?: string; html: string; btn: string; act?: () => void } | null = null;
  const dr = E.dailyRewardStatus(s, t);
  const fest = E.festivalsActive(s, t)[0];
  const ar = E.autoRechargeDue(s, t);
  if (E.clockTampered(s, t)) m = { key: 'clock', cls: 'err', html: 'Your device clock looks wrong — rewards and daily credits are paused.', btn: '' };
  else if (bal.total <= 0 && !s.passes.some((p: any) => E.passWindowActive(p, t))) m = { key: 'empty', cls: 'err', html: 'Out of ZIK Credits. Free credits refill at midnight — or recharge from ₹1.', btn: 'Recharge', act: () => openPanel('plans', 'recharge') };
  else if (s.settings.smartBalance && E.isLow(s, t)) m = { key: 'smart', cls: 'warn', html: 'Low balance — <b>Smart Balance Mode</b> keeps chat running on a lighter model.', btn: 'Recharge', act: () => openPanel('plans', 'recharge') };
  else if (ar) m = { key: 'autorecharge', cls: 'warn', html: `Balance is below ${inr(ar.triggerInr)}. Recharge ${inr(ar.amountInr)} to avoid interruption?`, btn: 'Recharge ' + inr(ar.amountInr), act: () => openPanel('plans', 'recharge') };
  else if (bal.expiringSoonCredits > 0) m = { key: 'expiring', cls: 'warn', html: `${fmtC(bal.expiringSoonCredits)} credits expire in ${until(bal.expiringSoon[0].expiresAt)}. Use them or top up.`, btn: 'Wallet', act: () => openPanel('wallet') };
  else if (s.trial && E.trialActive(s.trial, t)) m = { key: 'trial', html: `${ic('workspace_premium')} Pro trial · <b>${until(s.trial.endsAt)}</b> left`, btn: 'Plans', act: () => openPanel('plans', 'sub') };
  else if (!dr.claimedToday) m = { key: 'daily', cls: 'ok', html: `${ic('redeem')} Daily reward ready: <b>+${dr.nextAmount} credits</b>`, btn: 'Claim', act: () => { const r = walletStore.mutate((x) => E.claimDaily(x, Date.now()), 'reward'); if (r.ok) toast(`+${r.amount + r.streakBonus} credits · day ${r.streak} streak`, 'success'); else toast(r.message || 'Not available', 'warning'); } };
  else if (fest && C.PHASES[5] !== false) m = { key: 'fest:' + fest.id, cls: 'ok', html: `${ic('celebration')} ${fest.name} gift: <b>${fmtC(fest.credits)} credits</b> free`, btn: 'Claim', act: () => { const r = walletStore.mutate((x) => E.claimFestival(x, fest.id, Date.now()), 'reward'); r.ok ? toast(`+${fmtC(r.credits)} credits — happy ${r.name}!`, 'success') : toast(r.message || 'Not available', 'warning'); } };

  const dismissed = m ? readDis()[m.key] === E.dayKey(t) || hiddenKey === m.key : true;
  const show = !!m && !dismissed;
  return (
    <div id="zik-banner" role="status" className={`${m?.cls || ''}${show ? ' show' : ''}`}>
      <span className="t" dangerouslySetInnerHTML={{ __html: m?.html || '' }} />
      <button className="btn btn-primary" data-bn style={{ display: m?.btn ? '' : 'none' }} onClick={() => { m?.act?.(); if (m) setHiddenKey(m.key); }}>{m?.btn}</button>
      <button
        className="x"
        aria-label="Dismiss"
        onClick={() => {
          if (!m) return;
          const d = readDis();
          d[m.key] = E.dayKey(Date.now());
          try { localStorage.setItem(DIS_KEY, JSON.stringify(d)); } catch { /* ignore */ }
          setHiddenKey(m.key);
        }}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}

/* ============================ TOASTS ============================ */
const TOAST_ICON: Record<string, string> = { success: 'check_circle', error: 'error', warning: 'warning', info: 'info' };
export function Toasts() {
  const [list, setList] = useState<(ToastEvent & { show: boolean })[]>([]);
  useEffect(
    () =>
      onToast((t) => {
        setList((p) => [...p, { ...t, show: false }]);
        requestAnimationFrame(() => requestAnimationFrame(() => setList((p) => p.map((x) => (x.id === t.id ? { ...x, show: true } : x)))));
        setTimeout(() => setList((p) => p.map((x) => (x.id === t.id ? { ...x, show: false } : x))), t.duration);
        setTimeout(() => setList((p) => p.filter((x) => x.id !== t.id)), t.duration + 420);
      }),
    [],
  );
  return (
    <div id="toasts">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.type}${t.show ? ' show' : ''}`}>
          <Icon name={TOAST_ICON[t.type] || 'info'} />
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  );
}

/* ============================ PWA INSTALL ============================ */
export function InstallPrompt() {
  const [ev, setEv] = useState<any>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    const h = (e: any) => {
      e.preventDefault();
      setEv(e);
      if (!localStorage.getItem('zikriyon-install-dismissed')) setTimeout(() => setShow(true), 6000);
    };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);
  return (
    <div id="install-prompt" className={show ? 'show' : ''}>
      <Logo />
      <div className="txt"><b>Install Zikriyon AI</b><small>Add to your home screen for the best experience</small></div>
      <button
        className="btn btn-primary"
        id="install-btn"
        style={{ padding: '9px 15px', fontSize: '.78rem' }}
        onClick={async () => {
          if (!ev) return;
          ev.prompt();
          const { outcome } = await ev.userChoice;
          if (outcome === 'accepted') toast('Installing Zikriyon AI…', 'success');
          setEv(null);
          setShow(false);
        }}
      >
        Install
      </button>
      <button className="icon-btn" id="install-close" style={{ width: 32, height: 32, flex: '0 0 32px' }} onClick={() => { setShow(false); try { localStorage.setItem('zikriyon-install-dismissed', '1'); } catch { /* ignore */ } }}>
        <Icon name="close" style={{ fontSize: 16 }} />
      </button>
    </div>
  );
}
