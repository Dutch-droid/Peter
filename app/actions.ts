'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { db } from '@/lib/db';
import { createSession, destroySession, hashPassword, requireUser, verifyPassword } from '@/lib/auth';
import { businessDays, leaveUsed } from '@/lib/leave';
import { computePayslip, type Bracket, type Component } from '@/lib/payroll';
import {
  bracketsSchema, componentSchema, employeeSchema, employeeUpdateSchema, leaveRequestSchema,
  leaveTypeSchema, periodSchema,
} from '@/lib/schemas';
import type { z } from 'zod';

export type Result<T = undefined> = { ok: true; message?: string; data?: T } | { ok: false; error: string };
const ok = <T,>(message?: string, data?: T): Result<T> => ({ ok: true, message, data });
const fail = (error: string): Result<never> => ({ ok: false, error });
const bad = (e: z.ZodError) => fail(e.issues[0]?.message ?? 'Invalid input');
const dbError = (e: unknown, dup: string) =>
  fail(/UNIQUE/i.test(String(e)) ? dup : 'Could not save. Please try again.');

/* ---------- Auth ---------- */

export async function login(_: unknown, f: FormData) {
  const row = db().prepare('SELECT id, password_hash FROM users WHERE email = ?')
    .get(String(f.get('email') ?? '').trim().toLowerCase()) as { id: number; password_hash: string } | undefined;
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

export async function addEmployee(input: unknown): Promise<Result> {
  await requireUser(['admin']);
  const p = employeeSchema.safeParse(input);
  if (!p.success) return bad(p.error);
  const v = p.data;
  const d = db();
  try {
    d.transaction(() => {
      const id = Number(d.prepare(
        `INSERT INTO employees (first_name,last_name,email,department,job_title,manager_id,hire_date,monthly_salary)
         VALUES (?,?,?,?,?,?,?,?)`,
      ).run(v.first_name, v.last_name, v.email, v.department, v.job_title, v.manager_id, v.hire_date, v.monthly_salary).lastInsertRowid);
      d.prepare('INSERT INTO users (email,password_hash,role,employee_id) VALUES (?,?,?,?)')
        .run(v.email, hashPassword(v.password), v.role, id);
    })();
  } catch (e) {
    return dbError(e, 'An employee with that email already exists');
  }
  revalidatePath('/employees');
  revalidatePath('/');
  return ok(`${v.first_name} ${v.last_name} added`);
}

export async function updateEmployee(input: unknown): Promise<Result> {
  await requireUser(['admin']);
  const p = employeeUpdateSchema.safeParse(input);
  if (!p.success) return bad(p.error);
  const v = p.data;
  if (v.manager_id === v.id) return fail('An employee cannot be their own manager');
  try {
    db().prepare('UPDATE employees SET department=?, job_title=?, manager_id=?, monthly_salary=?, status=? WHERE id=?')
      .run(v.department, v.job_title, v.manager_id, v.monthly_salary, v.status, v.id);
  } catch (e) {
    return dbError(e, 'Could not save');
  }
  revalidatePath('/employees');
  return ok('Employee updated');
}

/* ---------- Leave ---------- */

export async function requestLeave(input: unknown): Promise<Result> {
  const u = await requireUser();
  const p = leaveRequestSchema.safeParse(input);
  if (!p.success) return bad(p.error);
  const v = p.data;
  const d = db();
  const type = d.prepare('SELECT days_per_year FROM leave_types WHERE id=?').get(v.leave_type_id) as
    { days_per_year: number } | undefined;
  if (!type) return fail('Unknown leave type');
  const days = businessDays(v.start_date, v.end_date);
  const left = type.days_per_year - leaveUsed(u.employeeId, v.leave_type_id, Number(v.start_date.slice(0, 4)));
  if (days > left) return fail(`You only have ${Math.max(left, 0)} day(s) left of this leave type`);
  const overlap = d.prepare(
    `SELECT 1 FROM leave_requests WHERE employee_id=? AND status IN ('pending','approved')
     AND start_date <= ? AND end_date >= ?`,
  ).get(u.employeeId, v.end_date, v.start_date);
  if (overlap) return fail('These dates overlap another pending or approved request');
  d.prepare(`INSERT INTO leave_requests (employee_id,leave_type_id,start_date,end_date,days,reason)
             VALUES (?,?,?,?,?,?)`).run(u.employeeId, v.leave_type_id, v.start_date, v.end_date, days, v.reason);
  revalidatePath('/leave');
  return ok(`Leave requested (${days} working day${days === 1 ? '' : 's'})`);
}

export async function decideLeave(id: number, decision: 'approve' | 'reject'): Promise<Result> {
  const u = await requireUser(['admin', 'manager']);
  if (decision !== 'approve' && decision !== 'reject') return fail('Invalid decision');
  const req = db().prepare(
    `SELECT r.employee_id, e.manager_id FROM leave_requests r JOIN employees e ON e.id=r.employee_id
     WHERE r.id=? AND r.status='pending'`,
  ).get(id) as { employee_id: number; manager_id: number | null } | undefined;
  if (!req) return fail('That request is no longer pending');
  if (req.employee_id === u.employeeId) return fail('You cannot decide your own leave');
  if (u.role === 'manager' && req.manager_id !== u.employeeId) return fail('Not one of your direct reports');
  db().prepare('UPDATE leave_requests SET status=?, decided_by=? WHERE id=?')
    .run(decision === 'approve' ? 'approved' : 'rejected', u.employeeId, id);
  revalidatePath('/leave');
  return ok(decision === 'approve' ? 'Leave approved' : 'Leave rejected');
}

export async function cancelLeave(id: number): Promise<Result> {
  const u = await requireUser();
  const r = db().prepare(`UPDATE leave_requests SET status='cancelled' WHERE id=? AND employee_id=? AND status='pending'`)
    .run(id, u.employeeId);
  if (!r.changes) return fail('Only your own pending requests can be cancelled');
  revalidatePath('/leave');
  return ok('Request cancelled');
}

/* ---------- Payroll ---------- */

export async function createPayrollRun(input: unknown): Promise<Result<{ id: number }>> {
  await requireUser(['admin']);
  const p = periodSchema.safeParse(input);
  if (!p.success) return bad(p.error);
  const { period } = p.data;
  const d = db();
  if (d.prepare('SELECT 1 FROM payroll_runs WHERE period=?').get(period)) return fail(`A payroll run for ${period} already exists`);
  const comps = d.prepare('SELECT * FROM pay_components').all() as Component[];
  const brackets = d.prepare('SELECT upper_limit, rate FROM tax_brackets').all() as Bracket[];
  const relief = Number((d.prepare("SELECT value FROM settings WHERE key='monthly_relief'").get() as
    { value: string } | undefined)?.value ?? 0);
  const emps = d.prepare("SELECT id, monthly_salary FROM employees WHERE status='active'").all() as
    { id: number; monthly_salary: number }[];
  if (!emps.length) return fail('There are no active employees to pay');
  const id = d.transaction(() => {
    const rid = Number(d.prepare('INSERT INTO payroll_runs (period) VALUES (?)').run(period).lastInsertRowid);
    const ins = d.prepare(`INSERT INTO payslips (run_id,employee_id,base,gross,total_deductions,tax,net,detail)
                           VALUES (?,?,?,?,?,?,?,?)`);
    for (const e of emps) {
      const s = computePayslip(e.monthly_salary, comps, brackets, relief);
      ins.run(rid, e.id, s.base, s.gross, s.totalDeductions, s.tax, s.net, JSON.stringify(s));
    }
    return rid;
  })();
  revalidatePath('/payroll');
  revalidatePath('/');
  return ok(`Payroll for ${period} calculated for ${emps.length} employees`, { id });
}

export async function finalizeRun(id: number): Promise<Result> {
  await requireUser(['admin']);
  const r = db().prepare("UPDATE payroll_runs SET status='finalized' WHERE id=? AND status='draft'").run(id);
  if (!r.changes) return fail('Only draft runs can be finalized');
  revalidatePath('/payroll');
  revalidatePath(`/payroll/${id}`);
  revalidatePath('/');
  return ok('Payroll finalized. Payslips are now visible to employees.');
}

export async function deleteDraftRun(id: number): Promise<Result> {
  await requireUser(['admin']);
  const r = db().prepare("DELETE FROM payroll_runs WHERE id=? AND status='draft'").run(id);
  if (!r.changes) return fail('Only draft runs can be discarded');
  revalidatePath('/payroll');
  return ok('Draft discarded');
}

/* ---------- Settings (admin) ---------- */

export async function saveComponent(input: unknown): Promise<Result> {
  await requireUser(['admin']);
  const p = componentSchema.safeParse(input);
  if (!p.success) return bad(p.error);
  const v = p.data;
  db().prepare(
    `INSERT INTO pay_components (name,kind,calc,value,taxable,min_amount,max_amount) VALUES (?,?,?,?,?,?,?)
     ON CONFLICT(name) DO UPDATE SET kind=excluded.kind, calc=excluded.calc, value=excluded.value,
       taxable=excluded.taxable, min_amount=excluded.min_amount, max_amount=excluded.max_amount`,
  ).run(v.name, v.kind, v.calc, v.value, v.taxable ? 1 : 0, v.min_amount, v.max_amount);
  revalidatePath('/settings');
  return ok(`${v.name} saved. It applies to payroll runs created from now on.`);
}

export async function deleteComponent(id: number): Promise<Result> {
  await requireUser(['admin']);
  db().prepare('DELETE FROM pay_components WHERE id=?').run(id);
  revalidatePath('/settings');
  return ok('Removed');
}

export async function saveBrackets(input: unknown): Promise<Result> {
  await requireUser(['admin']);
  const p = bracketsSchema.safeParse(input);
  if (!p.success) return bad(p.error);
  const d = db();
  d.transaction(() => {
    d.prepare('DELETE FROM tax_brackets').run();
    const ins = d.prepare('INSERT INTO tax_brackets (upper_limit, rate) VALUES (?,?)');
    p.data.brackets.forEach((b) => ins.run(b.upper_limit, b.rate));
    d.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('monthly_relief', ?)")
      .run(String(p.data.monthly_relief));
    d.prepare("INSERT OR REPLACE INTO settings (key,value) VALUES ('rates_confirmed','1')").run();
  })();
  revalidatePath('/');
  revalidatePath('/settings');
  return ok('Tax settings saved. They apply to payroll runs created from now on.');
}

export async function saveLeaveType(input: unknown): Promise<Result> {
  await requireUser(['admin']);
  const p = leaveTypeSchema.safeParse(input);
  if (!p.success) return bad(p.error);
  db().prepare(`INSERT INTO leave_types (name,days_per_year) VALUES (?,?)
                ON CONFLICT(name) DO UPDATE SET days_per_year=excluded.days_per_year`)
    .run(p.data.name, p.data.days_per_year);
  revalidatePath('/settings');
  revalidatePath('/leave');
  return ok(`${p.data.name} saved`);
}
