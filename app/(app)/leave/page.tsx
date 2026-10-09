import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { leaveUsed } from '@/lib/leave';
import { cancelLeave, decideLeave, requestLeave } from '../../actions';

type Row = { id: number; name: string; type: string; start_date: string; end_date: string; days: number; status: string; reason: string };

export default async function Leave() {
  const u = await requireUser();
  const d = db();
  const types = d.prepare('SELECT * FROM leave_types ORDER BY id').all() as { id: number; name: string; days_per_year: number }[];
  const year = new Date().getFullYear();
  const mine = d.prepare(
    `SELECT r.*, t.name type FROM leave_requests r JOIN leave_types t ON t.id=r.leave_type_id
     WHERE r.employee_id=? ORDER BY r.start_date DESC`).all(u.employeeId) as (Row & { name: string })[];
  const queue = u.role === 'employee' ? [] : d.prepare(
    `SELECT r.*, t.name type, e.first_name || ' ' || e.last_name name FROM leave_requests r
     JOIN leave_types t ON t.id=r.leave_type_id JOIN employees e ON e.id=r.employee_id
     WHERE r.status='pending' AND r.employee_id<>? AND (?='admin' OR e.manager_id=?) ORDER BY r.start_date`,
  ).all(u.employeeId, u.role, u.employeeId) as Row[];

  return (
    <>
      <h1>Leave</h1>
      <div className="stats">{types.map((t) => (
        <div key={t.id} className="card stat"><b>{t.days_per_year - leaveUsed(u.employeeId, t.id, year)}</b>
          <span>{t.name} days left of {t.days_per_year}</span></div>))}</div>
      <div className="card"><h2>Request leave</h2>
        <form action={requestLeave} className="row">
          <label>Type<select name="leave_type_id">{types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>
          <label>From<input type="date" name="start_date" required /></label>
          <label>To<input type="date" name="end_date" required /></label>
          <label>Reason<input name="reason" /></label>
          <button>Submit</button>
        </form>
        <small>Weekends are not counted. Public holidays are not excluded automatically.</small>
      </div>
      {queue.length > 0 && (<div className="card"><h2>Awaiting your decision</h2><table>
        <thead><tr><th>Employee</th><th>Type</th><th>Dates</th><th className="n">Days</th><th /></tr></thead>
        <tbody>{queue.map((r) => (<tr key={r.id}><td>{r.name}</td><td>{r.type}</td><td>{r.start_date} → {r.end_date}</td>
          <td className="n">{r.days}</td><td style={{ display: 'flex', gap: 8 }}>
            <form action={decideLeave}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="approve" /><button>Approve</button></form>
            <form action={decideLeave}><input type="hidden" name="id" value={r.id} /><input type="hidden" name="decision" value="reject" /><button className="bad">Reject</button></form></td></tr>))}</tbody></table></div>)}
      <div className="card"><h2>My requests</h2><table>
        <thead><tr><th>Type</th><th>Dates</th><th className="n">Days</th><th>Status</th><th /></tr></thead>
        <tbody>{mine.map((r) => (<tr key={r.id}><td>{r.type}</td><td>{r.start_date} → {r.end_date}</td><td className="n">{r.days}</td>
          <td><span className={`tag ${r.status}`}>{r.status}</span></td>
          <td>{r.status === 'pending' && <form action={cancelLeave}><input type="hidden" name="id" value={r.id} /><button className="sec">Cancel</button></form>}</td></tr>))}</tbody></table></div>
    </>
  );
}
