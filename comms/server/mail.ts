import { db, now, tx } from './db.ts';
import { bad, forbidden, notFound, str } from './errors.ts';
import { publish } from './bus.ts';

export const FOLDERS = ['inbox', 'sent', 'drafts', 'archive', 'trash'] as const;
export type Folder = (typeof FOLDERS)[number];

type EmailRow = {
  id: number;
  thread_id: number | null;
  sender_id: number;
  subject: string;
  body: string;
  importance: 'normal' | 'high';
  created_at: number;
  sent_at: number | null;
};

type Person = { id: number; name: string; email: string; color: string };

function people(emailId: number) {
  return db()
    .prepare(
      `SELECT r.kind, u.id, u.name, u.email, u.color FROM email_recipients r JOIN users u ON u.id = r.user_id
       WHERE r.email_id = ? ORDER BY u.name`,
    )
    .all(emailId) as (Person & { kind: 'to' | 'cc' | 'bcc' })[];
}

function sender(id: number): Person {
  return db().prepare('SELECT id, name, email, color FROM users WHERE id = ?').get(id) as Person;
}

function attachmentsOf(emailId: number) {
  return db()
    .prepare(
      `SELECT a.id, a.filename, a.mime, a.size FROM email_attachments ea JOIN attachments a ON a.id = ea.attachment_id
       WHERE ea.email_id = ?`,
    )
    .all(emailId) as { id: number; filename: string; mime: string; size: number }[];
}

/** Full email as seen by `viewerId`: Bcc is only visible to the sender (and each Bcc recipient sees only themself). */
function view(viewerId: number, e: EmailRow, box?: { folder: Folder; is_read: number; starred: number }) {
  const rec = people(e.id);
  const isSender = e.sender_id === viewerId;
  const vis = (k: string) => rec.filter((r) => r.kind === k).map(({ kind: _, ...p }) => p);
  return {
    id: e.id,
    threadId: e.thread_id ?? e.id,
    from: sender(e.sender_id),
    to: vis('to'),
    cc: vis('cc'),
    bcc: isSender ? vis('bcc') : vis('bcc').filter((p) => p.id === viewerId),
    subject: e.subject,
    body: e.body,
    importance: e.importance,
    createdAt: e.created_at,
    sentAt: e.sent_at,
    folder: box?.folder ?? null,
    read: !!box?.is_read,
    starred: !!box?.starred,
    attachments: attachmentsOf(e.id),
  };
}
export type EmailView = ReturnType<typeof view>;

function box(userId: number, emailId: number) {
  return db().prepare('SELECT folder, is_read, starred FROM mailbox WHERE email_id = ? AND user_id = ?').get(emailId, userId) as
    | { folder: Folder; is_read: number; starred: number }
    | undefined;
}

function row(emailId: number): EmailRow {
  const e = db().prepare('SELECT * FROM emails WHERE id = ?').get(emailId) as EmailRow | undefined;
  if (!e) throw notFound('Email not found');
  return e;
}

export function counts(userId: number) {
  const rows = db()
    .prepare(
      `SELECT folder, COUNT(*) AS total, SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) AS unread
       FROM mailbox WHERE user_id = ? GROUP BY folder`,
    )
    .all(userId) as { folder: Folder; total: number; unread: number }[];
  const starred = (db().prepare("SELECT COUNT(*) AS n FROM mailbox WHERE user_id = ? AND starred = 1 AND folder != 'trash'").get(userId) as { n: number }).n;
  const out: Record<string, { total: number; unread: number }> = {};
  for (const f of FOLDERS) out[f] = { total: 0, unread: 0 };
  for (const r of rows) out[r.folder] = { total: r.total, unread: r.unread };
  out.starred = { total: starred, unread: 0 };
  return out;
}

export function listFolder(userId: number, folder: string, q = '') {
  const isStarred = folder === 'starred';
  if (!isStarred && !FOLDERS.includes(folder as Folder)) throw bad('Unknown folder');
  const like = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  const rows = db()
    .prepare(
      `SELECT e.*, b.folder, b.is_read, b.starred FROM mailbox b JOIN emails e ON e.id = b.email_id
       JOIN users s ON s.id = e.sender_id
       WHERE b.user_id = ? AND ${isStarred ? "b.starred = 1 AND b.folder != 'trash'" : 'b.folder = ?'}
         AND (? = '' OR e.subject LIKE ? ESCAPE '\\' OR e.body LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\')
       ORDER BY COALESCE(e.sent_at, e.created_at) DESC LIMIT 200`,
    )
    .all(...(isStarred ? [userId] : [userId, folder]), q, like, like, like) as (EmailRow & {
    folder: Folder;
    is_read: number;
    starred: number;
  })[];
  return rows.map((r) => {
    const v = view(userId, r, r);
    return { ...v, body: undefined, snippet: r.body.replace(/\s+/g, ' ').slice(0, 160) };
  });
}

/** Open an email: returns it plus the rest of its thread that this user can see, and marks it read. */
export function getEmail(userId: number, emailId: number) {
  const e = row(emailId);
  const b = box(userId, emailId);
  if (!b) throw notFound('Email not found');
  if (!b.is_read) {
    db().prepare('UPDATE mailbox SET is_read = 1 WHERE email_id = ? AND user_id = ?').run(emailId, userId);
    b.is_read = 1;
    publish([userId], { type: 'mail:counts', counts: counts(userId) });
  }
  const threadId = e.thread_id ?? e.id;
  const thread = (
    db()
      .prepare(
        `SELECT e.*, b.folder, b.is_read, b.starred FROM emails e JOIN mailbox b ON b.email_id = e.id AND b.user_id = ?
         WHERE (e.id = ? OR e.thread_id = ?) AND e.sent_at IS NOT NULL AND b.folder != 'trash' ORDER BY e.sent_at`,
      )
      .all(userId, threadId, threadId) as (EmailRow & { folder: Folder; is_read: number; starred: number })[]
  ).map((r) => view(userId, r, r));
  return { email: view(userId, e, b), thread };
}

type DraftInput = {
  id?: unknown;
  to?: unknown;
  cc?: unknown;
  bcc?: unknown;
  subject?: unknown;
  body?: unknown;
  importance?: unknown;
  attachmentIds?: unknown;
  inReplyTo?: unknown;
};

/** Accepts user ids or email addresses; returns user ids or throws naming the unknown address. */
function resolveRecipients(v: unknown, field: string): number[] {
  if (v === undefined || v === null || v === '') return [];
  const list = Array.isArray(v) ? v : String(v).split(/[,;]/);
  const out: number[] = [];
  for (const raw of list) {
    if (typeof raw === 'number') {
      if (!db().prepare('SELECT 1 FROM users WHERE id = ?').get(raw)) throw bad(`${field}: unknown recipient`);
      out.push(raw);
      continue;
    }
    const s = String(raw).trim().toLowerCase();
    if (!s) continue;
    const u = db().prepare('SELECT id FROM users WHERE email = ?').get(s) as { id: number } | undefined;
    if (!u) throw bad(`${field}: no one in the directory has the address ${s}`);
    out.push(u.id);
  }
  if (out.length > 200) throw bad(`${field}: too many recipients`);
  return [...new Set(out)];
}

function writeDraft(userId: number, input: DraftInput): number {
  const subject = str(input.subject, 'Subject', { max: 300, optional: true });
  const body = str(input.body, 'Body', { max: 100_000, optional: true });
  const importance = input.importance === 'high' ? 'high' : 'normal';
  const to = resolveRecipients(input.to, 'To');
  const cc = resolveRecipients(input.cc, 'Cc').filter((x) => !to.includes(x));
  const bcc = resolveRecipients(input.bcc, 'Bcc').filter((x) => !to.includes(x) && !cc.includes(x));
  const attachmentIds = Array.isArray(input.attachmentIds) ? (input.attachmentIds as unknown[]).map(Number) : [];
  if (attachmentIds.length > 20) throw bad('Too many attachments');

  let threadId: number | null = null;
  if (input.inReplyTo) {
    const parentId = Number(input.inReplyTo);
    if (!box(userId, parentId)) throw bad('Original email not found');
    const p = row(parentId);
    threadId = p.thread_id ?? p.id;
  }

  return tx(() => {
    let id: number;
    if (input.id) {
      id = Number(input.id);
      const existing = db().prepare('SELECT * FROM emails WHERE id = ?').get(id) as EmailRow | undefined;
      const b = existing && box(userId, id);
      if (!existing || existing.sender_id !== userId || existing.sent_at || b?.folder !== 'drafts') throw notFound('Draft not found');
      db().prepare('UPDATE emails SET subject = ?, body = ?, importance = ?, created_at = ? WHERE id = ?').run(subject, body, importance, now(), id);
      if (threadId) db().prepare('UPDATE emails SET thread_id = ? WHERE id = ?').run(threadId, id);
      db().prepare('DELETE FROM email_recipients WHERE email_id = ?').run(id);
      db().prepare('DELETE FROM email_attachments WHERE email_id = ?').run(id);
    } else {
      const { lastInsertRowid } = db()
        .prepare('INSERT INTO emails (thread_id, sender_id, subject, body, importance, created_at) VALUES (?,?,?,?,?,?)')
        .run(threadId, userId, subject, body, importance, now());
      id = Number(lastInsertRowid);
      db().prepare("INSERT INTO mailbox (email_id, user_id, folder, is_read) VALUES (?,?,'drafts',1)").run(id, userId);
    }
    const addR = db().prepare('INSERT INTO email_recipients (email_id, user_id, kind) VALUES (?,?,?)');
    for (const u of to) addR.run(id, u, 'to');
    for (const u of cc) addR.run(id, u, 'cc');
    for (const u of bcc) addR.run(id, u, 'bcc');
    for (const a of attachmentIds) {
      // Allowed: your own upload, or an attachment on an email you can see (forwarding).
      const own = db().prepare('SELECT 1 FROM attachments WHERE id = ? AND uploader_id = ?').get(a, userId);
      const seen = db()
        .prepare('SELECT 1 FROM email_attachments ea JOIN mailbox b ON b.email_id = ea.email_id AND b.user_id = ? WHERE ea.attachment_id = ?')
        .get(userId, a);
      if (!own && !seen) throw bad('Attachment not found');
      db().prepare('INSERT OR IGNORE INTO email_attachments (email_id, attachment_id) VALUES (?,?)').run(id, a);
    }
    return id;
  });
}

export function saveDraft(userId: number, input: DraftInput) {
  const id = writeDraft(userId, input);
  publish([userId], { type: 'mail:counts', counts: counts(userId) });
  return view(userId, row(id), box(userId, id));
}

export function send(userId: number, input: DraftInput) {
  const id = writeDraft(userId, input);
  const rec = people(id);
  if (!rec.length) {
    throw bad('Add at least one recipient');
  }
  const e = row(id);
  if (!e.subject && !e.body) throw bad('Write a subject or a message');
  const t = now();
  tx(() => {
    db().prepare('UPDATE emails SET sent_at = ?, created_at = ? WHERE id = ?').run(t, t, id);
    db().prepare("UPDATE mailbox SET folder = 'sent' WHERE email_id = ? AND user_id = ?").run(id, userId);
    const add = db().prepare("INSERT OR IGNORE INTO mailbox (email_id, user_id, folder, is_read) VALUES (?,?,'inbox',0)");
    for (const r of rec) add.run(id, r.id);
  });
  const sent = row(id);
  for (const r of rec) {
    if (r.id === userId) continue; // sending to yourself: your copy stays in Sent
    publish([r.id], { type: 'mail:new', email: { ...view(r.id, sent, box(r.id, id)), body: undefined, snippet: sent.body.slice(0, 160) } });
    publish([r.id], { type: 'mail:counts', counts: counts(r.id) });
  }
  publish([userId], { type: 'mail:counts', counts: counts(userId) });
  return view(userId, sent, box(userId, id));
}

export function update(userId: number, emailId: number, input: { folder?: unknown; read?: unknown; starred?: unknown }) {
  const b = box(userId, emailId);
  if (!b) throw notFound('Email not found');
  if (input.folder !== undefined) {
    const f = input.folder as Folder;
    if (!FOLDERS.includes(f)) throw bad('Unknown folder');
    const unsent = !row(emailId).sent_at;
    if (unsent ? f !== 'drafts' && f !== 'trash' : f === 'drafts') throw bad('Drafts can only be discarded or restored');
    if (f === 'sent' && row(emailId).sender_id !== userId) throw forbidden('Only your own emails go in Sent');
    db().prepare('UPDATE mailbox SET folder = ? WHERE email_id = ? AND user_id = ?').run(f, emailId, userId);
  }
  if (input.read !== undefined) db().prepare('UPDATE mailbox SET is_read = ? WHERE email_id = ? AND user_id = ?').run(input.read ? 1 : 0, emailId, userId);
  if (input.starred !== undefined)
    db().prepare('UPDATE mailbox SET starred = ? WHERE email_id = ? AND user_id = ?').run(input.starred ? 1 : 0, emailId, userId);
  publish([userId], { type: 'mail:counts', counts: counts(userId) });
  return view(userId, row(emailId), box(userId, emailId));
}

/** Delete forever (only from Trash). The email itself goes once no mailbox references it. */
export function destroy(userId: number, emailId: number) {
  const b = box(userId, emailId);
  if (!b) throw notFound('Email not found');
  if (b.folder !== 'trash') throw bad('Move the email to Trash first');
  tx(() => {
    db().prepare('DELETE FROM mailbox WHERE email_id = ? AND user_id = ?').run(emailId, userId);
    const left = db().prepare('SELECT 1 FROM mailbox WHERE email_id = ?').get(emailId);
    if (!left) db().prepare('DELETE FROM emails WHERE id = ?').run(emailId);
  });
  publish([userId], { type: 'mail:counts', counts: counts(userId) });
}

export function emptyTrash(userId: number) {
  const ids = (db().prepare("SELECT email_id FROM mailbox WHERE user_id = ? AND folder = 'trash'").all(userId) as { email_id: number }[]).map(
    (r) => r.email_id,
  );
  for (const id of ids) destroy(userId, id);
  return ids.length;
}

export function searchMail(userId: number, q: string) {
  return listFolder(userId, 'inbox', q).concat(listFolder(userId, 'sent', q), listFolder(userId, 'archive', q)).slice(0, 30);
}
