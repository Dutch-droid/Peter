'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Modal, ConfirmButton } from '@/components/modal';
import { Field, StatusTag } from '@/components/form';
import { Progress } from '@/components/progress';
import { useRun, useToast } from '@/components/toast';
import { STAGES, candidateSchema, type CandidateInput, type Stage } from '@/lib/schemas';
import { deleteCandidate, moveCandidate, saveCandidate } from '../../../actions';

export type Cand = { id: number; job_id: number; name: string; email: string; phone: string; stage: Stage; notes: string; created_at: string };
type Job = { id: number; title: string; department: string; location: string; description: string; status: string };

const LABEL: Record<Stage, string> = { applied: 'Applied', screening: 'Screening', interview: 'Interview', offer: 'Offer', hired: 'Hired', rejected: 'Rejected' };
const FORWARD = STAGES.slice(0, 5); // applied..hired: the happy path used for the progress bar

export function BoardClient({ job, initial }: { job: Job; initial: Cand[] }) {
  const toast = useToast();
  const router = useRouter();
  const [cands, setCands] = useState(initial);
  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const [editing, setEditing] = useState<Cand | 'new' | null>(null);
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
      {hired > 0 && <div className="banner">🎉 {hired} hired for this role. Add them as an employee from <a href="/employees">Employees</a>.</div>}
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
    </>
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
