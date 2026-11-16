export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export const bad = (msg: string) => new HttpError(400, msg);
export const forbidden = (msg = 'Not allowed') => new HttpError(403, msg);
export const notFound = (msg = 'Not found') => new HttpError(404, msg);

export function str(v: unknown, field: string, { max = 10_000, min = 0, optional = false } = {}): string {
  if (v === undefined || v === null) {
    if (optional) return '';
    throw bad(`${field} is required`);
  }
  if (typeof v !== 'string') throw bad(`${field} must be text`);
  const s = v.trim();
  if (s.length < min) throw bad(min <= 1 ? `${field} is required` : `${field} must be at least ${min} characters`);
  if (s.length > max) throw bad(`${field} must be at most ${max} characters`);
  return s;
}

export function id(v: unknown, field: string): number {
  const n = typeof v === 'string' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0) throw bad(`${field} is invalid`);
  return n;
}

export function ids(v: unknown, field: string): number[] {
  if (!Array.isArray(v)) throw bad(`${field} must be a list`);
  if (v.length > 200) throw bad(`${field} has too many entries`);
  return [...new Set(v.map((x) => id(x, field)))];
}
