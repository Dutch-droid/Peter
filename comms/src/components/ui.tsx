import { Component, useEffect, useRef, useState, type ReactNode } from 'react';
import { isOffline, type User } from '../api';
import { useStore } from '../store';

const PATHS: Record<string, string> = {
  chat: 'M4 5h16v11H8l-4 4z',
  mail: 'M4 5h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1zM3.5 6.5l8.5 6 8.5-6',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1z',
  video: 'M3 7h12v10H3zM15 10l6-3v10l-6-3',
  people: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0M16 3.5a4 4 0 0 1 0 7.5M18 14a6 6 0 0 1 4 7',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5',
  plus: 'M12 5v14M5 12h14',
  send: 'M4 12l16-8-6 16-3-7z',
  clip: 'M20 11l-8.5 8.5a5 5 0 0 1-7-7L13 4a3.5 3.5 0 0 1 5 5l-8.5 8.5a2 2 0 0 1-3-3L14 7',
  close: 'M6 6l12 12M18 6L6 18',
  reply: 'M10 8L4 13l6 5M4 13h11a5 5 0 0 1 5 5',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  smile: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 14s1.5 2 4 2 4-2 4-2M9 9.5h.01M15 9.5h.01',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
  micOff: 'M3 3l18 18M9 9v3a3 3 0 0 0 5 2.2M15 9.3V6a3 3 0 0 0-5.7-1.3M5 11a7 7 0 0 0 11 5.7M19 11a7 7 0 0 1-.7 3M12 18v3',
  videoOff: 'M3 3l18 18M15 10l6-3v10l-6-3M15 15V7H8M3 7v10h12',
  screen: 'M3 4h18v12H3zM8 20h8M12 16v4',
  hangup: 'M3 15c5-5 13-5 18 0l-2.5 2.5-3-1.5v-2.5a10 10 0 0 0-7 0V16l-3 1.5z',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  inbox: 'M3 13l3-8h12l3 8v6H3zM3 13h5l1 3h6l1-3h5',
  sent: 'M4 12l16-8-6 16-3-7z',
  draft: 'M5 3h10l4 4v14H5zM14 3v5h5',
  archive: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  forward: 'M14 8l6 5-6 5M20 13H9a5 5 0 0 0-5 5',
  back: 'M15 6l-6 6 6 6',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  bell: 'M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0',
  bellOff: 'M3 3l18 18M6 16v-5a6 6 0 0 1 .7-2.8M9.5 5.5A6 6 0 0 1 18 11v4M4 18h13M10 20a2 2 0 0 0 4 0',
  hash: 'M5 9h14M5 15h14M10 4L8 20M16 4l-2 16',
  missed: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1zM15 3l6 6M21 3l-6 6',
  incoming: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1zM21 3l-6 6M15 4v5h5',
  outgoing: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1zM15 9l6-6M16 3h5v5',
  megaphone: 'M3 10v4h3l7 5V5L6 10zM16 8a5 5 0 0 1 0 8M19 5a9 9 0 0 1 0 14',
  wifiOff: 'M3 3l18 18M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 5-2.7M2 9.5a15 15 0 0 1 4.5-2.8M14 10.4a10 10 0 0 1 5 2.6M22 9.5a15 15 0 0 0-11-4M12 20h.01',
  check: 'M5 12l5 5 9-10',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  menu: 'M4 6h16M4 12h16M4 18h16',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
  like: 'M7 11v9H4v-9zM7 11l4-8a2 2 0 0 1 2.5 2.3L13 9h5.5a2 2 0 0 1 2 2.4l-1.3 6.6a2 2 0 0 1-2 1.6H7',
  agree: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM8 12l3 3 5-6',
  heart: 'M12 20s-7-4.4-8.5-9A4.6 4.6 0 0 1 12 7a4.6 4.6 0 0 1 8.5 4c-1.5 4.6-8.5 9-8.5 9z',
  celebrate: 'M4 20l4-11 7 7zM14 4v2M19 9h2M17.5 6.5L19 5M12 9a4 4 0 0 1 3-3',
  seen: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  question: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 0 1 4.9.8c0 1.7-2.4 2.2-2.4 3.7M12 17h.01',
  pin: 'M9 4h6l-1 6 4 3v2H6v-2l4-3zM12 15v6',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4M9 13h6M9 17h6',
  app: 'M9 3v4M15 3v4M7 7h10v4a5 5 0 0 1-10 0zM12 16v5',
  at: 'M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8',
  alert: 'M12 3l10 18H2zM12 10v4M12 17.5h.01',
  info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v6M12 7.5h.01',
  external: 'M14 4h6v6M20 4l-9 9M18 14v6H4V6h6',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
};

/** Reaction keys from the server, drawn as line icons. */
export const REACTION_LABEL: Record<string, string> = {
  like: 'Like',
  agree: 'Agree',
  heart: 'Love',
  celebrate: 'Celebrate',
  seen: 'Seen',
  question: 'Question',
};

export function Icon({ name, size = 18, className, title }: { name: keyof typeof PATHS | string; size?: number; className?: string; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name] ?? PATHS.chat} />
    </svg>
  );
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

const STATUS_LABEL: Record<string, string> = { available: 'Available', busy: 'Busy', dnd: 'Do not disturb', away: 'Away' };
export function presenceOf(u: User | undefined): { key: string; label: string } {
  if (!u || !u.online) return { key: 'offline', label: 'Offline' };
  return { key: u.status, label: STATUS_LABEL[u.status] ?? 'Available' };
}

export function Avatar({ user, size = 36, showPresence = true, name, color }: { user?: User; size?: number; showPresence?: boolean; name?: string; color?: string }) {
  const p = presenceOf(user);
  const label = user?.name ?? name ?? '?';
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.38, background: user?.color ?? color ?? '#55635D', borderRadius: Math.round(size * 0.28) }} aria-hidden>
      {initials(label)}
      {showPresence && user && <span className={`presence presence-${p.key}`} title={p.label} />}
    </span>
  );
}

export function GroupAvatar({ ids, size = 36 }: { ids: number[]; size?: number }) {
  const { user } = useStore();
  const [a, b] = ids;
  return (
    <span className="group-avatar" style={{ width: size, height: size }} aria-hidden>
      <span style={{ background: user(a)?.color ?? '#777' }}>{initials(user(a)?.name ?? '?')}</span>
      <span style={{ background: user(b)?.color ?? '#999' }}>{initials(user(b)?.name ?? '?')}</span>
    </span>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, textarea, select, button:not(.modal-close)');
    first?.focus();
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <header className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn modal-close" onClick={onClose} aria-label="Close">
            <Icon name="close" />
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

/** Multi-select people picker with type-ahead; used for new chats and mail recipients. */
export function PeoplePicker({
  value,
  onChange,
  placeholder = 'Type a name or email',
  excludeMe = true,
  id,
  label,
}: {
  value: number[];
  onChange: (ids: number[]) => void;
  placeholder?: string;
  excludeMe?: boolean;
  id?: string;
  label?: string;
}) {
  const { users, me } = useStore();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const lq = q.trim().toLowerCase();
  const options = [...users.values()]
    .filter((u) => !value.includes(u.id) && (!excludeMe || u.id !== me.id))
    .filter((u) => !lq || u.name.toLowerCase().includes(lq) || u.email.toLowerCase().includes(lq))
    .slice(0, 8);
  const add = (uid: number) => {
    onChange([...value, uid]);
    setQ('');
    setHi(0);
  };
  return (
    <div className="picker" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <div className="picker-box">
        {value.map((uid) => {
          const u = users.get(uid);
          return (
            <span className="chip" key={uid}>
              {u?.name ?? '…'}
              <button type="button" aria-label={`Remove ${u?.name}`} onClick={() => onChange(value.filter((x) => x !== uid))}>
                <Icon name="close" size={12} />
              </button>
            </span>
          );
        })}
        <input
          id={id}
          aria-label={label}
          value={q}
          placeholder={value.length ? '' : placeholder}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
            setHi(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setHi((h) => Math.min(h + 1, options.length - 1)));
            else if (e.key === 'ArrowUp') (e.preventDefault(), setHi((h) => Math.max(h - 1, 0)));
            else if ((e.key === 'Enter' || e.key === ',' || e.key === 'Tab') && q && options[hi]) {
              e.preventDefault();
              add(options[hi].id);
            } else if (e.key === 'Backspace' && !q && value.length) onChange(value.slice(0, -1));
          }}
          role="combobox"
          aria-expanded={open && options.length > 0}
          autoComplete="off"
        />
      </div>
      {open && options.length > 0 && (
        <ul className="picker-menu" role="listbox">
          {options.map((u, i) => (
            <li key={u.id} role="option" aria-selected={i === hi}>
              <button type="button" className={i === hi ? 'hi' : ''} onMouseDown={(e) => e.preventDefault()} onClick={() => add(u.id)}>
                <Avatar user={u} size={26} />
                <span>
                  <strong>{u.name}</strong>
                  <small>{u.email}</small>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- formatting ----------
export function timeShort(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  if (now.getTime() - ts < 6 * 86400_000) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}
export const clock = (ts: number) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const fullDate = (ts: number) => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
export function dayLabel(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
}
export function duration(ms: number) {
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}
export function bytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

/** Plain text with clickable links, **bold**, `code` and @mentions; no HTML is ever injected. */
export function RichText({ text, me }: { text: string; me?: User }) {
  const mine = me ? [me.email.split('@')[0].toLowerCase(), me.name.toLowerCase().replace(/\s+/g, ''), me.name.toLowerCase().split(/\s+/)[0], 'everyone', 'channel', 'here'] : [];
  const parts: ReactNode[] = [];
  const re = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])|\*\*([^*]+)\*\*|`([^`]+)`|@([\w.-]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[1]) parts.push(<a key={k++} href={m[1]} target="_blank" rel="noopener noreferrer">{m[1]}</a>);
    else if (m[2]) parts.push(<strong key={k++}>{m[2]}</strong>);
    else if (m[3]) parts.push(<code key={k++}>{m[3]}</code>);
    else parts.push(<span key={k++} className={`mention ${mine.includes(m[4].toLowerCase()) ? 'mention-me' : ''}`}>@{m[4]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts}</>;
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name={icon} size={28} />
      </span>
      <h3>{title}</h3>
      {children}
    </div>
  );
}

/** A failed load, with what went wrong and a Try again button. Offline errors get their own wording. */
export function ErrorState({ title, error, onRetry, compact }: { title: string; error: unknown; onRetry: () => void; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const offline = isOffline(error);
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className={`empty error-state ${compact ? 'compact' : ''}`} role="alert">
      <span className="empty-icon error-icon">
        <Icon name={offline ? 'wifiOff' : 'alert'} size={28} />
      </span>
      <h3>{offline ? 'You’re offline or Relay is unreachable' : title}</h3>
      <p>{message}</p>
      <button
        className="btn primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onRetry();
          } finally {
            setBusy(false);
          }
        }}
      >
        <Icon name="refresh" size={18} /> {busy ? 'Trying…' : 'Try again'}
      </button>
    </div>
  );
}

/** Catches a crash while drawing the page so people see a way out instead of a blank screen. */
export class ErrorBoundary extends Component<{ children: ReactNode; label?: string }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('Relay UI error', error);
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="crash-screen" role="alert">
        <span className="empty-icon error-icon">
          <Icon name="alert" size={28} />
        </span>
        <h2>Something went wrong{this.props.label ? ` in ${this.props.label}` : ''}</h2>
        <p className="muted">Your messages and mail are safe on the server. Try again, or reload Relay.</p>
        <div className="row gap-s">
          <button className="btn" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
          <button className="btn primary" onClick={() => location.reload()}>
            <Icon name="refresh" size={18} /> Reload Relay
          </button>
        </div>
        <details>
          <summary>Technical details</summary>
          <pre className="code-block">{error.message}</pre>
        </details>
      </div>
    );
  }
}
