import { db } from './db';

export { businessDays } from './leave-days';

/** All configured public holidays as ISO dates. */
export function holidaySet(): Set<string> {
  return new Set((db().prepare('SELECT date FROM holidays').all() as { date: string }[]).map((r) => r.date));
}

/** Approved + pending days count against the balance so people can't over-request. */
export function leaveUsed(employeeId: number, typeId: number, year: number): number {
  const r = db().prepare(
    `SELECT COALESCE(SUM(days),0) d FROM leave_requests
     WHERE employee_id=? AND leave_type_id=? AND status IN ('approved','pending')
       AND substr(start_date,1,4)=?`,
  ).get(employeeId, typeId, String(year)) as { d: number };
  return r.d;
}
