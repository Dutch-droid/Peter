import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { kes } from '@/lib/format';
import type { PayslipResult } from '@/lib/payroll';

export default async function Payslip({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const { id } = await params;
  const row = db().prepare(
    `SELECT p.*, r.period, r.status, e.first_name || ' ' || e.last_name name, e.job_title
     FROM payslips p JOIN payroll_runs r ON r.id=p.run_id JOIN employees e ON e.id=p.employee_id WHERE p.id=?`,
  ).get(Number(id)) as { detail: string; period: string; status: string; name: string; job_title: string;
    employee_id: number } | undefined;
  // Employees see only their own published payslips; admins see all.
  if (!row || (u.role !== 'admin' && (row.employee_id !== u.employeeId || row.status !== 'finalized'))) notFound();
  const p: PayslipResult = JSON.parse(row.detail);
  const line = (n: string, a: number, neg = false) => (
    <tr key={n}><td>{n}</td><td className="n">{neg ? '− ' : ''}{kes(a)}</td></tr>);
  return (
    <>
      <h1>Payslip · {row.period}{row.status === 'draft' && ' (draft)'}</h1>
      <div className="card"><p><b>{row.name}</b> · {row.job_title}</p>
        <table><tbody>
          {line('Basic salary', p.base)}
          {p.allowances.map((a) => line(a.name, a.amount))}
          <tr><th>Gross pay</th><th className="n">{kes(p.gross)}</th></tr>
          {p.deductions.map((d) => line(d.name, d.amount, true))}
          {line('PAYE (after relief)', p.tax, true)}
          <tr><th>Net pay</th><th className="n">{kes(p.net)}</th></tr></tbody></table>
        <small>Taxable income this month: {kes(p.taxableMonthly)}</small></div>
    </>
  );
}
