import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { handleApi } from './api.ts';
import { closeAllSockets, connectionCount, handleUpgrade } from './realtime.ts';
import { closeDb, dataDir, db, recoverAfterCrash } from './db.ts';
import { endAll as endAllCalls } from './calls.ts';
import { log } from './log.ts';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '0.0.0.0';
const DIST = path.resolve(process.cwd(), 'dist');

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
};

// Everything is served from this machine: no CDNs, fonts or analytics, so Relay keeps working when other providers are down.
const CSP = [
  "default-src 'self'",
  "connect-src 'self' ws: wss:",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "script-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

function security(res: http.ServerResponse) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self)');
  res.setHeader('Content-Security-Policy', CSP);
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  let file = path.join(DIST, path.normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, ''));
  if (!file.startsWith(DIST)) {
    res.writeHead(400).end();
    return;
  }
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html'); // SPA fallback
  if (!fs.existsSync(file)) {
    res.writeHead(503, { 'Content-Type': 'text/plain' }).end('Frontend not built. Run `npm run build`, or use `npm run dev`.');
    return;
  }
  const ext = path.extname(file);
  const immutable = file.includes(`${path.sep}assets${path.sep}`);
  res.writeHead(200, {
    'Content-Type': TYPES[ext] ?? 'application/octet-stream',
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(file)
    .on('error', (e) => {
      log.error('static file read failed', e, { file: path.relative(DIST, file) });
      res.destroy();
    })
    .pipe(res);
}

// ---------- boot ----------

try {
  db(); // opens the file and creates the schema
  const fixed = recoverAfterCrash();
  if (fixed) log.warn('recovered after an unclean stop', { callsClosed: fixed });
} catch (e) {
  log.error('cannot open the database; check RELAY_DATA_DIR / RELAY_DB and file permissions', e, { dataDir: dataDir() });
  process.exit(1);
}
if (!fs.existsSync(path.join(DIST, 'index.html'))) log.warn('frontend not built: run `npm run build` (the API still works)');

const server = http.createServer(async (req, res) => {
  try {
    security(res);
    if (await handleApi(req, res)) return;
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    serveStatic(req, res);
  } catch (e) {
    log.error('request handler crashed', e, { method: req.method });
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' }).end('Something went wrong on the server.');
    else res.destroy();
  }
});
server.on('upgrade', (req, socket, head) => {
  socket.on('error', () => socket.destroy());
  try {
    handleUpgrade(req, socket, head);
  } catch (e) {
    log.error('websocket upgrade failed', e);
    socket.destroy();
  }
});
server.on('clientError', (_e, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  else socket.destroy();
});
server.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EADDRINUSE') log.error(`port ${PORT} is already in use; stop the other process or set PORT`, undefined, { port: PORT });
  else if (e.code === 'EACCES') log.error(`no permission to listen on port ${PORT}; use a port above 1024 or a reverse proxy`, undefined, { port: PORT });
  else log.error('server error', e);
  process.exit(1);
});
server.listen(PORT, HOST, () => log.info('Relay is listening', { url: `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`, dataDir: dataDir(), node: process.version }));

// ---------- clean shutdown ----------

let stopping = false;
async function shutdown(reason: string, code = 0) {
  if (stopping) return;
  stopping = true;
  log.info('shutting down', { reason, connections: connectionCount() });
  // Hard stop if something hangs, so a process manager can restart us.
  setTimeout(() => {
    log.error('shutdown took too long; forcing exit');
    process.exit(code || 1);
  }, 10_000).unref();
  try {
    const closed = new Promise<void>((resolve) => server.close(() => resolve())); // stop accepting; finish in-flight requests
    server.closeIdleConnections();
    const ended = endAllCalls(); // posts "call ended" to chats while sockets are still open
    if (ended) log.info('ended live calls', { calls: ended });
    closeAllSockets(); // clients see a restart and reconnect with backoff
    await Promise.race([closed, new Promise((r) => setTimeout(r, 5_000))]);
    server.closeAllConnections();
    closeDb();
    log.info('stopped cleanly');
  } catch (e) {
    log.error('error during shutdown', e);
    code ||= 1;
  }
  process.exit(code);
}

for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'] as const) {
  try {
    process.on(sig, () => void shutdown(sig));
  } catch {
    /* signal not supported on this platform */
  }
}
// A bug we didn't catch: log it, close the database cleanly, and exit non-zero so the process manager restarts us.
process.on('uncaughtException', (e) => {
  log.error('uncaught exception', e);
  void shutdown('uncaught exception', 1);
});
// A rejected promise nobody awaited is logged but doesn't take everyone offline.
process.on('unhandledRejection', (e) => log.error('unhandled promise rejection', e));
