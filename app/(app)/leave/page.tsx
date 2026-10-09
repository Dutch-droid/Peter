import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { holidaySet, leaveUsed } from '@/lib/leave';
import { nextWorkingDay } from '@/lib/leave-days';
import { LeaveClient, type MyReq, type QueueReq } from './leave-client';

export default async function Leave() {
  const u = await requireUser();
  const d = db();
  const types = d.prepare('SELECT * FROM leave_types ORDER BY id').all() as { id: number; name: string; days_per_year: number }[];
  const year = new Date().getFullYear();
  const balances = types.map((t) => ({ id: t.id, name: t.name, total: t.days_per_year, left: t.days_per_year - leaveUsed(u.employeeId, t.id, year) }));
  const mine = d.prepare(
    `SELECT r.id, t.name AS type, r.start_date, r.end_date, r.days, r.status, r.reason
     FROM leave_requests r JOIN leave_types t ON t.id=r.leave_type_id WHERE r.employee_id=? ORDER BY r.start_date DESC`,
  ).all(u.employeeId) as MyReq[];
  const queue = u.role === 'employee' ? [] : d.prepare(
    `SELECT r.id, e.first_name || ' ' || e.last_name AS name, t.name AS type, r.start_date, r.end_date, r.days, r.reason
     FROM leave_requests r JOIN leave_types t ON t.id=r.leave_type_id JOIN employees e ON e.id=r.employee_id
     WHERE r.status='pending' AND r.employee_id<>? AND (?='admin' OR e.manager_id=?) ORDER BY r.start_date`,
  ).all(u.employeeId, u.role, u.employeeId) as QueueReq[];
  // Smart defaults: the type you most likely want (Annual, if you still have days), starting next working day.
  const preferred = balances.find((b) => /annual/i.test(b.name) && b.left > 0) ?? [...balances].sort((a, b) => b.left - a.left)[0];
  const defaults = { typeId: preferred?.id ?? 0, start: nextWorkingDay(new Date()) };
  return <LeaveClient balances={balances} mine={mine} queue={queue} defaults={defaults} holidays={[...holidaySet()]} />;
}
