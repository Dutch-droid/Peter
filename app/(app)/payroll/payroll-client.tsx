'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { Field, StatusTag } from '@/components/form';
import { useRun } from '@/components/toast';
import { periodSchema } from '@/lib/schemas';
import { kes } from '@/lib/format';
import { createPayrollRun } from '../../actions';

export type RunRow = { id: number; period: string; status: string; n: number; gross: number; net: number };

export function PayrollClient({ rows, suggested }: { rows: RunRow[]; suggested: string }) {
  const router = useRouter();
  const { run, pending } = useRun();
  const { register, handleSubmit, formState: { errors } } = useForm<{ period: string }>({ resolver: zodResolver(periodSchema), defaultValues: { period: suggested } });
  const columns = useMemo<ColumnDef<RunRow>[]>(() => [
    { accessorKey: 'period', header: 'Period' },
    { accessorKey: 'status', header: 'Status', cell: ({ getValue }) => <StatusTag s={String(getValue())} /> },
    { accessorKey: 'n', header: 'Employees', meta: { n: true } },
    { accessorKey: 'gross', header: 'Gross', meta: { n: true }, cell: ({ getValue }) => kes(Number(getValue())) },
    { accessorKey: 'net', header: 'Net', meta: { n: true }, cell: ({ getValue }) => kes(Number(getValue())) },
    { id: 'open', header: '', enableSorting: false, cell: ({ row }) => <Link href={`/payroll/${row.original.id}`}>Open</Link> },
  ], []);
  return (
    <>
      <h1>Payroll</h1>
      <div className="card"><h2>New payroll run</h2>
        <form className="row" noValidate
          onSubmit={handleSubmit((v) => run(() => createPayrollRun(v), (r) => r.data && router.push(`/payroll/${r.data.id}`)))}>
          <Field label="Month" error={errors.period} hint={`Suggested: ${suggested}. Uses the rates currently in Settings`}><input type="month" {...register('period')} /></Field>
          <button disabled={pending}>{pending ? 'Calculating…' : 'Calculate payroll'}</button>
        </form></div>
      <div className="card"><DataTable data={rows} columns={columns} filters={[{ id: 'status', label: 'Status' }]}
        searchPlaceholder="Search period…" empty="No payroll runs yet." /></div>
    </>
  );
}
