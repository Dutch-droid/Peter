import crypto from 'node:crypto';
import { db, now, tx } from './db.ts';
import { bad, forbidden, HttpError, notFound, str } from './errors.ts';
import { publish } from './bus.ts';
import { getUser } from './auth.ts';

export type ConvType = 'dm' | 'group' | 'channel';
type ConvRow = {
  id: number;
  type: ConvType;
  name: string;
  topic: string;
  created_by: number | null;
  created_at: number;
  last_message_at: number;
};

/** Reactions are keys rendered as line icons by the client (no emoji). */
export const REACTIONS = ['like', 'agree', 'heart', 'celebrate', 'seen', 'question'];

export function memberIds(convId: number): number[] {
  return (db().prepare('SELECT user_id FROM members WHERE conversation_id = ?').all(convId) as { user_id: number }[]).map(
    (r) => r.user_id,
  );
}

export function isMember(userId: number, convId: number): boolean {
  return !!db().prepare('SELECT 1 FROM members WHERE conversation_id = ? AND user_id = ?').get(convId, userId);
}

function conv(convId: number): ConvRow {
  const c = db().prepare('SELECT * FROM conversations WHERE id = ?').get(convId) as ConvRow | undefined;
  if (!c) throw notFound('Conversation not found');
  return c;
}

export function requireMember(userId: number, convId: number): ConvRow {
  const c = conv(convId);
  if (!isMember(userId, convId)) throw forbidden('You are not in this conversation');
  return c;
}

function summary(userId: number, c: ConvRow) {
  const me = db().prepare('SELECT last_read_id, muted FROM members WHERE conversation_id = ? AND user_id = ?').get(c.id, userId) as
    | { last_read_id: number; muted: number }
    | undefined;
  const last = db()
    .prepare(
      `SELECT m.id, m.kind, m.body, m.sender_id, m.created_at, m.deleted_at, m.attachment_id, m.meta, u.name AS sender_name,
              a.filename AS att_name
       FROM messages m LEFT JOIN users u ON u.id = m.sender_id LEFT JOIN attachments a ON a.id = m.attachment_id
       WHERE m.conversation_id = ? ORDER BY m.id DESC LIMIT 1`,
    )
    .get(c.id) as
    | {
        id: number;
        kind: string;
        body: string;
        sender_id: number;
        created_at: number;
        deleted_at: number | null;
        attachment_id: number | null;
        meta: string | null;
        sender_name: string;
        att_name: string | null;
      }
    | undefined;
  const unread = me
    ? (
        db()
          .prepare(
            `SELECT COUNT(*) AS n FROM messages WHERE conversation_id = ? AND id > ? AND kind != 'system' AND (sender_id IS NULL OR sender_id != ?) AND deleted_at IS NULL`,
          )
          .get(c.id, me.last_read_id, userId) as { n: number }
      ).n
    : 0;
  const mention = db()
    .prepare(
      `SELECT COUNT(CASE WHEN m.id > ? THEN 1 END) AS unread, MAX(m.created_at) AS latest
       FROM mentions x JOIN messages m ON m.id = x.message_id
       WHERE x.user_id = ? AND m.conversation_id = ? AND m.deleted_at IS NULL`,
    )
    .get(me?.last_read_id ?? 0, userId, c.id) as { unread: number; latest: number | null };
  const reads = db().prepare('SELECT user_id, last_read_id FROM members WHERE conversation_id = ?').all(c.id) as {
    user_id: number;
    last_read_id: number;
  }[];
  return {
    id: c.id,
    type: c.type,
    name: c.name,
    topic: c.topic,
    createdBy: c.created_by,
    lastMessageAt: c.last_message_at,
    memberIds: reads.map((r) => r.user_id),
    reads: Object.fromEntries(reads.map((r) => [r.user_id, r.last_read_id])),
    joined: !!me,
    muted: !!me?.muted,
    unread,
    mentions: mention.unread,
    mentionedAt: mention.latest,
    lastMessage: last
      ? {
          id: last.id,
          kind: last.kind,
          senderId: last.sender_id,
          senderName: last.kind === 'app' ? (JSON.parse(last.meta ?? '{}').appName ?? 'App') : last.sender_name,
          preview: previewOf(last),
          createdAt: last.created_at,
        }
      : null,
  };
}
function previewOf(m: { kind: string; body: string; deleted_at: number | null; att_name: string | null; meta: string | null }) {
  if (m.deleted_at) return 'Message deleted';
  if (m.kind === 'app') return JSON.parse(m.meta ?? '{}').title ?? m.body.slice(0, 140);
  if (m.kind === 'call') {
    const c = JSON.parse(m.meta ?? '{}');
    return c.status === 'ended' ? `${c.media === 'video' ? 'Video' : 'Voice'} call ended` : c.status === 'declined' ? 'Call declined' : 'Missed call';
  }
  const body = m.body.slice(0, 140);
  if (m.kind === 'notice') return `Notice: ${body}`;
  return body || (m.att_name ? `Shared a file: ${m.att_name}` : '');
}

export type ConversationSummary = ReturnType<typeof summary>;

export function getConversation(userId: number, convId: number) {
  const c = conv(convId);
  if (c.type !== 'channel' && !isMember(userId, convId)) throw forbidden('You are not in this conversation');
  return summary(userId, c);
}

export function listConversations(userId: number) {
  const rows = db()
    .prepare(
      `SELECT c.* FROM conversations c JOIN members m ON m.conversation_id = c.id
       WHERE m.user_id = ? ORDER BY c.last_message_at DESC`,
    )
    .all(userId) as ConvRow[];
  return rows.map((c) => summary(userId, c));
}

/** All channels (joined or not) so people can discover and join them. */
export function browseChannels(userId: number) {
  const rows = db().prepare("SELECT * FROM conversations WHERE type = 'channel' ORDER BY name").all() as ConvRow[];
  return rows.map((c) => summary(userId, c));
}

function notifyConversation(convId: number, extraUserIds: number[] = []) {
  const ids = [...memberIds(convId), ...extraUserIds];
  for (const uid of new Set(ids)) {
    const c = conv(convId);
    publish([uid], { type: 'conversation:updated', conversation: summary(uid, c) });
  }
}

export function openDm(userId: number, otherId: number) {
  if (!getUser(otherId)) throw notFound('User not found');
  const key = [userId, otherId].sort((a, b) => a - b).join(':');
  const existing = db().prepare('SELECT id FROM conversations WHERE dm_key = ?').get(key) as { id: number } | undefined;
  if (existing) return getConversation(userId, existing.id);
  const id = tx(() => {
    const t = now();
    const { lastInsertRowid } = db()
      .prepare("INSERT INTO conversations (type, dm_key, created_by, created_at, last_message_at) VALUES ('dm',?,?,?,?)")
      .run(key, userId, t, t);
    const cid = Number(lastInsertRowid);
    const add = db().prepare('INSERT OR IGNORE INTO members (conversation_id, user_id, joined_at) VALUES (?,?,?)');
    add.run(cid, userId, t);
    add.run(cid, otherId, t);
    return cid;
  });
  notifyConversation(id);
  return getConversation(userId, id);
}

const CHANNEL_RE = /^[a-z0-9][a-z0-9-_]{0,39}$/;

export function createConversation(userId: number, input: { type?: unknown; name?: unknown; topic?: unknown; memberIds?: unknown }) {
  const type = input.type;
  if (type !== 'group' && type !== 'channel') throw bad('type must be group or channel');
  let name = str(input.name, 'Name', { max: 60, optional: type === 'group' });
  const topic = str(input.topic, 'Topic', { max: 250, optional: true });
  const members = Array.isArray(input.memberIds) ? (input.memberIds as unknown[]).map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  if (type === 'channel') {
    name = name.toLowerCase().replace(/^#/, '').replace(/\s+/g, '-');
    if (!CHANNEL_RE.test(name)) throw bad('Channel names use lowercase letters, numbers and dashes (max 40)');
    if (db().prepare("SELECT 1 FROM conversations WHERE type = 'channel' AND name = ?").get(name)) throw bad('A channel with that name exists');
  } else if (members.filter((m) => m !== userId).length < 2) {
    throw bad('A group chat needs at least two other people');
  }
  for (const m of members) if (!getUser(m)) throw bad('Unknown member');
  const id = tx(() => {
    const t = now();
    const { lastInsertRowid } = db()
      .prepare('INSERT INTO conversations (type, name, topic, created_by, created_at, last_message_at) VALUES (?,?,?,?,?,?)')
      .run(type, name, topic, userId, t, t);
    const cid = Number(lastInsertRowid);
    const add = db().prepare('INSERT OR IGNORE INTO members (conversation_id, user_id, joined_at) VALUES (?,?,?)');
    for (const m of new Set([userId, ...members])) add.run(cid, m, t);
    return cid;
  });
  systemMessage(id, `${getUser(userId)!.name} created this ${type === 'channel' ? 'channel' : 'group'}`);
  return getConversation(userId, id);
}

export function updateConversation(userId: number, convId: number, input: { name?: unknown; topic?: unknown }) {
  const c = requireMember(userId, convId);
  if (c.type === 'dm') throw bad('Direct chats cannot be renamed');
  const sets: string[] = [];
  const vals: string[] = [];
  if (input.name !== undefined) {
    let name = str(input.name, 'Name', { max: 60, optional: c.type === 'group' });
    if (c.type === 'channel') {
      name = name.toLowerCase().replace(/^#/, '').replace(/\s+/g, '-');
      if (!CHANNEL_RE.test(name)) throw bad('Channel names use lowercase letters, numbers and dashes (max 40)');
      if (db().prepare("SELECT 1 FROM conversations WHERE type = 'channel' AND name = ? AND id != ?").get(name, convId))
        throw bad('A channel with that name exists');
    }
    sets.push('name = ?');
    vals.push(name);
  }
  if (input.topic !== undefined) {
    sets.push('topic = ?');
    vals.push(str(input.topic, 'Topic', { max: 250, optional: true }));
  }
  if (sets.length) db().prepare(`UPDATE conversations SET ${sets.join(', ')} WHERE id = ?`).run(...vals, convId);
  systemMessage(convId, `${getUser(userId)!.name} updated the ${input.topic !== undefined ? 'topic' : 'name'}`);
  return getConversation(userId, convId);
}

export function joinChannel(userId: number, convId: number) {
  const c = conv(convId);
  if (c.type !== 'channel') throw forbidden('Only channels can be joined');
  if (!isMember(userId, convId)) {
    db().prepare('INSERT INTO members (conversation_id, user_id, joined_at) VALUES (?,?,?)').run(convId, userId, now());
    systemMessage(convId, `${getUser(userId)!.name} joined`);
  }
  return getConversation(userId, convId);
}

export function addMembers(userId: number, convId: number, userIds: number[]) {
  const c = requireMember(userId, convId);
  if (c.type === 'dm') throw bad('Start a group chat to add people');
  const added: string[] = [];
  for (const uid of userIds) {
    const u = getUser(uid);
    if (!u) throw bad('Unknown member');
    if (!isMember(uid, convId)) {
      db().prepare('INSERT INTO members (conversation_id, user_id, joined_at) VALUES (?,?,?)').run(convId, uid, now());
      added.push(u.name);
    }
  }
  if (added.length) systemMessage(convId, `${getUser(userId)!.name} added ${added.join(', ')}`);
  return getConversation(userId, convId);
}

export function leaveConversation(userId: number, convId: number) {
  const c = requireMember(userId, convId);
  if (c.type === 'dm') throw bad('You cannot leave a direct chat');
  db().prepare('DELETE FROM members WHERE conversation_id = ? AND user_id = ?').run(convId, userId);
  systemMessage(convId, `${getUser(userId)!.name} left`);
  publish([userId], { type: 'conversation:removed', conversationId: convId });
}

export function setMuted(userId: number, convId: number, muted: boolean) {
  requireMember(userId, convId);
  db().prepare('UPDATE members SET muted = ? WHERE conversation_id = ? AND user_id = ?').run(muted ? 1 : 0, convId, userId);
  return getConversation(userId, convId);
}

// --- messages ---

type MsgRow = {
  id: number;
  conversation_id: number;
  sender_id: number | null;
  kind: string;
  body: string;
  reply_to_id: number | null;
  attachment_id: number | null;
  meta: string | null;
  created_at: number;
  edited_at: number | null;
  deleted_at: number | null;
};

function hydrate(rows: MsgRow[]) {
  if (!rows.length) return [];
  const idList = rows.map((r) => r.id);
  const ph = idList.map(() => '?').join(',');
  const reacts = db().prepare(`SELECT message_id, user_id, emoji FROM reactions WHERE message_id IN (${ph})`).all(...idList) as {
    message_id: number;
    user_id: number;
    emoji: string;
  }[];
  const acks = db().prepare(`SELECT message_id, user_id FROM acknowledgements WHERE message_id IN (${ph})`).all(...idList) as {
    message_id: number;
    user_id: number;
  }[];
  const pinned = new Set(
    (db().prepare(`SELECT message_id FROM pins WHERE message_id IN (${ph})`).all(...idList) as { message_id: number }[]).map((p) => p.message_id),
  );
  const attIds = rows.map((r) => r.attachment_id).filter((x): x is number => !!x);
  const atts = attIds.length
    ? (db()
        .prepare(`SELECT id, filename, mime, size FROM attachments WHERE id IN (${attIds.map(() => '?').join(',')})`)
        .all(...attIds) as { id: number; filename: string; mime: string; size: number }[])
    : [];
  const replyIds = rows.map((r) => r.reply_to_id).filter((x): x is number => !!x);
  const replies = replyIds.length
    ? (db()
        .prepare(
          `SELECT m.id, m.body, m.deleted_at, u.name AS sender_name FROM messages m LEFT JOIN users u ON u.id = m.sender_id
           WHERE m.id IN (${replyIds.map(() => '?').join(',')})`,
        )
        .all(...replyIds) as { id: number; body: string; deleted_at: number | null; sender_name: string }[])
    : [];
  return rows.map((r) => {
    const reactions: Record<string, number[]> = {};
    for (const x of reacts) if (x.message_id === r.id) (reactions[x.emoji] ??= []).push(x.user_id);
    const rep = replies.find((x) => x.id === r.reply_to_id);
    const deleted = !!r.deleted_at;
    return {
      id: r.id,
      conversationId: r.conversation_id,
      senderId: r.sender_id,
      kind: r.kind,
      body: deleted ? '' : r.body,
      createdAt: r.created_at,
      editedAt: r.edited_at,
      deleted,
      reactions: deleted ? {} : reactions,
      attachment: deleted ? null : (atts.find((a) => a.id === r.attachment_id) ?? null),
      replyTo: rep ? { id: rep.id, senderName: rep.sender_name, body: rep.deleted_at ? 'Message deleted' : rep.body.slice(0, 160) } : null,
      meta: r.meta ? JSON.parse(r.meta) : null,
      acks: r.kind === 'notice' ? acks.filter((a) => a.message_id === r.id).map((a) => a.user_id) : [],
      pinned: pinned.has(r.id),
    };
  });
}
export type Message = ReturnType<typeof hydrate>[number];

function messageById(id: number): Message {
  const row = db().prepare('SELECT * FROM messages WHERE id = ?').get(id) as MsgRow | undefined;
  if (!row) throw notFound('Message not found');
  return hydrate([row])[0];
}

export function listMessages(userId: number, convId: number, before?: number, limit = 50) {
  const c = conv(convId);
  if (!isMember(userId, convId) && c.type !== 'channel') throw forbidden('You are not in this conversation');
  const rows = db()
    .prepare(`SELECT * FROM messages WHERE conversation_id = ? AND id < ? ORDER BY id DESC LIMIT ?`)
    .all(convId, before ?? Number.MAX_SAFE_INTEGER, Math.min(limit, 100)) as MsgRow[];
  return { messages: hydrate(rows.reverse()), hasMore: rows.length === Math.min(limit, 100) };
}

function insertMessage(
  convId: number,
  senderId: number | null,
  kind: string,
  body: string,
  opts: { replyToId?: number | null; attachmentId?: number | null; meta?: unknown } = {},
): Message {
  const t = now();
  const { lastInsertRowid } = db()
    .prepare(
      'INSERT INTO messages (conversation_id, sender_id, kind, body, reply_to_id, attachment_id, meta, created_at) VALUES (?,?,?,?,?,?,?,?)',
    )
    .run(convId, senderId, kind, body, opts.replyToId ?? null, opts.attachmentId ?? null, opts.meta ? JSON.stringify(opts.meta) : null, t);
  db().prepare('UPDATE conversations SET last_message_at = ? WHERE id = ?').run(t, convId);
  const id = Number(lastInsertRowid);
  if (kind === 'text' || kind === 'notice') saveMentions(id, convId, body, senderId);
  if (senderId) db().prepare('UPDATE members SET last_read_id = ? WHERE conversation_id = ? AND user_id = ?').run(id, convId, senderId);
  const msg = messageById(id);
  for (const uid of memberIds(convId)) {
    publish([uid], { type: 'message:new', message: msg, conversation: summary(uid, conv(convId)) });
  }
  return msg;
}

/**
 * @alex matches a member by email name (alex@...), full name without spaces, or a unique first name.
 * @everyone / @channel mention every member.
 */
export function findMentions(convId: number, body: string, senderId: number | null): number[] {
  const tokens = [...body.matchAll(/(?:^|[^\w@])@([a-z0-9][a-z0-9._-]*)/gi)].map((m) => m[1].toLowerCase().replace(/[._-]+$/, ''));
  if (!tokens.length) return [];
  const members = db()
    .prepare('SELECT u.id, u.email, u.name FROM members m JOIN users u ON u.id = m.user_id WHERE m.conversation_id = ?')
    .all(convId) as { id: number; email: string; name: string }[];
  const out = new Set<number>();
  for (const t of tokens) {
    if (t === 'everyone' || t === 'channel' || t === 'here') {
      for (const m of members) out.add(m.id);
      continue;
    }
    const exact = members.filter((m) => m.email.split('@')[0].toLowerCase() === t || m.name.toLowerCase().replace(/\s+/g, '') === t);
    const first = members.filter((m) => m.name.toLowerCase().split(/\s+/)[0] === t);
    for (const m of exact.length ? exact : first.length === 1 ? first : []) out.add(m.id);
  }
  if (senderId) out.delete(senderId);
  return [...out];
}

function saveMentions(msgId: number, convId: number, body: string, senderId: number | null) {
  db().prepare('DELETE FROM mentions WHERE message_id = ?').run(msgId);
  const add = db().prepare('INSERT OR IGNORE INTO mentions (message_id, user_id) VALUES (?,?)');
  for (const uid of findMentions(convId, body, senderId)) add.run(msgId, uid);
}

export function systemMessage(convId: number, body: string) {
  return insertMessage(convId, null, 'system', body);
}

export function callMessage(convId: number, initiatorId: number, meta: unknown) {
  return insertMessage(convId, initiatorId, 'call', '', { meta });
}

export function sendMessage(
  userId: number,
  convId: number,
  input: { body?: unknown; replyToId?: unknown; attachmentId?: unknown; notice?: unknown },
) {
  requireMember(userId, convId);
  const body = str(input.body, 'Message', { max: 8000, optional: true });
  if (input.notice && !body) throw bad('A notice needs some text');
  const attachmentId = input.attachmentId ? Number(input.attachmentId) : null;
  if (!body && !attachmentId) throw bad('Message is empty');
  if (attachmentId) {
    const a = db().prepare('SELECT uploader_id FROM attachments WHERE id = ?').get(attachmentId) as { uploader_id: number } | undefined;
    if (!a || a.uploader_id !== userId) throw bad('Attachment not found');
  }
  let replyToId: number | null = null;
  if (input.replyToId) {
    replyToId = Number(input.replyToId);
    const r = db().prepare('SELECT conversation_id FROM messages WHERE id = ?').get(replyToId) as { conversation_id: number } | undefined;
    if (!r || r.conversation_id !== convId) throw bad('Reply target not found');
  }
  return insertMessage(convId, userId, input.notice ? 'notice' : 'text', body, { replyToId, attachmentId });
}

function ownMessage(userId: number, msgId: number): MsgRow {
  const m = db().prepare('SELECT * FROM messages WHERE id = ?').get(msgId) as MsgRow | undefined;
  if (!m || !isMember(userId, m.conversation_id)) throw notFound('Message not found');
  if (m.sender_id !== userId || (m.kind !== 'text' && m.kind !== 'notice')) throw forbidden('You can only change your own messages');
  if (m.deleted_at) throw bad('Message was deleted');
  return m;
}

function broadcastUpdate(msgId: number) {
  const msg = messageById(msgId);
  publish(memberIds(msg.conversationId), { type: 'message:updated', message: msg });
  return msg;
}

export function editMessage(userId: number, msgId: number, body: unknown) {
  const m = ownMessage(userId, msgId);
  const text = str(body, 'Message', { max: 8000, min: m.attachment_id ? 0 : 1 });
  db().prepare('UPDATE messages SET body = ?, edited_at = ? WHERE id = ?').run(text, now(), msgId);
  saveMentions(msgId, m.conversation_id, text, userId);
  return broadcastUpdate(msgId);
}

export function deleteMessage(userId: number, msgId: number) {
  ownMessage(userId, msgId);
  db().prepare('UPDATE messages SET deleted_at = ? WHERE id = ?').run(now(), msgId);
  db().prepare('DELETE FROM reactions WHERE message_id = ?').run(msgId);
  db().prepare('DELETE FROM pins WHERE message_id = ?').run(msgId);
  db().prepare('DELETE FROM mentions WHERE message_id = ?').run(msgId);
  const msg = broadcastUpdate(msgId);
  publish(memberIds(msg.conversationId), { type: 'pins:changed', conversationId: msg.conversationId });
  return msg;
}

export function toggleReaction(userId: number, msgId: number, emoji: unknown) {
  if (typeof emoji !== 'string' || !REACTIONS.includes(emoji)) throw bad('Unsupported reaction');
  const m = db().prepare('SELECT conversation_id, deleted_at, kind FROM messages WHERE id = ?').get(msgId) as
    | { conversation_id: number; deleted_at: number | null; kind: string }
    | undefined;
  if (!m || !isMember(userId, m.conversation_id)) throw notFound('Message not found');
  if (m.deleted_at || m.kind === 'system') throw bad('Cannot react to this message');
  const del = db().prepare('DELETE FROM reactions WHERE message_id = ? AND user_id = ? AND emoji = ?').run(msgId, userId, emoji);
  if (!del.changes) db().prepare('INSERT INTO reactions (message_id, user_id, emoji) VALUES (?,?,?)').run(msgId, userId, emoji);
  return broadcastUpdate(msgId);
}

export function markRead(userId: number, convId: number, msgId: unknown) {
  requireMember(userId, convId);
  const max = (db().prepare('SELECT COALESCE(MAX(id),0) AS m FROM messages WHERE conversation_id = ?').get(convId) as { m: number }).m;
  const target = Math.min(Number(msgId) || max, max);
  db()
    .prepare('UPDATE members SET last_read_id = MAX(last_read_id, ?) WHERE conversation_id = ? AND user_id = ?')
    .run(target, convId, userId);
  publish(memberIds(convId), { type: 'conversation:read', conversationId: convId, userId, lastReadId: target });
}

export function searchMessages(userId: number, q: string) {
  const like = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  const rows = db()
    .prepare(
      `SELECT m.* FROM messages m JOIN members mem ON mem.conversation_id = m.conversation_id AND mem.user_id = ?
       WHERE m.kind IN ('text','notice') AND m.deleted_at IS NULL AND m.body LIKE ? ESCAPE '\\' ORDER BY m.id DESC LIMIT 30`,
    )
    .all(userId, like) as MsgRow[];
  return hydrate(rows);
}

// --- notices, pins ---

function visibleMessage(userId: number, msgId: number) {
  const m = db().prepare('SELECT * FROM messages WHERE id = ?').get(msgId) as MsgRow | undefined;
  if (!m || !isMember(userId, m.conversation_id)) throw notFound('Message not found');
  if (m.deleted_at) throw bad('Message was deleted');
  return m;
}

export function acknowledge(userId: number, msgId: number) {
  const m = visibleMessage(userId, msgId);
  if (m.kind !== 'notice') throw bad('Only notices can be acknowledged');
  db().prepare('INSERT OR IGNORE INTO acknowledgements (message_id, user_id, created_at) VALUES (?,?,?)').run(msgId, userId, now());
  return broadcastUpdate(msgId);
}

export function setPinned(userId: number, msgId: number, pinned: boolean) {
  const m = visibleMessage(userId, msgId);
  if (m.kind === 'system' || m.kind === 'call') throw bad('This message cannot be pinned');
  if (pinned)
    db().prepare('INSERT OR IGNORE INTO pins (conversation_id, message_id, pinned_by, created_at) VALUES (?,?,?,?)').run(m.conversation_id, msgId, userId, now());
  else db().prepare('DELETE FROM pins WHERE message_id = ?').run(msgId);
  const msg = broadcastUpdate(msgId);
  publish(memberIds(m.conversation_id), { type: 'pins:changed', conversationId: m.conversation_id });
  return msg;
}

export function listPins(userId: number, convId: number) {
  const c = conv(convId);
  if (!isMember(userId, convId) && c.type !== 'channel') throw forbidden('You are not in this conversation');
  const rows = db()
    .prepare('SELECT m.* FROM pins p JOIN messages m ON m.id = p.message_id WHERE p.conversation_id = ? ORDER BY p.created_at DESC LIMIT 50')
    .all(convId) as MsgRow[];
  return hydrate(rows);
}

// --- connected apps (incoming webhooks) ---

const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

export function listApps(userId: number, convId: number) {
  const c = conv(convId);
  if (!isMember(userId, convId) && c.type !== 'channel') throw forbidden('You are not in this conversation');
  return (
    db().prepare('SELECT id, name, created_by, created_at, last_used_at FROM apps WHERE conversation_id = ? ORDER BY name').all(convId) as {
      id: number;
      name: string;
      created_by: number;
      created_at: number;
      last_used_at: number | null;
    }[]
  ).map((a) => ({ id: a.id, name: a.name, createdBy: a.created_by, createdAt: a.created_at, lastUsedAt: a.last_used_at }));
}

/** Returns the secret token once; only its hash is stored. */
export function createApp(userId: number, convId: number, nameIn: unknown) {
  const c = requireMember(userId, convId);
  if (c.type === 'dm') throw bad('Connect apps to a channel or group');
  const name = str(nameIn, 'App name', { min: 1, max: 40 });
  const token = crypto.randomBytes(24).toString('base64url');
  const { lastInsertRowid } = db()
    .prepare('INSERT INTO apps (conversation_id, name, token_hash, created_by, created_at) VALUES (?,?,?,?,?)')
    .run(convId, name, hashToken(token), userId, now());
  systemMessage(convId, `${getUser(userId)!.name} connected the app ${name}`);
  publish(memberIds(convId), { type: 'apps:changed', conversationId: convId });
  return { id: Number(lastInsertRowid), name, token };
}

export function deleteApp(userId: number, appId: number) {
  const a = db().prepare('SELECT conversation_id, name FROM apps WHERE id = ?').get(appId) as { conversation_id: number; name: string } | undefined;
  if (!a || !isMember(userId, a.conversation_id)) throw notFound('App not found');
  db().prepare('DELETE FROM apps WHERE id = ?').run(appId);
  systemMessage(a.conversation_id, `${getUser(userId)!.name} disconnected the app ${a.name}`);
  publish(memberIds(a.conversation_id), { type: 'apps:changed', conversationId: a.conversation_id });
}

const hookHits = new Map<number, { n: number; reset: number }>();

/** POST /api/hooks/:token  {title, text?, severity?: info|warning|critical|resolved, link?} */
export function postFromApp(token: string, input: { title?: unknown; text?: unknown; severity?: unknown; link?: unknown }) {
  const a = db().prepare('SELECT id, conversation_id, name FROM apps WHERE token_hash = ?').get(hashToken(token)) as
    | { id: number; conversation_id: number; name: string }
    | undefined;
  if (!a) throw notFound('Unknown webhook');
  const h = hookHits.get(a.id);
  const t = now();
  if (h && h.reset > t && h.n >= 60) throw new HttpError(429, 'Too many alerts, slow down (60 per minute)');
  hookHits.set(a.id, h && h.reset > t ? { n: h.n + 1, reset: h.reset } : { n: 1, reset: t + 60_000 });
  const title = str(input.title, 'title', { min: 1, max: 200 });
  const text = str(input.text, 'text', { max: 4000, optional: true });
  const severity = ['info', 'warning', 'critical', 'resolved'].includes(input.severity as string) ? input.severity : 'info';
  let link: string | null = null;
  if (typeof input.link === 'string' && input.link) {
    try {
      const u = new URL(input.link);
      if (u.protocol === 'https:' || u.protocol === 'http:') link = u.toString();
    } catch {
      /* ignore invalid links */
    }
  }
  db().prepare('UPDATE apps SET last_used_at = ? WHERE id = ?').run(t, a.id);
  return insertMessage(a.conversation_id, null, 'app', text, { meta: { appId: a.id, appName: a.name, title, severity, link } });
}

// --- files shared with me ---

export function listFiles(userId: number, q = '') {
  const like = `%${q.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  return db()
    .prepare(
      `SELECT * FROM (
         SELECT a.id, a.filename, a.mime, a.size, m.created_at AS shared_at, m.sender_id AS shared_by,
                'chat' AS source, m.conversation_id AS ref_id
         FROM messages m JOIN members mem ON mem.conversation_id = m.conversation_id AND mem.user_id = ?
         JOIN attachments a ON a.id = m.attachment_id
         WHERE m.deleted_at IS NULL
         UNION
         SELECT a.id, a.filename, a.mime, a.size, COALESCE(e.sent_at, e.created_at), e.sender_id, 'mail', e.id
         FROM email_attachments ea JOIN emails e ON e.id = ea.email_id
         JOIN mailbox b ON b.email_id = e.id AND b.user_id = ? AND b.folder != 'trash'
         JOIN attachments a ON a.id = ea.attachment_id
         WHERE e.sent_at IS NOT NULL
       ) WHERE filename LIKE ? ESCAPE '\\' ORDER BY shared_at DESC LIMIT 300`,
    )
    .all(userId, userId, like) as {
    id: number;
    filename: string;
    mime: string;
    size: number;
    shared_at: number;
    shared_by: number;
    source: 'chat' | 'mail';
    ref_id: number;
  }[];
}
