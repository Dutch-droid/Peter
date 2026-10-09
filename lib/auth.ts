import crypto from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { db } from './db';

export type Role = 'admin' | 'manager' | 'employee';
export type SessionUser = { id: number; email: string; role: Role; employeeId: number; name: string };

const SESSION_MS = 1000 * 60 * 60 * 8;

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

export async function createSession(userId: number) {
  const token = crypto.randomBytes(32).toString('hex');
  db().prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run(
    token,
    userId,
    Date.now() + SESSION_MS,
  );
  (await cookies()).set('sid', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_MS / 1000,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get('sid')?.value;
  if (token) db().prepare('DELETE FROM sessions WHERE token = ?').run(token);
  jar.delete('sid');
}

export async function currentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get('sid')?.value;
  if (!token) return null;
  const row = db()
    .prepare(
      `SELECT u.id, u.email, u.role, u.employee_id AS employeeId,
              e.first_name || ' ' || e.last_name AS name
       FROM sessions s JOIN users u ON u.id = s.user_id JOIN employees e ON e.id = u.employee_id
       WHERE s.token = ? AND s.expires_at > ?`,
    )
    .get(token, Date.now()) as SessionUser | undefined;
  return row ?? null;
}

export async function requireUser(roles?: Role[]): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (roles && !roles.includes(user.role)) redirect('/');
  return user;
}
