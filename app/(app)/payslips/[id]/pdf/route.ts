import { currentUser } from '@/lib/auth';
import { db } from '@/lib/db';
import { buildPayslipPdf } from '@/lib/payslip-pdf';
import type { PayslipResult } from '@/lib/payroll';

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await currentUser();
  if (!u) return new Response('Unauthorized', { status: 401 });
  const { id } = await params;
  const row = db().prepare(
    `SELECT p.detail, p.employee_id, r.period, r.status, e.first_name || ' ' || e.last_name AS name,
            e.job_title, e.department
     FROM payslips p JOIN payroll_runs r ON r.id=p.run_id JOIN employees e ON e.id=p.employee_id WHERE p.id=?`,
  ).get(Number(id)) as { detail: string; employee_id: number; period: string; status: string; name: string; job_title: string; department: string } | undefined;
  // Same rule as the on-screen payslip: employees only get their own published payslips.
  if (!row || (u.role !== 'admin' && (row.employee_id !== u.employeeId || row.status !== 'finalized'))) {
    return new Response('Not found', { status: 404 });
  }
  const bytes = await buildPayslipPdf({
    company: 'PeopleFlow HR', name: row.name, jobTitle: row.job_title, department: row.department,
    period: row.period, draft: row.status !== 'finalized', slip: JSON.parse(row.detail) as PayslipResult,
  });
  return new Response(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="payslip-${row.period}-${row.name.replace(/[^\w]+/g, '_')}.pdf"`,
      'Cache-Control': 'no-store',
    },
  });
}
