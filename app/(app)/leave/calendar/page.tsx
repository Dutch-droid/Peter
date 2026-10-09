import Link from 'next/link';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { entriesOn, monthGrid, shiftMonth, type CalEntry } from '@/lib/calendar';

const MAX_CHIPS = 3;

export default async function LeaveCalendar({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const today = new Date().toISOString().slice(0, 10);
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m ?? '') ? sp.m! : today.slice(0, 7);
  const weeks = monthGrid(month);
  const from = weeks[0][0].date, to = weeks[weeks.length - 1][6].date;

  const me = db().prepare('SELECT department FROM employees WHERE id=?').get(u.employeeId) as { department: string };
  const rows = db().prepare(
    `SELECT r.employee_id, e.manager_id, e.department, e.first_name || ' ' || e.last_name AS name,
            t.name AS type, r.status, r.start_date, r.end_date
     FROM leave_requests r JOIN employees e ON e.id=r.employee_id JOIN leave_types t ON t.id=r.leave_type_id
     WHERE r.status IN ('approved','pending') AND r.start_date <= ? AND r.end_date >= ?
     ORDER BY e.first_name`,
  ).all(to, from) as (CalEntry & { employee_id: number; manager_id: number | null; department: string })[];

  // Who sees what: admins see all; everyone else sees their own department.
  // Pending requests are only visible to the requester, their manager and admins.
  const visible = rows.filter((r) => {
    const inScope = u.role === 'admin' || r.employee_id === u.employeeId || r.department === me.department;
    const pendingOk = r.status === 'approved' || u.role === 'admin' || r.employee_id === u.employeeId || r.manager_id === u.employeeId;
    return inScope && pendingOk;
  });

  const title = new Date(month + '-01T00:00:00Z').toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0 }}>Leave calendar · {title}</h1><span className="sp" />
        <Link className="btn" href={`/leave/calendar?m=${shiftMonth(month, -1)}`} aria-label="Previous month">←</Link>
        <Link className="btn" href="/leave/calendar">Today</Link>
        <Link className="btn" href={`/leave/calendar?m=${shiftMonth(month, 1)}`} aria-label="Next month">→</Link>
        <Link className="btn" href="/leave">Back to leave</Link>
      </div>
      <p style={{ color: 'var(--mute)' }}>
        {u.role === 'admin' ? 'Everyone' : `${me.department || 'Your department'}`} · <span className="chip approved">approved</span>{' '}
        <span className="chip pending">pending</span>
      </p>
      <div className="card" style={{ padding: 8 }}>
        <div className="cal" role="grid" aria-label={`Leave in ${title}`}>
          {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="calhead" role="columnheader">{d}</div>)}
          {weeks.flat().map((c) => {
            const list = entriesOn(c.date, visible);
            return (
              <div key={c.date} role="gridcell" className={`calday${c.inMonth ? '' : ' out'}${c.weekend ? ' we' : ''}${c.date === today ? ' today' : ''}`}>
                <div className="num">{Number(c.date.slice(8))}</div>
                {list.slice(0, MAX_CHIPS).map((e, i) => (
                  <div key={i} className={`chip ${e.status}`} title={`${e.name} · ${e.type} (${e.status})`}>{e.name.split(' ')[0]} · {e.type}</div>))}
                {list.length > MAX_CHIPS && (
                  <div className="more" title={list.slice(MAX_CHIPS).map((e) => `${e.name} · ${e.type}`).join('\n')}>+{list.length - MAX_CHIPS} more</div>)}
              </div>);
          })}
        </div>
      </div>
    </>
  );
}
