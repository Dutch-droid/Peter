'use client';
import { compactNumber, periodLabel } from '@/lib/chart-math';
import { DonutChart, type Slice } from './donut-chart';
import { LineChart } from './line-chart';
import { ColumnChart, RowBars } from './bar-chart';

const kes = (n: number) => 'KES ' + Math.round(n).toLocaleString('en-US');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DEPT_COLORS = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];
const STAGE_LABEL: Record<string, string> = { applied: 'Applied', screening: 'Screening', interview: 'Interview', offer: 'Offer', hired: 'Hired' };

type Pay = { period: string; gross: number; net: number };

/** Colour follows the department (alphabetical), not its size. More than 5 fold the smallest into "Other". */
function deptSlices(rows: { name: string; count: number }[]): Slice[] {
  const keep = rows.length > DEPT_COLORS.length ? rows.slice(0, DEPT_COLORS.length - 1) : rows;
  const rest = rows.slice(keep.length);
  const sorted = [...keep].sort((a, b) => a.name.localeCompare(b.name));
  const out: Slice[] = sorted.map((d, i) => ({ label: d.name, value: d.count, color: DEPT_COLORS[i] }));
  if (rest.length) out.push({ label: 'Other', value: rest.reduce((s, r) => s + r.count, 0), color: 'var(--other)' });
  return out;
}

export function AdminInsights({ pay, depts, leave, funnel, year }: {
  pay: Pay[]; depts: { name: string; count: number }[]; leave: number[]; funnel: { stage: string; count: number }[]; year: number;
}) {
  return (
    <div className="viz-grid">
      <div className="viz-wide">
        <LineChart title="Payroll cost" subtitle="Gross vs net pay per finalized run, last 12 runs" unit="KES" emptyText="Finalize a payroll run to see the trend."
          series={[{ key: 'gross', label: 'Gross', color: 'var(--s1)' }, { key: 'net', label: 'Net', color: 'var(--s2)' }]}
          points={pay.map((p) => ({ x: periodLabel(p.period), values: { gross: p.gross, net: p.net } }))} format={kes} />
      </div>
      <DonutChart title="Headcount by department" subtitle="Active employees" totalLabel="employees" emptyText="No active employees yet."
        slices={deptSlices(depts)} />
      <ColumnChart title="Leave taken" subtitle={`Approved working days per month, ${year}`} data={leave.map((v, i) => ({ label: MONTHS[i], value: v }))}
        color="var(--s1)" valueLabel="Working days" emptyText={`No approved leave in ${year} yet.`} />
      <RowBars title="Hiring pipeline" subtitle="Candidates at each stage across open roles" valueLabel="Candidates" emptyText="No candidates in open roles."
        data={funnel.map((f, i) => ({ label: STAGE_LABEL[f.stage] ?? f.stage, value: f.count, color: `var(--o${i + 1})` }))} />
    </div>
  );
}

export function MyInsights({ pay, leave, year }: { pay: Pay[]; leave: number[]; year: number }) {
  return (
    <div className="viz-grid">
      <LineChart title="My net pay" subtitle="Take-home per published payslip" unit="KES" area emptyText="Your payslips will chart here once payroll is published."
        series={[{ key: 'net', label: 'Net pay', color: 'var(--s1)' }]}
        points={pay.map((p) => ({ x: periodLabel(p.period), values: { net: p.net } }))} format={kes} />
      <ColumnChart title="My leave" subtitle={`Approved working days per month, ${year}`} data={leave.map((v, i) => ({ label: MONTHS[i], value: v }))}
        color="var(--s1)" valueLabel="Working days" emptyText={`You haven't taken leave in ${year} yet.`} />
    </div>
  );
}

// re-export for tests / reuse
export { compactNumber };
