import './globals.css';
export const metadata = { title: 'PeopleFlow HR', description: 'HR, leave and payroll' };
export default function Root({ children }: { children: React.ReactNode }) {
  return (<html lang="en"><body>{children}</body></html>);
}
