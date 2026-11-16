import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.RELAY_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-test-'));
process.env.RELAY_RING_MS = '50';

const { resetDb, db, recoverAfterCrash } = await import('../server/db.ts');
const { safePath, setQuiet } = await import('../server/log.ts');
setQuiet(true);
const auth = await import('../server/auth.ts');
const chat = await import('../server/chat.ts');
const mail = await import('../server/mail.ts');
const calls = await import('../server/calls.ts');
const admin = await import('../server/admin.ts');
const { installTransport } = await import('../server/bus.ts');
const { saveUpload, openAttachment } = await import('../server/attachments.ts');

type Ev = { to: number; type: string; [k: string]: unknown };
let events: Ev[] = [];
installTransport((to, e) => events.push({ to, ...e }), () => true);

let a: number, b: number, c: number;
beforeEach(() => {
  resetDb();
  calls._resetCalls();
  events = [];
  a = auth.createUser({ email: 'ann@x.co', name: 'Ann Lee', password: 'password1' }, { role: 'admin' }).id;
  b = auth.createUser({ email: 'bob@x.co', name: 'Bob Stone', password: 'password1' }).id;
  c = auth.createUser({ email: 'cara@x.co', name: 'Cara Diaz', password: 'password1' }).id;
});

test('login: wrong password and disabled accounts are rejected, sessions resolve', () => {
  assert.throws(() => auth.login('ann@x.co', 'nope', '1.1.1.1'), /Incorrect/);
  const { token } = auth.login('ANN@x.co', 'password1', '1.1.1.1');
  assert.equal(auth.userForToken(token)?.id, a);
  auth.setDisabled(b, true);
  assert.throws(() => auth.login('bob@x.co', 'password1', '1.1.1.1'), /Incorrect/);
});

test('login is throttled after repeated failures', () => {
  for (let i = 0; i < 10; i++) assert.throws(() => auth.login('ann@x.co', 'bad', '9.9.9.9'));
  assert.throws(() => auth.login('ann@x.co', 'password1', '9.9.9.9'), /Too many/);
  // a different IP is unaffected
  assert.ok(auth.login('ann@x.co', 'password1', '8.8.8.8').token);
});

test('cannot demote the last admin', () => {
  assert.throws(() => auth.setRole(a, 'member'), /at least one active admin/);
});

test('provisioning creates accounts that must change their password, and skips bad rows', () => {
  const r = admin.provision({ text: 'name,email,title\nDee Kay,dee@x.co,Ops\n"Smith, Jo",jo@x.co,\nNo Email,,\nAnn Again,ann@x.co,' });
  assert.deepEqual(r.created.map((x) => x.email), ['dee@x.co', 'jo@x.co']);
  assert.equal(r.created[1].name, 'Smith, Jo');
  assert.equal(r.skipped.length, 2);
  const { user } = auth.login('dee@x.co', r.created[0].password, 'ip');
  assert.equal(user.must_change_password, 1);
  auth.changePassword(user.id, r.created[0].password, 'a-new-password');
  assert.equal(auth.getUser(user.id)!.must_change_password, 0);
});

test('one DM per pair; only members can read or post', () => {
  const dm1 = chat.openDm(a, b);
  const dm2 = chat.openDm(b, a);
  assert.equal(dm1.id, dm2.id);
  chat.sendMessage(a, dm1.id, { body: 'hi' });
  assert.throws(() => chat.listMessages(c, dm1.id), /not in this conversation/);
  assert.throws(() => chat.sendMessage(c, dm1.id, { body: 'x' }), /not in this conversation/);
  assert.equal(chat.listMessages(b, dm1.id).messages.length, 1);
});

test('unread counts, read receipts and real-time fan-out to members only', () => {
  const g = chat.createConversation(a, { type: 'group', memberIds: [b, c] });
  events = [];
  chat.sendMessage(a, g.id, { body: 'one' });
  const m2 = chat.sendMessage(a, g.id, { body: 'two' });
  assert.equal(chat.getConversation(b, g.id).unread, 2);
  assert.equal(chat.getConversation(a, g.id).unread, 0);
  assert.deepEqual([...new Set(events.filter((e) => e.type === 'message:new').map((e) => e.to))].sort(), [a, b, c].sort());
  chat.markRead(b, g.id, m2.id);
  assert.equal(chat.getConversation(b, g.id).unread, 0);
  assert.equal(chat.getConversation(a, g.id).reads[b], m2.id);
});

test('edit/delete only your own messages; reactions use the line-icon set', () => {
  const dm = chat.openDm(a, b);
  const m = chat.sendMessage(a, dm.id, { body: 'hello' });
  assert.throws(() => chat.editMessage(b, m.id, 'hacked'), /own messages/);
  assert.equal(chat.editMessage(a, m.id, 'hello!').body, 'hello!');
  assert.throws(() => chat.toggleReaction(b, m.id, '👍'), /Unsupported/);
  assert.deepEqual(chat.toggleReaction(b, m.id, 'like').reactions, { like: [b] });
  assert.deepEqual(chat.toggleReaction(b, m.id, 'like').reactions, {});
  const d = chat.deleteMessage(a, m.id);
  assert.equal(d.deleted, true);
  assert.equal(d.body, '');
});

test('mentions resolve to members and drive the Mentions filter', () => {
  const ch = chat.createConversation(a, { type: 'channel', name: 'ops', memberIds: [b] });
  chat.sendMessage(a, ch.id, { body: 'ping @bob and @cara' }); // cara is not a member
  assert.equal(chat.getConversation(b, ch.id).mentions, 1);
  assert.ok(chat.getConversation(b, ch.id).mentionedAt);
  assert.deepEqual(chat.findMentions(ch.id, 'hey @everyone', a), [b]);
  assert.deepEqual(chat.findMentions(ch.id, 'email bob@x.co', a), []);
  assert.deepEqual(chat.findMentions(ch.id, '@BobStone ok', a), [b]);
});

test('notices collect acknowledgements; plain messages cannot be acknowledged', () => {
  const ch = chat.createConversation(a, { type: 'channel', name: 'all', memberIds: [b, c] });
  const n = chat.sendMessage(a, ch.id, { body: 'Teams is down', notice: true });
  assert.equal(n.kind, 'notice');
  assert.deepEqual(chat.acknowledge(b, n.id).acks, [b]);
  chat.acknowledge(b, n.id); // idempotent
  assert.deepEqual(chat.acknowledge(c, n.id).acks.sort(), [b, c].sort());
  const plain = chat.sendMessage(a, ch.id, { body: 'x' });
  assert.throws(() => chat.acknowledge(b, plain.id), /Only notices/);
});

test('pins are per conversation and listed for the side panel', () => {
  const ch = chat.createConversation(a, { type: 'channel', name: 'p', memberIds: [b] });
  const m = chat.sendMessage(b, ch.id, { body: 'dial-in: 123' });
  chat.setPinned(a, m.id, true);
  assert.deepEqual(chat.listPins(b, ch.id).map((x) => x.id), [m.id]);
  chat.setPinned(a, m.id, false);
  assert.equal(chat.listPins(b, ch.id).length, 0);
  assert.throws(() => chat.setPinned(c, m.id, true), /not found/);
});

test('connected app webhooks post alert cards, sanitize links, and stop after removal', () => {
  const ch = chat.createConversation(a, { type: 'channel', name: 'alerts', memberIds: [b] });
  const app = chat.createApp(a, ch.id, 'Uptime');
  const m = chat.postFromApp(app.token, { title: 'Down', severity: 'critical', link: 'javascript:alert(1)' });
  assert.equal(m.kind, 'app');
  assert.equal(m.meta!.title, 'Down');
  assert.equal(m.meta!.link, null);
  assert.equal(chat.postFromApp(app.token, { title: 'Up', severity: 'nonsense', link: 'https://s.io/x' }).meta!.severity, 'info');
  assert.equal(db().prepare('SELECT COUNT(*) AS n FROM apps WHERE token_hash = ?').get(app.token) ? 1 : 0, 1);
  assert.throws(() => chat.postFromApp('wrong', { title: 'x' }), /Unknown webhook/);
  assert.throws(() => chat.createApp(a, chat.openDm(a, b).id, 'x'), /channel or group/);
  chat.deleteApp(a, app.id);
  assert.throws(() => chat.postFromApp(app.token, { title: 'x' }), /Unknown webhook/);
});

test('mail: send, bcc privacy, thread replies, folders, drafts', () => {
  const sent = mail.send(a, { to: 'bob@x.co', bcc: [c], subject: 'Plan', body: 'Use Relay' });
  assert.equal(sent.folder, 'sent');
  assert.deepEqual(sent.bcc.map((p) => p.id), [c]);
  const bobView = mail.getEmail(b, sent.id).email;
  assert.deepEqual(bobView.bcc, []);
  assert.deepEqual(mail.getEmail(c, sent.id).email.bcc.map((p) => p.id), [c]);
  assert.equal(mail.counts(b).inbox.unread, 0); // opened above
  const reply = mail.send(b, { to: [a], subject: 'Re: Plan', body: 'ok', inReplyTo: sent.id });
  assert.equal(mail.getEmail(a, reply.id).thread.length, 2);
  assert.throws(() => mail.getEmail(a + 100, sent.id), /not found/);
  assert.throws(() => mail.send(a, { to: 'nobody@x.co', subject: 'x' }), /no one in the directory/);
  const draft = mail.saveDraft(a, { subject: 'later' });
  assert.equal(mail.listFolder(a, 'drafts').length, 1);
  assert.throws(() => mail.update(a, draft.id, { folder: 'inbox' }), /Drafts/);
  mail.update(b, sent.id, { folder: 'trash' });
  mail.destroy(b, sent.id);
  assert.ok(mail.getEmail(a, sent.id)); // others keep their copy
});

test('attachments are only readable by people who can see them', () => {
  const dm = chat.openDm(a, b);
  const f = saveUpload(a, '../../etc/passwd', 'text/plain', Buffer.from('hello'));
  assert.equal(f.filename, 'passwd');
  assert.throws(() => openAttachment(b, f.id), /not found/);
  chat.sendMessage(a, dm.id, { attachmentId: f.id });
  assert.ok(openAttachment(b, f.id));
  assert.throws(() => openAttachment(c, f.id), /not found/);
  assert.throws(() => chat.sendMessage(b, dm.id, { attachmentId: f.id }), /Attachment not found/); // can't re-post someone else's upload
  assert.equal(chat.listFiles(b).length, 1);
  assert.equal(chat.listFiles(c).length, 0);
});

test('calls: ring, answer, signal only between participants, hang up logs a summary', () => {
  const dm = chat.openDm(a, b);
  events = [];
  const call = calls.start(a, 'connA', dm.id, 'video');
  assert.ok(events.some((e) => e.type === 'call:ring' && e.to === b));
  assert.throws(() => calls.join(c, 'connC', call.id), /not in this conversation/);
  calls.join(b, 'connB', call.id);
  assert.ok(events.some((e) => e.type === 'call:peer-joined' && e.to === a && e.connId === 'connA'));
  events = [];
  calls.signal(a, call.id, b, { kind: 'offer' });
  assert.deepEqual(events.map((e) => [e.type, e.to, e.connId]), [['call:signal', b, 'connB']]);
  assert.throws(() => calls.signal(c, call.id, a, {}), /Not in this call/);
  calls.leave(b, call.id, 'stale-tab'); // wrong tab: ignored
  assert.equal(calls.activeCalls(a).length, 1);
  calls.leave(b, call.id, 'connB');
  assert.equal(calls.activeCalls(a).length, 0);
  const last = chat.listMessages(a, dm.id).messages.at(-1)!;
  assert.equal(last.kind, 'call');
  assert.equal(last.meta!.status, 'ended');
  assert.equal(calls.history(b)[0].status, 'ended');
});

test('calls: unanswered DM call becomes missed; decline ends it', async () => {
  const dm = chat.openDm(a, b);
  const c1 = calls.start(a, 'x', dm.id, 'audio');
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(calls.activeCalls(a).length, 0);
  assert.equal(calls.history(b).find((h) => h.id === c1.id)!.missedByMe, true);
  const c2 = calls.start(a, 'x', dm.id, 'audio');
  calls.decline(b, c2.id);
  assert.equal(calls.history(a).find((h) => h.id === c2.id)!.status, 'declined');
});

test('group meetings stay open until the last person leaves', () => {
  const g = chat.createConversation(a, { type: 'group', memberIds: [b, c] });
  const call = calls.start(a, 'A', g.id, 'audio');
  calls.join(b, 'B', call.id);
  calls.join(c, 'C', call.id);
  calls.leave(a, call.id, 'A');
  assert.equal(calls.activeCalls(b)[0].participants.length, 2);
  calls.leave(b, call.id, 'B');
  calls.leave(c, call.id, 'C');
  assert.equal(calls.activeCalls(b).length, 0);
});

test('announcements replace each other and reach every user', () => {
  events = [];
  admin.announce(a, { body: 'Teams down', severity: 'critical' });
  assert.equal(new Set(events.filter((e) => e.type === 'announcement').map((e) => e.to)).size, 3);
  admin.announce(a, { body: 'Update', severity: 'info' });
  assert.equal(admin.currentAnnouncement()!.body, 'Update');
  admin.clearAnnouncement();
  assert.equal(admin.currentAnnouncement(), null);
});

test('after a crash, calls left live in the database are closed on boot', () => {
  const dm = chat.openDm(a, b);
  const t = Date.now() - 60_000;
  db().prepare("INSERT INTO calls (conversation_id, initiator_id, media, status, started_at, answered_at) VALUES (?,?,?,'active',?,?)").run(dm.id, a, 'audio', t, t + 1000);
  db().prepare("INSERT INTO calls (conversation_id, initiator_id, media, status, started_at) VALUES (?,?,?,'ringing',?)").run(dm.id, a, 'audio', t);
  db().prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?,?,?)').run('old', a, t);
  assert.equal(recoverAfterCrash(), 2);
  const rows = db().prepare('SELECT status, ended_at FROM calls ORDER BY id').all() as { status: string; ended_at: number }[];
  assert.deepEqual(rows.map((r) => r.status), ['ended', 'missed']);
  assert.ok(rows.every((r) => r.ended_at));
  assert.equal(auth.userForToken('old'), null);
  assert.equal(recoverAfterCrash(), 0);
});

test('shutdown ends live calls and logs them in the chat', () => {
  const dm = chat.openDm(a, b);
  const call = calls.start(a, 'A', dm.id, 'video');
  calls.join(b, 'B', call.id);
  assert.equal(calls.endAll(), 1);
  assert.equal(calls.activeCalls(a).length, 0);
  assert.equal(chat.listMessages(a, dm.id).messages.at(-1)!.meta!.status, 'ended');
});

test('webhook secrets never reach the logs', () => {
  assert.equal(safePath('/api/hooks/abc123secret'), '/api/hooks/[redacted]');
  assert.equal(safePath('/api/me'), '/api/me');
});
