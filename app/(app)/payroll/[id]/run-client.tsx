'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { ConfirmButton } from '@/components/modal';
import { StatusTag } from '@/components/form';
import { Progress } from '@/components/progress';
import { kes } from '@/lib/format';
import { deleteDraftRun, finalizeRun } from '../../../actions';

export type SlipRow = { id: number; name: string; department: string; gross: number; ded: number; tax: number; net: number };

export function RunClient({ run, rows }: { run: { id: number; period: string; status: string }; rows: SlipRow[] }) {
  const router = useRouter();
  const sum = (k: 'gross' | 'ded' | 'tax' | 'net') => rows.reduce((s, r) => s + r[k], 0);
  const money = (h: string, k: keyof SlipRow): ColumnDef<SlipRow> =>
    ({ accessorKey: k, header: h, meta: { n: true }, cell: ({ getValue }) => kes(Number(getValue())) });
  const columns = useMemo<ColumnDef<SlipRow>[]>(() => [
    { accessorKey: 'name', header: 'Employee' },
    { accessorKey: 'department', header: 'Department' },
    money('Gross', 'gross'), money('Deductions', 'ded'), money('PAYE', 'tax'), money('Net', 'net'),
    { id: 'slip', header: '', enableSorting: false, cell: ({ row }) => <span style={{ display: 'flex', gap: 12 }}><Link href={`/payslips/${row.original.id}`}>Payslip</Link><a href={`/payslips/${row.original.id}/pdf`} download>PDF</a></span> },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []);
  return (
    <>
      <h1>Payroll {run.period} <StatusTag s={run.status} /></h1>
      <div className="card">
        <div className="steps">
          <span className="ok">✓ Calculated</span>
          <span className={run.status === 'draft' ? 'on' : 'ok'}>{run.status === 'draft' ? '2 Review figures' : '✓ Reviewed'}</span>
          <span className={run.status === 'draft' ? '' : 'ok'}>{run.status === 'draft' ? '3 Finalize & publish' : '✓ Published'}</span>
        </div>
        <Progress value={run.status === 'draft' ? 1 : 3} max={3} label="Payroll progress" />
        <div className="meta"><span>{run.status === 'draft' ? 'Review the totals below, then finalize. One step left.' : 'Done. Employees can see their payslips.'}</span></div>
      </div>
      <div className="stats">
        <div className="card stat"><b>{kes(sum('gross'))}</b><span>Total gross</span></div>
        <div className="card stat"><b>{kes(sum('ded'))}</b><span>Total deductions</span></div>
        <div className="card stat"><b>{kes(sum('tax'))}</b><span>Total PAYE</span></div>
        <div className="card stat"><b>{kes(sum('net'))}</b><span>Total net pay</span></div>
      </div>
      <div className="card"><DataTable data={rows} columns={columns} filters={[{ id: 'department', label: 'Department' }]}
        searchPlaceholder="Search employee…"
        toolbar={<a className="btn" href={`/payroll/${run.id}/export`} download>Export CSV</a>} /></div>
      {run.status === 'draft' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <ConfirmButton label="Finalize & publish" title="Finalize this payroll?"
            message="Employees will be able to see their payslips for this period. This cannot be undone."
            action={() => finalizeRun(run.id)} onDone={() => router.refresh()} />
          <ConfirmButton label="Discard draft" title="Discard this draft?" danger
            message="The draft payslips will be deleted. You can recalculate afterwards."
            action={() => deleteDraftRun(run.id)} onDone={() => router.push('/payroll')} />
        </div>)}
    </>
  );
}
