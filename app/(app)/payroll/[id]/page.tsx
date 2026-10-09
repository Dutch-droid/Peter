import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { kes } from '@/lib/format';
import { deleteDraftRun, finalizeRun } from '../../../actions';

export default async function Run({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(['admin']);
  const { id } = await params;
  const run = db().prepare('SELECT * FROM payroll_runs WHERE id=?').get(Number(id)) as
    { id: number; period: string; status: string } | undefined;
  if (!run) notFound();
  const rows = db().prepare(
    `SELECT p.id, e.first_name || ' ' || e.last_name name, p.gross, p.total_deductions ded, p.tax, p.net
     FROM payslips p JOIN employees e ON e.id=p.employee_id WHERE p.run_id=? ORDER BY e.last_name`,
  ).all(run.id) as { id: number; name: string; gross: number; ded: number; tax: number; net: number }[];
  const sum = (k: 'gross' | 'ded' | 'tax' | 'net') => rows.reduce((s, r) => s + r[k], 0);
  return (
    <>
      <h1>Payroll {run.period} <span className={`tag ${run.status}`}>{run.status}</span></h1>
      <div className="card"><table>
        <thead><tr><th>Employee</th><th className="n">Gross</th><th className="n">Statutory/other deductions</th><th className="n">PAYE</th><th className="n">Net</th><th /></tr></thead>
        <tbody>{rows.map((r) => (<tr key={r.id}><td>{r.name}</td><td className="n">{kes(r.gross)}</td><td className="n">{kes(r.ded)}</td>
          <td className="n">{kes(r.tax)}</td><td className="n">{kes(r.net)}</td><td><Link href={`/payslips/${r.id}`}>Payslip</Link></td></tr>))}
          <tr><th>Total</th><th className="n">{kes(sum('gross'))}</th><th className="n">{kes(sum('ded'))}</th><th className="n">{kes(sum('tax'))}</th><th className="n">{kes(sum('net'))}</th><th /></tr></tbody></table></div>
      {run.status === 'draft' && (
        <div className="row" style={{ display: 'flex', gap: 8 }}>
          <form action={finalizeRun}><input type="hidden" name="id" value={run.id} /><button>Finalize &amp; publish payslips</button></form>
          <form action={deleteDraftRun}><input type="hidden" name="id" value={run.id} /><button className="bad">Discard draft</button></form>
        </div>)}
    </>
  );
}
