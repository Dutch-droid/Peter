import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { PayrollClient, type RunRow } from './payroll-client';

export default async function Payroll() {
  await requireUser(['admin']);
  const rows = db().prepare(
    `SELECT r.id, r.period, r.status, COUNT(p.id) n, COALESCE(SUM(p.gross),0) gross, COALESCE(SUM(p.net),0) net
     FROM payroll_runs r LEFT JOIN payslips p ON p.run_id=r.id GROUP BY r.id ORDER BY r.period DESC`,
  ).all() as RunRow[];
  // Smart default: the month after the latest run, or this month if there are none.
  const latest = rows[0]?.period;
  const base = latest ? new Date(Date.UTC(Number(latest.slice(0, 4)), Number(latest.slice(5, 7)), 1)) : new Date();
  const suggested = `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}`;
  return <PayrollClient rows={rows} suggested={suggested} />;
}
