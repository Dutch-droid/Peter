'use client';
import { useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';

/**
 * One filter row above the charts it scopes. While the server re-renders, the previous charts stay on
 * screen at reduced opacity (no skeleton, no layout jump).
 */
export function FilterScope({ years, year, children }: { years: number[]; year: number; children: React.ReactNode }) {
  const router = useRouter();
  const path = usePathname();
  const [pending, start] = useTransition();
  return (
    <>
      <div className="filterrow" role="group" aria-label="Chart filters">
        <label>Year
          <select value={year} onChange={(e) => start(() => router.push(`${path}?y=${e.target.value}`, { scroll: false }))}>
            {years.map((y) => <option key={y}>{y}</option>)}</select></label>
        <span className="hint">Payroll and leave charts show the selected year. Headcount and hiring are as of today.</span>
        {pending && <span className="hint" role="status">Updating…</span>}
      </div>
      <div className={pending ? 'viz-dim' : undefined} aria-busy={pending}>{children}</div>
    </>
  );
}
