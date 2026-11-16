import crypto from 'node:crypto';
import { db, now } from './db.ts';
import { bad, HttpError, str } from './errors.ts';
import { isOnline } from './bus.ts';

export const SESSION_MS = 1000 * 60 * 60 * 24 * 7;

export type UserRow = {
  id: number;
  email: string;
  name: string;
  title: string;
  color: string;
  status: string;
  status_message: string;
  role: 'admin' | 'member';
  must_change_password: number;
  disabled: number;
  last_seen_at: number | null;
};

export type PublicUser = {
  id: number;
  email: string;
  name: string;
  title: string;
  color: string;
  status: string;
  statusMessage: string;
  role: 'admin' | 'member';
  online: boolean;
  disabled: boolean;
};

export const USER_COLS = 'id, email, name, title, color, status, status_message, role, must_change_password, disabled, last_seen_at';

export function toPublic(u: UserRow): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    title: u.title,
    color: u.color,
    status: u.status,
    statusMessage: u.status_message,
    role: u.role,
    online: isOnline(u.id),
    disabled: !!u.disabled,
  };
}

export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function verifyPassword(pw: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const PALETTE = ['#5b5fc7', '#0f7b6c', '#c4314b', '#ca5010', '#8764b8', '#038387', '#986f0b', '#4f6bed', '#b146c2', '#00727a'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function userCount(): number {
  return (db().prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
}

export function createUser(
  input: { email: unknown; name: unknown; password: unknown; title?: unknown },
  opts: { role?: 'admin' | 'member'; mustChangePassword?: boolean } = {},
): UserRow {
  const email = str(input.email, 'Email', { max: 200 }).toLowerCase();
  if (!EMAIL_RE.test(email)) throw bad('Enter a valid email address');
  const name = str(input.name, 'Name', { min: 1, max: 80 });
  const title = str(input.title, 'Title', { max: 80, optional: true });
  if (typeof input.password !== 'string' || input.password.length < 8) throw bad('Password must be at least 8 characters');
  if (input.password.length > 200) throw bad('Password is too long');
  const exists = db().prepare('SELECT 1 FROM users WHERE email = ?').get(email);
  if (exists) throw new HttpError(409, 'An account with that email already exists');
  const color = PALETTE[crypto.randomInt(PALETTE.length)];
  const { lastInsertRowid } = db()
    .prepare(
      'INSERT INTO users (email, name, title, password_hash, color, role, must_change_password, created_at) VALUES (?,?,?,?,?,?,?,?)',
    )
    .run(email, name, title, hashPassword(input.password), color, opts.role ?? 'member', opts.mustChangePassword ? 1 : 0, now());
  autoJoinDefaultChannels(Number(lastInsertRowid));
  return getUser(Number(lastInsertRowid))!;
}

/** New people land in #general so they have someone to talk to. */
function autoJoinDefaultChannels(userId: number) {
  const general = db().prepare("SELECT id FROM conversations WHERE type = 'channel' AND name = 'general'").get() as
    | { id: number }
    | undefined;
  if (general) {
    db()
      .prepare('INSERT OR IGNORE INTO members (conversation_id, user_id, joined_at) VALUES (?,?,?)')
      .run(general.id, userId, now());
  }
}

export function getUser(id: number): UserRow | undefined {
  return db().prepare(`SELECT ${USER_COLS} FROM users WHERE id = ?`).get(id) as UserRow | undefined;
}

// --- login throttling: 10 failures per email+ip per 15 minutes ---
const failures = new Map<string, { count: number; until: number }>();
const WINDOW = 15 * 60 * 1000;

export function login(emailIn: unknown, password: unknown, ip: string): { user: UserRow; token: string } {
  const email = typeof emailIn === 'string' ? emailIn.trim().toLowerCase() : '';
  const key = `${email}|${ip}`;
  const f = failures.get(key);
  if (f && f.until > now() && f.count >= 10) throw new HttpError(429, 'Too many attempts. Try again in a few minutes.');
  const row = db().prepare(`SELECT ${USER_COLS}, password_hash FROM users WHERE email = ?`).get(email) as
    | (UserRow & { password_hash: string })
    | undefined;
  // Always run scrypt so response time doesn't reveal whether the account exists.
  const ok = verifyPassword(typeof password === 'string' ? password : '', row?.password_hash ?? DUMMY_HASH);
  if (!row || !ok || row.disabled) {
    const cur = f && f.until > now() ? f : { count: 0, until: now() + WINDOW };
    cur.count++;
    failures.set(key, cur);
    throw new HttpError(401, 'Incorrect email or password');
  }
  failures.delete(key);
  const { password_hash: _, ...user } = row;
  return { user, token: createSession(user.id) };
}
const DUMMY_HASH = hashPassword('not-a-real-password');

export function createSession(userId: number): string {
  const token = crypto.randomBytes(32).toString('hex');
  db().prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run(token, userId, now() + SESSION_MS);
  return token;
}

export function destroySession(token: string) {
  db().prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function userForToken(token: string | undefined): UserRow | null {
  if (!token) return null;
  const row = db()
    .prepare(
      `SELECT ${USER_COLS.split(', ').map((c) => 'u.' + c).join(', ')}
       FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token = ? AND s.expires_at > ? AND u.disabled = 0`,
    )
    .get(token, now()) as UserRow | undefined;
  return row ?? null;
}

export function changePassword(userId: number, current: unknown, next: unknown) {
  const row = db().prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as { password_hash: string };
  if (typeof current !== 'string' || !verifyPassword(current, row.password_hash)) throw bad('Current password is incorrect');
  if (typeof next !== 'string' || next.length < 8) throw bad('New password must be at least 8 characters');
  if (next.length > 200) throw bad('Password is too long');
  if (next === current) throw bad('Choose a password different from the current one');
  db().prepare('UPDATE users SET password_hash = ?, must_change_password = 0 WHERE id = ?').run(hashPassword(next), userId);
}

/** Readable one-time password (no look-alike characters) for admin-provisioned accounts. */
export function generatePassword(length = 12): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  return Array.from({ length }, () => chars[crypto.randomInt(chars.length)]).join('');
}

/** Admin: set a new temporary password and sign the user out everywhere. */
export function resetPassword(userId: number): string {
  if (!getUser(userId)) throw new HttpError(404, 'User not found');
  const pw = generatePassword();
  db().prepare('UPDATE users SET password_hash = ?, must_change_password = 1 WHERE id = ?').run(hashPassword(pw), userId);
  db().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  return pw;
}

export function setDisabled(userId: number, disabled: boolean) {
  if (!getUser(userId)) throw new HttpError(404, 'User not found');
  db().prepare('UPDATE users SET disabled = ? WHERE id = ?').run(disabled ? 1 : 0, userId);
  if (disabled) db().prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function setRole(userId: number, role: unknown) {
  if (role !== 'admin' && role !== 'member') throw bad('Unknown role');
  if (!getUser(userId)) throw new HttpError(404, 'User not found');
  if (role === 'member') {
    const admins = (db().prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND id != ?").get(userId) as { n: number }).n;
    if (admins === 0) throw bad('There must be at least one active admin');
  }
  db().prepare('UPDATE users SET role = ? WHERE id = ?').run(role, userId);
}

export function touchLastSeen(userId: number) {
  db().prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now(), userId);
}

export function updateProfile(userId: number, input: Record<string, unknown>): UserRow {
  const sets: string[] = [];
  const vals: (string | number)[] = [];
  if (input.name !== undefined) {
    sets.push('name = ?');
    vals.push(str(input.name, 'Name', { min: 1, max: 80 }));
  }
  if (input.title !== undefined) {
    sets.push('title = ?');
    vals.push(str(input.title, 'Title', { max: 80, optional: true }));
  }
  if (input.status !== undefined) {
    if (!['available', 'busy', 'dnd', 'away'].includes(input.status as string)) throw bad('Unknown status');
    sets.push('status = ?');
    vals.push(input.status as string);
  }
  if (input.statusMessage !== undefined) {
    sets.push('status_message = ?');
    vals.push(str(input.statusMessage, 'Status message', { max: 140, optional: true }));
  }
  if (sets.length) db().prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).run(...vals, userId);
  return getUser(userId)!;
}

export function directory(): PublicUser[] {
  return (db().prepare(`SELECT ${USER_COLS} FROM users ORDER BY name COLLATE NOCASE`).all() as UserRow[]).map(toPublic);
}
