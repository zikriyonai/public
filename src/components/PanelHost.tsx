'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { bridge, panels } from '@/lib/panels';
import { Icon } from './Icon';
import { useAuth } from './providers/AuthProvider';
import { useUI } from './providers/UIProvider';
import { useWallet } from './providers/stores';
import { useMounted } from './useMounted';

/* eslint-disable @typescript-eslint/no-explicit-any */
/** Hosts the template-based panels (wallet, plans, UPI checkout, billing …). */
export function PanelHost() {
  const ui = useUI();
  const { user } = useAuth();
  const { version } = useWallet();
  const [tick, setTick] = useState(0);
  const openId = ui.modal?.kind === 'panel' ? ui.modal.id : null;
  const [lastId, setLastId] = useState<string | null>(null);
  const { mounted, active } = useMounted(!!openId);
  const modalRef = useRef(ui.modal);
  const userRef = useRef(user);
  modalRef.current = ui.modal;
  userRef.current = user;
  const lastRender = useRef<{ id: string | null; tick: number }>({ id: null, tick: -1 });
  const root = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const card = useRef<HTMLDivElement>(null);

  if (openId && openId !== lastId) setLastId(openId);
  const id = openId || lastId;

  /* wire the framework-free panel code to React state */
  useEffect(() => {
    bridge.open = (pid) => {
      ui.openPanel(pid as any);
      setTick((t) => t + 1);
    };
    bridge.close = (pid) => {
      if (modalRef.current?.kind === 'panel' && modalRef.current.id === pid) ui.closeModal();
    };
    bridge.rerender = () => setTick((t) => t + 1);
    bridge.isOpen = (pid) => modalRef.current?.kind === 'panel' && modalRef.current.id === pid;
    bridge.openModal = (mid, arg) => ui.openModal(mid as any, arg);
    bridge.closeAll = ui.closeAll;
    bridge.getUser = () => userRef.current;
  }, [ui]);

  /* (re)render the panel HTML — on open, wallet change or explicit rerender; don't steal focus while typing */
  useLayoutEffect(() => {
    if (!id || !body.current) return;
    const def = panels[id];
    if (!def) return;
    const ae = document.activeElement as HTMLElement | null;
    const typing = !!ae && body.current.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName);
    if (typing && lastRender.current.id === id && lastRender.current.tick === tick) return; // wallet-only refresh while typing
    const top = card.current?.scrollTop ?? 0;
    body.current.innerHTML = def.render(def.arg);
    if (card.current) card.current.scrollTop = lastRender.current.id === id ? top : 0;
    lastRender.current = { id, tick };
    def.after?.(body.current, root.current as HTMLElement);
  }, [id, tick, version, mounted]);
  useEffect(() => {
    if (!openId) lastRender.current = { id: null, tick: -1 };
  }, [openId]);

  if (!mounted || !id || !panels[id]) return null;
  const def = panels[id];

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    if (t === root.current && def.sheet) return ui.closeModal();
    if (t.closest('[data-zclose]')) return ui.closeModal();
    const b = t.closest('[data-a]') as HTMLElement | null;
    const fn = b && def.actions && def.actions[b.dataset.a as string];
    if (b && fn) {
      e.preventDefault();
      void fn(b, e.nativeEvent);
    }
  };

  return (
    <div
      ref={root}
      id={`zik-${id}`}
      className={`modal${def.sheet ? ' zik-sheet-modal' : ''}${active ? ' active' : ''}`}
      onClick={onClick}
      onInput={(e) => def.input?.(e.target, e.nativeEvent)}
      onChange={(e) => def.change?.(e.target, e.nativeEvent)}
      onSubmit={(e) => {
        e.preventDefault();
        def.submit?.(e.target, e.nativeEvent);
      }}
    >
      <div className={`modal-card ${def.cls || ''}`} ref={card}>
        <div className="modal-head">
          <h2>{def.title}</h2>
          <button className="modal-close" data-zclose aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body" ref={body} />
      </div>
    </div>
  );
}
