import { requireUser } from '@/lib/auth';
import { NavLinks } from '@/components/nav-links';
import { ToastProvider } from '@/components/toast';
import { logout } from '../actions';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  const links = [
    { href: '/', label: 'Dashboard' },
    ...(u.role !== 'employee' ? [{ href: '/employees', label: 'Employees' }] : []),
    { href: '/leave', label: 'Leave' },
    { href: '/payslips', label: 'My payslips' },
    ...(u.role === 'admin' ? [{ href: '/payroll', label: 'Payroll' }, { href: '/settings', label: 'Settings' }] : []),
  ];
  return (
    <ToastProvider>
      <div className="shell">
        <aside className="side">
          <div className="brand">PeopleFlow HR</div>
          <NavLinks links={links} />
          <div className="who">{u.name}<br />{u.role}
            <form action={logout} style={{ marginTop: 8 }}><button className="sec">Sign out</button></form></div>
        </aside>
        <main className="content">{children}</main>
      </div>
    </ToastProvider>
  );
}
