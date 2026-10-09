'use client';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { Modal } from '@/components/modal';
import { Field, StatusTag, asNumber, asOptId } from '@/components/form';
import { generatePassword } from '@/lib/password';
import { useRun } from '@/components/toast';
import { employeeSchema, employeeUpdateSchema, type EmployeeInput, type EmployeeUpdateInput } from '@/lib/schemas';
import { addEmployee, updateEmployee } from '../../actions';
import { kes } from '@/lib/format';

export type EmpRow = {
  id: number; name: string; email: string; department: string; job_title: string; manager_id: number | null;
  manager: string; hire_date: string; status: string; monthly_salary?: number;
};

export function EmployeesClient({ rows, isAdmin }: { rows: EmpRow[]; isAdmin: boolean }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<EmpRow | null>(null);

  const columns = useMemo<ColumnDef<EmpRow>[]>(() => [
    { accessorKey: 'name', header: 'Name', cell: ({ row: { original: e } }) => (
      <><b>{e.name}</b><br /><small>{e.email}</small></>) },
    { accessorKey: 'department', header: 'Department' },
    { accessorKey: 'job_title', header: 'Title' },
    { accessorKey: 'manager', header: 'Manager' },
    { accessorKey: 'hire_date', header: 'Hired' },
    ...(isAdmin ? [{ accessorKey: 'monthly_salary', header: 'Monthly salary', meta: { n: true },
      cell: ({ getValue }) => kes(Number(getValue())) } as ColumnDef<EmpRow>] : []),
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusTag s={String(getValue())} /> },
    ...(isAdmin ? [{ id: 'edit', header: '', enableSorting: false,
      cell: ({ row }) => <button type="button" className="sec" onClick={() => setEditing(row.original)}>Edit</button> } as ColumnDef<EmpRow>] : []),
  ], [isAdmin]);

  return (
    <>
      <h1>Employees</h1>
      <div className="card">
        <DataTable data={rows} columns={columns} searchPlaceholder="Search name, email, title…"
          filters={[{ id: 'department', label: 'Department' }, { id: 'status', label: 'Status' }]}
          toolbar={isAdmin ? <><a className="btn" href="/employees/export" download>Export CSV</a><button type="button" onClick={() => setAdding(true)}>+ Add employee</button></> : null} />
      </div>
      {isAdmin && (
        <>
          <Modal open={adding} onClose={() => setAdding(false)} title="Add employee">
            <AddForm managers={rows} onDone={() => setAdding(false)} />
          </Modal>
          <Modal open={!!editing} onClose={() => setEditing(null)} title={editing ? `Edit ${editing.name}` : ''}>
            {editing && <EditForm emp={editing} all={rows} onDone={() => setEditing(null)} />}
          </Modal>
        </>
      )}
    </>
  );
}

function ManagerSelect({ all, exclude, reg }: { all: EmpRow[]; exclude?: number; reg: object }) {
  return (
    <select {...reg}><option value="">— none —</option>
      {all.filter((m) => m.id !== exclude).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
  );
}

function AddForm({ managers, onDone }: { managers: EmpRow[]; onDone: () => void }) {
  const { run, pending } = useRun();
  const { register, handleSubmit, setValue, getValues, formState: { errors } } = useForm<EmployeeInput>({
    resolver: zodResolver(employeeSchema),
    // Smart defaults: hired today, plain employee role, and a strong suggested password.
    defaultValues: { role: 'employee', manager_id: null, department: '', job_title: '',
      hire_date: new Date().toISOString().slice(0, 10), password: generatePassword() },
  });
  return (
    <form onSubmit={handleSubmit((v) => run(() => addEmployee(v), onDone))} noValidate>
      <div className="grid2">
        <Field label="First name" error={errors.first_name}><input {...register('first_name')} /></Field>
        <Field label="Last name" error={errors.last_name}><input {...register('last_name')} /></Field>
        <Field label="Email (also their login)" error={errors.email}><input type="email" {...register('email')} /></Field>
        <Field label="Initial password" error={errors.password} hint="Suggested. Copy it and share it securely.">
          <span style={{ display: 'flex', gap: 6 }}>
            <input style={{ flex: 1 }} autoComplete="off" spellCheck={false} {...register('password')} />
            <button type="button" className="sec" onClick={() => setValue('password', generatePassword(), { shouldValidate: true })}>New</button>
          </span></Field>
        <Field label="Department" error={errors.department}><input {...register('department')} /></Field>
        <Field label="Job title" error={errors.job_title}><input {...register('job_title')} /></Field>
        <Field label="Hire date" error={errors.hire_date}><input type="date" {...register('hire_date')} /></Field>
        <Field label="Monthly salary (KES)" error={errors.monthly_salary}>
          <input type="number" step="0.01" {...register('monthly_salary', asNumber)} /></Field>
        <Field label="Manager" error={errors.manager_id} hint="Picking a manager fills in their department">
          <ManagerSelect all={managers} reg={register('manager_id', { ...asOptId, onChange: (e) => {
            const m = managers.find((x) => x.id === Number(e.target.value));
            if (m && !getValues('department')) setValue('department', m.department);
          } })} /></Field>
        <Field label="Role" error={errors.role}>
          <select {...register('role')}><option value="employee">Employee</option><option value="manager">Manager</option><option value="admin">Admin</option></select></Field>
      </div>
      <div className="actions"><button type="button" className="sec" onClick={onDone}>Cancel</button>
        <button disabled={pending}>{pending ? 'Saving…' : 'Add employee'}</button></div>
    </form>
  );
}

function EditForm({ emp, all, onDone }: { emp: EmpRow; all: EmpRow[]; onDone: () => void }) {
  const { run, pending } = useRun();
  const { register, handleSubmit, formState: { errors } } = useForm<EmployeeUpdateInput>({
    resolver: zodResolver(employeeUpdateSchema),
    defaultValues: {
      id: emp.id, department: emp.department, job_title: emp.job_title, manager_id: emp.manager_id,
      monthly_salary: emp.monthly_salary ?? 0, status: emp.status as 'active' | 'inactive',
    },
  });
  return (
    <form onSubmit={handleSubmit((v) => run(() => updateEmployee(v), onDone))} noValidate>
      <div className="grid2">
        <Field label="Department" error={errors.department}><input {...register('department')} /></Field>
        <Field label="Job title" error={errors.job_title}><input {...register('job_title')} /></Field>
        <Field label="Monthly salary (KES)" error={errors.monthly_salary}>
          <input type="number" step="0.01" {...register('monthly_salary', asNumber)} /></Field>
        <Field label="Manager" error={errors.manager_id}><ManagerSelect all={all} exclude={emp.id} reg={register('manager_id', asOptId)} /></Field>
        <Field label="Status" error={errors.status} hint="Inactive employees are skipped in payroll">
          <select {...register('status')}><option value="active">Active</option><option value="inactive">Inactive</option></select></Field>
      </div>
      <div className="actions"><button type="button" className="sec" onClick={onDone}>Cancel</button>
        <button disabled={pending}>{pending ? 'Saving…' : 'Save changes'}</button></div>
    </form>
  );
}
