/**
 * One line per event, timestamped, to stdout (info) or stderr (warn/error):
 *   2026-11-16T07:31:11.902Z INFO  request method=GET path=/api/me status=200 ms=3
 * Set RELAY_LOG_FORMAT=json for one JSON object per line (for log collectors).
 * Set RELAY_LOG_REQUESTS=1 to log every API request; by default only failures (status 500+) are logged.
 * Never pass passwords, cookies or tokens in fields.
 */
type Level = 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

const json = process.env.RELAY_LOG_FORMAT === 'json';
let quiet = false;

/** Tests turn logging off so their output stays readable. */
export function setQuiet(q: boolean) {
  quiet = q;
}

function errorFields(e: unknown): Fields {
  if (e instanceof Error) {
    const stack = e.stack?.split('\n').slice(1, 6).map((l) => l.trim()).filter(Boolean).join(' | ');
    return { error: e.message, ...(stack ? { stack } : {}) };
  }
  return { error: String(e) };
}

function fmt(v: unknown): string {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  return /[\s="]/.test(s) ? JSON.stringify(s) : s;
}

function write(level: Level, msg: string, fields: Fields = {}) {
  if (quiet) return;
  const time = new Date().toISOString();
  const line = json
    ? JSON.stringify({ time, level, msg, ...fields })
    : `${time} ${level.toUpperCase().padEnd(5)} ${msg}${Object.entries(fields)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => ` ${k}=${fmt(v)}`)
        .join('')}`;
  (level === 'info' ? process.stdout : process.stderr).write(line + '\n');
}

export const log = {
  info: (msg: string, fields?: Fields) => write('info', msg, fields),
  warn: (msg: string, fields?: Fields) => write('warn', msg, fields),
  error: (msg: string, e?: unknown, fields?: Fields) => write('error', msg, { ...fields, ...(e === undefined ? {} : errorFields(e)) }),
};

export const logRequests = process.env.RELAY_LOG_REQUESTS === '1';

/** Webhook URLs carry their secret in the path, so it never reaches the logs. */
export function safePath(p: string) {
  return p.replace(/^\/api\/hooks\/[^/]+/, '/api/hooks/[redacted]');
}
