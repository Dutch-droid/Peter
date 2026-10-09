import type { DB } from './db';

export type PayPoint = { period: string; gross: number; net: number };

/** Totals per finalized payroll run in `year`, oldest first (drafts are excluded so charts never show unpublished numbers). */
export function payrollTrend(d: DB, year: number): PayPoint[] {
  return d.prepare(
    `SELECT r.period, SUM(p.gross) AS gross, SUM(p.net) AS net
     FROM payroll_runs r JOIN payslips p ON p.run_id = r.id
     WHERE r.status='finalized' AND substr(r.period,1,4)=? GROUP BY r.id ORDER BY r.period`,
  ).all(String(year)) as PayPoint[];
}

export function myPayTrend(d: DB, employeeId: number, year: number): PayPoint[] {
  return d.prepare(
    `SELECT r.period, p.gross, p.net FROM payslips p JOIN payroll_runs r ON r.id=p.run_id
     WHERE p.employee_id=? AND r.status='finalized' AND substr(r.period,1,4)=? ORDER BY r.period`,
  ).all(employeeId, String(year)) as PayPoint[];
}

/** Years worth offering in the filter: every year with payroll or leave, plus the current one. Newest first. */
export function chartYears(d: DB, current: number): number[] {
  const rows = d.prepare(
    `SELECT substr(period,1,4) AS y FROM payroll_runs UNION SELECT substr(start_date,1,4) FROM leave_requests`,
  ).all() as { y: string }[];
  return [...new Set([current, ...rows.map((r) => Number(r.y)).filter((y) => y > 1999 && y < 2200)])].sort((a, b) => b - a);
}

export function headcountByDepartment(d: DB): { name: string; count: number }[] {
  return d.prepare(
    `SELECT COALESCE(NULLIF(TRIM(department), ''), 'Unassigned') AS name, COUNT(*) AS count
     FROM employees WHERE status='active' GROUP BY name ORDER BY count DESC, name`,
  ).all() as { name: string; count: number }[];
}

/** Approved leave working days per calendar month (by start month). 12 numbers. Pass employeeId to scope to one person. */
export function leaveByMonth(d: DB, year: number, employeeId?: number): number[] {
  const rows = d.prepare(
    `SELECT CAST(substr(start_date,6,2) AS INTEGER) AS m, SUM(days) AS days FROM leave_requests
     WHERE status='approved' AND substr(start_date,1,4)=? AND (? IS NULL OR employee_id=?) GROUP BY m`,
  ).all(String(year), employeeId ?? null, employeeId ?? null) as { m: number; days: number }[];
  const out = Array(12).fill(0);
  rows.forEach((r) => { if (r.m >= 1 && r.m <= 12) out[r.m - 1] = r.days; });
  return out;
}

export const FUNNEL_STAGES = ['applied', 'screening', 'interview', 'offer', 'hired'] as const;

/** Candidates currently at each stage, across open roles. Rejected candidates are left out. */
export function hiringFunnel(d: DB): { stage: string; count: number }[] {
  const rows = d.prepare(
    `SELECT c.stage, COUNT(*) AS count FROM candidates c JOIN jobs j ON j.id=c.job_id
     WHERE j.status='open' GROUP BY c.stage`,
  ).all() as { stage: string; count: number }[];
  return FUNNEL_STAGES.map((stage) => ({ stage, count: rows.find((r) => r.stage === stage)?.count ?? 0 }));
}
