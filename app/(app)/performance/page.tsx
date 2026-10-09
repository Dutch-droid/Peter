import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { PerformanceClient, type Cycle, type Goal, type MyReview, type TeamRow } from './performance-client';

export default async function Performance({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const u = await requireUser();
  const sp = await searchParams;
  const d = db();
  const cycles = d.prepare('SELECT id, name, start_date, end_date, status FROM review_cycles ORDER BY start_date DESC, id DESC').all() as Cycle[];
  const cycle = cycles.find((c) => String(c.id) === sp.c) ?? cycles.find((c) => c.status === 'open') ?? cycles[0] ?? null;

  let goals: Goal[] = [], mine: MyReview | null = null, team: TeamRow[] = [];
  if (cycle) {
    goals = d.prepare('SELECT id, title, description, progress FROM goals WHERE employee_id=? AND cycle_id=? ORDER BY id').all(u.employeeId, cycle.id) as Goal[];
    const r = d.prepare('SELECT id, status, self_rating, self_comment, manager_rating, manager_comment FROM reviews WHERE employee_id=? AND cycle_id=?')
      .get(u.employeeId, cycle.id) as (MyReview & { manager_rating: number | null; manager_comment: string }) | undefined;
    // An employee only sees their manager's rating once the review is completed.
    if (r) mine = r.status === 'completed' ? r : { ...r, manager_rating: null, manager_comment: '' };

    if (u.role !== 'employee') {
      team = d.prepare(
        `SELECT rv.id AS review_id, e.id AS employee_id, e.first_name || ' ' || e.last_name AS name, e.job_title,
                rv.status, rv.self_rating, rv.self_comment, rv.manager_rating, rv.manager_comment,
                (SELECT COUNT(*) FROM goals g WHERE g.employee_id=e.id AND g.cycle_id=rv.cycle_id) AS goal_count,
                COALESCE((SELECT ROUND(AVG(g.progress)) FROM goals g WHERE g.employee_id=e.id AND g.cycle_id=rv.cycle_id), 0) AS avg_progress
         FROM reviews rv JOIN employees e ON e.id=rv.employee_id
         WHERE rv.cycle_id=? AND e.id<>? AND (?='admin' OR e.manager_id=?) ORDER BY e.last_name`,
      ).all(cycle.id, u.employeeId, u.role, u.employeeId) as TeamRow[];
    }
  }
  return <PerformanceClient role={u.role} cycles={cycles} cycle={cycle} goals={goals} mine={mine} team={team} />;
}
