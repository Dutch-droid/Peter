import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#5b5fc7',
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available','busy','dnd','away')),
  status_message TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
  must_change_password INTEGER NOT NULL DEFAULT 0,
  disabled INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER,
  created_at INTEGER NOT NULL
);

-- Admin broadcasts shown as a banner to everyone (e.g. "Teams is down, use Relay until further notice").
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  author_id INTEGER NOT NULL REFERENCES users(id),
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warning','critical')),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  cleared_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);

-- Chats: 'dm' = one-to-one, 'group' = ad-hoc group chat, 'channel' = named team channel anyone can join.
CREATE TABLE IF NOT EXISTS conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL CHECK (type IN ('dm','group','channel')),
  name TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL DEFAULT '',
  dm_key TEXT UNIQUE,            -- "minId:maxId" for dm, so each pair has one chat
  created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL,
  last_message_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  muted INTEGER NOT NULL DEFAULT 0,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX IF NOT EXISTS members_user ON members(user_id);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  uploader_id INTEGER NOT NULL REFERENCES users(id),
  filename TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  stored_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id INTEGER REFERENCES users(id),
  kind TEXT NOT NULL DEFAULT 'text' CHECK (kind IN ('text','notice','system','call','app')),
  body TEXT NOT NULL DEFAULT '',
  reply_to_id INTEGER REFERENCES messages(id),
  attachment_id INTEGER REFERENCES attachments(id),
  meta TEXT,                      -- JSON: call summary, or app alert {appId, appName, title, severity, link}
  created_at INTEGER NOT NULL,
  edited_at INTEGER,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS messages_conv ON messages(conversation_id, id);

-- A notice asks members to acknowledge it.
CREATE TABLE IF NOT EXISTS acknowledgements (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS pins (
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  pinned_by INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (conversation_id, message_id)
);

CREATE TABLE IF NOT EXISTS mentions (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS mentions_user ON mentions(user_id);

-- Connected apps: incoming webhooks that post alert cards into one conversation.
CREATE TABLE IF NOT EXISTS apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);

CREATE TABLE IF NOT EXISTS reactions (
  message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  PRIMARY KEY (message_id, user_id, emoji)
);

-- Mail. One row per email; mailbox holds each user's copy (folder, read, starred).
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER,              -- id of the first email in the thread
  sender_id INTEGER NOT NULL REFERENCES users(id),
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  importance TEXT NOT NULL DEFAULT 'normal' CHECK (importance IN ('normal','high')),
  created_at INTEGER NOT NULL,
  sent_at INTEGER                 -- NULL while a draft
);
CREATE INDEX IF NOT EXISTS emails_thread ON emails(thread_id);

CREATE TABLE IF NOT EXISTS email_recipients (
  email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL CHECK (kind IN ('to','cc','bcc')),
  PRIMARY KEY (email_id, user_id)
);

CREATE TABLE IF NOT EXISTS email_attachments (
  email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  attachment_id INTEGER NOT NULL REFERENCES attachments(id),
  PRIMARY KEY (email_id, attachment_id)
);

CREATE TABLE IF NOT EXISTS mailbox (
  email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  folder TEXT NOT NULL CHECK (folder IN ('inbox','sent','drafts','archive','trash')),
  is_read INTEGER NOT NULL DEFAULT 0,
  starred INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (email_id, user_id)
);
CREATE INDEX IF NOT EXISTS mailbox_user ON mailbox(user_id, folder);

-- Calls happen inside a conversation (a DM call, or a group/channel meeting).
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  initiator_id INTEGER NOT NULL REFERENCES users(id),
  media TEXT NOT NULL CHECK (media IN ('audio','video')),
  status TEXT NOT NULL DEFAULT 'ringing' CHECK (status IN ('ringing','active','ended','missed','declined')),
  started_at INTEGER NOT NULL,
  answered_at INTEGER,
  ended_at INTEGER
);

CREATE TABLE IF NOT EXISTS call_participants (
  call_id INTEGER NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id),
  joined_at INTEGER NOT NULL,
  left_at INTEGER,
  PRIMARY KEY (call_id, user_id)
);
`;

let instance: DatabaseSync | null = null;

export function dataDir(): string {
  const dir = process.env.RELAY_DATA_DIR ?? path.join(process.cwd(), 'data');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function uploadsDir(): string {
  const dir = path.join(dataDir(), 'uploads');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function db(): DatabaseSync {
  if (!instance) {
    const file = process.env.RELAY_DB ?? path.join(dataDir(), 'relay.db');
    instance = new DatabaseSync(file);
    instance.exec('PRAGMA busy_timeout = 5000');
    instance.exec(SCHEMA);
  }
  return instance;
}

/** Shutdown: fold the write-ahead log into the main file and close it, so a copy of relay.db alone is complete. */
export function closeDb() {
  if (!instance) return;
  try {
    instance.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    instance.close();
    instance = null;
  }
}

/**
 * On boot, tidy up after a crash or power cut: calls that were live when the process died
 * are recorded as ended (or missed), and expired sessions are removed. Returns the calls fixed.
 */
export function recoverAfterCrash(): number {
  const t = Date.now();
  const r = db()
    .prepare(
      `UPDATE calls SET status = CASE WHEN answered_at IS NULL THEN 'missed' ELSE 'ended' END, ended_at = COALESCE(ended_at, ?)
       WHERE status IN ('ringing','active')`,
    )
    .run(t);
  db().prepare('UPDATE call_participants SET left_at = COALESCE(left_at, ?) WHERE left_at IS NULL').run(t);
  db().prepare('DELETE FROM sessions WHERE expires_at < ?').run(t);
  return Number(r.changes);
}

/** For tests: swap in a fresh in-memory database. */
export function resetDb(): DatabaseSync {
  instance?.close();
  instance = new DatabaseSync(':memory:');
  instance.exec(SCHEMA);
  return instance;
}

export function tx<T>(fn: () => T): T {
  const d = db();
  d.exec('BEGIN');
  try {
    const out = fn();
    d.exec('COMMIT');
    return out;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

export const now = () => Date.now();
