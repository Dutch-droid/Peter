export type User = {
  id: number;
  email: string;
  name: string;
  title: string;
  color: string;
  status: 'available' | 'busy' | 'dnd' | 'away';
  statusMessage: string;
  role: 'admin' | 'member';
  online: boolean;
  disabled?: boolean;
  mustChangePassword?: boolean;
};

export type Attachment = { id: number; filename: string; mime: string; size: number };

export type Conversation = {
  id: number;
  type: 'dm' | 'group' | 'channel';
  name: string;
  topic: string;
  createdBy: number | null;
  lastMessageAt: number;
  memberIds: number[];
  reads: Record<number, number>;
  joined: boolean;
  muted: boolean;
  unread: number;
  mentions: number;
  mentionedAt: number | null;
  lastMessage: { id: number; kind: string; senderId: number | null; senderName: string | null; preview: string; createdAt: number } | null;
};

export type Message = {
  id: number;
  conversationId: number;
  senderId: number | null;
  kind: 'text' | 'notice' | 'system' | 'call' | 'app';
  body: string;
  createdAt: number;
  editedAt: number | null;
  deleted: boolean;
  reactions: Record<string, number[]>;
  attachment: Attachment | null;
  replyTo: { id: number; senderName: string; body: string } | null;
  meta: Partial<CallMeta & AppMeta> | null;
  acks: number[];
  pinned: boolean;
};
export type CallMeta = { callId: number; media: 'audio' | 'video'; status: string; durationMs: number; participants: number };
export type AppMeta = { appId: number; appName: string; title: string; severity: 'info' | 'warning' | 'critical' | 'resolved'; link: string | null };
export type ConnectedApp = { id: number; name: string; createdBy: number; createdAt: number; lastUsedAt: number | null };
export type SharedFile = { id: number; filename: string; mime: string; size: number; shared_at: number; shared_by: number; source: 'chat' | 'mail'; ref_id: number };

export type Person = { id: number; name: string; email: string; color: string };
export type Email = {
  id: number;
  threadId: number;
  from: Person;
  to: Person[];
  cc: Person[];
  bcc: Person[];
  subject: string;
  body?: string;
  snippet?: string;
  importance: 'normal' | 'high';
  createdAt: number;
  sentAt: number | null;
  folder: string | null;
  read: boolean;
  starred: boolean;
  attachments: Attachment[];
};
export type MailCounts = Record<string, { total: number; unread: number }>;

export type CallParticipant = { user: User; audio: boolean; video: boolean; screen: boolean };
export type LiveCall = {
  id: number;
  conversationId: number;
  initiatorId: number;
  media: 'audio' | 'video';
  startedAt: number;
  answeredAt: number | null;
  participants: CallParticipant[];
};
export type CallRecord = {
  id: number;
  conversationId: number;
  conversationType: string;
  conversationName: string;
  media: 'audio' | 'video';
  status: string;
  direction: 'incoming' | 'outgoing';
  missedByMe: boolean;
  initiatorId: number;
  participantIds: number[];
  startedAt: number;
  durationMs: number;
};
export type Announcement = { id: number; severity: 'info' | 'warning' | 'critical'; body: string; createdAt: number; clearedAt: number | null; author: string };

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const OFFLINE_MESSAGE = 'Can’t reach Relay. Check your connection, then try again.';

/** status 0: the request never got an answer (offline, server down, DNS). */
export const isOffline = (e: unknown) => e instanceof ApiError && (e.status === 0 || e.status === 502 || e.status === 503 || e.status === 504);

async function send(input: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throw new ApiError(0, OFFLINE_MESSAGE);
  }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await send(path, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  if (res.status === 502 || res.status === 503 || res.status === 504) throw new ApiError(res.status, 'Relay is restarting or unavailable. Try again in a moment.');
  let data: any = null;
  try {
    data = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) {
    if (res.status === 401 && !path.startsWith('/api/auth/')) window.dispatchEvent(new Event('relay:signed-out'));
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  }
  return data as T;
}

export async function upload(file: File): Promise<Attachment> {
  const res = await send('/api/attachments', {
    method: 'POST',
    headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-Filename': encodeURIComponent(file.name) },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'Upload failed');
  return data.attachment;
}
