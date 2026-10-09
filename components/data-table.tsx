'use client';
import { useMemo, useState } from 'react';
import {
  flexRender, getCoreRowModel, getFilteredRowModel, getPaginationRowModel, getSortedRowModel,
  useReactTable, type ColumnDef, type SortingState,
} from '@tanstack/react-table';

type Filter = { id: string; label: string };
const defaultColumn = { filterFn: 'equalsString' as const };
const NO_FILTERS: Filter[] = [];

/**
 * Sortable, searchable, paginated table. `filters` adds a dropdown per column id,
 * with options taken from the data.
 */
export function DataTable<T>({ data, columns, filters = NO_FILTERS, searchPlaceholder = 'Search…', pageSize = 10, empty = 'Nothing to show.', toolbar }: {
  data: T[]; columns: ColumnDef<T, any>[]; filters?: Filter[]; // eslint-disable-line @typescript-eslint/no-explicit-any
  searchPlaceholder?: string; pageSize?: number; empty?: string; toolbar?: React.ReactNode;
}) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [global, setGlobal] = useState('');
  const [colFilters, setColFilters] = useState<Record<string, string>>({});

  // Must be referentially stable: a new array each render makes the table reset its page, re-render, repeat.
  const columnFilters = useMemo(
    () => Object.entries(colFilters).filter(([, v]) => v).map(([id, value]) => ({ id, value })),
    [colFilters],
  );
  const table = useReactTable({
    data, columns,
    state: { sorting, globalFilter: global, columnFilters },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobal,
    globalFilterFn: 'includesString',
    defaultColumn,
    initialState: { pagination: { pageSize } },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    autoResetPageIndex: true,
  });

  const options = useMemo(() => Object.fromEntries(filters.map((f) => [
    f.id, [...new Set(data.map((r) => String((r as Record<string, unknown>)[f.id] ?? '')).filter(Boolean))].sort(),
  ])), [data, filters]);

  const rows = table.getRowModel().rows;
  const total = table.getFilteredRowModel().rows.length;
  const { pageIndex, pageSize: size } = table.getState().pagination;

  return (
    <div>
      <div className="toolbar">
        <input type="search" value={global} onChange={(e) => setGlobal(e.target.value)}
          placeholder={searchPlaceholder} aria-label="Search" />
        {filters.map((f) => (
          <select key={f.id} aria-label={f.label} value={colFilters[f.id] ?? ''}
            onChange={(e) => setColFilters((c) => ({ ...c, [f.id]: e.target.value }))}>
            <option value="">{f.label}: all</option>
            {options[f.id].map((o) => <option key={o}>{o}</option>)}
          </select>
        ))}
        <span className="sp" />{toolbar}
      </div>
      <div className="tablewrap">
        <table>
          <thead>{table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>{hg.headers.map((h) => {
              const sortable = h.column.getCanSort();
              const dir = h.column.getIsSorted();
              return (
                <th key={h.id} className={(h.column.columnDef.meta as { n?: boolean } | undefined)?.n ? 'n' : ''}
                  aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}>
                  {sortable ? (
                    <button type="button" className="th" onClick={h.column.getToggleSortingHandler()}>
                      {flexRender(h.column.columnDef.header, h.getContext())}
                      <span aria-hidden>{dir === 'asc' ? ' ▲' : dir === 'desc' ? ' ▼' : ' ↕'}</span>
                    </button>
                  ) : flexRender(h.column.columnDef.header, h.getContext())}
                </th>);
            })}</tr>))}
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={columns.length} className="empty">{empty}</td></tr>}
            {rows.map((r) => (
              <tr key={r.id}>{r.getVisibleCells().map((c) => (
                <td key={c.id} className={(c.column.columnDef.meta as { n?: boolean } | undefined)?.n ? 'n' : ''}>
                  {flexRender(c.column.columnDef.cell, c.getContext())}</td>))}</tr>))}
          </tbody>
        </table>
      </div>
      <div className="pager">
        <span>{total === 0 ? '0 results' : `${pageIndex * size + 1}–${Math.min(total, (pageIndex + 1) * size)} of ${total}`}</span>
        <span className="sp" />
        <button type="button" className="sec" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}>Previous</button>
        <button type="button" className="sec" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>Next</button>
      </div>
    </div>
  );
}
