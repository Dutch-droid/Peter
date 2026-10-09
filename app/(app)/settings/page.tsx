import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { deleteComponent, saveBrackets, saveComponent, saveLeaveType } from '../../actions';

type C = { id: number; name: string; kind: string; calc: string; value: number; taxable: number; min_amount: number | null; max_amount: number | null };

export default async function Settings() {
  await requireUser(['admin']);
  const d = db();
  const comps = d.prepare('SELECT * FROM pay_components ORDER BY kind, id').all() as C[];
  const brackets = d.prepare('SELECT * FROM tax_brackets ORDER BY upper_limit IS NULL, upper_limit').all() as { upper_limit: number | null; rate: number }[];
  const relief = (d.prepare("SELECT value FROM settings WHERE key='monthly_relief'").get() as { value: string } | undefined)?.value ?? '0';
  const types = d.prepare('SELECT * FROM leave_types ORDER BY id').all() as { id: number; name: string; days_per_year: number }[];
  return (
    <>
      <h1>Settings</h1>
      <p style={{ color: 'var(--mute)' }}>Defaults follow Kenya (KES). Confirm rates against current KRA, NSSF and SHA guidance before running real payroll.</p>
      <div className="card"><h2>PAYE tax bands (annual taxable income)</h2>
        <form action={saveBrackets} style={{ display: 'grid', gap: 8 }}>
          {[...brackets, { upper_limit: null, rate: NaN }].map((b, i) => (
            <div key={i} className="row">
              <label>Up to (blank = no limit)<input name="upper_limit" type="number" step="any" defaultValue={b.upper_limit ?? ''} /></label>
              <label>Rate %<input name="rate" type="number" step="any" defaultValue={Number.isNaN(b.rate) ? '' : b.rate} /></label>
            </div>))}
          <label style={{ maxWidth: 220 }}>Monthly personal relief (tax credit)<input name="monthly_relief" type="number" step="any" defaultValue={relief} /></label>
          <small>Blank-rate rows are ignored. Saving replaces all bands.</small>
          <div><button>Save tax settings</button></div>
        </form></div>
      <div className="card"><h2>Allowances &amp; deductions</h2>
        <table><thead><tr><th>Name</th><th>Kind</th><th>Calc</th><th className="n">Value</th><th>Taxable / pre-tax</th><th className="n">Min</th><th className="n">Max</th><th /></tr></thead>
          <tbody>{comps.map((c) => (<tr key={c.id}><td>{c.name}</td><td>{c.kind}</td><td>{c.calc}</td><td className="n">{c.value}</td>
            <td>{c.taxable ? 'yes' : 'no'}</td><td className="n">{c.min_amount ?? ''}</td><td className="n">{c.max_amount ?? ''}</td>
            <td><form action={deleteComponent}><input type="hidden" name="id" value={c.id} /><button className="sec">Delete</button></form></td></tr>))}</tbody></table>
        <h2 style={{ marginTop: 16 }}>Add or update (same name replaces)</h2>
        <form action={saveComponent} className="row">
          <label>Name<input name="name" required /></label>
          <label>Kind<select name="kind"><option>allowance</option><option>deduction</option></select></label>
          <label>Calc<select name="calc"><option value="percent">% (of base for allowances, gross for deductions)</option><option value="fixed">fixed KES</option></select></label>
          <label>Value<input name="value" type="number" step="any" required /></label>
          <label>Min<input name="min_amount" type="number" step="any" /></label>
          <label>Max<input name="max_amount" type="number" step="any" /></label>
          <label style={{ flexDirection: 'row', alignItems: 'center' }}><input type="checkbox" name="taxable" defaultChecked /> taxable / pre-tax</label>
          <button>Save</button>
        </form></div>
      <div className="card"><h2>Leave types</h2>
        {types.map((t) => <div key={t.id}>{t.name}: {t.days_per_year} days/year</div>)}
        <form action={saveLeaveType} className="row" style={{ marginTop: 12 }}>
          <label>Name<input name="name" required /></label>
          <label>Days per year<input name="days_per_year" type="number" min="0" required /></label>
          <button>Save</button></form></div>
    </>
  );
}
