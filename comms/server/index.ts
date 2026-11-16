import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { handleApi } from './api.ts';
import { handleUpgrade } from './realtime.ts';
import { db } from './db.ts';

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
  fs.createReadStream(file).pipe(res);
}

db(); // create schema on boot

const server = http.createServer(async (req, res) => {
  security(res);
  if (await handleApi(req, res)) return;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405).end();
    return;
  }
  serveStatic(req, res);
});
server.on('upgrade', handleUpgrade);
server.listen(PORT, HOST, () => console.log(`Relay listening on http://${HOST}:${PORT}`));
