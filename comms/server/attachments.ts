import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { db, now, uploadsDir } from './db.ts';
import { bad, notFound } from './errors.ts';

export const MAX_UPLOAD = Number(process.env.RELAY_MAX_UPLOAD_MB ?? 25) * 1024 * 1024;

export function saveUpload(userId: number, filenameIn: string, mimeIn: string, data: Buffer) {
  if (!data.length) throw bad('File is empty');
  if (data.length > MAX_UPLOAD) throw bad(`Files can be at most ${MAX_UPLOAD / 1024 / 1024} MB`);
  const filename = path.basename(filenameIn || 'file').replace(/[\x00-\x1f"\\/]/g, '_').slice(0, 200) || 'file';
  const mime = /^[\w.+-]+\/[\w.+-]+$/.test(mimeIn) ? mimeIn.toLowerCase() : 'application/octet-stream';
  const stored = crypto.randomBytes(16).toString('hex');
  fs.writeFileSync(path.join(uploadsDir(), stored), data);
  const { lastInsertRowid } = db()
    .prepare('INSERT INTO attachments (uploader_id, filename, mime, size, stored_name, created_at) VALUES (?,?,?,?,?,?)')
    .run(userId, filename, mime, data.length, stored, now());
  return { id: Number(lastInsertRowid), filename, mime, size: data.length };
}

/** A user may download a file they uploaded, one posted in a chat they belong to, or one on an email in their mailbox. */
export function openAttachment(userId: number, id: number) {
  const a = db().prepare('SELECT * FROM attachments WHERE id = ?').get(id) as
    | { id: number; uploader_id: number; filename: string; mime: string; size: number; stored_name: string }
    | undefined;
  if (!a) throw notFound('File not found');
  const allowed =
    a.uploader_id === userId ||
    db()
      .prepare(
        `SELECT 1 FROM messages m JOIN members mem ON mem.conversation_id = m.conversation_id AND mem.user_id = ?
         WHERE m.attachment_id = ? AND m.deleted_at IS NULL`,
      )
      .get(userId, id) ||
    db()
      .prepare('SELECT 1 FROM email_attachments ea JOIN mailbox b ON b.email_id = ea.email_id AND b.user_id = ? WHERE ea.attachment_id = ?')
      .get(userId, id);
  if (!allowed) throw notFound('File not found');
  return { ...a, path: path.join(uploadsDir(), a.stored_name) };
}

/** Only raster images (not SVG, which can carry script) are shown inline. */
export const INLINE_SAFE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
