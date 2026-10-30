'use client';

import { useEffect, useState } from 'react';
import '@/lib/panels';
import { AuthProvider } from './providers/AuthProvider';
import { ChatProvider, useChat } from './providers/ChatProvider';
import { UIProvider, useUI } from './providers/UIProvider';
import { AuthDrawer, Banner, Header, InstallPrompt, OfflineBanner, Sidebar, Splash, Toasts } from './Chrome';
import { Composer, ScrollBottom, Welcome } from './Composer';
import { Messages } from './Messages';
import { AuthModal, EditHistoryModal, ExportModal, ModelModal, ProfileModal, SettingsModal } from './modals';
import { PanelHost } from './PanelHost';
import { walletStore } from '@/lib/wallet-store';
import { open as openPanel } from '@/lib/panels';
import E from '@/lib/billing/engine';

function Shell() {
  const ui = useUI();
  const chat = useChat();
  const [draft, setDraft] = useState('');

  /* welcome gift (7-day Pro trial) for first-time visitors */
  useEffect(() => {
    const t = setTimeout(() => {
      const s = walletStore.get();
      if (s.trialUsed || localStorage.getItem('zik-onboarded')) return;
      try { localStorage.setItem('zik-onboarded', '1'); } catch { /* ignore */ }
      const r = walletStore.mutate((x) => E.startTrial(x, 'reverse_trial', Date.now()), 'trial');
      if (r.ok) openPanel('welcome');
    }, 3600);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      const reg = () => navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
      if (document.readyState === 'complete') reg();
      else window.addEventListener('load', reg, { once: true });
    }
  }, []);

  const overlay = ui.drawer !== null || ui.modal !== null;
  return (
    <>
      <Splash />
      <OfflineBanner />
      <Header />
      <div className={`overlay${overlay ? ' active' : ''}`} id="overlay" onClick={ui.closeAll} />
      <Sidebar />
      <AuthDrawer />
      <main className="container" id="container">
        <Welcome onPick={(p) => { setDraft(p); if (window.innerWidth > 640 && chat.send(p)) setDraft(''); }} />
        <Messages />
      </main>
      <ScrollBottom />
      <Composer draft={draft} setDraft={setDraft} />
      <Banner />
      <ModelModal />
      <SettingsModal />
      <ProfileModal />
      <AuthModal />
      <EditHistoryModal />
      <ExportModal />
      <PanelHost />
      <InstallPrompt />
      <Toasts />
    </>
  );
}

export default function App() {
  return (
    <UIProvider>
      <AuthProvider>
        <ChatProvider>
          <Shell />
        </ChatProvider>
      </AuthProvider>
    </UIProvider>
  );
}
