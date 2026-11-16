import { db, now } from './db.ts';
import { bad, forbidden, notFound } from './errors.ts';
import { publish } from './bus.ts';
import { callMessage, isMember, memberIds, requireMember } from './chat.ts';
import { getUser, toPublic } from './auth.ts';

/**
 * Calls are peer-to-peer WebRTC (full mesh, good up to ~6-8 people). The server only relays
 * signalling (offers/answers/ICE) between the browser tabs that actually joined the call.
 */

type Live = {
  id: number;
  conversationId: number;
  initiatorId: number;
  media: 'audio' | 'video';
  startedAt: number;
  answeredAt: number | null;
  /** userId -> connection id of the tab in the call */
  peers: Map<number, string>;
  /** media state per user, for mute / camera-off indicators */
  state: Map<number, { audio: boolean; video: boolean; screen: boolean }>;
  /** people who declined (stop ringing them) */
  declined: Set<number>;
  ringTimer?: NodeJS.Timeout;
};

const live = new Map<number, Live>();
export const RING_MS = Number(process.env.RELAY_RING_MS ?? 35_000);

function convType(convId: number): string {
  return (db().prepare('SELECT type FROM conversations WHERE id = ?').get(convId) as { type: string }).type;
}

export function publicCall(c: Live) {
  return {
    id: c.id,
    conversationId: c.conversationId,
    initiatorId: c.initiatorId,
    media: c.media,
    startedAt: c.startedAt,
    answeredAt: c.answeredAt,
    participants: [...c.peers.keys()].map((uid) => ({
      user: toPublic(getUser(uid)!),
      ...(c.state.get(uid) ?? { audio: true, video: c.media === 'video', screen: false }),
    })),
  };
}

function broadcastState(c: Live) {
  publish(memberIds(c.conversationId), { type: 'call:state', call: publicCall(c) });
}

export function activeCallFor(convId: number): Live | undefined {
  for (const c of live.values()) if (c.conversationId === convId) return c;
  return undefined;
}

export function activeCalls(userId: number) {
  return [...live.values()].filter((c) => isMember(userId, c.conversationId)).map(publicCall);
}

export function start(userId: number, connId: string, convId: number, media: unknown) {
  if (media !== 'audio' && media !== 'video') throw bad('media must be audio or video');
  requireMember(userId, convId);
  const existing = activeCallFor(convId);
  if (existing) return join(userId, connId, existing.id);
  leaveAllFor(userId); // one call at a time
  const t = now();
  const { lastInsertRowid } = db()
    .prepare('INSERT INTO calls (conversation_id, initiator_id, media, started_at) VALUES (?,?,?,?)')
    .run(convId, userId, media, t);
  const id = Number(lastInsertRowid);
  db().prepare('INSERT INTO call_participants (call_id, user_id, joined_at) VALUES (?,?,?)').run(id, userId, t);
  const c: Live = {
    id,
    conversationId: convId,
    initiatorId: userId,
    media,
    startedAt: t,
    answeredAt: null,
    peers: new Map([[userId, connId]]),
    state: new Map([[userId, { audio: true, video: media === 'video', screen: false }]]),
    declined: new Set(),
  };
  live.set(id, c);
  c.ringTimer = setTimeout(() => {
    if (live.get(id) && !c.answeredAt) finish(c, 'missed');
  }, RING_MS);
  const from = toPublic(getUser(userId)!);
  publish(
    memberIds(convId).filter((m) => m !== userId),
    { type: 'call:ring', call: publicCall(c), from },
  );
  broadcastState(c);
  return publicCall(c);
}

function requireLive(callId: number): Live {
  const c = live.get(callId);
  if (!c) throw notFound('This call has ended');
  return c;
}

export function join(userId: number, connId: string, callId: number) {
  const c = requireLive(callId);
  if (!isMember(userId, c.conversationId)) throw forbidden('You are not in this conversation');
  const prevConn = c.peers.get(userId);
  if (prevConn && prevConn !== connId) {
    // Same person joining from another tab/device: move them.
    publish([userId], { type: 'call:moved', callId, connId: prevConn });
  }
  if (!prevConn) leaveAllFor(userId, callId);
  const t = now();
  c.peers.set(userId, connId);
  c.state.set(userId, { audio: true, video: c.media === 'video', screen: false });
  db()
    .prepare(
      `INSERT INTO call_participants (call_id, user_id, joined_at) VALUES (?,?,?)
       ON CONFLICT(call_id, user_id) DO UPDATE SET left_at = NULL`,
    )
    .run(callId, userId, t);
  if (!c.answeredAt && userId !== c.initiatorId) {
    c.answeredAt = t;
    clearTimeout(c.ringTimer);
    db().prepare("UPDATE calls SET status = 'active', answered_at = ? WHERE id = ?").run(t, callId);
  }
  // Existing peers will each send an offer to the newcomer.
  for (const [uid, conn] of c.peers) {
    if (uid !== userId) publish([uid], { type: 'call:peer-joined', callId, user: toPublic(getUser(userId)!), connId: conn });
  }
  // Tell this user's other tabs to stop ringing.
  publish([userId], { type: 'call:answered-elsewhere', callId, connId });
  broadcastState(c);
  return publicCall(c);
}

export function decline(userId: number, callId: number) {
  const c = live.get(callId);
  if (!c || c.peers.has(userId) || !isMember(userId, c.conversationId)) return;
  c.declined.add(userId);
  publish([userId], { type: 'call:answered-elsewhere', callId, connId: null });
  if (convType(c.conversationId) === 'dm' && !c.answeredAt) finish(c, 'declined');
}

export function leave(userId: number, callId: number, connId?: string) {
  const c = live.get(callId);
  if (!c || !c.peers.has(userId)) return;
  if (connId && c.peers.get(userId) !== connId) return; // a stale tab, not the one in the call
  c.peers.delete(userId);
  c.state.delete(userId);
  db().prepare('UPDATE call_participants SET left_at = ? WHERE call_id = ? AND user_id = ?').run(now(), callId, userId);
  for (const uid of c.peers.keys()) publish([uid], { type: 'call:peer-left', callId, userId });
  const dm = convType(c.conversationId) === 'dm';
  if (c.peers.size === 0 || (dm && c.answeredAt && c.peers.size < 2)) {
    finish(c, c.answeredAt ? 'ended' : 'missed');
  } else if (!c.answeredAt && userId === c.initiatorId) {
    finish(c, 'missed'); // caller hung up before anyone answered
  } else {
    broadcastState(c);
  }
}

/** Called when a socket closes, or before starting another call. */
export function leaveAllFor(userId: number, exceptCallId?: number, connId?: string) {
  for (const c of [...live.values()]) if (c.id !== exceptCallId && c.peers.has(userId)) leave(userId, c.id, connId);
}

function finish(c: Live, status: 'ended' | 'missed' | 'declined') {
  if (!live.has(c.id)) return;
  live.delete(c.id);
  clearTimeout(c.ringTimer);
  const t = now();
  db().prepare('UPDATE calls SET status = ?, ended_at = ? WHERE id = ?').run(status, t, c.id);
  db().prepare('UPDATE call_participants SET left_at = COALESCE(left_at, ?) WHERE call_id = ?').run(t, c.id);
  publish(memberIds(c.conversationId), { type: 'call:ended', callId: c.id, conversationId: c.conversationId, status });
  const count = (db().prepare('SELECT COUNT(*) AS n FROM call_participants WHERE call_id = ?').get(c.id) as { n: number }).n;
  callMessage(c.conversationId, c.initiatorId, {
    callId: c.id,
    media: c.media,
    status,
    durationMs: c.answeredAt ? t - c.answeredAt : 0,
    participants: count,
  });
}

export function signal(userId: number, callId: number, to: unknown, data: unknown) {
  const c = requireLive(callId);
  const target = Number(to);
  if (!c.peers.has(userId) || !c.peers.has(target)) throw forbidden('Not in this call');
  if (JSON.stringify(data ?? null).length > 64_000) throw bad('Signal too large');
  publish([target], { type: 'call:signal', callId, from: userId, connId: c.peers.get(target), data });
}

export function setMedia(userId: number, callId: number, input: { audio?: unknown; video?: unknown; screen?: unknown }) {
  const c = requireLive(callId);
  if (!c.peers.has(userId)) throw forbidden('Not in this call');
  const cur = c.state.get(userId) ?? { audio: true, video: false, screen: false };
  c.state.set(userId, { audio: !!(input.audio ?? cur.audio), video: !!(input.video ?? cur.video), screen: !!(input.screen ?? cur.screen) });
  broadcastState(c);
}

export function connFor(callId: number, userId: number): string | undefined {
  return live.get(callId)?.peers.get(userId);
}

export function history(userId: number, limit = 100) {
  const rows = db()
    .prepare(
      `SELECT c.*, conv.type AS conv_type, conv.name AS conv_name FROM calls c
       JOIN members m ON m.conversation_id = c.conversation_id AND m.user_id = ?
       JOIN conversations conv ON conv.id = c.conversation_id
       WHERE c.status != 'ringing' AND c.status != 'active'
       ORDER BY c.started_at DESC LIMIT ?`,
    )
    .all(userId, limit) as {
    id: number;
    conversation_id: number;
    initiator_id: number;
    media: string;
    status: string;
    started_at: number;
    answered_at: number | null;
    ended_at: number | null;
    conv_type: string;
    conv_name: string;
  }[];
  return rows.map((r) => {
    const parts = db().prepare('SELECT user_id FROM call_participants WHERE call_id = ?').all(r.id) as { user_id: number }[];
    const joined = parts.some((p) => p.user_id === userId);
    return {
      id: r.id,
      conversationId: r.conversation_id,
      conversationType: r.conv_type,
      conversationName: r.conv_name,
      media: r.media,
      status: r.status,
      direction: r.initiator_id === userId ? 'outgoing' : 'incoming',
      missedByMe: r.initiator_id !== userId && !joined,
      initiatorId: r.initiator_id,
      participantIds: parts.map((p) => p.user_id),
      startedAt: r.started_at,
      durationMs: r.answered_at && r.ended_at ? r.ended_at - r.answered_at : 0,
    };
  });
}

/** Test helper. */
export function _resetCalls() {
  for (const c of live.values()) clearTimeout(c.ringTimer);
  live.clear();
}
