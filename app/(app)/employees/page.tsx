import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { kes } from '@/lib/format';
import { addEmployee, updateEmployee } from '../../actions';

type Emp = { id: number; first_name: string; last_name: string; email: string; department: string;
  job_title: string; manager_id: number | null; monthly_salary: number; status: string; hire_date: string };

export default async function Employees() {
  const u = await requireUser(['admin', 'manager']);
  const all = db().prepare('SELECT * FROM employees ORDER BY last_name, first_name').all() as Emp[];
  // Managers see themselves and their direct reports; salary is admin-only.
  const list = u.role === 'admin' ? all : all.filter((e) => e.id === u.employeeId || e.manager_id === u.employeeId);
  const admin = u.role === 'admin';
  return (
    <>
      <h1>Employees</h1>
      <div className="card">
        <table>
          <thead><tr><th>Name</th><th>Department</th><th>Title</th><th>Hired</th>{admin && <th className="n">Monthly salary</th>}<th>Status</th></tr></thead>
          <tbody>{list.map((e) => (
            <tr key={e.id}><td>{e.first_name} {e.last_name}<br /><small>{e.email}</small></td><td>{e.department}</td>
              <td>{e.job_title}</td><td>{e.hire_date}</td>{admin && <td className="n">{kes(e.monthly_salary)}</td>}
              <td><span className={`tag ${e.status}`}>{e.status}</span></td></tr>))}</tbody>
        </table>
      </div>
      {admin && (<>
        <div className="card"><h2>Add employee</h2>
          <form action={addEmployee} className="row">
            <label>First name<input name="first_name" required /></label>
            <label>Last name<input name="last_name" required /></label>
            <label>Email<input name="email" type="email" required /></label>
            <label>Department<input name="department" /></label>
            <label>Job title<input name="job_title" /></label>
            <label>Hire date<input name="hire_date" type="date" required /></label>
            <label>Monthly salary (KES)<input name="monthly_salary" type="number" min="0" step="0.01" required /></label>
            <label>Manager<select name="manager_id"><option value="">—</option>
              {all.map((m) => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}</select></label>
            <label>Role<select name="role"><option>employee</option><option>manager</option><option>admin</option></select></label>
            <label>Initial password (8+)<input name="password" type="password" minLength={8} required /></label>
            <button>Add</button>
          </form></div>
        <div className="card"><h2>Edit employee</h2>
          {all.map((e) => (
            <form key={e.id} action={updateEmployee} className="row" style={{ marginBottom: 8 }}>
              <input type="hidden" name="id" value={e.id} />
              <span style={{ width: 150 }}>{e.first_name} {e.last_name}</span>
              <input name="department" defaultValue={e.department} aria-label="Department" />
              <input name="job_title" defaultValue={e.job_title} aria-label="Job title" />
              <input name="monthly_salary" type="number" step="0.01" defaultValue={e.monthly_salary} aria-label="Salary" style={{ width: 120 }} />
              <select name="manager_id" defaultValue={e.manager_id ?? ''} aria-label="Manager"><option value="">—</option>
                {all.filter((m) => m.id !== e.id).map((m) => <option key={m.id} value={m.id}>{m.first_name} {m.last_name}</option>)}</select>
              <select name="status" defaultValue={e.status}><option>active</option><option>inactive</option></select>
              <button className="sec">Save</button>
            </form>))}
        </div></>)}
    </>
  );
}
