'use client';
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { useMounted } from './useMounted';

/** Standard modal chrome (same markup/classes as the original .modal / .modal-card). */
export function Modal({ open, title, onClose, children, id }: { open: boolean; title: string; onClose: () => void; children: ReactNode; id?: string }) {
  const { mounted, active } = useMounted(open);
  if (!mounted) return null;
  return (
    <div className={`modal${active ? ' active' : ''}`} id={id}>
      <div className="modal-card">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}
