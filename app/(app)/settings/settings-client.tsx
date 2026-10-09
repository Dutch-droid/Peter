'use client';
import { useMemo, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { ConfirmButton, Modal } from '@/components/modal';
import { Field, asNumber, asOptNumber } from '@/components/form';
import { useRun } from '@/components/toast';
import { bracketsSchema, componentSchema, holidaySchema, leaveTypeSchema, type BracketsInput, type ComponentInput, type HolidayInput, type LeaveTypeInput } from '@/lib/schemas';
import { deleteComponent, deleteHoliday, saveBrackets, saveComponent, saveHoliday, saveLeaveType } from '../../actions';

export type Comp = { id: number; name: string; kind: string; calc: string; value: number; taxable: number; min_amount: number | null; max_amount: number | null };
export type Holiday = { date: string; name: string };
export type LeaveTypeRow = { id: number; name: string; days_per_year: number };

export function SettingsClient({ comps, brackets, relief, types, holidays }: {
  comps: Comp[]; brackets: { upper_limit: number | null; rate: number }[]; relief: number; types: LeaveTypeRow[]; holidays: Holiday[];
}) {
  return (
    <>
      <h1>Settings</h1>
      <p style={{ color: 'var(--mute)' }}>Defaults follow Kenya (KES). Confirm rates against current KRA, NSSF and SHA guidance before running real payroll. Changes apply to new payroll runs only.</p>
      <TaxCard brackets={brackets} relief={relief} />
      <ComponentsCard comps={comps} />
      <LeaveTypesCard types={types} />
      <HolidaysCard holidays={holidays} />
    </>
  );
}

function TaxCard({ brackets, relief }: { brackets: { upper_limit: number | null; rate: number }[]; relief: number }) {
  const { run, pending } = useRun();
  const { register, control, handleSubmit, formState: { errors } } = useForm<BracketsInput>({
    resolver: zodResolver(bracketsSchema),
    defaultValues: { brackets: brackets.length ? brackets : [{ upper_limit: null, rate: 0 }], monthly_relief: relief },
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'brackets' });
  return (
    <div className="card"><h2>PAYE tax bands (annual taxable income)</h2>
      <form onSubmit={handleSubmit((v) => run(() => saveBrackets(v)))} noValidate>
        {fields.map((f, i) => (
          <div key={f.id} className="row" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 8 }}>
            <Field label={i === 0 ? 'Up to (blank = no limit)' : ' '} error={errors.brackets?.[i]?.upper_limit}>
              <input type="number" step="any" {...register(`brackets.${i}.upper_limit`, asOptNumber)} /></Field>
            <Field label={i === 0 ? 'Rate %' : ' '} error={errors.brackets?.[i]?.rate}>
              <input type="number" step="any" {...register(`brackets.${i}.rate`, asNumber)} /></Field>
            <button type="button" className="sec" style={{ marginTop: 20 }} onClick={() => remove(i)} disabled={fields.length < 2} aria-label={`Remove band ${i + 1}`}>Remove</button>
          </div>))}
        {errors.brackets?.message && <div className="fielderr">{errors.brackets.message}</div>}
        <button type="button" className="sec" onClick={() => append({ upper_limit: null, rate: 0 })}>+ Add band</button>
        <div style={{ maxWidth: 260, marginTop: 12 }}>
          <Field label="Monthly personal relief (tax credit)" error={errors.monthly_relief}>
            <input type="number" step="any" {...register('monthly_relief', asNumber)} /></Field></div>
        <small>Bands must increase; only the last band has no limit.</small>
        <div className="actions"><button disabled={pending}>{pending ? 'Saving…' : 'Save tax settings'}</button></div>
      </form></div>
  );
}

function ComponentsCard({ comps }: { comps: Comp[] }) {
  const [editing, setEditing] = useState<Comp | 'new' | null>(null);
  const { run, pending } = useRun();
  const columns = useMemo<ColumnDef<Comp>[]>(() => [
    { accessorKey: 'name', header: 'Name' },
    { accessorKey: 'kind', header: 'Kind' },
    { id: 'rule', header: 'Rule', enableSorting: false, cell: ({ row: { original: c } }) => c.calc === 'percent' ? `${c.value}% of ${c.kind === 'allowance' ? 'base' : 'gross'}` : `KES ${c.value} fixed` },
    { id: 'limits', header: 'Min / Max', enableSorting: false, cell: ({ row: { original: c } }) => c.min_amount == null && c.max_amount == null ? '—' : `${c.min_amount ?? '—'} / ${c.max_amount ?? '—'}` },
    { id: 'tax', header: 'Tax treatment', accessorFn: (c) => (c.taxable ? (c.kind === 'allowance' ? 'taxable' : 'pre-tax') : (c.kind === 'allowance' ? 'non-taxable' : 'post-tax')) },
    { id: 'act', header: '', enableSorting: false, cell: ({ row: { original: c } }) => (
      <span style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="sec" onClick={() => setEditing(c)}>Edit</button>
        <ConfirmButton label="Delete" className="sec" title={`Delete ${c.name}?`} danger
          message="Future payroll runs will no longer include it. Existing payslips are unchanged."
          action={() => deleteComponent(c.id)} />
      </span>) },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [run, pending]);
  return (
    <div className="card"><h2>Allowances &amp; deductions</h2>
      <DataTable data={comps} columns={columns} filters={[{ id: 'kind', label: 'Kind' }]} searchPlaceholder="Search…"
        toolbar={<button type="button" onClick={() => setEditing('new')}>+ Add</button>} />
      <Modal open={!!editing} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add component' : `Edit ${(editing as Comp | null)?.name ?? ''}`}>
        {editing && <ComponentForm comp={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />}
      </Modal>
    </div>
  );
}

function ComponentForm({ comp, onDone }: { comp: Comp | null; onDone: () => void }) {
  const { run, pending } = useRun();
  const { register, handleSubmit, watch, formState: { errors } } = useForm<ComponentInput>({
    resolver: zodResolver(componentSchema),
    defaultValues: comp ? { name: comp.name, kind: comp.kind as 'allowance', calc: comp.calc as 'percent', value: comp.value, taxable: !!comp.taxable, min_amount: comp.min_amount, max_amount: comp.max_amount }
      : { name: '', kind: 'allowance', calc: 'percent', taxable: true, min_amount: null, max_amount: null },
  });
  const kind = watch('kind');
  return (
    <form onSubmit={handleSubmit((v) => run(() => saveComponent(v), onDone))} noValidate>
      <div className="grid2">
        <Field label="Name" error={errors.name}><input {...register('name')} readOnly={!!comp} /></Field>
        <Field label="Kind" error={errors.kind}><select {...register('kind')}><option value="allowance">Allowance (adds to pay)</option><option value="deduction">Deduction (reduces pay)</option></select></Field>
        <Field label="Calculation" error={errors.calc}><select {...register('calc')}><option value="percent">Percent</option><option value="fixed">Fixed KES</option></select></Field>
        <Field label="Value" error={errors.value} hint={kind === 'allowance' ? 'Percent of base salary' : 'Percent of gross pay'}><input type="number" step="any" {...register('value', asNumber)} /></Field>
        <Field label="Minimum amount (optional)" error={errors.min_amount}><input type="number" step="any" {...register('min_amount', asOptNumber)} /></Field>
        <Field label="Maximum amount (optional)" error={errors.max_amount}><input type="number" step="any" {...register('max_amount', asOptNumber)} /></Field>
      </div>
      <label style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
        <input type="checkbox" {...register('taxable')} />
        {kind === 'allowance' ? 'Taxable (counts towards PAYE)' : 'Pre-tax (reduces taxable income before PAYE)'}</label>
      <div className="actions"><button type="button" className="sec" onClick={onDone}>Cancel</button>
        <button disabled={pending}>{pending ? 'Saving…' : 'Save'}</button></div>
    </form>
  );
}

function LeaveTypesCard({ types }: { types: LeaveTypeRow[] }) {
  const { run, pending } = useRun();
  const { register, handleSubmit, reset, formState: { errors } } = useForm<LeaveTypeInput>({ resolver: zodResolver(leaveTypeSchema), defaultValues: { name: '' } });
  const columns = useMemo<ColumnDef<LeaveTypeRow>[]>(() => [
    { accessorKey: 'name', header: 'Leave type' },
    { accessorKey: 'days_per_year', header: 'Days per year', meta: { n: true } },
    { id: 'edit', header: '', enableSorting: false, cell: ({ row: { original: t } }) => (
      <button type="button" className="sec" onClick={() => reset({ name: t.name, days_per_year: t.days_per_year })}>Edit</button>) },
  ], [reset]);
  return (
    <div className="card"><h2>Leave types</h2>
      <DataTable data={types} columns={columns} pageSize={8} searchPlaceholder="Search…" />
      <form className="row" style={{ marginTop: 12 }} noValidate onSubmit={handleSubmit((v) => run(() => saveLeaveType(v), () => reset({ name: '', days_per_year: undefined })))}>
        <Field label="Name (same name updates it)" error={errors.name}><input {...register('name')} /></Field>
        <Field label="Days per year" error={errors.days_per_year}><input type="number" {...register('days_per_year', asNumber)} /></Field>
        <button disabled={pending}>{pending ? 'Saving…' : 'Save leave type'}</button>
      </form></div>
  );
}

function HolidaysCard({ holidays }: { holidays: Holiday[] }) {
  const { run, pending } = useRun();
  const { register, handleSubmit, reset, formState: { errors } } = useForm<HolidayInput>({ resolver: zodResolver(holidaySchema), defaultValues: { date: '', name: '' } });
  const columns = useMemo<ColumnDef<Holiday>[]>(() => [
    { accessorKey: 'date', header: 'Date', cell: ({ getValue }) => `${getValue()} (${new Date(String(getValue()) + 'T00:00:00Z').toLocaleString('en-GB', { weekday: 'short', timeZone: 'UTC' })})` },
    { accessorKey: 'name', header: 'Holiday' },
    { id: 'act', header: '', enableSorting: false, cell: ({ row: { original: h } }) => (
      <span style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="sec" onClick={() => reset({ date: h.date, name: h.name })}>Edit</button>
        <ConfirmButton label="Delete" className="sec" title={`Delete ${h.name}?`} danger
          message="Leave requested from now on will count this day as a working day." action={() => deleteHoliday(h.date)} /></span>) },
  ], [reset]);
  return (
    <div className="card"><h2>Public holidays</h2>
      <p style={{ color: 'var(--mute)', marginTop: 0 }}>Holidays are not counted against leave balances and show on the leave calendar. Add movable or newly gazetted days (for example Eid) here each year, and check the dates against the official gazette.</p>
      <DataTable data={holidays} columns={columns} pageSize={8} searchPlaceholder="Search holidays…" />
      <form className="row" style={{ marginTop: 12 }} noValidate onSubmit={handleSubmit((v) => run(() => saveHoliday(v), () => reset({ date: '', name: '' })))}>
        <Field label="Date" error={errors.date}><input type="date" {...register('date')} /></Field>
        <Field label="Name" error={errors.name}><input {...register('name')} /></Field>
        <button disabled={pending}>{pending ? 'Saving…' : 'Save holiday'}</button>
      </form></div>
  );
}
