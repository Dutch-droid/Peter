'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm, type UseFormReturn } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { ConfirmButton, Modal } from '@/components/modal';
import { Field, StatusTag, asNumber } from '@/components/form';
import { Progress } from '@/components/progress';
import { useRun } from '@/components/toast';
import { cycleSchema, goalSchema, ratingSchema, type CycleInput, type GoalInput, type RatingInput } from '@/lib/schemas';
import { addGoal, closeCycle, createCycle, deleteGoal, setGoalProgress, submitManagerReview, submitSelfReview } from '../../actions';

export type Cycle = { id: number; name: string; start_date: string; end_date: string; status: string };
export type Goal = { id: number; title: string; description: string; progress: number };
export type MyReview = { id: number; status: string; self_rating: number | null; self_comment: string; manager_rating: number | null; manager_comment: string };
export type TeamRow = { review_id: number; employee_id: number; name: string; job_title: string; status: string; self_rating: number | null; self_comment: string; manager_rating: number | null; manager_comment: string; goal_count: number; avg_progress: number };

const RATING = ['', 'Needs improvement', 'Below expectations', 'Meets expectations', 'Exceeds expectations', 'Outstanding'];
const STATUS_LABEL: Record<string, string> = { pending: 'Awaiting self-assessment', self_done: 'Awaiting manager', completed: 'Completed' };

export function PerformanceClient({ role, cycles, cycle, goals, mine, team }: {
  role: string; cycles: Cycle[]; cycle: Cycle | null; goals: Goal[]; mine: MyReview | null; team: TeamRow[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const isAdmin = role === 'admin';
  const open = cycle?.status === 'open';
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
        <h1 style={{ margin: 0 }}>Performance</h1><span className="sp" />
        {cycles.length > 0 && (
          <select aria-label="Review cycle" value={cycle?.id ?? ''} onChange={(e) => router.push(`/performance?c=${e.target.value}`)}>
            {cycles.map((c) => <option key={c.id} value={c.id}>{c.name}{c.status === 'closed' ? ' (closed)' : ''}</option>)}</select>)}
        {isAdmin && open && cycle && (
          <ConfirmButton label="Close cycle" className="sec" title={`Close ${cycle.name}?`} message="Goals and reviews become read-only."
            action={() => closeCycle(cycle.id)} onDone={() => router.refresh()} />)}
        {isAdmin && <button type="button" onClick={() => setCreating(true)}>+ New review cycle</button>}
      </div>
      {!cycle ? (
        <div className="card">{isAdmin ? 'No review cycle yet. Start one to give everyone goals and an appraisal.' : 'No review cycle is running yet.'}</div>
      ) : (
        <>
          <p style={{ color: 'var(--mute)', marginTop: 0 }}>{cycle.name}: {cycle.start_date} to {cycle.end_date} · <StatusTag s={cycle.status} /></p>
          <GoalsCard cycle={cycle} goals={goals} editable={!!open} />
          {mine && <MyReviewCard review={mine} editable={!!open} />}
          {role !== 'employee' && <TeamCard rows={team} editable={!!open} />}
        </>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="New review cycle"><CycleForm onDone={() => setCreating(false)} /></Modal>
    </>
  );
}

/* ---------- Goals ---------- */
function GoalsCard({ cycle, goals, editable }: { cycle: Cycle; goals: Goal[]; editable: boolean }) {
  const [adding, setAdding] = useState(false);
  const avg = goals.length ? Math.round(goals.reduce((s, g) => s + g.progress, 0) / goals.length) : 0;
  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><h2 style={{ margin: 0 }}>My goals</h2><span className="sp" />
        {editable && <button type="button" onClick={() => setAdding(true)}>+ Add goal</button>}</div>
      {goals.length === 0 ? <p style={{ color: 'var(--mute)' }}>No goals yet. Add two or three you want to achieve this cycle.</p> : (
        <>
          <div style={{ margin: '12px 0' }}>
            <Progress value={avg} max={100} label="Overall goal progress" />
            <div className="meta"><span>{goals.filter((g) => g.progress === 100).length} of {goals.length} goals complete</span><span>{avg}% overall</span></div>
          </div>
          <div style={{ display: 'grid', gap: 14 }}>{goals.map((g) => <GoalRow key={g.id} goal={g} editable={editable} />)}</div>
        </>)}
      <Modal open={adding} onClose={() => setAdding(false)} title="Add goal"><GoalForm cycleId={cycle.id} onDone={() => setAdding(false)} /></Modal>
    </div>
  );
}

function GoalRow({ goal, editable }: { goal: Goal; editable: boolean }) {
  const { run, pending } = useRun();
  const [val, setVal] = useState(goal.progress);
  const commit = () => { if (val !== goal.progress) run(() => setGoalProgress(goal.id, val)); };
  return (
    <div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <b>{goal.title}</b><span className="sp" /><span>{val}%</span>
        {editable && <ConfirmButton label="Remove" className="sec" title={`Remove "${goal.title}"?`} message="This goal and its progress will be deleted." danger action={() => deleteGoal(goal.id)} />}
      </div>
      {goal.description && <small style={{ color: 'var(--mute)' }}>{goal.description}</small>}
      <Progress value={val} max={100} label={`${goal.title} progress`} />
      {editable && (
        <input type="range" min={0} max={100} step={5} value={val} disabled={pending} aria-label={`Update progress for ${goal.title}`}
          style={{ width: '100%', marginTop: 4 }} onChange={(e) => setVal(Number(e.target.value))}
          onPointerUp={commit} onKeyUp={commit} onBlur={commit} />)}
    </div>
  );
}

function GoalForm({ cycleId, onDone }: { cycleId: number; onDone: () => void }) {
  const { run, pending } = useRun();
  const { register, handleSubmit, formState: { errors } } = useForm<GoalInput>({ resolver: zodResolver(goalSchema), defaultValues: { cycle_id: cycleId, title: '', description: '' } });
  return (
    <form noValidate onSubmit={handleSubmit((v) => run(() => addGoal(v), onDone))}>
      <Field label="Goal" error={errors.title} hint="Specific and measurable works best, e.g. Cut payroll processing time to 1 day"><input {...register('title')} /></Field>
      <div style={{ marginTop: 12 }}><Field label="Details (optional)" error={errors.description}><textarea rows={3} {...register('description')} /></Field></div>
      <div className="actions"><button type="button" className="sec" onClick={onDone}>Cancel</button><button disabled={pending}>{pending ? 'Adding…' : 'Add goal'}</button></div>
    </form>
  );
}

/* ---------- My review ---------- */
function Stepper({ status }: { status: string }) {
  const idx = status === 'pending' ? 0 : status === 'self_done' ? 1 : 2;
  const steps = ['Self-assessment', 'Manager review', 'Completed'];
  return (
    <>
      <div className="steps">{steps.map((s, i) => <span key={s} className={i < idx || idx === 2 ? 'ok' : i === idx ? 'on' : ''}>{i < idx || idx === 2 ? '✓ ' : `${i + 1} `}{s}</span>)}</div>
      <Progress value={idx === 2 ? 3 : idx} max={3} label="Review progress" />
    </>
  );
}

// Radios are controlled through setValue: react-hook-form bypasses valueAsNumber/setValueAs for radio
// groups, which would hand the schema the string "4" instead of the number 4.
function RatingFields({ form }: { form: UseFormReturn<RatingInput> }) {
  const { register, watch, setValue, formState: { errors } } = form;
  const current = watch('rating');
  return (
    <>
      <fieldset className="rating"><legend>Rating</legend>
        {[1, 2, 3, 4, 5].map((n) => (
          <label key={n} className="ratingopt">
            <input type="radio" name="rating" value={n} checked={current === n}
              onChange={() => setValue('rating', n, { shouldValidate: true, shouldDirty: true })} />
            <span>{n}</span><small>{RATING[n]}</small></label>))}
        {errors.rating && <span className="fielderr" role="alert">{errors.rating.message}</span>}
      </fieldset>
      <div style={{ marginTop: 12 }}><Field label="Comment" error={errors.comment}><textarea rows={4} {...register('comment')} /></Field></div>
    </>
  );
}

function MyReviewCard({ review, editable }: { review: MyReview; editable: boolean }) {
  const { run, pending } = useRun();
  const form = useForm<RatingInput>({
    resolver: zodResolver(ratingSchema),
    defaultValues: { review_id: review.id, rating: review.self_rating ?? undefined, comment: review.self_comment },
  });
  const { handleSubmit } = form;
  const done = review.status === 'completed';
  return (
    <div className="card"><h2>My appraisal</h2>
      <Stepper status={review.status} />
      {done ? (
        <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
          <div><b>Your self-rating:</b> {review.self_rating} · {RATING[review.self_rating ?? 0]}<br /><small>{review.self_comment}</small></div>
          <div><b>Manager rating:</b> {review.manager_rating} · {RATING[review.manager_rating ?? 0]}<br /><small>{review.manager_comment}</small></div>
        </div>
      ) : editable ? (
        <form style={{ marginTop: 12 }} noValidate onSubmit={handleSubmit((v) => run(() => submitSelfReview(v)))}>
          <RatingFields form={form} />
          <div className="actions"><button disabled={pending}>{pending ? 'Submitting…' : review.status === 'self_done' ? 'Update self-assessment' : 'Submit self-assessment'}</button></div>
        </form>
      ) : <p style={{ color: 'var(--mute)' }}>This cycle is closed.</p>}
    </div>
  );
}

/* ---------- Team ---------- */
function TeamCard({ rows, editable }: { rows: TeamRow[]; editable: boolean }) {
  const [sel, setSel] = useState<TeamRow | null>(null);
  const columns = useMemo<ColumnDef<TeamRow>[]>(() => [
    { accessorKey: 'name', header: 'Employee', cell: ({ row: { original: r } }) => <><b>{r.name}</b><br /><small>{r.job_title}</small></> },
    { id: 'goals', header: 'Goal progress', accessorFn: (r) => r.avg_progress, cell: ({ row: { original: r } }) => r.goal_count === 0 ? <small>No goals</small> : (
      <div style={{ minWidth: 120 }}><Progress value={r.avg_progress} max={100} label={`${r.name} goals`} /><small>{r.avg_progress}% of {r.goal_count} goal{r.goal_count > 1 ? 's' : ''}</small></div>) },
    { accessorKey: 'status', header: 'Review', cell: ({ getValue }) => STATUS_LABEL[String(getValue())] },
    { id: 'act', header: '', enableSorting: false, cell: ({ row: { original: r } }) => (
      <button type="button" className={r.status === 'self_done' && editable ? '' : 'sec'} onClick={() => setSel(r)}>{r.status === 'self_done' && editable ? 'Review' : 'View'}</button>) },
  ], [editable]);
  return (
    <div className="card"><h2>Team appraisals</h2>
      <DataTable data={rows} columns={columns} filters={[{ id: 'status', label: 'Status' }]} searchPlaceholder="Search team…" empty="No one to review in this cycle." pageSize={8} />
      <Modal open={!!sel} onClose={() => setSel(null)} title={sel ? `Appraisal: ${sel.name}` : ''}>
        {sel && <ManagerReview row={sel} editable={editable} onDone={() => setSel(null)} />}
      </Modal>
    </div>
  );
}

function ManagerReview({ row, editable, onDone }: { row: TeamRow; editable: boolean; onDone: () => void }) {
  const { run, pending } = useRun();
  const form = useForm<RatingInput>({
    resolver: zodResolver(ratingSchema),
    defaultValues: { review_id: row.review_id, rating: row.manager_rating ?? undefined, comment: row.manager_comment },
  });
  const { handleSubmit } = form;
  return (
    <div>
      <Stepper status={row.status} />
      <div style={{ margin: '12px 0' }}>
        <b>Self-assessment</b>
        {row.self_rating ? <p style={{ margin: '4px 0' }}>{row.self_rating} · {RATING[row.self_rating]}<br /><small>{row.self_comment}</small></p> : <p style={{ color: 'var(--mute)' }}>Not submitted yet.</p>}
      </div>
      {row.status === 'completed' && <p><b>Your rating:</b> {row.manager_rating} · {RATING[row.manager_rating ?? 0]}<br /><small>{row.manager_comment}</small></p>}
      {row.status === 'self_done' && editable && (
        <form noValidate onSubmit={handleSubmit((v) => run(() => submitManagerReview(v), onDone))}>
          <RatingFields form={form} />
          <div className="actions"><button type="button" className="sec" onClick={onDone}>Cancel</button><button disabled={pending}>{pending ? 'Saving…' : 'Complete review'}</button></div>
        </form>)}
    </div>
  );
}

/* ---------- Admin: new cycle ---------- */
function CycleForm({ onDone }: { onDone: () => void }) {
  const { run, pending } = useRun();
  const y = new Date().getFullYear();
  const { register, handleSubmit, formState: { errors } } = useForm<CycleInput>({
    resolver: zodResolver(cycleSchema),
    defaultValues: { name: `H${new Date().getMonth() < 6 ? 1 : 2} ${y}`, start_date: `${y}-${new Date().getMonth() < 6 ? '01' : '07'}-01`, end_date: `${y}-${new Date().getMonth() < 6 ? '06-30' : '12-31'}` },
  });
  return (
    <form noValidate onSubmit={handleSubmit((v) => run(() => createCycle(v), onDone))}>
      <div className="grid2">
        <Field label="Cycle name" error={errors.name}><input {...register('name')} /></Field>
        <Field label="Start" error={errors.start_date}><input type="date" {...register('start_date')} /></Field>
        <Field label="End" error={errors.end_date}><input type="date" {...register('end_date')} /></Field>
      </div>
      <p><small style={{ color: 'var(--mute)' }}>Every active employee gets an appraisal to complete.</small></p>
      <div className="actions"><button type="button" className="sec" onClick={onDone}>Cancel</button><button disabled={pending}>{pending ? 'Starting…' : 'Start cycle'}</button></div>
    </form>
  );
}
