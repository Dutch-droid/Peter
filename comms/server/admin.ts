import { db, now } from './db.ts';
import { bad, forbidden, notFound, str } from './errors.ts';
import { publish } from './bus.ts';
import { createUser, generatePassword, getUser, toPublic, USER_COLS, type UserRow } from './auth.ts';

export function requireAdmin(user: UserRow) {
  if (user.role !== 'admin') throw forbidden('Admins only');
}

function allUserIds(): number[] {
  return (db().prepare('SELECT id FROM users WHERE disabled = 0').all() as { id: number }[]).map((r) => r.id);
}

type AnnRow = { id: number; author_id: number; severity: string; body: string; created_at: number; cleared_at: number | null };
function annView(a: AnnRow) {
  const u = getUser(a.author_id);
  return { id: a.id, severity: a.severity, body: a.body, createdAt: a.created_at, clearedAt: a.cleared_at, author: u ? u.name : 'Unknown' };
}

export function currentAnnouncement() {
  const a = db().prepare('SELECT * FROM announcements WHERE cleared_at IS NULL ORDER BY id DESC LIMIT 1').get() as AnnRow | undefined;
  return a ? annView(a) : null;
}

export function announcementHistory() {
  return (db().prepare('SELECT * FROM announcements ORDER BY id DESC LIMIT 50').all() as AnnRow[]).map(annView);
}

/** Posting replaces any current banner. Everyone online gets it immediately (and a desktop notification). */
export function announce(authorId: number, input: { body?: unknown; severity?: unknown }) {
  const body = str(input.body, 'Announcement', { min: 1, max: 1000 });
  const severity = ['info', 'warning', 'critical'].includes(input.severity as string) ? (input.severity as string) : 'info';
  const t = now();
  db().prepare('UPDATE announcements SET cleared_at = ? WHERE cleared_at IS NULL').run(t);
  db().prepare('INSERT INTO announcements (author_id, severity, body, created_at) VALUES (?,?,?,?)').run(authorId, severity, body, t);
  const a = currentAnnouncement();
  publish(allUserIds(), { type: 'announcement', announcement: a });
  return a;
}

export function clearAnnouncement() {
  db().prepare('UPDATE announcements SET cleared_at = ? WHERE cleared_at IS NULL').run(now());
  publish(allUserIds(), { type: 'announcement', announcement: null });
}

/** People list for admins, including whether each person has ever signed in (readiness before an outage). */
export function adminUsers() {
  const rows = db().prepare(`SELECT ${USER_COLS}, created_at FROM users ORDER BY name COLLATE NOCASE`).all() as (UserRow & {
    created_at: number;
  })[];
  return rows.map((u) => ({
    ...toPublic(u),
    activated: !u.must_change_password,
    lastSeenAt: u.last_seen_at,
    createdAt: u.created_at,
  }));
}

export function readiness() {
  const r = db()
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN must_change_password = 0 THEN 1 ELSE 0 END) AS activated,
              SUM(CASE WHEN last_seen_at > ? THEN 1 ELSE 0 END) AS active30d
       FROM users WHERE disabled = 0`,
    )
    .get(now() - 30 * 86400_000) as { total: number; activated: number; active30d: number };
  return { total: r.total, activated: r.activated ?? 0, active30d: r.active30d ?? 0 };
}

/**
 * Parse "name,email[,title]" lines (a header row is skipped). Kept dependency-free on purpose:
 * this is typically pasted from an HR export.
 */
export function parseRoster(text: string): { name: string; email: string; title: string }[] {
  const out: { name: string; email: string; title: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cells: string[] = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"' && line[i + 1] === '"') (cur += '"'), i++;
        else if (ch === '"') q = false;
        else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',' || ch === '\t' || ch === ';') cells.push(cur.trim()), (cur = '');
      else cur += ch;
    }
    cells.push(cur.trim());
    const [name = '', email = '', title = ''] = cells;
    if (/^name$/i.test(name) && /mail/i.test(email)) continue;
    out.push({ name, email, title });
  }
  return out;
}

export function provision(input: { text?: unknown; role?: unknown }) {
  if (typeof input.text !== 'string' || !input.text.trim()) throw bad('Paste at least one line: name, email, title');
  const rows = parseRoster(input.text);
  if (rows.length > 2000) throw bad('Import at most 2000 people at a time');
  const created: { name: string; email: string; password: string }[] = [];
  const skipped: { line: number; email: string; reason: string }[] = [];
  rows.forEach((r, i) => {
    const password = generatePassword();
    try {
      createUser({ ...r, password }, { mustChangePassword: true, role: input.role === 'admin' ? 'admin' : 'member' });
      created.push({ name: r.name, email: r.email.toLowerCase(), password });
    } catch (e) {
      skipped.push({ line: i + 1, email: r.email, reason: (e as Error).message });
    }
  });
  if (created.length) publish(allUserIds(), { type: 'directory:changed' });
  return { created, skipped };
}

