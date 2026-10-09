import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { EmployeesClient, type EmpRow } from './employees-client';

export default async function Employees() {
  const u = await requireUser(['admin', 'manager']);
  const admin = u.role === 'admin';
  const all = db().prepare(
    `SELECT e.id, e.first_name || ' ' || e.last_name AS name, e.email, e.department, e.job_title, e.manager_id,
            COALESCE(m.first_name || ' ' || m.last_name, '') AS manager, e.hire_date, e.status, e.monthly_salary
     FROM employees e LEFT JOIN employees m ON m.id = e.manager_id ORDER BY e.last_name, e.first_name`,
  ).all() as (EmpRow & { monthly_salary: number })[];
  // Managers see themselves and their direct reports only; salary never leaves the server for them.
  const rows: EmpRow[] = (admin ? all : all.filter((e) => e.id === u.employeeId || e.manager_id === u.employeeId))
    .map((e) => (admin ? e : { ...e, monthly_salary: undefined }));
  return <EmployeesClient rows={rows} isAdmin={admin} />;
}
