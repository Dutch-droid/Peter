'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { Modal } from '@/components/modal';
import { Field, StatusTag } from '@/components/form';
import { useRun } from '@/components/toast';
import { jobSchema, type JobInput } from '@/lib/schemas';
import { saveJob } from '../../actions';

export type JobRow = { id: number; title: string; department: string; location: string; description: string; status: string; created_at: string; total: number; active: number; hired: number };

export function JobsClient({ rows }: { rows: JobRow[] }) {
  const [editing, setEditing] = useState<JobRow | 'new' | null>(null);
  const columns = useMemo<ColumnDef<JobRow>[]>(() => [
    { accessorKey: 'title', header: 'Role', cell: ({ row: { original: j } }) => <Link href={`/recruitment/${j.id}`}><b>{j.title}</b></Link> },
    { accessorKey: 'department', header: 'Department' },
    { accessorKey: 'location', header: 'Location' },
    { accessorKey: 'active', header: 'In pipeline', meta: { n: true } },
    { accessorKey: 'hired', header: 'Hired', meta: { n: true } },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusTag s={String(getValue())} /> },
    { id: 'act', header: '', enableSorting: false, cell: ({ row: { original: j } }) => (
      <span style={{ display: 'flex', gap: 8 }}>
        <Link className="btn" href={`/recruitment/${j.id}`}>Pipeline</Link>
        <button type="button" className="sec" onClick={() => setEditing(j)}>Edit</button></span>) },
  ], []);
  return (
    <>
      <h1>Recruitment</h1>
      <div className="card">
        <DataTable data={rows} columns={columns} filters={[{ id: 'status', label: 'Status' }, { id: 'department', label: 'Department' }]}
          searchPlaceholder="Search roles…" empty="No jobs yet. Create your first opening."
          toolbar={<button type="button" onClick={() => setEditing('new')}>+ New job</button>} />
      </div>
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'New job' : 'Edit job'}>
        {editing && <JobForm job={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Modal>
    </>
  );
}

function JobForm({ job, onDone }: { job: JobRow | null; onDone: () => void }) {
  const router = useRouter();
  const { run, pending } = useRun();
  const { register, handleSubmit, formState: { errors } } = useForm<JobInput>({
    resolver: zodResolver(jobSchema),
    defaultValues: job ? { id: job.id, title: job.title, department: job.department, location: job.location, description: job.description, status: job.status as 'open' }
      : { id: null, title: '', department: '', location: 'Nairobi', description: '', status: 'open' },
  });
  return (
    <form noValidate onSubmit={handleSubmit((v) => run(() => saveJob(v), (r) => { onDone(); if (!job && r.data) router.push(`/recruitment/${r.data.id}`); }))}>
      <div className="grid2">
        <Field label="Job title" error={errors.title}><input {...register('title')} /></Field>
        <Field label="Department" error={errors.department}><input {...register('department')} /></Field>
        <Field label="Location" error={errors.location}><input {...register('location')} /></Field>
        <Field label="Status" error={errors.status}><select {...register('status')}><option value="open">Open</option><option value="closed">Closed</option></select></Field>
      </div>
      <div style={{ marginTop: 12 }}><Field label="Description" error={errors.description}><textarea rows={4} {...register('description')} /></Field></div>
      <div className="actions"><button type="button" className="sec" onClick={onDone}>Cancel</button>
        <button disabled={pending}>{pending ? 'Saving…' : 'Save job'}</button></div>
    </form>
  );
}
