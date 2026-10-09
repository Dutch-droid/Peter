import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { SettingsClient, type Comp, type LeaveTypeRow } from './settings-client';

export default async function Settings() {
  await requireUser(['admin']);
  const d = db();
  const comps = d.prepare('SELECT * FROM pay_components ORDER BY kind, id').all() as Comp[];
  const brackets = d.prepare('SELECT upper_limit, rate FROM tax_brackets ORDER BY upper_limit IS NULL, upper_limit').all() as { upper_limit: number | null; rate: number }[];
  const relief = Number((d.prepare("SELECT value FROM settings WHERE key='monthly_relief'").get() as { value: string } | undefined)?.value ?? 0);
  const types = d.prepare('SELECT * FROM leave_types ORDER BY id').all() as LeaveTypeRow[];
  const holidays = d.prepare('SELECT date, name FROM holidays ORDER BY date').all() as { date: string; name: string }[];
  return <SettingsClient comps={comps} brackets={brackets} relief={relief} types={types} holidays={holidays} />;
}
