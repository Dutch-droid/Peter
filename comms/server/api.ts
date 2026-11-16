import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as auth from './auth.ts';
import * as chat from './chat.ts';
import * as mail from './mail.ts';
import * as calls from './calls.ts';
import * as admin from './admin.ts';
import { INLINE_SAFE, MAX_UPLOAD, openAttachment, saveUpload } from './attachments.ts';
import { bad, HttpError, id, ids } from './errors.ts';
import { db } from './db.ts';
import { publish } from './bus.ts';

type Ctx = {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  user: auth.UserRow;
  token: string;
};
type Handler = (ctx: Ctx) => unknown | Promise<unknown>;
type Route = { method: string; pattern: RegExp; keys: string[]; handler: Handler; public?: boolean; raw?: boolean };

const routes: Route[] = [];
function route(method: string, path: string, handler: Handler, opts: { public?: boolean; raw?: boolean } = {}) {
  const keys: string[] = [];
  const pattern = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)')) + '$');
  routes.push({ method, pattern, keys, handler, ...opts });
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** Mark the cookie Secure whenever the request arrived over HTTPS (directly or via a TLS-terminating proxy). */
function isHttps(req: IncomingMessage) {
  return (req.socket as { encrypted?: boolean }).encrypted || (process.env.RELAY_TRUST_PROXY === '1' && req.headers['x-forwarded-proto'] === 'https');
}
function setSession(req: IncomingMessage, res: ServerResponse, token: string) {
  res.setHeader(
    'Set-Cookie',
    `relay_sid=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${auth.SESSION_MS / 1000}${isHttps(req) ? '; Secure' : ''}`,
  );
}

const me = (u: auth.UserRow) => ({ ...auth.toPublic(u), mustChangePassword: !!u.must_change_password });

/** Self-signup is open for the very first account (who becomes admin), then only with RELAY_SIGNUP_CODE. */
function signupMode() {
  if (auth.userCount() === 0) return 'first-admin';
  return process.env.RELAY_SIGNUP_CODE ? 'code' : 'closed';
}

// ---------- auth ----------
// Touches the database so a monitor notices if storage is broken, without revealing anything.
route('GET', '/api/health', () => (auth.userCount(), { ok: true, time: Date.now() }), { public: true });
route('GET', '/api/auth/config', () => ({ signup: signupMode() }), { public: true });

route(
  'POST',
  '/api/auth/register',
  ({ body, res, req }) => {
    const mode = signupMode();
    if (mode === 'closed') throw new HttpError(403, 'Sign-up is closed. Ask an admin to create your account.');
    if (mode === 'code' && body.code !== process.env.RELAY_SIGNUP_CODE) throw new HttpError(403, 'That sign-up code is not valid');
    const user = auth.createUser(body, { role: mode === 'first-admin' ? 'admin' : 'member' });
    if (mode === 'first-admin') ensureGeneral(user.id);
    setSession(req, res, auth.createSession(user.id));
    publish(allIds(), { type: 'directory:changed' });
    return { user: me(user) };
  },
  { public: true },
);

route(
  'POST',
  '/api/auth/login',
  ({ body, res, req }) => {
    const ip = (process.env.RELAY_TRUST_PROXY === '1' && String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim()) || req.socket.remoteAddress || '';
    const { user, token } = auth.login(body.email, body.password, ip);
    setSession(req, res, token);
    return { user: me(user) };
  },
  { public: true },
);

route('POST', '/api/auth/logout', ({ token, res }) => {
  auth.destroySession(token);
  res.setHeader('Set-Cookie', 'relay_sid=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0');
  return { ok: true };
});

route('GET', '/api/me', ({ user }) => ({ user: me(user) }));
route('PATCH', '/api/me', ({ user, body }) => {
  const u = auth.updateProfile(user.id, body);
  publish(allIds(), { type: 'user:updated', user: auth.toPublic(u) });
  return { user: me(u) };
});
route('POST', '/api/me/password', ({ user, body, token }) => {
  auth.changePassword(user.id, body.current, body.next);
  db().prepare('DELETE FROM sessions WHERE user_id = ? AND token != ?').run(user.id, token);
  return { user: me(auth.getUser(user.id)!) };
});

route('GET', '/api/users', () => ({ users: auth.directory().filter((u) => !u.disabled) }));

route('GET', '/api/config', () => ({
  iceServers: iceServers(),
  reactions: chat.REACTIONS,
  maxUploadBytes: MAX_UPLOAD,
  announcement: admin.currentAnnouncement(),
}));

function iceServers() {
  if (process.env.RELAY_ICE_SERVERS) {
    try {
      return JSON.parse(process.env.RELAY_ICE_SERVERS);
    } catch {
      console.warn('RELAY_ICE_SERVERS is not valid JSON; ignoring');
    }
  }
  // No STUN by default: on a LAN / VPN peers connect directly. Configure your own STUN/TURN for the internet.
  return [];
}

// ---------- chat ----------
route('GET', '/api/conversations', ({ user }) => ({ conversations: chat.listConversations(user.id) }));
route('GET', '/api/channels', ({ user }) => ({ channels: chat.browseChannels(user.id) }));
route('POST', '/api/conversations', ({ user, body }) => ({ conversation: chat.createConversation(user.id, body) }));
route('POST', '/api/conversations/dm', ({ user, body }) => ({ conversation: chat.openDm(user.id, id(body.userId, 'userId')) }));
route('GET', '/api/conversations/:id', ({ user, params }) => ({ conversation: chat.getConversation(user.id, id(params.id, 'id')) }));
route('PATCH', '/api/conversations/:id', ({ user, params, body }) => {
  const cid = id(params.id, 'id');
  if (body.muted !== undefined) return { conversation: chat.setMuted(user.id, cid, !!body.muted) };
  return { conversation: chat.updateConversation(user.id, cid, body) };
});
route('POST', '/api/conversations/:id/join', ({ user, params }) => ({ conversation: chat.joinChannel(user.id, id(params.id, 'id')) }));
route('POST', '/api/conversations/:id/leave', ({ user, params }) => (chat.leaveConversation(user.id, id(params.id, 'id')), { ok: true }));
route('POST', '/api/conversations/:id/members', ({ user, params, body }) => ({
  conversation: chat.addMembers(user.id, id(params.id, 'id'), ids(body.userIds, 'userIds')),
}));
route('GET', '/api/conversations/:id/messages', ({ user, params, query }) =>
  chat.listMessages(user.id, id(params.id, 'id'), query.get('before') ? Number(query.get('before')) : undefined),
);
route('POST', '/api/conversations/:id/messages', ({ user, params, body }) => ({ message: chat.sendMessage(user.id, id(params.id, 'id'), body) }));
route('POST', '/api/conversations/:id/read', ({ user, params, body }) => (chat.markRead(user.id, id(params.id, 'id'), body.messageId), { ok: true }));
route('PATCH', '/api/messages/:id', ({ user, params, body }) => ({ message: chat.editMessage(user.id, id(params.id, 'id'), body.body) }));
route('DELETE', '/api/messages/:id', ({ user, params }) => ({ message: chat.deleteMessage(user.id, id(params.id, 'id')) }));
route('POST', '/api/messages/:id/reactions', ({ user, params, body }) => ({ message: chat.toggleReaction(user.id, id(params.id, 'id'), body.emoji) }));

route('POST', '/api/messages/:id/ack', ({ user, params }) => ({ message: chat.acknowledge(user.id, id(params.id, 'id')) }));
route('POST', '/api/messages/:id/pin', ({ user, params, body }) => ({ message: chat.setPinned(user.id, id(params.id, 'id'), body.pinned !== false) }));
route('GET', '/api/conversations/:id/pins', ({ user, params }) => ({ messages: chat.listPins(user.id, id(params.id, 'id')) }));
route('GET', '/api/conversations/:id/apps', ({ user, params }) => ({ apps: chat.listApps(user.id, id(params.id, 'id')) }));
route('POST', '/api/conversations/:id/apps', ({ user, params, body }) => ({ app: chat.createApp(user.id, id(params.id, 'id'), body.name) }));
route('DELETE', '/api/apps/:id', ({ user, params }) => (chat.deleteApp(user.id, id(params.id, 'id')), { ok: true }));
route('POST', '/api/hooks/:token', ({ params, body }) => ({ message: { id: chat.postFromApp(params.token, body).id } }), { public: true });
route('GET', '/api/files', ({ user, query }) => ({ files: chat.listFiles(user.id, query.get('q') ?? '') }));

// ---------- files ----------
route(
  'POST',
  '/api/attachments',
  async ({ user, req }) => {
    const data = await readBody(req, MAX_UPLOAD);
    const name = decodeURIComponent(String(req.headers['x-filename'] ?? 'file'));
    return { attachment: saveUpload(user.id, name, String(req.headers['content-type'] ?? ''), data) };
  },
  { raw: true },
);
route('GET', '/api/attachments/:id', ({ user, params, res, query }) => {
  const a = openAttachment(user.id, id(params.id, 'id'));
  const inline = INLINE_SAFE.has(a.mime) && query.get('download') !== '1';
  res.writeHead(200, {
    'Content-Type': inline ? a.mime : 'application/octet-stream',
    'Content-Length': a.size,
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.filename)}`,
    'Cache-Control': 'private, max-age=86400',
  });
  fs.createReadStream(a.path).pipe(res);
  return RAW;
});

// ---------- mail ----------
route('GET', '/api/mail', ({ user, query }) => ({ emails: mail.listFolder(user.id, query.get('folder') ?? 'inbox', query.get('q') ?? '') }));
route('GET', '/api/mail/counts', ({ user }) => ({ counts: mail.counts(user.id) }));
route('GET', '/api/mail/:id', ({ user, params }) => mail.getEmail(user.id, id(params.id, 'id')));
route('POST', '/api/mail/drafts', ({ user, body }) => ({ email: mail.saveDraft(user.id, body) }));
route('POST', '/api/mail/send', ({ user, body }) => ({ email: mail.send(user.id, body) }));
route('PATCH', '/api/mail/:id', ({ user, params, body }) => ({ email: mail.update(user.id, id(params.id, 'id'), body) }));
route('DELETE', '/api/mail/:id', ({ user, params }) => (mail.destroy(user.id, id(params.id, 'id')), { ok: true }));
route('POST', '/api/mail/empty-trash', ({ user }) => ({ deleted: mail.emptyTrash(user.id) }));

// ---------- calls ----------
route('GET', '/api/calls', ({ user }) => ({ calls: calls.history(user.id) }));
route('GET', '/api/calls/active', ({ user }) => ({ calls: calls.activeCalls(user.id) }));

// ---------- search ----------
route('GET', '/api/search', ({ user, query }) => {
  const q = (query.get('q') ?? '').trim();
  if (q.length < 2) return { messages: [], emails: [], people: [] };
  const lq = q.toLowerCase();
  return {
    messages: chat.searchMessages(user.id, q),
    emails: mail.searchMail(user.id, q),
    people: auth
      .directory()
      .filter((u) => !u.disabled && (u.name.toLowerCase().includes(lq) || u.email.includes(lq) || u.title.toLowerCase().includes(lq)))
      .slice(0, 10),
  };
});

// ---------- admin ----------
route('GET', '/api/admin/users', ({ user }) => (admin.requireAdmin(user), { users: admin.adminUsers(), readiness: admin.readiness() }));
route('POST', '/api/admin/users', ({ user, body }) => (admin.requireAdmin(user), admin.provision(body)));
route('PATCH', '/api/admin/users/:id', ({ user, params, body }) => {
  admin.requireAdmin(user);
  const uid = id(params.id, 'id');
  if (body.disabled !== undefined) {
    if (uid === user.id) throw bad('You cannot disable yourself');
    auth.setDisabled(uid, !!body.disabled);
  }
  if (body.role !== undefined) auth.setRole(uid, body.role);
  publish(allIds(), { type: 'directory:changed' });
  return { users: admin.adminUsers() };
});
route('POST', '/api/admin/users/:id/reset-password', ({ user, params }) => {
  admin.requireAdmin(user);
  return { password: auth.resetPassword(id(params.id, 'id')) };
});
route('GET', '/api/admin/announcements', ({ user }) => (admin.requireAdmin(user), { announcements: admin.announcementHistory() }));
route('POST', '/api/admin/announcements', ({ user, body }) => (admin.requireAdmin(user), { announcement: admin.announce(user.id, body) }));
route('DELETE', '/api/admin/announcements', ({ user }) => (admin.requireAdmin(user), admin.clearAnnouncement(), { ok: true }));

// ---------- plumbing ----------
const RAW = Symbol('raw');

function allIds() {
  return (db().prepare('SELECT id FROM users').all() as { id: number }[]).map((r) => r.id);
}

export function ensureGeneral(userId: number) {
  const exists = db().prepare("SELECT id FROM conversations WHERE type = 'channel' AND name = 'general'").get();
  if (!exists) {
    chat.createConversation(userId, { type: 'channel', name: 'general', topic: 'Company-wide updates and chat' });
  }
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new HttpError(413, 'Request is too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  const body = JSON.stringify(data);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

/** Reject cross-site state-changing requests (CSRF) by checking Origin against Host. */
function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients; the session cookie is SameSite=Lax anyway
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export async function handleApi(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? '/', 'http://x');
  if (!url.pathname.startsWith('/api/')) return false;
  try {
    const method = req.method ?? 'GET';
    let match: { r: Route; params: Record<string, string> } | null = null;
    let pathMatched = false;
    for (const r of routes) {
      const m = r.pattern.exec(url.pathname);
      if (!m) continue;
      pathMatched = true;
      if (r.method !== method) continue;
      match = { r, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
      break;
    }
    if (!match) throw new HttpError(pathMatched ? 405 : 404, pathMatched ? 'Method not allowed' : 'Not found');
    if (method !== 'GET' && !sameOrigin(req)) throw new HttpError(403, 'Cross-site request blocked');

    const token = parseCookies(req.headers.cookie).relay_sid ?? '';
    const user = auth.userForToken(token);
    if (!match.r.public && !user) throw new HttpError(401, 'Please sign in');
    if (user && user.must_change_password && !match.r.public && !ALLOWED_BEFORE_PW_CHANGE.has(url.pathname))
      throw new HttpError(403, 'Choose a new password to continue');

    let body: any = {};
    if (!match.r.raw && method !== 'GET' && method !== 'DELETE') {
      const buf = await readBody(req, 1024 * 1024);
      if (buf.length) {
        try {
          body = JSON.parse(buf.toString('utf8'));
        } catch {
          throw bad('Invalid JSON');
        }
        if (typeof body !== 'object' || body === null) throw bad('Invalid JSON');
      }
    }
    const out = await match.r.handler({ req, res, params: match.params, query: url.searchParams, body, user: user!, token });
    if (out !== RAW) sendJson(res, 200, out ?? { ok: true });
  } catch (e) {
    if (e instanceof HttpError) sendJson(res, e.status, { error: e.message });
    else {
      console.error(e);
      sendJson(res, 500, { error: 'Something went wrong' });
    }
  }
  return true;
}

const ALLOWED_BEFORE_PW_CHANGE = new Set(['/api/me', '/api/me/password', '/api/auth/logout', '/api/config']);
