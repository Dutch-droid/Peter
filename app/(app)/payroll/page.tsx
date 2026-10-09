import Link from 'next/link';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { kes } from '@/lib/format';
import { createPayrollRun } from '../../actions';

export default async function Payroll() {
  await requireUser(['admin']);
  const runs = db().prepare(
    `SELECT r.id, r.period, r.status, COUNT(p.id) n, COALESCE(SUM(p.gross),0) gross, COALESCE(SUM(p.net),0) net
     FROM payroll_runs r LEFT JOIN payslips p ON p.run_id=r.id GROUP BY r.id ORDER BY r.period DESC`,
  ).all() as { id: number; period: string; status: string; n: number; gross: number; net: number }[];
  return (
    <>
      <h1>Payroll</h1>
      <div className="card"><h2>New run</h2>
        <form action={createPayrollRun} className="row">
          <label>Month<input type="month" name="period" required /></label>
          <button>Calculate payroll</button>
        </form>
        <small>Calculates a draft payslip for every active employee using the rules in Settings.</small></div>
      <div className="card"><table>
        <thead><tr><th>Period</th><th>Status</th><th className="n">Employees</th><th className="n">Gross</th><th className="n">Net</th><th /></tr></thead>
        <tbody>{runs.map((r) => (<tr key={r.id}><td>{r.period}</td><td><span className={`tag ${r.status}`}>{r.status}</span></td>
          <td className="n">{r.n}</td><td className="n">{kes(r.gross)}</td><td className="n">{kes(r.net)}</td>
          <td><Link href={`/payroll/${r.id}`}>Open</Link></td></tr>))}</tbody></table></div>
    </>
  );
}
