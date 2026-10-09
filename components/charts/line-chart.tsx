'use client';
import { compactNumber, niceTicks } from '@/lib/chart-math';
import { ChartCard, Tooltip, useActive, useWidth } from './chart-kit';

export type Series = { key: string; label: string; color: string };
export type LinePoint = { x: string; values: Record<string, number> };

const H = 240, M = { l: 46, r: 64, t: 14, b: 30 };

/** 2px lines, end dots with a surface ring, hairline grid, crosshair + one tooltip for every series. */
export function LineChart({ title, subtitle, series, points, format, unit, area = false, emptyText }: {
  title: string; subtitle?: string; series: Series[]; points: LinePoint[]; format: (n: number) => string;
  unit?: string; area?: boolean; emptyText: string;
}) {
  const [ref, W] = useWidth();
  const { active: rawActive, setActive, onKeyDown } = useActive(points.length);
  // Data can refresh under a hovered chart; never index past the end.
  const active = rawActive != null && rawActive < points.length ? rawActive : null;
  const pw = W - M.l - M.r, ph = H - M.t - M.b;
  const max = Math.max(0, ...points.flatMap((p) => series.map((s) => p.values[s.key] ?? 0)));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const x = (i: number) => M.l + (points.length === 1 ? pw / 2 : (i * pw) / (points.length - 1));
  const y = (v: number) => M.t + ph - (v / top) * ph;
  const step = points.length > 8 ? Math.ceil(points.length / 7) : 1;
  const path = (k: string) => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.values[k] ?? 0).toFixed(1)}`).join(' ');

  const nearest = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    const px = clientX - r.left;
    let best = 0, d = Infinity;
    points.forEach((_, i) => { const dd = Math.abs(x(i) - px); if (dd < d) { d = dd; best = i; } });
    return best;
  };
  const last = points.length - 1;

  // JSX children are built eagerly, so with no points the plot markup below (points[last]) would throw
  // before ChartCard ever gets to show its empty state.
  if (points.length === 0) {
    return <ChartCard title={title} subtitle={subtitle} empty={emptyText} table={{ head: [], rows: [] }}>{null}</ChartCard>;
  }

  return (
    <ChartCard title={title} subtitle={subtitle} legend={series.map((s) => ({ label: s.label, color: s.color, shape: 'line' }))}
      empty={null}
      table={{ head: ['Period', ...series.map((s) => s.label)], rows: points.map((p) => [p.x, ...series.map((s) => format(p.values[s.key] ?? 0))]) }}>
      <div ref={ref} className="vplot" tabIndex={0} role="group" onKeyDown={onKeyDown} onBlur={() => setActive(null)}
        aria-label={`${title}. Use left and right arrow keys to read each point, or switch to the table view.`}
        onPointerMove={(e) => setActive(nearest(e.clientX))} onPointerLeave={() => setActive(null)}>
        <svg width={W} height={H} aria-hidden>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'vaxis' : 'vgrid'} />
              <text x={M.l - 8} y={y(t) + 4} textAnchor="end" className="vtick">{compactNumber(t)}</text>
            </g>))}
          {points.map((p, i) => i % step === 0 && (
            <text key={p.x} x={x(i)} y={H - 8} textAnchor="middle" className="vtick">{p.x}</text>))}
          {area && series.length === 1 && (
            <path d={`${path(series[0].key)} L${x(last)},${y(0)} L${x(0)},${y(0)} Z`} fill={series[0].color} opacity={0.1} />)}
          {active != null && <line x1={x(active)} x2={x(active)} y1={M.t} y2={M.t + ph} className="vcross" />}
          {series.map((s) => (
            <g key={s.key}>
              <path d={path(s.key)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              {/* End dot always; the hovered point gets one too. 2px ring in the surface colour keeps dots legible. */}
              {[last, ...(active != null && active !== last ? [active] : [])].map((i) => (
                <circle key={i} cx={x(i)} cy={y(points[i].values[s.key] ?? 0)} r={4} fill={s.color} className="vdot" />))}
              {series.length > 1 && <text x={x(last) + 10} y={y(points[last].values[s.key] ?? 0) + 4} className="vdirect">{s.label}</text>}
            </g>))}
        </svg>
        {active != null && (
          <Tooltip x={x(active)} width={W} title={points[active].x}
            rows={series.map((s) => ({ label: s.label, value: format(points[active].values[s.key] ?? 0), color: s.color }))} />)}
      </div>
      {unit && <p className="viz-unit">{unit}</p>}
    </ChartCard>
  );
}
