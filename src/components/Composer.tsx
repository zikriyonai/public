'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import C from '@/lib/billing/catalog';
import E from '@/lib/billing/engine';
import { open as openPanel } from '@/lib/panels';
import { projectsStore } from '@/lib/projects-store';
import { toast } from '@/lib/ui-bus';
import { Icon } from './Icon';
import { MODEL_LABELS, useChat } from './providers/ChatProvider';
import { useUI } from './providers/UIProvider';
import { useProjects, useWallet } from './providers/stores';

/* eslint-disable @typescript-eslint/no-explicit-any */
export function Welcome({ onPick }: { onPick: (prompt: string) => void }) {
  const { items } = useChat();
  const S = [
    { i: 'lightbulb', t: 'Explain a concept', s: 'Quantum computing, simplified', p: 'Explain quantum computing in simple terms with an analogy.' },
    { i: 'code', t: 'Write some code', s: 'Python sorting helper', p: 'Write a Python function that sorts a list of dictionaries by a given key.' },
    { i: 'web', t: 'Build a web page', s: 'Responsive landing page', p: 'Create a modern responsive landing page with HTML and CSS. Include a hero section and a feature grid.' },
    { i: 'auto_awesome', t: 'Brainstorm ideas', s: 'AI productivity concepts', p: 'Give me 5 creative ideas for a productivity app that uses AI.' },
  ];
  return (
    <section className={`welcome${items.length ? ' hide' : ''}`} id="welcome">
      <div className="orb"><img src="/zikriyon.png" className="zikriyon-logo" alt="Zikriyon AI" /></div>
      <h1>Zikriyon AI</h1>
      <p className="sub">Your intelligent assistant for writing, coding, analysis and creative work. Ask anything — in any language.</p>
      <div className="badge"><span className="pulse" /> Online &amp; Ready</div>
      <div className="suggestions" id="suggestions">
        {S.map((x) => (
          <button key={x.t} className="suggestion" onClick={() => onPick(x.p)}>
            <div className="ico"><Icon name={x.i} /></div>
            <div><b>{x.t}</b><small>{x.s}</small></div>
          </button>
        ))}
      </div>
    </section>
  );
}

export function ScrollBottom() {
  const [show, setShow] = useState(false);
  const { items } = useChat();
  useEffect(() => {
    const c = document.getElementById('container');
    if (!c) return;
    const f = () => setShow(c.scrollHeight - c.scrollTop - c.clientHeight >= 120);
    c.addEventListener('scroll', f, { passive: true });
    return () => c.removeEventListener('scroll', f);
  }, []);
  return (
    <button id="scroll-bottom" aria-label="Scroll to bottom" className={show && items.length ? 'show' : ''} onClick={() => { const c = document.getElementById('container'); c?.scrollTo({ top: c.scrollHeight, behavior: 'smooth' }); }}>
      <Icon name="arrow_downward" />
    </button>
  );
}

export function Composer({ draft, setDraft }: { draft: string; setDraft: (v: string) => void }) {
  const chat = useChat();
  const ui = useUI();
  const { s } = useWallet();
  useProjects();
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const rec = useRef<any>(null);
  const [listening, setListening] = useState(false);
  const proj = projectsStore.active();

  /* autosize */
  useEffect(() => {
    if (!ta.current) return;
    ta.current.style.height = 'auto';
    ta.current.style.height = Math.min(ta.current.scrollHeight, 150) + 'px';
  }, [draft]);
  useEffect(() => {
    if (window.innerWidth > 900) setTimeout(() => ta.current?.focus(), 1300);
    const k = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        ta.current?.focus();
      }
    };
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, []);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (chat.send(draft)) setDraft('');
  };

  const ent = E.entitlement(s, Date.now());
  const attach = () => {
    if (C.ENFORCE.files && ent.files === 0) return openPanel('limit', { code: 'files_locked', message: 'File upload is available on plans with file support (from the ₹50 recharge or Standard plan).' });
    fileIn.current?.click();
  };
  const voice = () => {
    if (C.ENFORCE.voice && !ent.voice) return openPanel('limit', { code: 'voice_locked', message: 'Voice input/output is part of the Voice add-on (₹149/month).' });
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return toast('Speech recognition is not supported in this browser', 'warning');
    if (listening) return rec.current?.stop();
    const r = new SR();
    r.continuous = false;
    r.interimResults = true;
    r.lang = 'en-US';
    r.onstart = () => { setListening(true); toast('Listening… speak now', 'info', 1800); };
    r.onresult = (e: any) => {
      let t = '';
      for (let i = e.resultIndex; i < e.results.length; i++) t += e.results[i][0].transcript;
      setDraft(t);
    };
    r.onerror = (e: any) => { setListening(false); if (e.error !== 'aborted') toast('Voice error: ' + e.error, 'error'); };
    r.onend = () => setListening(false);
    rec.current = r;
    r.start();
  };

  return (
    <div className="composer-wrap">
      <div className="floating-actions">
        <button className="fab" id="refresh-btn" title="Refresh chat" onClick={chat.regenerateLast}><Icon name="refresh" /></button>
        <button className="fab" id="new-conversation-btn" title="New chat" onClick={() => { chat.newChat(); toast('New chat started', 'success'); }}><Icon name="add" /></button>
      </div>
      <form className="composer" id="composer-form" onSubmit={submit}>
        {proj ? (
          <div id="zik-proj-chip" className="zik-proj-chip" onClick={(e) => { if ((e.target as HTMLElement).closest('button')) { projectsStore.setActive(null); toast('Left project', 'info'); } }}>
            {proj.emoji} {proj.name}
            <button type="button" title="Leave project" aria-label="Leave project"><Icon name="close" /></button>
          </div>
        ) : null}
        <div className="file-previews" id="file-previews">
          {chat.files.map((f, i) => (
            <div className="file-chip" key={i}>
              {f.isImage ? <img src={f.dataURL} alt="" /> : <span className="fico material-symbols-rounded">{f.type.includes('pdf') ? 'picture_as_pdf' : f.type.includes('csv') ? 'table_chart' : f.type.includes('json') ? 'data_object' : 'description'}</span>}
              <span className="fname">{f.name}</span>
              <button type="button" className="rm" onClick={() => chat.removeFile(i)}><Icon name="close" /></button>
            </div>
          ))}
        </div>
        <textarea
          id="query"
          ref={ta}
          rows={1}
          value={draft}
          placeholder={chat.model === 'image' ? 'Describe the image you want to create...' : 'Ask Zikriyon anything...'}
          autoComplete="off"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && ui.settings.enterToSend) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <div className="composer-bar">
          <input ref={fileIn} id="file-input" type="file" accept="image/*,.pdf,.txt,.csv,.json,.md,.docx" multiple hidden onChange={(e) => { if (e.target.files) chat.addFiles(e.target.files); e.target.value = ''; }} />
          <button type="button" className="tool-btn" id="add-file-btn" title="Attach file" onClick={attach}><Icon name="attach_file" /></button>
          <button type="button" className={`tool-btn${listening ? ' listening' : ''}`} id="voice-btn" title="Voice input" onClick={voice}><Icon name="mic" /></button>
          <button type="button" className="model-pill" id="mode-select" onClick={() => ui.openModal('model')}>
            <Icon name="bolt" />
            <span id="model-label">{MODEL_LABELS[chat.model] || 'ZIKOS-Lite'}</span>
          </button>
          <span className="spacer" />
          <span className="char-count" id="char-count">{draft.length > 0 ? draft.length : ''}</span>
          <button type="button" className="send-btn" id="stop-btn" title="Stop" onClick={chat.stop}><Icon name="stop" /></button>
          <button type="submit" className="send-btn" id="send-btn" title="Send"><Icon name="arrow_upward" /></button>
        </div>
      </form>
    </div>
  );
}
