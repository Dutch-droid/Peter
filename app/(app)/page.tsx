import Link from 'next/link';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { leaveUsed } from '@/lib/leave';
import { CountUp } from '@/components/count-up';
import { Progress } from '@/components/progress';

const count = (sql: string, ...p: unknown[]) => (db().prepare(sql).get(...p) as { c: number }).c;

function tenure(hire: string): string {
  const months = Math.max(0, Math.floor((Date.now() - new Date(hire + 'T00:00:00Z').getTime()) / (30.44 * 864e5)));
  const y = Math.floor(months / 12), m = months % 12;
  return [y && `${y} year${y > 1 ? 's' : ''}`, m && `${m} month${m > 1 ? 's' : ''}`].filter(Boolean).join(' ') || 'just getting started';
}

export default async function Dashboard() {
  const u = await requireUser();
  const d = db();
  const now = new Date();
  const year = now.getFullYear();

  const me = d.prepare('SELECT first_name, hire_date FROM employees WHERE id=?').get(u.employeeId) as { first_name: string; hire_date: string };
  const types = d.prepare('SELECT id, name, days_per_year FROM leave_types ORDER BY id').all() as { id: number; name: string; days_per_year: number }[];
  const balances = types.map((t) => {
    const used = leaveUsed(u.employeeId, t.id, year);
    return { ...t, used, left: Math.max(0, t.days_per_year - used) };
  });
  const earned = (d.prepare(
    `SELECT COALESCE(SUM(p.net),0) s FROM payslips p JOIN payroll_runs r ON r.id=p.run_id
     WHERE p.employee_id=? AND r.status='finalized' AND substr(r.period,1,4)=?`,
  ).get(u.employeeId, String(year)) as { s: number }).s;
  const annual = balances.find((b) => /annual/i.test(b.name)) ?? balances[0];
  const nudge = annual && annual.left > annual.days_per_year / 2 && now.getMonth() >= 8; // Sep onwards

  const pending = u.role === 'employee' ? 0 : count(
    `SELECT COUNT(*) c FROM leave_requests r JOIN employees e ON e.id=r.employee_id
     WHERE r.status='pending' AND r.employee_id<>? AND (?='admin' OR e.manager_id=?)`, u.employeeId, u.role, u.employeeId);

  // Admin setup checklist: a visible path to "fully set up".
  const steps = u.role !== 'admin' ? [] : [
    { done: count("SELECT COUNT(*) c FROM employees WHERE status='active'") > 1, label: 'Add your team', href: '/employees' },
    { done: count("SELECT COUNT(*) c FROM settings WHERE key='rates_confirmed'") > 0, label: 'Review and confirm tax bands & relief', href: '/settings' },
    { done: count('SELECT COUNT(*) c FROM pay_components') > 0, label: 'Set up allowances & deductions', href: '/settings' },
    { done: count('SELECT COUNT(*) c FROM payroll_runs') > 0, label: 'Calculate your first payroll', href: '/payroll' },
    { done: count("SELECT COUNT(*) c FROM payroll_runs WHERE status='finalized'") > 0, label: 'Finalize and publish payslips', href: '/payroll' },
  ];
  const doneN = steps.filter((s) => s.done).length;
  const nextIdx = steps.findIndex((s) => !s.done);

  return (
    <>
      <div className="card hero">
        <h1>Welcome back, {me.first_name}</h1>
        <span style={{ color: 'var(--mute)' }}>{u.role === 'admin' ? 'HR admin' : u.role} · {tenure(me.hire_date)} with the team</span>
      </div>

      {u.role === 'admin' && doneN < steps.length && (
        <div className="card">
          <h2>Finish setting up payroll · {doneN} of {steps.length} done</h2>
          <Progress value={doneN} max={steps.length} label="Setup progress" />
          <div className="meta"><span>{steps.length - doneN === 1 ? 'One step to go' : `${steps.length - doneN} steps to go`}</span><span>{Math.round((doneN / steps.length) * 100)}%</span></div>
          <ul className="checklist">{steps.map((s, i) => (
            <li key={s.label} className={s.done ? 'done' : i === nextIdx ? 'next' : ''}>
              <span className="dot">{s.done ? '✓' : ''}</span>
              {s.done ? <span>{s.label}</span> : <Link href={s.href}>{s.label}{i === nextIdx ? ' →' : ''}</Link>}
            </li>))}</ul>
        </div>
      )}

      <div className="stats">
        <div className="card stat"><b><CountUp value={annual?.left ?? 0} /></b><span>{annual?.name ?? 'Leave'} days you have left</span></div>
        <div className="card stat"><b><CountUp value={earned} kind="kes" /></b><span>Net pay you&apos;ve earned in {year}</span></div>
        {u.role !== 'employee' && <div className="card stat"><b><CountUp value={pending} /></b><span>Leave requests awaiting you</span></div>}
        {u.role === 'admin' && <div className="card stat"><b><CountUp value={count("SELECT COUNT(*) c FROM employees WHERE status='active'")} /></b><span>Active employees</span></div>}
      </div>

      {nudge && annual && (
        <div className="card nudge">
          <b>You still have {annual.left} {annual.name.toLowerCase()} days this year.</b>{' '}
          Rest is part of the job, so <Link href="/leave">plan some time off</Link> before the year ends.
        </div>
      )}

      <div className="card">
        <h2>Your leave this year</h2>
        <div style={{ display: 'grid', gap: 14 }}>
          {balances.map((b) => (
            <div key={b.id}>
              <div className="meta" style={{ margin: '0 0 4px', color: 'var(--ink)' }}><span>{b.name}</span><span>{b.left} of {b.days_per_year} days left</span></div>
              <Progress value={b.used} max={b.days_per_year} label={`${b.name} used`} />
            </div>))}
        </div>
      </div>
    </>
  );
}
