'use client';
import { arcPath } from '@/lib/chart-math';
import { ChartCard, Tooltip, useActive, useWidth } from './chart-kit';

export type Slice = { label: string; value: number; color: string };

const SIZE = 180, R = 84, r = 54;

/** Part-to-whole at a glance. Few slices only; the legend carries exact counts and shares. */
export function DonutChart({ title, subtitle, slices, totalLabel, emptyText }: {
  title: string; subtitle?: string; slices: Slice[]; totalLabel: string; emptyText: string;
}) {
  const [ref, W] = useWidth(360);
  const { active: rawActive, setActive, onKeyDown } = useActive(slices.length);
  const active = rawActive != null && rawActive < slices.length ? rawActive : null;
  const total = slices.reduce((s, x) => s + x.value, 0);
  let acc = -Math.PI / 2;
  const arcs = slices.map((s) => { const a0 = acc; acc += (s.value / total) * Math.PI * 2; return { ...s, a0, a1: acc }; });
  const pct = (v: number) => `${Math.round((v / total) * 100)}%`;
  return (
    <ChartCard title={title} subtitle={subtitle} empty={total === 0 ? emptyText : null}
      table={{ head: ['Group', 'Count', 'Share'], rows: slices.map((s) => [s.label, s.value, pct(s.value)]) }}>
      <div ref={ref} className="vplot donut" tabIndex={0} role="group" onKeyDown={onKeyDown} onBlur={() => setActive(null)}
        aria-label={`${title}. Use arrow keys to read each slice, or switch to the table view.`} onPointerLeave={() => setActive(null)}>
        <svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`} aria-hidden>
          {arcs.map((a, i) => (
            <path key={a.label} d={arcPath(SIZE / 2, SIZE / 2, active === i ? R + 3 : R, r, a.a0, a.a1)} fill={a.color}
              className="vslice" onPointerMove={() => setActive(i)} />))}
          <text x={SIZE / 2} y={SIZE / 2 + 2} textAnchor="middle" className="vhero">{total}</text>
          <text x={SIZE / 2} y={SIZE / 2 + 20} textAnchor="middle" className="vtick">{totalLabel}</text>
        </svg>
        <ul className="dlegend">{slices.map((s, i) => (
          <li key={s.label} className={active === i ? 'hot' : ''} onPointerEnter={() => setActive(i)}>
            <i style={{ background: s.color }} /><span className="nm">{s.label}</span><b>{s.value}</b><span className="pc">{pct(s.value)}</span></li>))}</ul>
        {active != null && <Tooltip x={SIZE / 2} width={W < 520 ? SIZE : SIZE} title={slices[active].label}
          rows={[{ label: `of ${total} (${pct(slices[active].value)})`, value: String(slices[active].value), color: slices[active].color }]} />}
      </div>
    </ChartCard>
  );
}
