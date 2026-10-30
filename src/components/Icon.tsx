import type { CSSProperties } from 'react';

/** Material Symbols Rounded glyph (font is loaded in the root layout). */
export function Icon({ name, className = '', style, fill }: { name: string; className?: string; style?: CSSProperties; fill?: boolean }) {
  return (
    <span className={`material-symbols-rounded${fill ? ' icon-fill' : ''}${className ? ' ' + className : ''}`} style={style} aria-hidden="true">
      {name}
    </span>
  );
}
