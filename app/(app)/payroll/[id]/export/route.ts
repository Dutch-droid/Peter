import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { csvResponse, toCsv } from '@/lib/csv';
import type { PayslipResult } from '@/lib/payroll';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await currentUser();
  if (!u || u.role !== 'admin') return new Response('Forbidden', { status: u ? 403 : 401 });
  const { id } = await params;
  const run = db().prepare('SELECT period, status FROM payroll_runs WHERE id=?').get(Number(id)) as { period: string; status: string } | undefined;
  if (!run) return new Response('Not found', { status: 404 });
  const rows = db().prepare(
    `SELECT e.first_name || ' ' || e.last_name AS name, e.email, e.department, p.detail
     FROM payslips p JOIN employees e ON e.id=p.employee_id WHERE p.run_id=? ORDER BY e.last_name`,
  ).all(Number(id)) as { name: string; email: string; department: string; detail: string }[];
  const parsed = rows.map((r) => ({ r, s: JSON.parse(r.detail) as PayslipResult }));
  const allowNames = [...new Set(parsed.flatMap((p) => p.s.allowances.map((a) => a.name)))];
  const dedNames = [...new Set(parsed.flatMap((p) => p.s.deductions.map((d) => d.name)))];
  const amt = (list: { name: string; amount: number }[], n: string) => list.find((x) => x.name === n)?.amount ?? 0;
  const header = ['Employee', 'Email', 'Department', 'Base salary', ...allowNames, 'Gross pay', ...dedNames, 'Taxable income', 'PAYE', 'Net pay', 'Status'];
  const body = parsed.map(({ r, s }) => [
    r.name, r.email, r.department, s.base, ...allowNames.map((n) => amt(s.allowances, n)), s.gross,
    ...dedNames.map((n) => amt(s.deductions, n)), s.taxableMonthly, s.tax, s.net, run.status,
  ]);
  return csvResponse(`payroll-${run.period}.csv`, toCsv(header, body));
}
