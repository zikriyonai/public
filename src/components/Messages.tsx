'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import { buildPreviewDoc, renderMarkdown } from '@/lib/markdown';
import { copyText, formatTime } from '@/lib/util';
import { toast } from '@/lib/ui-bus';
import { Icon } from './Icon';
import { useChat, type Msg } from './providers/ChatProvider';
import { useUI } from './providers/UIProvider';

function speak(text: string, btn: HTMLElement | null) {
  if (!('speechSynthesis' in window)) return toast('Text-to-speech unavailable', 'warning');
  if (speechSynthesis.speaking) {
    speechSynthesis.cancel();
    btn?.classList.remove('active');
    return;
  }
  const u = new SpeechSynthesisUtterance(text.replace(/```[\s\S]*?```/g, ' code block '));
  u.rate = 0.95;
  btn?.classList.add('active');
  u.onend = u.onerror = () => btn?.classList.remove('active');
  speechSynthesis.speak(u);
}

function LiveDemo({ doc }: { doc: string }) {
  const [shown, setShown] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <div className="live-demo">
      <div className="live-demo-head">
        <b>Live Preview</b>
        <button
          className="live-demo-btn"
          onClick={() => {
            setShown(!shown);
            setLoaded(true);
          }}
        >
          {shown ? 'Hide' : 'Run'}
        </button>
      </div>
      {loaded ? <iframe sandbox="allow-scripts allow-modals" style={{ display: shown ? 'block' : 'none' }} srcDoc={doc} /> : null}
    </div>
  );
}

function UserMessage({ m, index }: { m: Msg; index: number }) {
  const chat = useChat();
  const ui = useUI();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(m.text);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    if (save) chat.editMessage(index, val);
  };
  return (
    <div className="message user-message">
      {(m.files || []).map((f, i) =>
        f.isImage ? (
          <img key={i} src={f.dataURL} className="img-attachment" style={{ maxWidth: '100%', borderRadius: 12, marginBottom: 8, display: 'block' }} alt="" />
        ) : (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 7, background: 'rgba(255,255,255,.15)', padding: '8px 12px', borderRadius: 10, marginBottom: 8, fontSize: '.78rem', fontWeight: 600 }}>
            <Icon name="description" style={{ fontSize: 16 }} />
            {f.name}
          </div>
        ),
      )}
      <div className="msg-bubble">
        {editing ? (
          <textarea
            className="edit-area"
            autoFocus
            value={val}
            style={{ width: '100%', minHeight: 60, padding: 10, borderRadius: 12, border: '1px solid var(--primary)', background: 'rgba(0,0,0,.25)', color: '#fff', fontFamily: 'inherit', fontSize: '.92rem', resize: 'vertical', outline: 'none' }}
            onChange={(e) => setVal(e.target.value)}
            onBlur={() => finish(true)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                finish(true);
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setVal(m.text);
                finish(false);
              }
            }}
          />
        ) : (
          <div className="msg-content" style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
        )}
      </div>
      <div className="msg-time">{formatTime(m.time)}</div>
      <div className="message-actions">
        <button className="msg-action-btn" title="Copy" onClick={() => copyText(m.text).then(() => toast('Copied to clipboard', 'success')).catch(() => toast('Copy failed', 'error'))}><Icon name="content_copy" /></button>
        <button className="msg-action-btn" title="Edit" onClick={() => { done.current = false; setVal(m.text); setEditing(true); }}><Icon name="edit" /></button>
        <button className="msg-action-btn" title="History" onClick={() => ui.openModal('editHistory', index)}><Icon name="history" /></button>
        <button className="msg-action-btn" title="Listen" onClick={(e) => speak(m.text, e.currentTarget)}><Icon name="volume_up" /></button>
      </div>
      {m.versions && m.versions.length ? (
        <button className="edited-indicator" onClick={() => ui.openModal('editHistory', index)}>
          <Icon name="edit" />
          <span>Edited · {m.versions.length + 1} versions</span>
        </button>
      ) : null}
    </div>
  );
}

function BotMessage({ m, index }: { m: Msg; index: number }) {
  const chat = useChat();
  const ui = useUI();
  const [vote, setVote] = useState<'up' | 'down' | null>(null);
  const doc = !m.loading && !m.streaming && !m.error ? buildPreviewDoc(m.text) : null;
  // the regenerate target is the user message that precedes this answer
  const userIndex = index - 1;
  return (
    <div className={`message bot-message${m.loading ? ' loading' : ''}`}>
      <img className="avatar zikriyon-logo" src="/zikriyon.png" alt="Zikriyon" />
      <div className="bot-wrap">
        <div className="msg-bubble">
          {m.loading ? (
            <div className="msg-content">
              <span className="typing"><i /><i /><i /></span>
            </div>
          ) : m.error ? (
            <div className="msg-content">
              <span style={{ color: 'var(--err)', fontWeight: 600 }}>⚠ {m.text}</span>
            </div>
          ) : m.streaming ? (
            <div className="msg-content" style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
          ) : (
            <div className="msg-content" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.text) }} />
          )}
        </div>
        {!m.loading ? (
          <div className="message-actions">
            <button className="msg-action-btn" title="Copy" onClick={() => copyText(m.text).then(() => toast('Copied to clipboard', 'success')).catch(() => toast('Copy failed', 'error'))}><Icon name="content_copy" /></button>
            <button className="msg-action-btn" title="Regenerate" onClick={() => chat.regenerateFrom(userIndex)}><Icon name="refresh" /></button>
            <button className={`msg-action-btn${vote === 'up' ? ' active' : ''}`} title="Good response" onClick={() => { setVote('up'); toast('Thanks for the feedback!', 'success'); }}><Icon name="thumb_up" /></button>
            <button className={`msg-action-btn${vote === 'down' ? ' active' : ''}`} title="Bad response" onClick={() => { setVote('down'); toast("Feedback noted — we'll improve.", 'info'); }}><Icon name="thumb_down" /></button>
            <button className="msg-action-btn" title="Share & export" onClick={() => ui.openModal('export')}><Icon name="ios_share" /></button>
          </div>
        ) : null}
        {doc ? <LiveDemo doc={doc} /> : null}
        {m.cost ? (
          <div className="zik-cost">
            <Icon name="bolt" />
            {m.cost}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function Messages() {
  const { items, regenerateFrom, scrollTick } = useChat();
  const ui = useUI();
  const box = useRef<HTMLDivElement>(null);

  /* copy buttons inside rendered markdown */
  const onClick = (e: React.MouseEvent) => {
    const b = (e.target as HTMLElement).closest('[data-copy-code]');
    if (!b) return;
    const code = b.closest('.code-block')?.querySelector('.code-content')?.textContent || '';
    copyText(code).then(() => toast('Code copied', 'success')).catch(() => toast('Copy failed', 'error'));
  };

  /* keep the latest message in view */
  useEffect(() => {
    const c = document.getElementById('container');
    if (!c || !ui.settings.autoScroll) return;
    requestAnimationFrame(() => c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' }));
  }, [scrollTick, items.length, ui.settings.autoScroll]);

  return (
    <div className="chats-container" id="chats-container" ref={box} onClick={onClick}>
      {items.map((m, i) => {
        const next = items[i + 1];
        const showRegen = m.role === 'user' && m.editedAt && (!next || (next.role === 'bot' && next.time < m.editedAt)) && !next?.loading;
        return (
          <Fragment key={m.id}>
            {m.role === 'user' ? <UserMessage m={m} index={i} /> : <BotMessage m={m} index={i} />}
            {showRegen ? (
              <div className="regenerate-row">
                <button className="regenerate-btn" onClick={() => regenerateFrom(i)}>
                  <Icon name="refresh" />
                  Regenerate response
                </button>
              </div>
            ) : null}
          </Fragment>
        );
      })}
    </div>
  );
}
