/**
 * Round-number axis ticks from 0 to just above `max` (about `count` intervals).
 * `integer` is for counts (days, people): the step is never fractional, so no tick reads 2.5 or 7.5.
 */
export function niceTicks(max: number, count = 4, integer = false): number[] {
  if (!(max > 0)) return [0, 1];
  const raw = integer ? Math.max(1, max / count) : max / count;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const mults = integer ? [1, 2, 5, 10] : [1, 2, 2.5, 5, 10];
  const step = mults.map((m) => m * pow).find((s) => s >= raw)!;
  const top = Math.ceil(max / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) ticks.push(Math.round(v * 1e6) / 1e6);
  return ticks;
}

/** 950 -> 950, 12900 -> 12.9K, 1250000 -> 1.25M (trailing zeros trimmed). */
export function compactNumber(n: number): string {
  const a = Math.abs(n);
  const trim = (v: number, d: number) => String(Number(v.toFixed(d)));
  if (a >= 1e6) return trim(n / 1e6, 2) + 'M';
  if (a >= 1e3) return trim(n / 1e3, 1) + 'K';
  return trim(n, 0);
}

/** "2026-09" -> "Sep 26" */
export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }) + ' ' + String(y).slice(2);
}

const pt = (cx: number, cy: number, r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];

/** Donut slice path between two angles (radians, 0 = 3 o'clock, clockwise). A full circle is capped just short. */
export function arcPath(cx: number, cy: number, rOuter: number, rInner: number, a0: number, a1: number): string {
  const end = Math.min(a1, a0 + Math.PI * 2 - 0.0001);
  const large = end - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = pt(cx, cy, rOuter, a0), [x1, y1] = pt(cx, cy, rOuter, end);
  const [x2, y2] = pt(cx, cy, rInner, end), [x3, y3] = pt(cx, cy, rInner, a0);
  const f = (n: number) => n.toFixed(2);
  return `M${f(x0)},${f(y0)} A${rOuter},${rOuter} 0 ${large} 1 ${f(x1)},${f(y1)} L${f(x2)},${f(y2)} A${rInner},${rInner} 0 ${large} 0 ${f(x3)},${f(y3)} Z`;
}

/** Column with a rounded data end (top) and a square baseline. */
export function columnPath(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.max(0, Math.min(r, h, w / 2));
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}

/** Bar growing right from a square baseline, with a rounded data end. */
export function barPath(x: number, y: number, w: number, h: number, r = 4): string {
  const rr = Math.max(0, Math.min(r, w, h / 2));
  return `M${x},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h - rr} Q${x + w},${y + h} ${x + w - rr},${y + h} L${x},${y + h} Z`;
}
