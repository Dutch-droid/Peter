import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { kes } from '@/lib/format';

export default async function Dashboard() {
  const u = await requireUser();
  const d = db();
  const one = <T,>(sql: string, ...p: unknown[]) => d.prepare(sql).get(...p) as T;
  const year = String(new Date().getFullYear());
  const mine = one<{ d: number }>(
    `SELECT COALESCE(SUM(days),0) d FROM leave_requests WHERE employee_id=? AND status='approved' AND substr(start_date,1,4)=?`,
    u.employeeId, year).d;
  const slip = d.prepare(
    `SELECT p.net, r.period FROM payslips p JOIN payroll_runs r ON r.id=p.run_id
     WHERE p.employee_id=? AND r.status='finalized' ORDER BY r.period DESC LIMIT 1`,
  ).get(u.employeeId) as { net: number; period: string } | undefined;

  return (
    <>
      <h1>Welcome, {u.name.split(' ')[0]}</h1>
      <div className="stats">
        <div className="card stat"><b>{mine}</b><span>Leave days taken this year</span></div>
        <div className="card stat"><b>{slip ? kes(slip.net) : '—'}</b><span>{slip ? `Net pay, ${slip.period}` : 'No payslip yet'}</span></div>
        {u.role !== 'employee' && (
          <div className="card stat"><b>{one<{ c: number }>(`SELECT COUNT(*) c FROM leave_requests r JOIN employees e ON e.id=r.employee_id
            WHERE r.status='pending' AND r.employee_id<>? AND (?='admin' OR e.manager_id=?)`, u.employeeId, u.role, u.employeeId).c}</b>
            <span>Leave requests awaiting you</span></div>
        )}
        {u.role === 'admin' && (
          <div className="card stat"><b>{one<{ c: number }>("SELECT COUNT(*) c FROM employees WHERE status='active'").c}</b><span>Active employees</span></div>
        )}
      </div>
    </>
  );
}
