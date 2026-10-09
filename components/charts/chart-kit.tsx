'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Width of an element, tracked with ResizeObserver. Starts at `initial` so SSR and first paint agree. */
export function useWidth(initial = 640): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(Math.max(260, Math.floor(el.getBoundingClientRect().width)));
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

/** Active data index driven by pointer or keyboard (←/→/Home/End, Esc clears). */
export function useActive(count: number) {
  const [active, setActive] = useState<number | null>(null);
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { setActive((a) => Math.min(count - 1, (a ?? -1) + 1)); e.preventDefault(); }
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { setActive((a) => Math.max(0, (a ?? count) - 1)); e.preventDefault(); }
    else if (e.key === 'Home') { setActive(0); e.preventDefault(); }
    else if (e.key === 'End') { setActive(count - 1); e.preventDefault(); }
    else if (e.key === 'Escape') setActive(null);
  }, [count]);
  return { active, setActive, onKeyDown };
}

export type TipRow = { label: string; value: string; color?: string };

/** Floating readout. Values lead (strong), labels follow (secondary); series keyed by a short line. */
export function Tooltip({ x, width, title, rows }: { x: number; width: number; title: string; rows: TipRow[] }) {
  const flip = x > width * 0.6;
  return (
    <div className="vtip" role="status" style={{ left: flip ? undefined : x + 14, right: flip ? width - x + 14 : undefined }}>
      <div className="vtip-title">{title}</div>
      {rows.map((r, i) => (
        <div key={i} className="vtip-row">
          {r.color && <i style={{ background: r.color }} />}
          <b>{r.value}</b><span>{r.label}</span>
        </div>))}
    </div>
  );
}

export type LegendItem = { label: string; color: string; shape?: 'line' | 'rect' };

/**
 * Card shell for every chart: title, optional legend (always for 2+ series), chart/table switch, empty state.
 * The table is the accessible twin: every value is reachable without hover.
 */
export function ChartCard({ title, subtitle, legend, table, empty, children, className }: {
  title: string; subtitle?: string; legend?: LegendItem[]; className?: string;
  table: { head: string[]; rows: (string | number)[][] }; empty?: string | null; children: React.ReactNode;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <section className={`card viz ${className ?? ''}`} aria-label={title}>
      <header className="viz-head">
        <div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>
        {!empty && (
          <div className="viz-switch" role="group" aria-label={`${title} view`}>
            <button type="button" className={view === 'chart' ? 'on' : ''} aria-pressed={view === 'chart'} onClick={() => setView('chart')}>Chart</button>
            <button type="button" className={view === 'table' ? 'on' : ''} aria-pressed={view === 'table'} onClick={() => setView('table')}>Table</button>
          </div>)}
      </header>
      {empty ? <div className="viz-empty">{empty}</div> : view === 'table' ? (
        <div className="tablewrap"><table className="viz-table">
          <thead><tr>{table.head.map((h, i) => <th key={i} className={i ? 'n' : ''}>{h}</th>)}</tr></thead>
          <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j ? 'n' : ''}>{c}</td>)}</tr>)}</tbody>
        </table></div>
      ) : (
        <>
          {legend && legend.length > 1 && (
            <ul className="viz-legend">{legend.map((l) => (
              <li key={l.label}><i className={l.shape === 'line' ? 'line' : ''} style={{ background: l.color }} />{l.label}</li>))}</ul>)}
          {children}
        </>)}
    </section>
  );
}
