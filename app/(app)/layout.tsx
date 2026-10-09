import Link from 'next/link';
import { requireUser } from '@/lib/auth';
import { logout } from '../actions';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  return (
    <>
      <nav>
        <b>PeopleFlow HR</b>
        <Link href="/">Dashboard</Link>
        {u.role !== 'employee' && <Link href="/employees">Employees</Link>}
        <Link href="/leave">Leave</Link>
        <Link href="/payslips">My payslips</Link>
        {u.role === 'admin' && <Link href="/payroll">Payroll</Link>}
        {u.role === 'admin' && <Link href="/settings">Settings</Link>}
        <span className="sp" />
        <span>{u.name} · {u.role}</span>
        <form action={logout}><button className="sec">Sign out</button></form>
      </nav>
      <main>{children}</main>
    </>
  );
}
