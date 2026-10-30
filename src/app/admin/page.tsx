'use client';

import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { getFirebase } from '@/lib/firebase/client';
import { apiPost } from '@/lib/panels/billing-adapter';

/* eslint-disable @typescript-eslint/no-explicit-any */
type Tab = 'pending_verification' | 'created' | 'approved' | 'rejected' | 'students' | 'alerts';
const TABS: [Tab, string][] = [['pending_verification', 'To verify'], ['created', 'Unpaid'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['students', 'Students'], ['alerts', 'Unmatched alerts']];

async function api(path: string, init?: RequestInit) {
  const u = getFirebase()?.auth.currentUser;
  if (!u) throw new Error('Sign in first');
  const r = await fetch(path, { ...init, headers: { ...(init?.headers || {}), Authorization: `Bearer ${await u.getIdToken()}` } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || `HTTP ${r.status}`);
  return j;
}

export default function AdminPage() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('pending_verification');
  const [items, setItems] = useState<any[]>([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const fb = getFirebase();
    if (!fb) return setReady(true);
    return onAuthStateChanged(fb.auth, (u) => { setUser(u); setReady(true); });
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    setErr(''); setBusy(true);
    try {
      const j = await api(tab === 'students' ? '/api/admin?kind=students' : tab === 'alerts' ? '/api/admin?kind=alerts' : `/api/admin?kind=orders&status=${tab}`);
      setItems(j.items || []);
    } catch (e: any) { setErr(e.message); setItems([]); } finally { setBusy(false); }
  }, [user, tab]);
  useEffect(() => { void load(); }, [load]);

  const act = async (body: Record<string, unknown>) => {
    try { await apiPost('/api/admin', body); await load(); } catch (e: any) { setErr(e.message); }
  };

  const card: React.CSSProperties = { background: 'var(--surface-solid, #fff)', border: '1px solid var(--border, #e2e8f0)', borderRadius: 16, padding: 14, display: 'flex', flexDirection: 'column', gap: 6 };
  return (
    <main style={{ maxWidth: 860, margin: '0 auto', padding: '24px 16px 60px', fontFamily: 'Inter, system-ui, sans-serif', color: 'var(--text, #0f172a)', minHeight: '100dvh', background: 'var(--bg, #f6fbff)' }}>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 800, marginBottom: 4 }}>Zikriyon AI · Admin</h1>
      <p style={{ color: 'var(--text-2, #64748b)', fontSize: '.85rem', marginBottom: 16 }}>
        Payments are approved automatically from your bank credit alerts. Anything that could not be matched shows up in “To verify” / “Unmatched alerts” for a manual check.
      </p>
      {!ready ? <p>Loading…</p> : !user ? <p>Sign in on the <a href="/">main app</a> with an admin account, then reopen this page.</p> : (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
            {TABS.map(([k, l]) => (
              <button key={k} className={`btn ${tab === k ? 'btn-primary' : 'btn-ghost'}`} style={{ padding: '8px 14px', fontSize: '.8rem' }} onClick={() => setTab(k)}>{l}</button>
            ))}
            <button className="btn btn-ghost" style={{ padding: '8px 14px', fontSize: '.8rem', marginLeft: 'auto' }} onClick={() => void load()}>{busy ? '…' : 'Refresh'}</button>
          </div>
          {err ? <div style={{ ...card, borderColor: '#ef4444', color: '#b91c1c', marginBottom: 12 }}>{err}</div> : null}
          <div style={{ display: 'grid', gap: 10 }}>
            {!items.length && !busy ? <p style={{ color: '#64748b' }}>Nothing here.</p> : null}
            {tab === 'alerts' ? items.map((a) => (
              <div key={a.id} style={card}>
                <b>₹{(a.amountPaise / 100).toFixed(2)} credit · UTR {a.utr || '—'}</b>
                <small>{new Date(a.ts).toLocaleString()} · {a.result || 'no matching order'}</small>
                <small style={{ fontFamily: 'JetBrains Mono, monospace', wordBreak: 'break-word' }}>{a.text}</small>
                <small>Match it by hand: open the order in "To verify" with the same UTR/amount and approve.</small>
              </div>
            )) : tab !== 'students' ? items.map((o) => (
              <div key={o.id} style={card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <b>{o.id} · {o.planName}</b><b>₹{Number(o.amountInr).toLocaleString('en-IN')}</b>
                </div>
                <small>{o.email || o.uid} · {new Date(o.submittedAt || o.createdAt).toLocaleString()}</small>
                <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '.9rem' }}>UTR: {o.utr || '—'}</div>
                {o.note ? <small>Note: {o.note}</small> : null}
                {tab === 'pending_verification' ? (
                  <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                    <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => { if (confirm(`Approve ₹${o.amountInr} for ${o.email || o.uid}? Confirm the UTR ${o.utr} is in your statement.`)) void act({ action: 'approve_order', orderId: o.id }); }}>Approve</button>
                    <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => { const note = prompt('Reason (shown to the user):', 'Payment not found for this UTR'); if (note !== null) void act({ action: 'reject_order', orderId: o.id, note }); }}>Reject</button>
                  </div>
                ) : null}
              </div>
            )) : items.map((s) => (
              <div key={s.id} style={card}>
                <b>{s.college} · {s.studentId}</b><small>{s.email || s.uid}</small>
                {s.image ? <img src={s.image} alt="ID" style={{ maxWidth: 320, borderRadius: 10 }} /> : null}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => void act({ action: 'student_approve', uid: s.id })}>Verify</button>
                  <button className="btn btn-danger" style={{ flex: 1 }} onClick={() => void act({ action: 'student_reject', uid: s.id })}>Reject</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </main>
  );
}
