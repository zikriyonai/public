'use client';
import { useEffect, useState } from 'react';

/** Keeps an element mounted during its exit transition; `active` flips one frame after mount so CSS transitions run. */
export function useMounted(open: boolean, exitMs = 380) {
  const [mounted, setMounted] = useState(open);
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setActive(true)));
      return () => cancelAnimationFrame(r);
    }
    setActive(false);
    const t = window.setTimeout(() => setMounted(false), exitMs);
    return () => window.clearTimeout(t);
  }, [open, exitMs]);
  return { mounted, active };
}
