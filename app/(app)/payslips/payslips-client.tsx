'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable } from '@/components/data-table';
import { kes } from '@/lib/format';

export type SlipListRow = { id: number; period: string; gross: number; net: number };

export function PayslipsClient({ rows }: { rows: SlipListRow[] }) {
  const columns = useMemo<ColumnDef<SlipListRow>[]>(() => [
    { accessorKey: 'period', header: 'Period' },
    { accessorKey: 'gross', header: 'Gross', meta: { n: true }, cell: ({ getValue }) => kes(Number(getValue())) },
    { accessorKey: 'net', header: 'Net', meta: { n: true }, cell: ({ getValue }) => kes(Number(getValue())) },
    { id: 'v', header: '', enableSorting: false, cell: ({ row }) => <Link href={`/payslips/${row.original.id}`}>View</Link> },
  ], []);
  return (
    <>
      <h1>My payslips</h1>
      <div className="card"><DataTable data={rows} columns={columns} searchPlaceholder="Search period…"
        empty="No payslips have been published for you yet." /></div>
    </>
  );
}
