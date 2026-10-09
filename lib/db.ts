import fs from 'node:fs';
import path from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  department TEXT NOT NULL DEFAULT '',
  job_title TEXT NOT NULL DEFAULT '',
  manager_id INTEGER REFERENCES employees(id),
  hire_date TEXT NOT NULL,
  monthly_salary REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive'))
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','manager','employee')),
  employee_id INTEGER NOT NULL REFERENCES employees(id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS leave_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  days_per_year INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  leave_type_id INTEGER NOT NULL REFERENCES leave_types(id),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  days INTEGER NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','cancelled')),
  decided_by INTEGER REFERENCES employees(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS pay_components (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL CHECK (kind IN ('allowance','deduction')),
  calc TEXT NOT NULL CHECK (calc IN ('percent','fixed')),
  value REAL NOT NULL,
  -- allowance: counts as taxable income. deduction: reduces taxable income (pre-tax).
  taxable INTEGER NOT NULL DEFAULT 1,
  -- optional floor/cap on the computed amount (e.g. NSSF cap, SHIF minimum)
  min_amount REAL,
  max_amount REAL
);
CREATE TABLE IF NOT EXISTS tax_brackets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  upper_limit REAL,          -- annual taxable income ceiling; NULL = no ceiling
  rate REAL NOT NULL         -- percent
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS payroll_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  period TEXT NOT NULL UNIQUE,   -- YYYY-MM
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','finalized')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS payslips (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  employee_id INTEGER NOT NULL REFERENCES employees(id),
  base REAL NOT NULL,
  gross REAL NOT NULL,
  total_deductions REAL NOT NULL,
  tax REAL NOT NULL,
  net REAL NOT NULL,
  detail TEXT NOT NULL,
  UNIQUE (run_id, employee_id)
);
`;

/* eslint-disable @typescript-eslint/no-explicit-any */
export type Stmt = {
  run(...p: any[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  get(...p: any[]): any;
  all(...p: any[]): any[];
};
export type DB = {
  prepare(sql: string): Stmt;
  exec(sql: string): void;
  /** Returns a function that runs `fn` inside a transaction (commit on return, rollback on throw). */
  transaction<T>(fn: () => T): () => T;
};

const g = globalThis as unknown as { __hrdb?: DB };

export function openDb(file: string): DB {
  // Node's built-in SQLite (Node 22.13+): no native compilation needed.
  const { DatabaseSync } = process.getBuiltinModule('node:sqlite') as typeof import('node:sqlite');
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const raw = new DatabaseSync(file);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  raw.exec(SCHEMA);
  return {
    prepare: (sql) => {
      const st = raw.prepare(sql);
      // node:sqlite rows have a null prototype; React won't pass those to client components.
      const plain = <T,>(r: T): T => (r && typeof r === 'object' ? ({ ...r } as T) : r);
      return {
        run: (...p) => st.run(...p),
        get: (...p) => plain(st.get(...p)),
        all: (...p) => st.all(...p).map(plain),
      };
    },
    exec: (sql) => raw.exec(sql),
    transaction: (fn) => () => {
      raw.exec('BEGIN');
      try {
        const out = fn();
        raw.exec('COMMIT');
        return out;
      } catch (e) {
        raw.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

export function db(): DB {
  return (g.__hrdb ??= openDb(process.env.HR_DB ?? path.join(process.cwd(), 'data', 'hr.db')));
}
