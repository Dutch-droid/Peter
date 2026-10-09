import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { csvResponse, toCsv } from '@/lib/csv';

export async function GET() {
  const u = await currentUser();
  if (!u || u.role !== 'admin') return new Response('Forbidden', { status: u ? 403 : 401 });
  const rows = db().prepare(
    `SELECT e.first_name, e.last_name, e.email, e.department, e.job_title,
            COALESCE(m.first_name || ' ' || m.last_name, '') AS manager, e.hire_date, e.monthly_salary, e.status
     FROM employees e LEFT JOIN employees m ON m.id=e.manager_id ORDER BY e.last_name, e.first_name`,
  ).all() as Record<string, unknown>[];
  return csvResponse('employees.csv', toCsv(
    ['First name', 'Last name', 'Email', 'Department', 'Job title', 'Manager', 'Hire date', 'Monthly salary (KES)', 'Status'],
    rows.map((r) => Object.values(r)),
  ));
}
