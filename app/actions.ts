'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import {
  createSession, destroySession, hashPassword, requireUser, verifyPassword,
} from '@/lib/auth';
import { businessDays, leaveUsed } from '@/lib/leave';
import { computePayslip, type Bracket, type Component } from '@/lib/payroll';

const str = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const num = (f: FormData, k: string) => Number(f.get(k));

export async function login(_: unknown, f: FormData) {
  const row = db().prepare('SELECT id, password_hash FROM users WHERE email = ?')
    .get(str(f, 'email').toLowerCase()) as { id: number; password_hash: string } | undefined;
  if (!row || !verifyPassword(String(f.get('password') ?? ''), row.password_hash)) {
    return { error: 'Invalid email or password' };
  }
  await createSession(row.id);
  redirect('/');
}

export async function logout() {
  await destroySession();
  redirect('/login');
}

/* ---------- Employees (admin) ---------- */

export async function addEmployee(f: FormData) {
  await requireUser(['admin']);
  const email = str(f, 'email').toLowerCase();
  const password = str(f, 'password');
  const role = str(f, 'role');
  if (!email || password.length < 8 || !['admin', 'manager', 'employee'].includes(role)) return;
  const d = db();
  d.transaction(() => {
    const id = Number(d.prepare(
      `INSERT INTO employees (first_name,last_name,email,department,job_title,manager_id,hire_date,monthly_salary)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(str(f, 'first_name'), str(f, 'last_name'), email, str(f, 'department'), str(f, 'job_title'),
      num(f, 'manager_id') || null, str(f, 'hire_date'), num(f, 'monthly_salary') || 0).lastInsertRowid);
    d.prepare('INSERT INTO users (email,password_hash,role,employee_id) VALUES (?,?,?,?)')
      .run(email, hashPassword(password), role, id);
  })();
  revalidatePath('/employees');
}

export async function updateEmployee(f: FormData) {
  await requireUser(['admin']);
  db().prepare(
    `UPDATE employees SET department=?, job_title=?, manager_id=?, monthly_salary=?, status=? WHERE id=?`,
  ).run(str(f, 'department'), str(f, 'job_title'), num(f, 'manager_id') || null,
    num(f, 'monthly_salary') || 0, str(f, 'status') === 'inactive' ? 'inactive' : 'active', num(f, 'id'));
  revalidatePath('/employees');
}

/* ---------- Leave ---------- */

export async function requestLeave(f: FormData) {
  const u = await requireUser();
  const start = str(f, 'start_date'), end = str(f, 'end_date');
  const days = businessDays(start, end);
  const typeId = num(f, 'leave_type_id');
  if (days < 1) return;
  const d = db();
  const type = d.prepare('SELECT days_per_year FROM leave_types WHERE id=?').get(typeId) as
    { days_per_year: number } | undefined;
  if (!type) return;
  const used = leaveUsed(u.employeeId, typeId, new Date().getFullYear());
  if (used + days > type.days_per_year) return; // insufficient balance
  d.prepare(`INSERT INTO leave_requests (employee_id,leave_type_id,start_date,end_date,days,reason)
             VALUES (?,?,?,?,?,?)`).run(u.employeeId, typeId, start, end, days, str(f, 'reason'));
  revalidatePath('/leave');
}

export async function decideLeave(f: FormData) {
  const u = await requireUser(['admin', 'manager']);
  const id = num(f, 'id');
  const d = str(f, 'decision');
  if (d !== 'approve' && d !== 'reject') return; // never default to a decision
  const decision = d === 'approve' ? 'approved' : 'rejected';
  const req = db().prepare(
    `SELECT r.employee_id, e.manager_id FROM leave_requests r JOIN employees e ON e.id=r.employee_id
     WHERE r.id=? AND r.status='pending'`,
  ).get(id) as { employee_id: number; manager_id: number | null } | undefined;
  if (!req || req.employee_id === u.employeeId) return; // nobody approves their own leave
  if (u.role === 'manager' && req.manager_id !== u.employeeId) return;
  db().prepare('UPDATE leave_requests SET status=?, decided_by=? WHERE id=?').run(decision, u.employeeId, id);
  revalidatePath('/leave');
}

export async function cancelLeave(f: FormData) {
  const u = await requireUser();
  db().prepare(`UPDATE leave_requests SET status='cancelled' WHERE id=? AND employee_id=? AND status='pending'`)
    .run(num(f, 'id'), u.employeeId);
  revalidatePath('/leave');
}

/* ---------- Payroll ---------- */

export async function createPayrollRun(f: FormData) {
  await requireUser(['admin']);
  const period = str(f, 'period');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return;
  const d = db();
  if (d.prepare('SELECT 1 FROM payroll_runs WHERE period=?').get(period)) return;
  const comps = d.prepare('SELECT * FROM pay_components').all() as Component[];
  const brackets = d.prepare('SELECT upper_limit, rate FROM tax_brackets').all() as Bracket[];
  const relief = Number((d.prepare("SELECT value FROM settings WHERE key='monthly_relief'").get() as
    { value: string } | undefined)?.value ?? 0);
  const emps = d.prepare("SELECT id, monthly_salary FROM employees WHERE status='active'").all() as
    { id: number; monthly_salary: number }[];
  const runId = d.transaction(() => {
    const id = Number(d.prepare('INSERT INTO payroll_runs (period) VALUES (?)').run(period).lastInsertRowid);
    const ins = d.prepare(`INSERT INTO payslips (run_id,employee_id,base,gross,total_deductions,tax,net,detail)
                           VALUES (?,?,?,?,?,?,?,?)`);
    for (const e of emps) {
      const p = computePayslip(e.monthly_salary, comps, brackets, relief);
      ins.run(id, e.id, p.base, p.gross, p.totalDeductions, p.tax, p.net, JSON.stringify(p));
    }
    return id;
  })();
  redirect(`/payroll/${runId}`);
}

export async function finalizeRun(f: FormData) {
  await requireUser(['admin']);
  db().prepare("UPDATE payroll_runs SET status='finalized' WHERE id=? AND status='draft'").run(num(f, 'id'));
  revalidatePath('/payroll');
}

export async function deleteDraftRun(f: FormData) {
  await requireUser(['admin']);
  db().prepare("DELETE FROM payroll_runs WHERE id=? AND status='draft'").run(num(f, 'id'));
  redirect('/payroll');
}

/* ---------- Settings (admin) ---------- */

export async function saveComponent(f: FormData) {
  await requireUser(['admin']);
  const kind = str(f, 'kind') === 'deduction' ? 'deduction' : 'allowance';
  const calc = str(f, 'calc') === 'fixed' ? 'fixed' : 'percent';
  const opt = (k: string) => (str(f, k) === '' ? null : num(f, k));
  db().prepare(`INSERT OR REPLACE INTO pay_components (name,kind,calc,value,taxable,min_amount,max_amount)
                VALUES (?,?,?,?,?,?,?)`)
    .run(str(f, 'name'), kind, calc, num(f, 'value') || 0, f.get('taxable') ? 1 : 0, opt('min_amount'), opt('max_amount'));
  revalidatePath('/settings');
}

export async function deleteComponent(f: FormData) {
  await requireUser(['admin']);
  db().prepare('DELETE FROM pay_components WHERE id=?').run(num(f, 'id'));
  revalidatePath('/settings');
}

export async function saveBrackets(f: FormData) {
  await requireUser(['admin']);
  const limits = f.getAll('upper_limit').map(String);
  const rates = f.getAll('rate').map(Number);
  const rows = rates.map((rate, i) => ({ rate, upper: limits[i].trim() === '' ? null : Number(limits[i]) }))
    .filter((r) => Number.isFinite(r.rate) && (r.upper === null || Number.isFinite(r.upper)));
  const d = db();
  d.transaction(() => {
    d.prepare('DELETE FROM tax_brackets').run();
    const ins = d.prepare('INSERT INTO tax_brackets (upper_limit, rate) VALUES (?,?)');
    rows.forEach((r) => ins.run(r.upper, r.rate));
    d.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('monthly_relief', ?)")
      .run(String(num(f, 'monthly_relief') || 0));
  })();
  revalidatePath('/settings');
}

export async function saveLeaveType(f: FormData) {
  await requireUser(['admin']);
  db().prepare(`INSERT INTO leave_types (name,days_per_year) VALUES (?,?)
                ON CONFLICT(name) DO UPDATE SET days_per_year=excluded.days_per_year`)
    .run(str(f, 'name'), num(f, 'days_per_year') || 0);
  revalidatePath('/settings');
}
