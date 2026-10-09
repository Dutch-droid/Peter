export type CalEntry = { name: string; type: string; status: string; start_date: string; end_date: string };

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Monday-first weeks covering the given month (YYYY-MM). Cells outside the month are flagged. */
export function monthGrid(month: string): { date: string; inMonth: boolean; weekend: boolean }[][] {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const last = new Date(Date.UTC(y, m, 0));
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7)); // back to Monday
  const weeks: { date: string; inMonth: boolean; weekend: boolean }[][] = [];
  for (const d = new Date(start); d <= last || d.getUTCDay() !== 1; ) {
    const week = [];
    for (let i = 0; i < 7; i++) {
      week.push({ date: iso(d), inMonth: d.getUTCMonth() === m - 1, weekend: d.getUTCDay() === 0 || d.getUTCDay() === 6 });
      d.setUTCDate(d.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

export const entriesOn = (date: string, all: CalEntry[]) =>
  all.filter((e) => e.start_date <= date && e.end_date >= date);

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}
