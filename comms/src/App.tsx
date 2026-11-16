import { useEffect, useRef, useState } from 'react';
import { api, type Email, type Message, type User } from './api';
import { AppProvider, go, useStore } from './store';
import { CallProvider, useCall } from './call/CallProvider';
import { CallWindow, IncomingCalls } from './call/CallUI';
import { Avatar, Icon, presenceOf, timeShort } from './components/ui';
import { ChatView, SidebarConversations } from './views/Chat';
import { MailView } from './views/Mail';
import { CallsView, PeopleView } from './views/Calls';
import { AdminView } from './views/Admin';
import { SettingsView } from './views/Settings';
import { Activate, Login } from './views/Auth';
import { FilesView } from './views/Files';
import { StatusControls, YouView } from './views/You';
import { useIsPhone } from './useMedia';

export default function App() {
  const [me, setMe] = useState<User | null | undefined>(undefined);
  useEffect(() => {
    api('/api/me')
      .then((r) => setMe(r.user))
      .catch(() => setMe(null));
  }, []);
  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    location.hash = '';
    location.reload();
  };
  if (me === undefined) return <div className="boot"><img src="/icon.svg" alt="" width={48} /></div>;
  if (me === null) return <Login onSignedIn={setMe} />;
  if (me.mustChangePassword) return <Activate user={me} onDone={setMe} onLogout={logout} />;
  return (
    <AppProvider initialMe={me}>
      <CallProvider>
        <Shell onLogout={logout} />
      </CallProvider>
    </AppProvider>
  );
}

function Shell({ onLogout }: { onLogout: () => void }) {
  const { route, me, conversations, mailCounts, connected, announcement, toasts } = useStore();
  const { call } = useCall();
  const phone = useIsPhone();
  const chatUnread = conversations.reduce((s, c) => s + (c.muted ? 0 : c.unread), 0);
  const mailUnread = mailCounts.inbox?.unread ?? 0;
  const [wasConnected, setWasConnected] = useState(false);
  useEffect(() => {
    if (connected) setWasConnected(true);
  }, [connected]);
  const inConversation = route.view === 'chat' && !!route.id;

  const view = (
    <>
      {route.view === 'chat' && <ChatView />}
      {route.view === 'mail' && <MailView />}
      {route.view === 'calls' && <CallsView />}
      {route.view === 'people' && <PeopleView />}
      {route.view === 'files' && <FilesView />}
      {route.view === 'you' && (phone ? <YouView onLogout={onLogout} /> : <SettingsView />)}
      {route.view === 'admin' && me.role === 'admin' && <AdminView />}
      {route.view === 'settings' && <SettingsView />}
    </>
  );
  const banners = (
    <>
      {announcement && (
        <div className={`announcement sev-${announcement.severity}`} role="status">
          <Icon name={announcement.severity === 'info' ? 'info' : 'megaphone'} size={20} />
          <p><strong>{announcement.severity === 'critical' ? 'Critical' : announcement.severity === 'warning' ? 'Notice' : 'Info'}:</strong> {announcement.body}</p>
          <small>{announcement.author} · {timeShort(announcement.createdAt)}</small>
        </div>
      )}
      {!connected && wasConnected && (
        <div className="offline" role="status"><Icon name="wifiOff" size={16} /> Connection lost. Reconnecting…</div>
      )}
    </>
  );
  const overlays = (
    <>
      <CallWindow />
      <IncomingCalls />
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>{t.text}</div>
        ))}
      </div>
    </>
  );

  if (phone) {
    const tabs = [
      { key: 'chat', label: 'Chats', icon: 'chat', badge: chatUnread, active: route.view === 'chat' },
      { key: 'calls', label: 'Calls', icon: 'phone', badge: 0, active: route.view === 'calls' },
      { key: 'files', label: 'Files', icon: 'file', badge: 0, active: route.view === 'files' },
      { key: 'you', label: 'You', icon: 'user', badge: 0, active: ['you', 'settings', 'admin', 'people'].includes(route.view) },
    ];
    return (
      <div className={`shell phone ${call ? 'in-call' : ''}`}>
        {!inConversation && (
          <header className="m-header">
            <div className="m-header-top">
              <a href="#/chat" className="app-name">Relay</a>
              <span className={`conn-dot ${connected ? 'ok' : ''}`} title={connected ? 'Connected' : 'Reconnecting'} />
              <span className="grow" />
              <a href="#/mail/inbox" className={`icon-btn light ${route.view === 'mail' ? 'on-dark' : ''}`} aria-label={`Mail${mailUnread ? `, ${mailUnread} unread` : ''}`}>
                <Icon name="mail" size={22} />
                {mailUnread > 0 && <span className="badge dot-badge">{mailUnread > 99 ? '99+' : mailUnread}</span>}
              </a>
            </div>
            <GlobalSearch />
          </header>
        )}
        {banners}
        <main className="content">{view}</main>
        {!inConversation && (
          <nav className="bottom-nav" aria-label="Main">
            {tabs.map((t) => (
              <a key={t.key} href={`#/${t.key}`} className={`bottom-item ${t.active ? 'active' : ''}`} aria-current={t.active ? 'page' : undefined}>
                <span className="bottom-icon">
                  <Icon name={t.icon} size={24} />
                  {t.badge > 0 && <span className="badge dot-badge">{t.badge > 99 ? '99+' : t.badge}</span>}
                </span>
                <span>{t.label}</span>
              </a>
            ))}
          </nav>
        )}
        {overlays}
      </div>
    );
  }

  const nav = [
    { key: 'chat', label: 'Chat', icon: 'chat', badge: chatUnread },
    { key: 'mail', label: 'Mail', icon: 'mail', badge: mailUnread },
    { key: 'calls', label: 'Calls', icon: 'phone', badge: 0 },
    { key: 'files', label: 'Files', icon: 'file', badge: 0 },
    { key: 'people', label: 'People', icon: 'people', badge: 0 },
  ];
  return (
    <div className={`shell ${call ? 'in-call' : ''}`}>
      <aside className="sidebar" aria-label="Navigation">
        <div className="side-top">
          <a href="#/chat" className="app-name">Relay</a>
          <span className={`conn-dot ${connected ? 'ok' : ''}`} title={connected ? 'Connected' : 'Reconnecting…'} aria-label={connected ? 'Connected' : 'Reconnecting'} />
        </div>
        <GlobalSearch />
        <nav className="side-nav" aria-label="Apps">
          {nav.map((n) => (
            <a key={n.key} href={`#/${n.key}`} className={`side-nav-item ${route.view === n.key ? 'active' : ''}`} aria-current={route.view === n.key ? 'page' : undefined} title={n.label}>
              <span className="bottom-icon">
                <Icon name={n.icon} size={20} />
                {n.badge > 0 && <span className="badge dot-badge">{n.badge > 99 ? '99+' : n.badge}</span>}
              </span>
              <span>{n.label}</span>
            </a>
          ))}
        </nav>
        <div className="side-scroll">
          <SidebarConversations />
        </div>
        <MeMenu onLogout={onLogout} />
      </aside>
      <div className="main">
        {banners}
        <main className="content">{view}</main>
      </div>
      {overlays}
    </div>
  );
}

function MeMenu({ onLogout }: { onLogout: () => void }) {
  const { me, route } = useStore();
  const [open, setOpen] = useState(false);
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => (document.removeEventListener('mousedown', close), document.removeEventListener('keydown', esc));
  }, [open]);
  const p = presenceOf({ ...me, online: true });
  return (
    <div className="me-menu" ref={ref}>
      {open && (
        <div className="menu">
          <StatusControls onDone={() => setOpen(false)} />
          {perm === 'default' && (
            <button className="menu-item" onClick={() => void Notification.requestPermission().then(setPerm)}><Icon name="bell" size={18} /> Turn on notifications</button>
          )}
          <button className="menu-item" onClick={() => (go('settings'), setOpen(false))}><Icon name="settings" size={18} /> Settings</button>
          {me.role === 'admin' && (
            <button className={`menu-item ${route.view === 'admin' ? 'on' : ''}`} onClick={() => (go('admin'), setOpen(false))}><Icon name="shield" size={18} /> Admin</button>
          )}
          <button className="menu-item" onClick={onLogout}><Icon name="logout" size={18} /> Sign out</button>
        </div>
      )}
      <button className="me-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu">
        <Avatar user={{ ...me, online: true }} size={32} />
        <span className="me-text">
          <strong>{me.name}</strong>
          <small>{me.statusMessage || p.label}</small>
        </span>
        <Icon name="more" size={18} />
      </button>
    </div>
  );
}

function GlobalSearch() {
  const { user, conversations, conversationName } = useStore();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<{ messages: Message[]; emails: Email[]; people: User[] } | null>(null);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (q.trim().length < 2) return setRes(null);
    const t = setTimeout(() => api(`/api/search?q=${encodeURIComponent(q.trim())}`).then(setRes), 200);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  const pick = (path: string) => {
    go(path);
    setOpen(false);
    setQ('');
  };
  const openDm = async (uid: number) => {
    const { conversation } = await api('/api/conversations/dm', { body: { userId: uid } });
    pick(`chat/${conversation.id}`);
  };
  const empty = res && !res.messages.length && !res.emails.length && !res.people.length;
  return (
    <div className="global-search" ref={ref}>
      <Icon name="search" size={16} />
      <input
        value={q}
        onChange={(e) => (setQ(e.target.value), setOpen(true))}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
        placeholder="Search people, messages and mail"
        aria-label="Search everything"
      />
      {open && res && (
        <div className="search-results">
          {empty && <div className="hint pad">No results for “{q}”.</div>}
          {res.people.length > 0 && <h4>People</h4>}
          {res.people.map((u) => (
            <button key={'u' + u.id} className="result" onClick={() => void openDm(u.id)}>
              <Avatar user={u} size={26} />
              <span><strong>{u.name}</strong><small>{u.title || u.email}</small></span>
            </button>
          ))}
          {res.messages.length > 0 && <h4>Messages</h4>}
          {res.messages.map((m) => {
            const c = conversations.find((x) => x.id === m.conversationId);
            return (
              <button key={'m' + m.id} className="result" onClick={() => pick(`chat/${m.conversationId}`)}>
                <Avatar user={user(m.senderId)} size={26} showPresence={false} />
                <span><strong>{user(m.senderId)?.name} {c && <small className="inline">in {conversationName(c)}</small>}</strong><small>{m.body.slice(0, 120)}</small></span>
              </button>
            );
          })}
          {res.emails.length > 0 && <h4>Mail</h4>}
          {res.emails.map((e) => (
            <button key={'e' + e.id} className="result" onClick={() => pick(`mail/${e.folder}/${e.id}`)}>
              <Icon name="mail" size={18} />
              <span><strong>{e.subject || '(no subject)'}</strong><small>{e.from.name} · {e.snippet}</small></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
