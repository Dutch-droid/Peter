import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { JobsClient, type JobRow } from './jobs-client';

export default async function Recruitment() {
  await requireUser(['admin']);
  const rows = db().prepare(
    `SELECT j.id, j.title, j.department, j.location, j.description, j.status, j.created_at,
            COUNT(c.id) AS total,
            COALESCE(SUM(c.stage NOT IN ('hired','rejected')), 0) AS active,
            COALESCE(SUM(c.stage='hired'), 0) AS hired
     FROM jobs j LEFT JOIN candidates c ON c.job_id=j.id GROUP BY j.id ORDER BY j.status, j.created_at DESC`,
  ).all() as JobRow[];
  return <JobsClient rows={rows} />;
}
