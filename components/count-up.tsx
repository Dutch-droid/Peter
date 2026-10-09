'use client';
import { useEffect, useRef, useState } from 'react';
import { kes } from '@/lib/format';

/** Counts up to `value` on mount (skipped when the user prefers reduced motion). */
export function CountUp({ value, kind = 'int' }: { value: number; kind?: 'int' | 'kes' }) {
  const [shown, setShown] = useState(value);
  const raf = useRef(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const t0 = performance.now();
    const dur = 700;
    const tick = (t: number) => {
      const k = Math.min(1, (t - t0) / dur);
      setShown(value * (1 - Math.pow(1 - k, 3)));
      if (k < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value]);
  return <>{kind === 'kes' ? kes(Math.round(shown)) : Math.round(shown)}</>;
}
