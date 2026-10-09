'use client';
import { barPath, columnPath, compactNumber, niceTicks } from '@/lib/chart-math';
import { ChartCard, Tooltip, useActive, useWidth } from './chart-kit';

export type BarDatum = { label: string; value: number; color?: string };

const MAX_THICK = 24;

/** Vertical columns: single series, one colour, labelled at the cap for the maximum only. */
export function ColumnChart({ title, subtitle, data, color, valueLabel, unit, emptyText }: {
  title: string; subtitle?: string; data: BarDatum[]; color: string; valueLabel: string; unit?: string; emptyText: string;
}) {
  const [ref, W] = useWidth();
  const { active: rawActive, setActive, onKeyDown } = useActive(data.length);
  const active = rawActive != null && rawActive < data.length ? rawActive : null;
  const H = 220, M = { l: 36, r: 8, t: 16, b: 28 };
  const pw = W - M.l - M.r, ph = H - M.t - M.b, band = pw / data.length;
  const max = Math.max(0, ...data.map((d) => d.value));
  const ticks = niceTicks(max, 4, true), top = ticks[ticks.length - 1]; // counts: whole-number ticks only
  const bw = Math.min(MAX_THICK, band * 0.6);
  const peak = max > 0 ? data.findIndex((d) => d.value === max) : -1;
  const empty = max === 0;
  return (
    <ChartCard title={title} subtitle={subtitle} empty={empty ? emptyText : null}
      table={{ head: ['Month', valueLabel], rows: data.map((d) => [d.label, d.value]) }}>
      <div ref={ref} className="vplot" tabIndex={0} role="group" onKeyDown={onKeyDown} onBlur={() => setActive(null)}
        aria-label={`${title}. Use arrow keys to read each bar, or switch to the table view.`} onPointerLeave={() => setActive(null)}>
        <svg width={W} height={H} aria-hidden>
          {ticks.map((t) => {
            const yy = M.t + ph - (t / top) * ph;
            return (<g key={t}>
              <line x1={M.l} x2={W - M.r} y1={yy} y2={yy} className={t === 0 ? 'vaxis' : 'vgrid'} />
              <text x={M.l - 6} y={yy + 4} textAnchor="end" className="vtick">{compactNumber(t)}</text></g>);
          })}
          {data.map((d, i) => {
            const h = (d.value / top) * ph, cx = M.l + band * i + band / 2;
            return (
              <g key={d.label}>
                {d.value > 0 && <path d={columnPath(cx - bw / 2, M.t + ph - h, bw, h)} fill={d.color ?? color} className={`vbar${active === i ? ' hot' : ''}`} />}
                {i === peak && <text x={cx} y={M.t + ph - h - 6} textAnchor="middle" className="vvalue">{d.value}</text>}
                <text x={cx} y={H - 8} textAnchor="middle" className="vtick">{d.label}</text>
                {/* hit area is the full band, far bigger than the bar */}
                <rect x={M.l + band * i} y={M.t} width={band} height={ph} fill="transparent" onPointerMove={() => setActive(i)} />
              </g>);
          })}
        </svg>
        {active != null && (
          <Tooltip x={M.l + band * active + band / 2} width={W} title={data[active].label}
            rows={[{ label: valueLabel, value: String(data[active].value), color }]} />)}
      </div>
      {unit && <p className="viz-unit">{unit}</p>}
    </ChartCard>
  );
}

/** Horizontal bars for ordered categories (e.g. funnel stages): ordinal ramp, value at the tip. */
export function RowBars({ title, subtitle, data, valueLabel, emptyText }: {
  title: string; subtitle?: string; data: BarDatum[]; valueLabel: string; emptyText: string;
}) {
  const [ref, W] = useWidth();
  const { active: rawActive, setActive, onKeyDown } = useActive(data.length);
  const active = rawActive != null && rawActive < data.length ? rawActive : null;
  const rowH = 34, M = { l: 92, r: 40, t: 4, b: 4 };
  const H = M.t + M.b + rowH * data.length;
  const max = Math.max(0, ...data.map((d) => d.value));
  const pw = W - M.l - M.r;
  return (
    <ChartCard title={title} subtitle={subtitle} empty={max === 0 ? emptyText : null}
      table={{ head: ['Stage', valueLabel], rows: data.map((d) => [d.label, d.value]) }}>
      <div ref={ref} className="vplot" tabIndex={0} role="group" onKeyDown={onKeyDown} onBlur={() => setActive(null)}
        aria-label={`${title}. Use arrow keys to read each bar, or switch to the table view.`} onPointerLeave={() => setActive(null)}>
        <svg width={W} height={H} aria-hidden>
          {data.map((d, i) => {
            const yy = M.t + rowH * i, w = max ? (d.value / max) * pw : 0, th = 20;
            return (
              <g key={d.label}>
                <text x={M.l - 10} y={yy + rowH / 2 + 4} textAnchor="end" className="vlabel">{d.label}</text>
                {d.value > 0 && <path d={barPath(M.l, yy + (rowH - th) / 2, Math.max(w, 6), th)} fill={d.color} className={`vbar${active === i ? ' hot' : ''}`} />}
                <text x={M.l + Math.max(w, 6) + 8} y={yy + rowH / 2 + 4} className="vvalue">{d.value}</text>
                <rect x={0} y={yy} width={W} height={rowH} fill="transparent" onPointerMove={() => setActive(i)} />
              </g>);
          })}
        </svg>
        {active != null && <Tooltip x={M.l + (max ? (data[active].value / max) * pw : 0)} width={W} title={data[active].label}
          rows={[{ label: valueLabel, value: String(data[active].value), color: data[active].color }]} />}
      </div>
    </ChartCard>
  );
}
