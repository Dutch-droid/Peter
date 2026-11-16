import { useState } from 'react';
import { api } from '../api';
import { go, useStore } from '../store';
import { Avatar, Icon, presenceOf } from '../components/ui';

export const STATUSES = [
  { key: 'available', label: 'Available' },
  { key: 'busy', label: 'Busy' },
  { key: 'dnd', label: 'Do not disturb' },
  { key: 'away', label: 'Away' },
] as const;

/** Status picker + status message, shared by the desktop "You" menu and the phone "You" tab. */
export function StatusControls({ onDone }: { onDone?: () => void }) {
  const { me, setMe, toast } = useStore();
  const [msg, setMsg] = useState(me.statusMessage);
  const update = async (body: object) => {
    try {
      const { user } = await api('/api/me', { method: 'PATCH', body });
      setMe(user);
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  return (
    <>
      <div role="radiogroup" aria-label="Your status">
        {STATUSES.map((s) => (
          <button key={s.key} role="radio" aria-checked={me.status === s.key} className={`menu-item ${me.status === s.key ? 'on' : ''}`} onClick={() => void update({ status: s.key })}>
            <span className={`presence-dot presence-${s.key}`} /> {s.label}
            {me.status === s.key && <Icon name="check" size={16} />}
          </button>
        ))}
      </div>
      <form
        className="menu-status"
        onSubmit={(e) => {
          e.preventDefault();
          void update({ statusMessage: msg });
          onDone?.();
        }}
      >
        <input value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={140} placeholder="Set a status message" aria-label="Status message" />
      </form>
    </>
  );
}

export function YouView({ onLogout }: { onLogout: () => void }) {
  const { me, mailCounts } = useStore();
  const unread = mailCounts.inbox?.unread ?? 0;
  return (
    <div className="page you">
      <div className="you-card">
        <Avatar user={{ ...me, online: true }} size={64} />
        <div>
          <h1>{me.name}</h1>
          <p className="muted">{me.title || me.email}</p>
          <p className={`p-${presenceOf({ ...me, online: true }).key}`}>{presenceOf({ ...me, online: true }).label}</p>
        </div>
      </div>
      <section className="card">
        <h2>Status</h2>
        <StatusControls />
      </section>
      <nav className="card you-links" aria-label="More">
        <button className="menu-item" onClick={() => go('mail/inbox')}><Icon name="mail" size={20} /> Mail {unread > 0 && <span className="badge">{unread}</span>}</button>
        <button className="menu-item" onClick={() => go('people')}><Icon name="people" size={20} /> People</button>
        <button className="menu-item" onClick={() => go('settings')}><Icon name="settings" size={20} /> Settings</button>
        {me.role === 'admin' && <button className="menu-item" onClick={() => go('admin')}><Icon name="shield" size={20} /> Admin</button>}
        <button className="menu-item danger-text" onClick={onLogout}><Icon name="logout" size={20} /> Sign out</button>
      </nav>
    </div>
  );
}
