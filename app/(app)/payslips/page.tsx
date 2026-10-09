import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { PayslipsClient, type SlipListRow } from './payslips-client';

export default async function MyPayslips() {
  const u = await requireUser();
  const rows = db().prepare(
    `SELECT p.id, r.period, p.gross, p.net FROM payslips p JOIN payroll_runs r ON r.id=p.run_id
     WHERE p.employee_id=? AND r.status='finalized' ORDER BY r.period DESC`,
  ).all(u.employeeId) as SlipListRow[];
  return <PayslipsClient rows={rows} />;
}
