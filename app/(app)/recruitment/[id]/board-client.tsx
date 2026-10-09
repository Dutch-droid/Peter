'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Modal, ConfirmButton } from '@/components/modal';
import { Field, StatusTag, asNumber, asOptId } from '@/components/form';
import { Progress } from '@/components/progress';
import { useRun, useToast } from '@/components/toast';
import { STAGES, candidateSchema, hireSchema, type CandidateInput, type HireInput, type Stage } from '@/lib/schemas';
import { generatePassword } from '@/lib/password';
import { deleteCandidate, hireCandidate, moveCandidate, saveCandidate } from '../../../actions';

export type Cand = { id: number; job_id: number; name: string; email: string; phone: string; stage: Stage; notes: string; employee_id: number | null; created_at: string };
type Mgr = { id: number; name: string; department: string };
type Job = { id: number; title: string; department: string; location: string; description: string; status: string };

const LABEL: Record<Stage, string> = { applied: 'Applied', screening: 'Screening', interview: 'Interview', offer: 'Offer', hired: 'Hired', rejected: 'Rejected' };
const FORWARD = STAGES.slice(0, 5); // applied..hired: the happy path used for the progress bar

export function BoardClient({ job, initial, managers }: { job: Job; initial: Cand[]; managers: Mgr[] }) {
  const toast = useToast();
  const router = useRouter();
  const [cands, setCands] = useState(initial);
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const [editing, setEditing] = useState<Cand | 'new' | null>(null);
  const [hiring, setHiring] = useState<Cand | null>(null);
  const [, start] = useTransition();
  useEffect(() => setCands(initial), [initial]);

  function move(id: number, stage: Stage) {
    const prev = cands.find((c) => c.id === id);
    if (!prev || prev.stage === stage) return;
    setCands((l) => l.map((c) => (c.id === id ? { ...c, stage } : c))); // optimistic
    start(async () => {
      const r = await moveCandidate(id, stage).catch(() => ({ ok: false as const, error: 'Something went wrong. Please try again.' }));
      if (r.ok) toast('ok', r.message ?? 'Moved');
      else { toast('error', r.error); setCands((l) => l.map((c) => (c.id === id ? { ...c, stage: prev.stage } : c))); }
    });
  }

  const hired = cands.filter((c) => c.stage === 'hired').length;
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', margin: '8px 0 16px' }}>
        <h1 style={{ margin: 0 }}>{job.title}</h1><StatusTag s={job.status} />
        <span style={{ color: 'var(--mute)' }}>{[job.department, job.location].filter(Boolean).join(' · ')}</span>
        <span className="sp" />
        <button type="button" onClick={() => setEditing('new')}>+ Add candidate</button>
      </div>
      {cands.some((c) => c.stage === 'hired' && !c.employee_id) && (
        <div className="banner">🎉 You have hired for this role. Use <b>Create employee</b> on their card to set up their record and login.</div>)}
      <div className="board">
        {STAGES.map((stage) => {
          const list = cands.filter((c) => c.stage === stage);
          return (
            <section key={stage} className={`col${over === stage ? ' over' : ''}${stage === 'rejected' ? ' muted' : ''}`}
              aria-label={`${LABEL[stage]} column`}
              onDragOver={(e) => { e.preventDefault(); setOver(stage); }}
              onDragLeave={() => setOver((o) => (o === stage ? null : o))}
              onDrop={(e) => { e.preventDefault(); setOver(null); if (dragId != null) move(dragId, stage); setDragId(null); }}>
              <h3>{LABEL[stage]} <span className="count">{list.length}</span></h3>
              {list.length === 0 && <div className="dropHint">Drop here</div>}
              {list.map((c) => (
                <article key={c.id} className={`kcard${dragId === c.id ? ' dragging' : ''}`} draggable
                  onDragStart={(e) => { setDragId(c.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(c.id)); }}
                  onDragEnd={() => { setDragId(null); setOver(null); }}>
                  <button type="button" className="linkbtn name" onClick={() => setEditing(c)}>{c.name}</button>
                  {c.email && <small>{c.email}</small>}
                  {c.stage !== 'rejected' && <Progress value={FORWARD.indexOf(c.stage as typeof FORWARD[number])} max={FORWARD.length - 1} label={`${c.name} progress`} />}
                  {c.stage === 'hired' && (c.employee_id
                    ? <a className="tag active" href="/employees" style={{ justifySelf: 'start', textDecoration: 'none' }}>✓ Employee</a>
                    : <button type="button" onClick={() => setHiring(c)}>Create employee</button>)}
                  <select aria-label={`Move ${c.name}`} value={c.stage} onChange={(e) => move(c.id, e.target.value as Stage)}>
                    {STAGES.map((s) => <option key={s} value={s}>{LABEL[s]}</option>)}</select>
                </article>))}
            </section>);
        })}
      </div>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add candidate' : 'Candidate'}>
        {editing && (
          <CandidateForm jobId={job.id} cand={editing === 'new' ? null : editing} onDone={() => { setEditing(null); router.refresh(); }} />)}
      </Modal>
      <Modal open={!!hiring} onClose={() => setHiring(null)} title={hiring ? `Create employee: ${hiring.name}` : ''}>
        {hiring && <HireForm cand={hiring} job={job} managers={managers} onDone={() => { setHiring(null); router.refresh(); }} />}
      </Modal>
    </>
  );
}

function HireForm({ cand, job, managers, onDone }: { cand: Cand; job: Job; managers: Mgr[]; onDone: () => void }) {
  const { run, pending } = useRun();
  const [first, ...rest] = cand.name.trim().split(/\s+/);
  const { register, handleSubmit, setValue, getValues, formState: { errors } } = useForm<HireInput>({
    resolver: zodResolver(hireSchema),
    // Smart defaults from what we already know about the candidate and the role.
    defaultValues: { candidate_id: cand.id, first_name: first ?? '', last_name: rest.join(' '), email: cand.email, department: job.department,
      job_title: job.title, hire_date: new Date().toISOString().slice(0, 10), role: 'employee', manager_id: null, password: generatePassword() },
  });
  return (
    <form noValidate onSubmit={handleSubmit((v) => run(() => hireCandidate(v), onDone))}>
      <div className="grid2">
        <Field label="First name" error={errors.first_name}><input {...register('first_name')} /></Field>
        <Field label="Last name" error={errors.last_name}><input {...register('last_name')} /></Field>
        <Field label="Email (their login)" error={errors.email}><input type="email" {...register('email')} /></Field>
        <Field label="Initial password" error={errors.password} hint="Suggested. Share it securely.">
          <span style={{ display: 'flex', gap: 6 }}><input style={{ flex: 1 }} autoComplete="off" spellCheck={false} {...register('password')} />
            <button type="button" className="sec" onClick={() => setValue('password', generatePassword(), { shouldValidate: true })}>New</button></span></Field>
        <Field label="Department" error={errors.department}><input {...register('department')} /></Field>
        <Field label="Job title" error={errors.job_title}><input {...register('job_title')} /></Field>
        <Field label="Start date" error={errors.hire_date}><input type="date" {...register('hire_date')} /></Field>
        <Field label="Monthly salary (KES)" error={errors.monthly_salary}><input type="number" step="0.01" {...register('monthly_salary', asNumber)} /></Field>
        <Field label="Manager" error={errors.manager_id} hint="Picking a manager fills in their department if blank">
          <select {...register('manager_id', { ...asOptId, onChange: (e) => {
            const m = managers.find((x) => x.id === Number(e.target.value)); if (m && !getValues('department')) setValue('department', m.department);
          } })}><option value="">— none —</option>{managers.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>
        <Field label="Role" error={errors.role}><select {...register('role')}><option value="employee">Employee</option><option value="manager">Manager</option><option value="admin">Admin</option></select></Field>
      </div>
      <div className="actions"><button type="button" className="sec" onClick={onDone}>Cancel</button>
        <button disabled={pending}>{pending ? 'Creating…' : 'Create employee'}</button></div>
    </form>
  );
}

function CandidateForm({ jobId, cand, onDone }: { jobId: number; cand: Cand | null; onDone: () => void }) {
  const { run, pending } = useRun();
  const { register, handleSubmit, formState: { errors } } = useForm<CandidateInput>({
    resolver: zodResolver(candidateSchema),
    defaultValues: { id: cand?.id ?? null, job_id: jobId, name: cand?.name ?? '', email: cand?.email ?? '', phone: cand?.phone ?? '', notes: cand?.notes ?? '' },
  });
  return (
    <form noValidate onSubmit={handleSubmit((v) => run(() => saveCandidate(v), onDone))}>
      <div className="grid2">
        <Field label="Full name" error={errors.name}><input {...register('name')} /></Field>
        <Field label="Email" error={errors.email}><input type="email" {...register('email')} /></Field>
        <Field label="Phone" error={errors.phone}><input {...register('phone')} /></Field>
      </div>
      <div style={{ marginTop: 12 }}><Field label="Notes" error={errors.notes}><textarea rows={4} {...register('notes')} /></Field></div>
      <div className="actions">
        {cand && <ConfirmButton label="Remove" danger title={`Remove ${cand.name}?`} message="They will be deleted from this pipeline."
          action={() => deleteCandidate(cand.id)} onDone={onDone} />}
        <span className="sp" />
        <button type="button" className="sec" onClick={onDone}>Cancel</button>
        <button disabled={pending}>{pending ? 'Saving…' : 'Save'}</button>
      </div>
    </form>
  );
}
