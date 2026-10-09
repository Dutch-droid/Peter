import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { csvResponse, toCsv } from '@/lib/csv';

export async function GET() {
  const u = await currentUser();
  if (!u) return new Response('Unauthorized', { status: 401 });
  // Admin: everyone. Manager: self + direct reports. Employee: self only.
  const rows = db().prepare(
    `SELECT e.first_name || ' ' || e.last_name AS name, t.name AS type, r.start_date, r.end_date, r.days, r.status, r.reason
     FROM leave_requests r JOIN employees e ON e.id=r.employee_id JOIN leave_types t ON t.id=r.leave_type_id
     WHERE (?='admin') OR r.employee_id=? OR (?='manager' AND e.manager_id=?)
     ORDER BY r.start_date DESC`,
  ).all(u.role, u.employeeId, u.role, u.employeeId) as Record<string, unknown>[];
  return csvResponse('leave-requests.csv', toCsv(
    ['Employee', 'Type', 'Start', 'End', 'Working days', 'Status', 'Reason'], rows.map((r) => Object.values(r)),
  ));
}
