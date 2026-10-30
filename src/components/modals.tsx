'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import C from '@/lib/billing/catalog';
import E from '@/lib/billing/engine';
import { open as openPanel } from '@/lib/panels';
import { copyText, download, formatRelative, resetLocalData } from '@/lib/util';
import { toast } from '@/lib/ui-bus';
import { Icon } from './Icon';
import { Modal } from './Modal';
import { useChat } from './providers/ChatProvider';
import { prettyAuthError, useAuth } from './providers/AuthProvider';
import { useUI } from './providers/UIProvider';
import { useWallet } from './providers/stores';

/* eslint-disable @typescript-eslint/no-explicit-any */
const Logo = ({ style }: { style?: React.CSSProperties }) => <img src="/zikriyon.png" className="zikriyon-logo" alt="" style={style} />;

/* ============================ MODEL PICKER ============================ */
const MODELS = [
  { id: 'zikos-lite', name: 'ZIKOS-Lite', desc: 'Fast & light — mobile aur edge ke liye' },
  { id: 'zikos-tiny', name: 'ZIKOS-Tiny', desc: 'Chhota test model — training experiments' },
  { id: 'zikos-base', name: 'ZIKOS-Base', desc: 'Standard — rozmarra ke kaam ke liye' },
  { id: 'zikos-delta', name: 'ZIKOS-Delta', desc: 'Advanced reasoning — mushkil sawal' },
  { id: 'image', name: 'ZIKOS-Img', desc: 'Image generation — text se tasveer' },
];
export function ModelModal() {
  const ui = useUI();
  const chat = useChat();
  const { s } = useWallet();
  const ent = E.entitlement(s, Date.now());
  const open = ui.modal?.kind === 'modal' && ui.modal.id === 'model';
  return (
    <Modal open={open} title="Choose AI Model" onClose={ui.closeModal} id="model-selector-modal">
      <div className="model-list">
        {MODELS.map((m) => {
          const tier = C.PICKER_MAP[m.id];
          const locked = tier ? C.ENFORCE.models && !ent.models.includes(tier) : C.ENFORCE.image && !ent.image;
          return (
            <div
              key={m.id}
              className={`model-item${chat.model === m.id ? ' active' : ''}${locked ? ' zik-locked' : ''}`}
              onClick={() => {
                if (locked) {
                  openPanel('limit', { code: 'model_locked', message: 'This model is not part of your current plan. Upgrade or recharge to unlock it.' });
                  return;
                }
                chat.setModel(m.id);
                toast(`Switched to ${m.name}`, 'success');
                ui.closeModal();
              }}
            >
              <div className="model-icon">{m.id === 'image' ? <Icon name="palette" /> : <Logo />}</div>
              <div className="model-meta">
                <b>
                  {m.name}
                  {tier ? <span className="zik-tier">{(C.MODELS[tier] || {}).label || tier}</span> : null}
                </b>
                <small>{m.desc}</small>
              </div>
              <Icon name="check_circle" className="model-check" />
              {locked ? (
                <span className="zik-lock">
                  <Icon name="lock" />
                  Upgrade
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

/* ============================ SETTINGS ============================ */
export function SettingsModal() {
  const ui = useUI();
  const open = ui.modal?.kind === 'modal' && ui.modal.id === 'settings';
  const [c1, setC1] = useState(ui.colors.color1);
  const [c2, setC2] = useState(ui.colors.color2);
  const [prefs, setPrefs] = useState(ui.settings);
  useEffect(() => {
    if (open) {
      setC1(ui.colors.color1);
      setC2(ui.colors.color2);
      setPrefs(ui.settings);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const themes = [
    { id: 'light', label: 'Light', bg: 'linear-gradient(135deg,#E3FDFF,#E9E4FF)' },
    { id: 'dark', label: 'Dark', bg: 'linear-gradient(135deg,#0b1020,#141034)' },
    { id: 'blue', label: 'Blue', bg: 'linear-gradient(135deg,#0015FF,#000B66)' },
  ] as const;
  const tog = (k: keyof typeof prefs) => (
    <button className="btn btn-ghost" style={{ padding: '8px 14px', fontSize: '.78rem' }} onClick={() => setPrefs({ ...prefs, [k]: !prefs[k] })}>
      {prefs[k] ? 'On' : 'Off'}
    </button>
  );
  const enableNotif = async () => {
    if (!('Notification' in window)) return toast('Notifications not supported', 'warning');
    if (Notification.permission === 'granted') return toast('Notifications are already enabled ✅', 'success');
    const p = await Notification.requestPermission();
    toast(p === 'granted' ? 'Notifications enabled' : 'Notification permission denied', p === 'granted' ? 'success' : 'warning');
  };
  return (
    <Modal open={open} title="Settings" onClose={ui.closeModal} id="settings-modal">
      <div className="sec">
        <div className="sec-title">
          <Icon name="palette" /> Appearance
        </div>
        <div className="theme-grid">
          {themes.map((t) => (
            <div key={t.id} className={`theme-card${ui.theme === t.id ? ' active' : ''}`} onClick={() => ui.setTheme(t.id)}>
              <div className="theme-swatch" style={{ background: t.bg }} />
              <span>{t.label}</span>
            </div>
          ))}
        </div>
        <div className="color-row">
          <label className="color-field">
            <input type="color" value={c1} onChange={(e) => setC1(e.target.value)} />
            <small>Accent 1</small>
          </label>
          <label className="color-field">
            <input type="color" value={c2} onChange={(e) => setC2(e.target.value)} />
            <small>Accent 2</small>
          </label>
        </div>
        <div className="grad-preview" style={{ background: `linear-gradient(135deg,${c1},${c2})` }} />
      </div>
      <div className="sec">
        <div className="sec-title">
          <Icon name="notifications" /> Notifications
        </div>
        <div className="row">
          <span className="k">Push notifications</span>
          <button className="btn btn-ghost" onClick={enableNotif} style={{ padding: '8px 14px', fontSize: '.78rem' }}>
            <Icon name="notifications_active" style={{ fontSize: 16 }} /> Enable
          </button>
        </div>
        <div className="row">
          <span className="k">Response sound</span>
          {tog('sound')}
        </div>
      </div>
      <div className="sec">
        <div className="sec-title">
          <Icon name="tune" /> Preferences
        </div>
        <div className="row">
          <span className="k">Auto-scroll</span>
          {tog('autoScroll')}
        </div>
        <div className="row">
          <span className="k">Send with Enter</span>
          {tog('enterToSend')}
        </div>
        <div className="row">
          <span className="k">Clear all local data</span>
          <button
            className="btn btn-danger"
            style={{ padding: '8px 14px', fontSize: '.78rem' }}
            onClick={() => {
              if (!confirm('Reset the app? All local chats and settings will be erased (your wallet is kept).')) return;
              resetLocalData();
              location.reload();
            }}
          >
            Reset
          </button>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-ghost" style={{ flex: 1 }} onClick={ui.closeModal}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          style={{ flex: 1 }}
          onClick={() => {
            ui.applyColors({ color1: c1, color2: c2 });
            ui.saveSettings(prefs);
            ui.closeModal();
            toast('Settings applied', 'success');
          }}
        >
          <Icon name="check" /> Apply
        </button>
      </div>
    </Modal>
  );
}

/* ============================ PROFILE ============================ */
export function ProfileModal() {
  const ui = useUI();
  const { user } = useAuth();
  const { sessionId } = useChat();
  const open = ui.modal?.kind === 'modal' && ui.modal.id === 'profile';
  const [online, setOnline] = useState(true);
  useEffect(() => {
    const f = () => setOnline(navigator.onLine);
    f();
    window.addEventListener('online', f);
    window.addEventListener('offline', f);
    return () => {
      window.removeEventListener('online', f);
      window.removeEventListener('offline', f);
    };
  }, []);
  const info = useMemo(() => {
    if (!open) return null;
    const ua = navigator.userAgent;
    const browser = ua.includes('Edg') ? 'Edge' : ua.includes('Chrome') ? 'Chrome' : ua.includes('Firefox') ? 'Firefox' : ua.includes('Safari') ? 'Safari' : 'Unknown';
    const platform = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Unknown';
    let bytes = 0, chats = 0, messages = 0;
    for (const k in localStorage) {
      if (!Object.prototype.hasOwnProperty.call(localStorage, k) || !k.startsWith('zikriyon')) continue;
      const v = localStorage.getItem(k) || '';
      bytes += new Blob([v]).size;
      if (k === 'zikriyonLocalHistory') {
        try {
          const arr = JSON.parse(v);
          chats = arr.length;
          messages = arr.reduce((n: number, x: any) => n + (x.messageCount || x.messages?.length || 0), 0);
        } catch { /* ignore */ }
      }
    }
    const created = localStorage.getItem('zikriyon-account-created');
    return { browser, platform, bytes, chats, messages, created: created ? new Date(+created).toLocaleDateString() : '—' };
  }, [open]);
  const name = user ? user.displayName || user.email?.split('@')[0] || 'User' : 'Guest User';
  return (
    <Modal open={open} title="Profile" onClose={ui.closeModal} id="profile-modal">
      <div className="profile-hero">
        <div className="profile-avatar">{user?.photoURL ? <img src={user.photoURL} alt="" /> : <Icon name="person" style={{ fontSize: 36 }} />}</div>
        <h3>{name}</h3>
        <p>{user?.email || '—'}</p>
        <div className="uid-chip">{sessionId}</div>
      </div>
      <div className="sec">
        <div className="sec-title"><Icon name="database" /> Usage</div>
        <div className="row"><span className="k">Total chats</span><span className="v">{info?.chats ?? 0}</span></div>
        <div className="row"><span className="k">Total messages</span><span className="v">{info?.messages ?? 0}</span></div>
        <div className="row"><span className="k">Storage used</span><span className="v">{((info?.bytes ?? 0) / 1024).toFixed(2)} KB</span></div>
        <div className="row"><span className="k">Member since</span><span className="v">{info?.created ?? '—'}</span></div>
        <div className="bar"><span style={{ width: Math.min(((info?.bytes ?? 0) / 1024 / 5120) * 100, 100) + '%' }} /></div>
      </div>
      <div className="sec">
        <div className="sec-title"><Icon name="devices" /> Device</div>
        <div className="row"><span className="k">Browser</span><span className="v">{info?.browser ?? '—'}</span></div>
        <div className="row"><span className="k">Platform</span><span className="v">{info?.platform ?? '—'}</span></div>
        <div className="row"><span className="k">Screen</span><span className="v">{open ? `${screen.width}×${screen.height}` : '—'}</span></div>
        <div className="row"><span className="k">Language</span><span className="v">{open ? navigator.language : '—'}</span></div>
        <div className="row">
          <span className="k">Connection</span>
          <span className="v"><span className={`status-pill${online ? '' : ' off'}`}><span className="d" /><span>{online ? 'Online' : 'Offline'}</span></span></span>
        </div>
      </div>
    </Modal>
  );
}

/* ============================ AUTH ============================ */
export function AuthModal() {
  const ui = useUI();
  const auth = useAuth();
  const open = ui.modal?.kind === 'modal' && ui.modal.id === 'auth';
  const [signUp, setSignUp] = useState(false);
  const [mode, setMode] = useState<'password' | 'link'>('password');
  const [info, setInfo] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  useEffect(() => {
    if (open) {
      setSignUp(!!ui.modal?.arg?.signUp);
      setMode('password');
      setInfo('');
      setErr('');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr('');
    setInfo('');
    try {
      if (mode === 'link') {
        await auth.sendLink(email);
        setInfo('Sign-in link sent! Open it on this device to finish (check spam too).');
        return;
      }
      if (signUp) {
        await auth.signUp(email.trim(), pass, name.trim());
        toast('Account created 🎉', 'success');
      } else {
        await auth.signIn(email.trim(), pass);
        toast('Signed in', 'success');
      }
      ui.closeModal();
    } catch (x) {
      setErr(prettyAuthError(x));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} title={signUp ? 'Create Account' : 'Sign In'} onClose={ui.closeModal} id="auth-modal">
      <div className="auth-hero">
        <Logo />
        <h2>{signUp ? 'Get started' : 'Welcome back'}</h2>
        <p>{signUp ? 'Create your free Zikriyon AI account' : 'Sign in to continue to Zikriyon AI'}</p>
      </div>
      <div className={`auth-error${err ? ' show' : ''}`}>{err}</div>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
        {signUp ? <input type="text" className="input" placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} /> : null}
        <input type="email" className="input" placeholder="Email address" required value={email} onChange={(e) => setEmail(e.target.value)} />
        {mode === 'password' ? <input type="password" className="input" placeholder="Password" required minLength={6} value={pass} onChange={(e) => setPass(e.target.value)} /> : null}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy}>
          {mode === 'link' ? <><Icon name="forward_to_inbox" /> Email me a sign-in link</> : <><Icon name={signUp ? 'person_add' : 'login'} /> {signUp ? 'Create Account' : 'Sign In'}</>}
        </button>
        {info ? <div className="auth-error show" style={{ background: 'rgba(16,185,129,.12)', color: 'var(--ok)', borderColor: 'var(--ok)' }}>{info}</div> : null}
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.78rem' }}>
          <button type="button" className="auth-link" style={{ background: 'none', border: 0, color: 'var(--primary)', cursor: 'pointer', fontWeight: 600 }} onClick={() => { setMode(mode === 'link' ? 'password' : 'link'); setErr(''); setInfo(''); }}>
            {mode === 'link' ? 'Use password instead' : 'Passwordless: email link'}
          </button>
          {mode === 'password' && !signUp ? (
            <button
              type="button"
              style={{ background: 'none', border: 0, color: 'var(--text-2)', cursor: 'pointer', fontWeight: 600 }}
              onClick={async () => {
                if (!email.trim()) return setErr('Enter your email first.');
                try { await auth.resetPassword(email); setErr(''); setInfo('Password reset email sent.'); } catch (x) { setErr(prettyAuthError(x)); }
              }}
            >
              Forgot password?
            </button>
          ) : null}
        </div>
      </form>
      <div className="divider">OR</div>
      <button
        className="btn btn-ghost btn-block"
        onClick={async () => {
          try {
            await auth.signInGoogle();
            toast('Signed in with Google', 'success');
            ui.closeModal();
          } catch (x) {
            setErr(prettyAuthError(x));
          }
        }}
      >
        <Icon name="account_circle" /> Continue with Google
      </button>
      <button
        className="btn btn-ghost btn-block"
        onClick={async () => {
          try {
            await auth.signInGithub();
            toast('Signed in with GitHub', 'success');
            ui.closeModal();
          } catch (x) {
            setErr(prettyAuthError(x));
          }
        }}
      >
        <Icon name="code" /> Continue with GitHub
      </button>
      <div className="auth-switch">
        <span>{signUp ? 'Already have an account?' : "Don't have an account?"}</span>
        <button type="button" onClick={() => setSignUp(!signUp)}>{signUp ? 'Sign in' : 'Sign up'}</button>
      </div>
    </Modal>
  );
}

/* ============================ EDIT HISTORY ============================ */
export function EditHistoryModal() {
  const ui = useUI();
  const chat = useChat();
  const open = ui.modal?.kind === 'modal' && ui.modal.id === 'editHistory';
  const index: number = ui.modal?.arg ?? -1;
  const [sel, setSel] = useState(-1);
  useEffect(() => setSel(-1), [open, index]);
  const msg = chat.items[index];
  const versions = msg?.versions || [];
  return (
    <Modal open={open} title="Edit History" onClose={ui.closeModal} id="edit-history-modal">
      <div className="eh-list">
        {msg ? (
          <>
            <div className={`eh-item${sel === -1 ? ' active' : ''}`} onClick={() => setSel(-1)}>
              <div className="eh-text">{msg.text.slice(0, 200)}</div>
              <div className="eh-meta"><span>Current version</span><span>now</span></div>
            </div>
            {versions.map((v, i) => ({ v, i })).reverse().map(({ v, i }) => (
              <div key={i} className={`eh-item${sel === i ? ' active' : ''}`} onClick={() => setSel(i)}>
                <div className="eh-text">{v.text.slice(0, 200)}</div>
                <div className="eh-meta"><span>Version {i + 1}</span><span>{formatRelative(v.timestamp)}</span></div>
              </div>
            ))}
          </>
        ) : null}
      </div>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-ghost" style={{ flex: 1 }} onClick={ui.closeModal}>Cancel</button>
        <button
          className="btn btn-primary"
          style={{ flex: 1 }}
          onClick={() => {
            if (sel === -1) return toast('Select an older version to restore', 'info');
            chat.restoreVersion(index, sel);
            ui.closeModal();
          }}
        >
          <Icon name="restore" /> Restore
        </button>
      </div>
    </Modal>
  );
}

/* ============================ EXPORT ============================ */
export function ExportModal() {
  const ui = useUI();
  const chat = useChat();
  const open = ui.modal?.kind === 'modal' && ui.modal.id === 'export';
  const md = () => {
    const h = chat.toHistory();
    if (!h.length) return '_Empty conversation_';
    const lines = ['# Zikriyon AI Conversation', `_${new Date().toLocaleString()}_`, ''];
    h.forEach((m) => {
      lines.push(m.role === 'user' ? '## 👤 You' : '## 🤖 Zikriyon', '', m.parts[0].text, '');
    });
    return lines.join('\n');
  };
  const txt = () => chat.toHistory().map((m) => `${m.role === 'user' ? 'You' : 'Zikriyon'}: ${m.parts[0].text}`).join('\n\n');
  const guard = (fn: () => void, verb: string) => () => {
    if (!chat.items.length) return toast(`Nothing to ${verb}`, 'warning');
    fn();
  };
  return (
    <Modal open={open} title="Share & Export" onClose={ui.closeModal} id="export-modal">
      <div className="sec">
        <div className="sec-title"><Icon name="ios_share" /> Export current chat</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          <button className="btn btn-ghost btn-block" onClick={guard(() => { download(`zikriyon-chat-${Date.now()}.md`, md(), 'text/markdown'); toast('Markdown downloaded', 'success'); }, 'export')}><Icon name="description" /> Download as Markdown</button>
          <button className="btn btn-ghost btn-block" onClick={guard(() => { download(`zikriyon-chat-${Date.now()}.json`, JSON.stringify(chat.toHistory(), null, 2), 'application/json'); toast('JSON downloaded', 'success'); }, 'export')}><Icon name="data_object" /> Download as JSON</button>
          <button className="btn btn-ghost btn-block" onClick={guard(() => { download(`zikriyon-chat-${Date.now()}.txt`, txt(), 'text/plain'); toast('Text file downloaded', 'success'); }, 'export')}><Icon name="article" /> Download as Text</button>
          <button className="btn btn-primary btn-block" onClick={guard(() => { void copyText(md()).then(() => toast('Conversation copied', 'success')); }, 'copy')}><Icon name="content_copy" /> Copy to Clipboard</button>
        </div>
      </div>
    </Modal>
  );
}
