import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, type Announcement, type Conversation, type LiveCall, type MailCounts, type User } from './api';
import { socket } from './socket';
import { chime } from './sound';

export type Route = { view: 'chat' | 'mail' | 'calls' | 'people' | 'files' | 'you' | 'admin' | 'settings'; id?: number; sub?: string };

export function parseHash(): Route {
  const [view, a, b] = location.hash.replace(/^#\/?/, '').split('/');
  const views = ['chat', 'mail', 'calls', 'people', 'files', 'you', 'admin', 'settings'];
  if (!views.includes(view)) return { view: 'chat' };
  if (view === 'mail') return { view, sub: a || 'inbox', id: b ? Number(b) : undefined };
  return { view: view as Route['view'], id: a ? Number(a) : undefined };
}
export function go(path: string) {
  location.hash = '#/' + path;
}

type Toast = { id: number; text: string; tone: 'info' | 'error' | 'success' };
type Config = { iceServers: RTCIceServer[]; reactions: string[]; maxUploadBytes: number };

type Store = {
  me: User;
  setMe: (u: User) => void;
  users: Map<number, User>;
  user: (id: number | null | undefined) => User | undefined;
  conversations: Conversation[];
  upsertConversation: (c: Conversation) => void;
  removeConversation: (id: number) => void;
  conversationName: (c: Conversation) => string;
  typing: Record<number, Record<number, number>>;
  mailCounts: MailCounts;
  announcement: Announcement | null;
  activeCalls: Map<number, LiveCall>;
  config: Config;
  connected: boolean;
  route: Route;
  toast: (text: string, tone?: Toast['tone']) => void;
  toasts: Toast[];
  refreshUsers: () => void;
};

const Ctx = createContext<Store | null>(null);
export const useStore = () => {
  const s = useContext(Ctx);
  if (!s) throw new Error('No store');
  return s;
};

export function AppProvider({ initialMe, children }: { initialMe: User; children: ReactNode }) {
  const [me, setMe] = useState(initialMe);
  const [users, setUsers] = useState<Map<number, User>>(new Map());
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [typing, setTyping] = useState<Record<number, Record<number, number>>>({});
  const [mailCounts, setMailCounts] = useState<MailCounts>({});
  const [announcement, setAnnouncement] = useState<Announcement | null>(null);
  const [activeCalls, setActiveCalls] = useState<Map<number, LiveCall>>(new Map());
  const [config, setConfig] = useState<Config>({ iceServers: [], reactions: [], maxUploadBytes: 25 << 20 });
  const [connected, setConnected] = useState(false);
  const [route, setRoute] = useState(parseHash());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const routeRef = useRef(route);
  routeRef.current = route;
  const meRef = useRef(me);
  meRef.current = me;
  const convRef = useRef(conversations);
  convRef.current = conversations;
  const usersRef = useRef(users);
  usersRef.current = users;

  const toast = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = Math.random();
    setToasts((t) => [...t, { id, text, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  // Live presence from the socket wins over a directory fetch that may have started before it arrived.
  const onlineRef = useRef<Set<number> | null>(null);
  const refreshUsers = useCallback(() => {
    api<{ users: User[] }>('/api/users').then(({ users }) => {
      const live = onlineRef.current;
      setUsers(new Map(users.map((u) => [u.id, live ? { ...u, online: live.has(u.id) } : u])));
    });
  }, []);

  const loadAll = useCallback(() => {
    refreshUsers();
    api<{ conversations: Conversation[] }>('/api/conversations').then((r) => setConversations(r.conversations));
    api<{ counts: MailCounts }>('/api/mail/counts').then((r) => setMailCounts(r.counts));
    api<{ calls: LiveCall[] }>('/api/calls/active').then((r) => setActiveCalls(new Map(r.calls.map((c) => [c.conversationId, c]))));
    api<Config & { announcement: Announcement | null }>('/api/config').then((r) => {
      setConfig(r);
      setAnnouncement(r.announcement);
    });
  }, [refreshUsers]);

  const upsertConversation = useCallback((c: Conversation) => {
    setConversations((list) => {
      const next = list.filter((x) => x.id !== c.id);
      if (c.joined) next.push(c);
      return next.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
    });
  }, []);
  const removeConversation = useCallback((id: number) => setConversations((l) => l.filter((c) => c.id !== id)), []);

  useEffect(() => {
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    loadAll();
    socket.start();
    const off = socket.on((e) => {
      switch (e.type) {
        case 'hello':
          onlineRef.current = new Set<number>(e.online);
          setConnected(true);
          // After a reconnect, catch up on anything missed while offline.
          loadAll();
          setUsers((m) => {
            const online = new Set<number>(e.online);
            const n = new Map(m);
            for (const [id, u] of n) n.set(id, { ...u, online: online.has(id) });
            return n;
          });
          break;
        case 'socket:down':
          onlineRef.current = null;
          setConnected(false);
          break;
        case 'presence':
          if (onlineRef.current) {
            if (e.online) onlineRef.current.add(e.userId);
            else onlineRef.current.delete(e.userId);
          }
          setUsers((m) => {
            const u = m.get(e.userId);
            if (!u) return m;
            return new Map(m).set(e.userId, { ...u, online: e.online });
          });
          break;
        case 'user:updated':
          setUsers((m) => new Map(m).set(e.user.id, e.user));
          if (e.user.id === meRef.current.id) setMe((cur) => ({ ...cur, ...e.user }));
          break;
        case 'directory:changed':
          refreshUsers();
          break;
        case 'conversation:updated':
          upsertConversation(e.conversation);
          break;
        case 'conversation:removed':
          removeConversation(e.conversationId);
          break;
        case 'message:new': {
          const r = routeRef.current;
          const viewing = r.view === 'chat' && r.id === e.conversation.id && document.visibilityState === 'visible';
          upsertConversation(viewing ? { ...e.conversation, unread: 0 } : e.conversation);
          setTyping((t) => {
            const c = t[e.message.conversationId];
            if (!c || !c[e.message.senderId]) return t;
            const { [e.message.senderId]: _, ...rest } = c;
            return { ...t, [e.message.conversationId]: rest };
          });
          const fromOther =
            (e.message.senderId && e.message.senderId !== meRef.current.id && (e.message.kind === 'text' || e.message.kind === 'notice')) ||
            e.message.kind === 'app';
          if (fromOther && !viewing && !e.conversation.muted && meRef.current.status !== 'dnd') {
            const sender = e.message.kind === 'app' ? (e.message.meta?.appName ?? 'App') : (usersRef.current.get(e.message.senderId)?.name ?? 'Someone');
            const where = e.conversation.type === 'dm' ? sender : `${sender} in ${e.conversation.type === 'channel' ? '#' : ''}${e.conversation.name || 'group'}`;
            if (e.message.kind === 'app') notify(where, e.message.meta?.title ?? 'Alert', () => go(`chat/${e.conversation.id}`));
            else notify(where, e.message.kind === 'notice' ? `Notice: ${e.message.body}` : e.message.body || 'Shared a file', () => go(`chat/${e.conversation.id}`));
            chime('message');
          }
          break;
        }
        case 'typing':
          setTyping((t) => ({ ...t, [e.conversationId]: { ...t[e.conversationId], [e.userId]: Date.now() } }));
          break;
        case 'mail:counts':
          setMailCounts(e.counts);
          break;
        case 'mail:new':
          if (meRef.current.status !== 'dnd') {
            notify(`Mail from ${e.email.from.name}`, e.email.subject || '(no subject)', () => go(`mail/inbox/${e.email.id}`));
            chime('message');
          }
          break;
        case 'announcement':
          setAnnouncement(e.announcement);
          if (e.announcement) {
            notify('Announcement', e.announcement.body, () => window.focus(), true);
            chime('alert');
          }
          break;
        case 'call:state':
          setActiveCalls((m) => new Map(m).set(e.call.conversationId, e.call));
          break;
        case 'call:ended':
          setActiveCalls((m) => {
            const n = new Map(m);
            n.delete(e.conversationId);
            return n;
          });
          break;
      }
    });
    const signedOut = () => location.reload();
    window.addEventListener('relay:signed-out', signedOut);
    return () => {
      off();
      socket.stop();
      window.removeEventListener('relay:signed-out', signedOut);
    };
  }, [loadAll, refreshUsers, upsertConversation, removeConversation]);

  // Expire stale typing indicators.
  useEffect(() => {
    const t = setInterval(() => {
      setTyping((cur) => {
        const cutoff = Date.now() - 4000;
        let changed = false;
        const next: typeof cur = {};
        for (const [cid, byUser] of Object.entries(cur)) {
          const keep = Object.fromEntries(Object.entries(byUser).filter(([, ts]) => ts > cutoff));
          if (Object.keys(keep).length !== Object.keys(byUser).length) changed = true;
          if (Object.keys(keep).length) next[Number(cid)] = keep;
        }
        return changed ? next : cur;
      });
    }, 1500);
    return () => clearInterval(t);
  }, []);

  // Unread badge in the tab title.
  useEffect(() => {
    const n = conversations.reduce((s, c) => s + (c.muted ? 0 : c.unread), 0) + (mailCounts.inbox?.unread ?? 0);
    document.title = n ? `(${n}) Relay` : 'Relay';
  }, [conversations, mailCounts]);

  const user = useCallback((id: number | null | undefined) => (id ? users.get(id) : undefined), [users]);
  const conversationName = useCallback(
    (c: Conversation) => {
      if (c.type === 'channel') return `#${c.name}`;
      const others = c.memberIds.filter((id) => id !== me.id).map((id) => users.get(id)?.name ?? '…');
      if (c.type === 'dm') return others[0] ?? 'Just you';
      return c.name || others.slice(0, 3).join(', ') + (others.length > 3 ? ` +${others.length - 3}` : '');
    },
    [me.id, users],
  );

  const value = useMemo<Store>(
    () => ({
      me,
      setMe,
      users,
      user,
      conversations,
      upsertConversation,
      removeConversation,
      conversationName,
      typing,
      mailCounts,
      announcement,
      activeCalls,
      config,
      connected,
      route,
      toast,
      toasts,
      refreshUsers,
    }),
    [me, users, user, conversations, upsertConversation, removeConversation, conversationName, typing, mailCounts, announcement, activeCalls, config, connected, route, toast, toasts, refreshUsers],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Desktop notification when the tab is in the background. */
export function notify(title: string, body: string, onClick?: () => void, force = false) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!force && document.visibilityState === 'visible' && document.hasFocus()) return;
  const n = new Notification(title, { body: body.slice(0, 200), icon: '/icon.svg', tag: force ? 'announcement' : undefined });
  n.onclick = () => {
    window.focus();
    onClick?.();
    n.close();
  };
}
