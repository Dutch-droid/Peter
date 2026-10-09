'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { Field, StatusTag, asNumber } from '@/components/form';
import { Progress } from '@/components/progress';
import { useRun } from '@/components/toast';
import { leaveRequestSchema, type LeaveRequestInput } from '@/lib/schemas';
import { businessDays } from '@/lib/leave-days';
import { cancelLeave, decideLeave, requestLeave } from '../../actions';

export type Balance = { id: number; name: string; total: number; left: number };
export type MyReq = { id: number; type: string; start_date: string; end_date: string; days: number; status: string; reason: string };
export type QueueReq = { id: number; name: string; type: string; start_date: string; end_date: string; days: number; reason: string };

export function LeaveClient({ balances, mine, queue, defaults }: {
  balances: Balance[]; mine: MyReq[]; queue: QueueReq[]; defaults: { typeId: number; start: string };
}) {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><h1 style={{ margin: 0 }}>Leave</h1><span className="sp" />
        <Link className="btn" href="/leave/calendar">Team calendar</Link></div>
      <div style={{ height: 16 }} />
      <div className="stats">{balances.map((b) => (
        <div key={b.id} className="card stat"><b>{b.left}</b><span>{b.name} days yours to use</span>
          <div style={{ marginTop: 8 }}><Progress value={b.total - b.left} max={b.total} label={`${b.name} used`} /></div>
          <div className="meta"><span>{b.total - b.left} used</span><span>of {b.total}</span></div></div>))}</div>
      <RequestForm balances={balances} defaults={defaults} />
      {queue.length > 0 && <Queue rows={queue} />}
      <MyRequests rows={mine} />
    </>
  );
}

function RequestForm({ balances, defaults }: { balances: Balance[]; defaults: { typeId: number; start: string } }) {
  const { run, pending } = useRun();
  const { register, handleSubmit, watch, reset, setValue, getValues, formState: { errors } } = useForm<LeaveRequestInput>({
    resolver: zodResolver(leaveRequestSchema),
    defaultValues: { leave_type_id: defaults.typeId, reason: '', start_date: defaults.start, end_date: defaults.start },
  });
  const [typeId, start, end] = watch(['leave_type_id', 'start_date', 'end_date']);
  const days = start && end ? businessDays(start, end) : 0;
  const bal = balances.find((b) => b.id === Number(typeId));
  const over = bal && days > bal.left;
  return (
    <div className="card"><h2>Request leave</h2>
      <form onSubmit={handleSubmit((v) => run(() => requestLeave(v), () => reset({ leave_type_id: defaults.typeId, reason: '', start_date: defaults.start, end_date: defaults.start })))} noValidate>
        <div className="grid2">
          <Field label="Type" error={errors.leave_type_id}>
            <select {...register('leave_type_id', asNumber)}>{balances.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="From" error={errors.start_date}><input type="date" {...register('start_date', {
            // Smart default: keep the end date in step so a one-day request is one click.
            onChange: (e) => { const end = getValues('end_date'); if (!end || end < e.target.value) setValue('end_date', e.target.value, { shouldValidate: true }); },
          })} /></Field>
          <Field label="To" error={errors.end_date}><input type="date" min={start || undefined} {...register('end_date')} /></Field>
          <Field label="Reason (optional)" error={errors.reason}><input {...register('reason')} /></Field>
        </div>
        {days > 0 && (
          <div className={`banner${over ? ' warn' : ''}`}>
            {days} working day{days === 1 ? '' : 's'}{bal ? ` · ${bal.left} available in ${bal.name}` : ''}
            {over ? ' · exceeds your balance' : ''}. Weekends are excluded; public holidays are not.
          </div>)}
        <div className="actions"><button disabled={pending}>{pending ? 'Submitting…' : 'Submit request'}</button></div>
      </form>
    </div>
  );
}

function Queue({ rows }: { rows: QueueReq[] }) {
  const { run, pending } = useRun();
  const columns = useMemo<ColumnDef<QueueReq>[]>(() => [
    { accessorKey: 'name', header: 'Employee' },
    { accessorKey: 'type', header: 'Type' },
    { id: 'dates', header: 'Dates', accessorFn: (r) => r.start_date, cell: ({ row: { original: r } }) => `${r.start_date} → ${r.end_date}` },
    { accessorKey: 'days', header: 'Days', meta: { n: true } },
    { accessorKey: 'reason', header: 'Reason' },
    { id: 'act', header: '', enableSorting: false, cell: ({ row: { original: r } }) => (
      <span style={{ display: 'flex', gap: 8 }}>
        <button type="button" disabled={pending} onClick={() => run(() => decideLeave(r.id, 'approve'))}>Approve</button>
        <button type="button" className="bad" disabled={pending} onClick={() => run(() => decideLeave(r.id, 'reject'))}>Reject</button>
      </span>) },
  ], [run, pending]);
  return <div className="card"><h2>Awaiting your decision ({rows.length})</h2><DataTable data={rows} columns={columns} pageSize={5} /></div>;
}

function MyRequests({ rows }: { rows: MyReq[] }) {
  const { run, pending } = useRun();
  const columns = useMemo<ColumnDef<MyReq>[]>(() => [
    { accessorKey: 'type', header: 'Type' },
    { id: 'dates', header: 'Dates', accessorFn: (r) => r.start_date, cell: ({ row: { original: r } }) => `${r.start_date} → ${r.end_date}` },
    { accessorKey: 'days', header: 'Days', meta: { n: true } },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusTag s={String(getValue())} /> },
    { id: 'act', header: '', enableSorting: false, cell: ({ row: { original: r } }) => r.status === 'pending' && (
      <button type="button" className="sec" disabled={pending} onClick={() => run(() => cancelLeave(r.id))}>Cancel</button>) },
  ], [run, pending]);
  return (
    <div className="card"><h2>My requests</h2>
      <DataTable data={rows} columns={columns} filters={[{ id: 'status', label: 'Status' }, { id: 'type', label: 'Type' }]}
        searchPlaceholder="Search my requests…" empty="You haven't requested any leave yet."
        toolbar={<a className="btn" href="/leave/export" download>Export CSV</a>} /></div>
  );
}
