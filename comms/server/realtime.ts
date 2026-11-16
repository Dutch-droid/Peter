import crypto from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocketServer, type WebSocket } from 'ws';
import { installTransport, publish, type ServerEvent } from './bus.ts';
import { parseCookies } from './api.ts';
import { touchLastSeen, userForToken } from './auth.ts';
import { db } from './db.ts';
import { isMember, memberIds } from './chat.ts';
import * as calls from './calls.ts';
import { HttpError } from './errors.ts';

type Conn = { id: string; userId: number; ws: WebSocket; alive: boolean };
const byUser = new Map<number, Map<string, Conn>>();

function everyone(): number[] {
  return (db().prepare('SELECT id FROM users').all() as { id: number }[]).map((r) => r.id);
}

function sendTo(userId: number, event: ServerEvent) {
  const conns = byUser.get(userId);
  if (!conns) return;
  // Call signalling addressed to a specific tab goes only there.
  const target = typeof event.connId === 'string' && event.type.startsWith('call:') ? event.connId : null;
  const data = JSON.stringify(event);
  for (const c of conns.values()) {
    if (target && c.id !== target && event.type !== 'call:answered-elsewhere' && event.type !== 'call:moved') continue;
    if (c.ws.readyState === c.ws.OPEN) c.ws.send(data);
  }
}

installTransport(sendTo, (uid) => (byUser.get(uid)?.size ?? 0) > 0);

const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024 });

export function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
  const url = new URL(req.url ?? '/', 'http://x');
  const origin = req.headers.origin;
  const sameOrigin = !origin || (() => { try { return new URL(origin).host === req.headers.host; } catch { return false; } })();
  const user = url.pathname === '/ws' && sameOrigin ? userForToken(parseCookies(req.headers.cookie).relay_sid) : null;
  if (!user || user.must_change_password) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => attach(ws, user.id));
}

function attach(ws: WebSocket, userId: number) {
  const conn: Conn = { id: crypto.randomUUID(), userId, ws, alive: true };
  let conns = byUser.get(userId);
  const wasOnline = !!conns?.size;
  if (!conns) byUser.set(userId, (conns = new Map()));
  conns.set(conn.id, conn);
  touchLastSeen(userId);
  ws.send(JSON.stringify({ type: 'hello', connId: conn.id, online: [...byUser.keys()] }));
  if (!wasOnline) publish(everyone(), { type: 'presence', userId, online: true });

  ws.on('pong', () => (conn.alive = true));
  ws.on('message', (raw) => {
    let msg: any;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    try {
      const result = handle(conn, msg);
      if (msg.reqId) ws.send(JSON.stringify({ type: 'reply', reqId: msg.reqId, ok: true, result }));
    } catch (e) {
      const message = e instanceof HttpError ? e.message : 'Something went wrong';
      if (!(e instanceof HttpError)) console.error(e);
      if (msg.reqId) ws.send(JSON.stringify({ type: 'reply', reqId: msg.reqId, ok: false, error: message }));
    }
  });
  ws.on('close', () => {
    conns!.delete(conn.id);
    calls.leaveAllFor(userId, undefined, conn.id);
    if (!conns!.size) {
      byUser.delete(userId);
      touchLastSeen(userId);
      publish(everyone(), { type: 'presence', userId, online: false });
    }
  });
}

function handle(conn: Conn, msg: any): unknown {
  const uid = conn.userId;
  switch (msg.type) {
    case 'ping':
      return 'pong';
    case 'typing': {
      const cid = Number(msg.conversationId);
      if (!isMember(uid, cid)) return null;
      publish(memberIds(cid).filter((m) => m !== uid), { type: 'typing', conversationId: cid, userId: uid });
      return null;
    }
    case 'call:start':
      return calls.start(uid, conn.id, Number(msg.conversationId), msg.media);
    case 'call:join':
      return calls.join(uid, conn.id, Number(msg.callId));
    case 'call:decline':
      return calls.decline(uid, Number(msg.callId)), null;
    case 'call:leave':
      return calls.leave(uid, Number(msg.callId), conn.id), null;
    case 'call:signal':
      if (calls.connFor(Number(msg.callId), uid) !== conn.id) throw new HttpError(403, 'Not in this call');
      return calls.signal(uid, Number(msg.callId), msg.to, msg.data), null;
    case 'call:media':
      if (calls.connFor(Number(msg.callId), uid) !== conn.id) throw new HttpError(403, 'Not in this call');
      return calls.setMedia(uid, Number(msg.callId), msg), null;
    default:
      throw new HttpError(400, 'Unknown message');
  }
}

// Drop dead connections (laptops closing, flaky mobile networks) so presence and calls stay accurate.
const heartbeat = setInterval(() => {
  for (const conns of byUser.values())
    for (const c of conns.values()) {
      if (!c.alive) {
        c.ws.terminate();
        continue;
      }
      c.alive = false;
      c.ws.ping();
    }
}, 20_000);
heartbeat.unref();
