import type { DB } from './db';
import { hashPassword } from './auth';

/**
 * Kenya defaults (KES). These are editable in Settings; verify against current KRA /
 * NSSF / SHA guidance before running real payroll:
 *  - PAYE (monthly bands): 10% to 24,000; 25% to 32,333; 30% to 500,000; 32.5% to 800,000; 35% above
 *  - Personal relief: KES 2,400/month
 *  - NSSF: 6% of pay, capped at KES 6,480 (upper earnings limit 108,000)
 *  - SHIF: 2.75% of gross, minimum KES 300
 *  - Affordable Housing Levy: 1.5% of gross
 * NSSF, SHIF and the Housing Levy are deductible before PAYE.
 */
export function seed(db: DB) {
  if ((db.prepare('SELECT COUNT(*) c FROM employees').get() as { c: number }).c > 0) return;

  const emp = db.prepare(
    `INSERT INTO employees (first_name,last_name,email,department,job_title,manager_id,hire_date,monthly_salary)
     VALUES (?,?,?,?,?,?,?,?)`,
  );
  const user = db.prepare('INSERT INTO users (email,password_hash,role,employee_id) VALUES (?,?,?,?)');

  const admin = Number(emp.run('Wanjiru', 'Kamau', 'admin@example.com', 'HR', 'HR Director', null, '2020-01-06', 250000).lastInsertRowid);
  const mgr = Number(emp.run('Otieno', 'Odhiambo', 'manager@example.com', 'Engineering', 'Engineering Manager', admin, '2021-03-01', 180000).lastInsertRowid);
  const e1 = Number(emp.run('Amina', 'Hassan', 'amina@example.com', 'Engineering', 'Software Engineer', mgr, '2022-07-11', 120000).lastInsertRowid);
  const e2 = Number(emp.run('Brian', 'Mutua', 'brian@example.com', 'Engineering', 'QA Analyst', mgr, '2023-02-20', 65000).lastInsertRowid);
  user.run('admin@example.com', hashPassword('admin123'), 'admin', admin);
  user.run('manager@example.com', hashPassword('manager123'), 'manager', mgr);
  user.run('amina@example.com', hashPassword('employee123'), 'employee', e1);
  user.run('brian@example.com', hashPassword('employee123'), 'employee', e2);

  const lt = db.prepare('INSERT INTO leave_types (name, days_per_year) VALUES (?,?)');
  lt.run('Annual', 21); lt.run('Sick', 30); lt.run('Maternity', 90); lt.run('Paternity', 14); lt.run('Compassionate', 5);

  const pc = db.prepare(
    'INSERT INTO pay_components (name,kind,calc,value,taxable,min_amount,max_amount) VALUES (?,?,?,?,?,?,?)',
  );
  pc.run('House allowance', 'allowance', 'percent', 15, 1, null, null);
  pc.run('NSSF', 'deduction', 'percent', 6, 1, null, 6480);
  pc.run('SHIF', 'deduction', 'percent', 2.75, 1, 300, null);
  pc.run('Affordable Housing Levy', 'deduction', 'percent', 1.5, 1, null, null);

  const tb = db.prepare('INSERT INTO tax_brackets (upper_limit, rate) VALUES (?,?)');
  tb.run(288000, 10); tb.run(388000, 25); tb.run(6000000, 30); tb.run(9600000, 32.5); tb.run(null, 35);

  db.prepare("INSERT INTO settings (key,value) VALUES ('currency','KES'), ('monthly_relief','2400')").run();

  // Recruitment sample: one open role with candidates spread across the pipeline.
  const job = Number(db.prepare("INSERT INTO jobs (title,department,location,description) VALUES (?,?,?,?)")
    .run('Senior Backend Engineer', 'Engineering', 'Nairobi', 'Own our payroll and HR services.').lastInsertRowid);
  const cand = db.prepare('INSERT INTO candidates (job_id,name,email,stage,notes) VALUES (?,?,?,?,?)');
  cand.run(job, 'Faith Wambui', 'faith@example.com', 'interview', 'Strong systems background.');
  cand.run(job, 'Kevin Otieno', 'kevin@example.com', 'screening', '');
  cand.run(job, 'Mary Achieng', 'mary@example.com', 'applied', '');

  // Performance sample: an open cycle with a couple of goals.
  const cycle = Number(db.prepare("INSERT INTO review_cycles (name,start_date,end_date) VALUES ('H2 2026','2026-07-01','2026-12-31')").run().lastInsertRowid);
  const rv = db.prepare('INSERT INTO reviews (cycle_id, employee_id) VALUES (?,?)');
  [admin, mgr, e1, e2].forEach((id) => rv.run(cycle, id));
  const goal = db.prepare('INSERT INTO goals (employee_id,cycle_id,title,description,progress) VALUES (?,?,?,?,?)');
  goal.run(e1, cycle, 'Ship the payroll export service', 'Production ready with monitoring', 60);
  goal.run(e1, cycle, 'Mentor a junior engineer', '', 25);
}
