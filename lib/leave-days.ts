/** Count Monday–Friday days between two ISO dates, inclusive, skipping any date in `holidays`. Returns 0 if end < start. */
export function businessDays(startISO: string, endISO: string, holidays?: ReadonlySet<string>): number {
  const start = new Date(startISO + 'T00:00:00Z');
  const end = new Date(endISO + 'T00:00:00Z');
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return 0;
  let n = 0;
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6 && !holidays?.has(d.toISOString().slice(0, 10))) n++;
  }
  return n;
}

/** ISO date (UTC) of the next Monday–Friday strictly after `from`. */
export function nextWorkingDay(from: Date): string {
  const d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  do d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}
