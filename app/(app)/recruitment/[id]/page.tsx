import { notFound } from 'next/navigation';
import Link from 'next/link';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { BoardClient, type Cand } from './board-client';

export default async function Pipeline({ params }: { params: Promise<{ id: string }> }) {
  await requireUser(['admin']);
  const { id } = await params;
  const job = db().prepare('SELECT id, title, department, location, description, status FROM jobs WHERE id=?').get(Number(id)) as
    { id: number; title: string; department: string; location: string; description: string; status: string } | undefined;
  if (!job) notFound();
  const cands = db().prepare('SELECT id, job_id, name, email, phone, stage, notes, employee_id, created_at FROM candidates WHERE job_id=? ORDER BY created_at, id').all(job.id) as Cand[];
  const managers = db().prepare("SELECT id, first_name || ' ' || last_name AS name, department FROM employees WHERE status='active' ORDER BY first_name").all() as { id: number; name: string; department: string }[];
  return (
    <>
      <p style={{ margin: 0 }}><Link href="/recruitment">← All jobs</Link></p>
      <BoardClient job={job} initial={cands} managers={managers} />
    </>
  );
}
