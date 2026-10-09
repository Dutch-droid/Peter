import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { RunClient, type SlipRow } from './run-client';

export default async function Run({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(['admin']);
  const { id } = await params;
  const run = db().prepare('SELECT id, period, status FROM payroll_runs WHERE id=?').get(Number(id)) as
    { id: number; period: string; status: string } | undefined;
  if (!run) notFound();
  const rows = db().prepare(
    `SELECT p.id, e.first_name || ' ' || e.last_name AS name, e.department, p.gross, p.total_deductions AS ded, p.tax, p.net
     FROM payslips p JOIN employees e ON e.id=p.employee_id WHERE p.run_id=? ORDER BY e.last_name`,
  ).all(run.id) as SlipRow[];
  return <RunClient run={run} rows={rows} />;
}
