/**
 * Demo data: `npm run seed` (add `-- --reset` to wipe the database first).
 * Every demo account uses the password "relay-demo-1". Never run this against a real deployment.
 */
import fs from 'node:fs';
import path from 'node:path';
import { dataDir, db } from '../server/db.ts';
import { createUser, userCount } from '../server/auth.ts';
import * as chat from '../server/chat.ts';
import * as mail from '../server/mail.ts';
import { saveUpload } from '../server/attachments.ts';
import { ensureGeneral } from '../server/api.ts';

if (process.argv.includes('--reset')) {
  const file = process.env.RELAY_DB ?? path.join(dataDir(), 'relay.db');
  for (const f of [file, file + '-wal', file + '-shm']) fs.rmSync(f, { force: true });
  fs.rmSync(path.join(dataDir(), 'uploads'), { recursive: true, force: true });
}
db();
if (userCount() > 0) {
  console.log('Database already has users; skipping. Use `npm run seed -- --reset` to start over.');
  process.exit(0);
}

const PW = 'relay-demo-1';
const people = [
  { name: 'Amina Wanjiru', email: 'amina@example.com', title: 'IT Operations Lead', admin: true },
  { name: 'Daniel Otieno', email: 'daniel@example.com', title: 'Service Desk' },
  { name: 'Grace Muthoni', email: 'grace@example.com', title: 'Head of Finance' },
  { name: 'Peter Kamau', email: 'peter@example.com', title: 'Communications' },
  { name: 'Lucy Achieng', email: 'lucy@example.com', title: 'HR Business Partner' },
  { name: 'Brian Mwangi', email: 'brian@example.com', title: 'Network Engineer' },
  { name: 'Faith Njeri', email: 'faith@example.com', title: 'Customer Support' },
];
const u: Record<string, number> = {};
for (const p of people) u[p.email.split('@')[0]] = createUser({ ...p, password: PW }, { role: p.admin ? 'admin' : 'member' }).id;
// Everyone has "activated" except Faith, so the admin readiness card has something to show.
db().prepare("UPDATE users SET must_change_password = 1 WHERE email = 'faith@example.com'").run();
db().prepare('UPDATE users SET last_seen_at = ? WHERE email != ?').run(Date.now() - 3600_000, 'faith@example.com');
db().prepare("UPDATE users SET status = 'away', status_message = 'On site at the data centre' WHERE email = 'brian@example.com'").run();

ensureGeneral(u.amina);
const general = (db().prepare("SELECT id FROM conversations WHERE name = 'general'").get() as { id: number }).id;
chat.addMembers(u.amina, general, Object.values(u));
const incident = chat.createConversation(u.amina, {
  type: 'channel',
  name: 'incident-response',
  topic: 'Live coordination while Microsoft 365 is unavailable',
  memberIds: [u.daniel, u.brian, u.peter, u.grace, u.lucy],
}).id;
const itStatus = chat.createConversation(u.brian, { type: 'channel', name: 'it-status', topic: 'Automated alerts from monitoring', memberIds: [u.amina, u.daniel] }).id;
chat.createConversation(u.grace, { type: 'channel', name: 'finance', topic: 'Month-end close and approvals', memberIds: [u.amina] });

// Backdate so the timeline reads naturally.
let clock = Date.now() - 95 * 60_000;
const at = (min: number) => (clock += min * 60_000);
function stamp(msgId: number, t: number) {
  db().prepare('UPDATE messages SET created_at = ? WHERE id = ?').run(t, msgId);
  db().prepare('UPDATE conversations SET last_message_at = MAX(last_message_at, ?) WHERE id = (SELECT conversation_id FROM messages WHERE id = ?)').run(t, msgId);
}
const say = (who: string, conv: number, body: string, mins = 2, extra: Record<string, unknown> = {}) => {
  const m = chat.sendMessage(u[who], conv, { body, ...extra });
  stamp(m.id, at(mins));
  return m;
};

const app = chat.createApp(u.brian, itStatus, 'Uptime monitor');
const a1 = chat.postFromApp(app.token, {
  title: 'Microsoft 365: Teams and Outlook unreachable',
  text: 'Sign-in and mailbox checks failing from all three regions since 08:52.',
  severity: 'critical',
  link: 'https://status.example.com/incidents/m365',
});
stamp(a1.id, at(1));

const n = say(
  'amina',
  general,
  'Microsoft 365 (Teams, Outlook, OneDrive) is down across the company. Use Relay for chat, mail and calls until further notice. Next update at 11:00. Please acknowledge so we know you have this.',
  3,
  { notice: true },
);
for (const who of ['daniel', 'grace', 'peter', 'brian']) chat.acknowledge(u[who], n.id);
chat.setPinned(u.amina, n.id, true);

say('daniel', general, 'Got it. Service desk is routing all calls through Relay now.', 4);
say('grace', general, '@amina does this affect the payment run? We have suppliers due today.', 3);
say('amina', general, '@grace bank portal is unaffected, only Microsoft services. Go ahead.', 2);

say('amina', incident, 'Bridge is open here. @brian what do you see from the network side?', 2);
say('brian', incident, 'Our edge is fine. DNS resolves, the failure is upstream at the provider. Vendor ticket is open.', 3);
const pdf = Buffer.from('%PDF-1.4\n% Relay demo file\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n');
const att = saveUpload(u.peter, 'Outage-comms-template.pdf', 'application/pdf', pdf);
const fileMsg = say('peter', incident, 'Customer-facing holding statement, ready for review.', 2, { attachmentId: att.id });
chat.setPinned(u.peter, fileMsg.id, true);
chat.toggleReaction(u.amina, fileMsg.id, 'like');
chat.toggleReaction(u.daniel, fileMsg.id, 'agree');
say('lucy', incident, 'I will post the staff version in #general once this is approved.', 3);
const a2 = chat.postFromApp(app.token, { title: 'Exchange Online: degraded', text: 'Mail flow partially restored in EU region.', severity: 'warning' });
stamp(a2.id, at(4));

const dm = chat.openDm(u.amina, u.peter).id;
say('peter', dm, 'Do you want me to draft the 11:00 update?', 5);
say('amina', dm, 'Yes please. Keep it short and say Relay is the place for questions.', 1);

const dm2 = chat.openDm(u.amina, u.grace).id;
say('grace', dm2, 'Thanks for the quick answer on the payment run.', 2);

// Mail
mail.send(u.peter, {
  to: [u.amina],
  cc: [u.lucy],
  subject: 'Draft: 11:00 outage update',
  body: 'Hi Amina,\n\nHere is a draft for the next update:\n\n"Microsoft 365 remains unavailable. Our provider is working on it and expects an update by 12:00. Keep using Relay for chat, mail and calls. If you cannot sign in, call the service desk."\n\nHappy to adjust.\n\nPeter',
});
mail.send(u.grace, { to: [u.amina, u.daniel], subject: 'Supplier payments today', body: 'Confirming the payment run goes ahead at 14:00 via the bank portal.\n\nGrace' });
mail.saveDraft(u.amina, { to: [u.brian], subject: 'Post-incident review', body: 'Brian, can you pull the timeline together for Friday?' });

// A missed call for the demo call history
const t0 = Date.now() - 40 * 60_000;
const { lastInsertRowid } = db()
  .prepare("INSERT INTO calls (conversation_id, initiator_id, media, status, started_at, ended_at) VALUES (?,?,?,'missed',?,?)")
  .run(dm2, u.grace, 'audio', t0, t0 + 30_000);
const mc = chat.callMessage(dm2, u.grace, { callId: Number(lastInsertRowid), media: 'audio', status: 'missed', durationMs: 0, participants: 1 });
stamp(mc.id, t0);
db().prepare('INSERT INTO call_participants (call_id, user_id, joined_at, left_at) VALUES (?,?,?,?)').run(Number(lastInsertRowid), u.grace, t0, t0 + 30_000);

// System messages ("created this channel") were written with the real clock; move them before the story starts.
db().prepare("UPDATE messages SET created_at = ? WHERE kind = 'system'").run(Date.now() - 100 * 60_000);

// Mark Amina's own channels read up to the notice so there is a realistic mix of unread.
db().prepare('UPDATE members SET last_read_id = ? WHERE user_id = ? AND conversation_id = ?').run(n.id, u.amina, general);

console.log(`Seeded ${people.length} people. Sign in as amina@example.com (admin) or any other demo account, password: ${PW}`);
console.log(`Demo webhook for #it-status: POST /api/hooks/${app.token}`);
