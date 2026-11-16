import { useState } from 'react';
import { api } from '../api';
import { useStore } from '../store';
import { Avatar, Icon } from '../components/ui';
import { PasswordForm } from './Auth';

export function SettingsView() {
  const { me, setMe, toast } = useStore();
  const [name, setName] = useState(me.name);
  const [title, setTitle] = useState(me.title);
  const [perm, setPerm] = useState(typeof Notification !== 'undefined' ? Notification.permission : 'denied');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const { user } = await api('/api/me', { method: 'PATCH', body: { name, title } });
      setMe(user);
      toast('Profile saved', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div className="admin-view settings">
      <div className="list-head"><h1>Settings</h1></div>
      <section className="card">
        <h2><Icon name="user" /> Profile</h2>
        <form className="stack" onSubmit={save}>
          <div className="row gap-s"><Avatar user={me} size={56} /><div><strong>{me.email}</strong><br /><small className="muted">{me.role === 'admin' ? 'Administrator' : 'Member'}</small></div></div>
          <label className="field"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} /></label>
          <label className="field"><span>Job title</span><input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} /></label>
          <div className="row"><button className="btn primary">Save</button></div>
        </form>
      </section>
      <section className="card">
        <h2><Icon name="bell" /> Notifications</h2>
        <p className="muted">Get desktop alerts for messages, mail, calls and announcements while Relay is in the background.</p>
        {perm === 'granted' ? (
          <p><span className="pill ok">On</span> Desktop notifications are enabled in this browser.</p>
        ) : perm === 'denied' ? (
          <p><span className="pill">Blocked</span> Allow notifications for this site in your browser settings.</p>
        ) : (
          <button className="btn" onClick={() => void Notification.requestPermission().then(setPerm)}>Turn on desktop notifications</button>
        )}
        <p className="muted small">Tip: install Relay as an app (browser menu → Install) so it is one click away during an outage.</p>
      </section>
      <section className="card">
        <h2><Icon name="lock" /> Password</h2>
        <PasswordForm onDone={() => toast('Password changed. Other sessions were signed out.', 'success')} />
      </section>
    </div>
  );
}
