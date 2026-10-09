import Link from 'next/link';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { kes } from '@/lib/format';

export default async function MyPayslips() {
  const u = await requireUser();
  const rows = db().prepare(
    `SELECT p.id, r.period, p.gross, p.net FROM payslips p JOIN payroll_runs r ON r.id=p.run_id
     WHERE p.employee_id=? AND r.status='finalized' ORDER BY r.period DESC`,
  ).all(u.employeeId) as { id: number; period: string; gross: number; net: number }[];
  return (
    <>
      <h1>My payslips</h1>
      <div className="card">{rows.length === 0 ? 'No payslips published yet.' : (<table>
        <thead><tr><th>Period</th><th className="n">Gross</th><th className="n">Net</th><th /></tr></thead>
        <tbody>{rows.map((r) => (<tr key={r.id}><td>{r.period}</td><td className="n">{kes(r.gross)}</td><td className="n">{kes(r.net)}</td>
          <td><Link href={`/payslips/${r.id}`}>View</Link></td></tr>))}</tbody></table>)}</div>
    </>
  );
}
