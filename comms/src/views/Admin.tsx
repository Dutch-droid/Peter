import { useEffect, useState } from 'react';
import { api, type Announcement, type User } from '../api';
import { useStore } from '../store';
import { Avatar, Icon, Modal, timeShort } from '../components/ui';

type AdminUser = User & { activated: boolean; lastSeenAt: number | null; createdAt: number };
type Readiness = { total: number; activated: number; active30d: number };

function downloadCsv(name: string, rows: string[][]) {
  // Prefix cells that a spreadsheet would treat as formulas.
  const esc = (s: string) => {
    const v = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function AdminView() {
  const { me, toast, announcement } = useStore();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [ready, setReady] = useState<Readiness | null>(null);
  const [history, setHistory] = useState<Announcement[]>([]);
  const [roster, setRoster] = useState('');
  const [result, setResult] = useState<{ created: { name: string; email: string; password: string }[]; skipped: { line: number; email: string; reason: string }[] } | null>(null);
  const [annBody, setAnnBody] = useState('');
  const [severity, setSeverity] = useState<'info' | 'warning' | 'critical'>('warning');
  const [q, setQ] = useState('');
  const [reset, setReset] = useState<{ name: string; email: string; password: string } | null>(null);

  const load = () => {
    api('/api/admin/users').then((r) => {
      setUsers(r.users);
      setReady(r.readiness);
    });
    api('/api/admin/announcements').then((r) => setHistory(r.announcements));
  };
  useEffect(load, []);

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast(ok, 'success');
      load();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  const pct = ready && ready.total ? Math.round((ready.activated / ready.total) * 100) : 0;
  const lq = q.toLowerCase();
  const shown = users.filter((u) => !lq || u.name.toLowerCase().includes(lq) || u.email.includes(lq));

  return (
    <div className="admin-view">
      <div className="list-head">
        <h1>Admin</h1>
      </div>

      <section className="card">
        <h2><Icon name="megaphone" /> Announcement banner</h2>
        <p className="muted">Shown at the top of everyone’s screen, with a sound and desktop notification. Use it to tell people what is down, what to use instead, and when you’ll update next.</p>
        {announcement && (
          <div className={`announce-preview sev-${announcement.severity}`}>
            <strong>Live now:</strong> {announcement.body}
            <button className="btn small ghost" onClick={() => void run(() => api('/api/admin/announcements', { method: 'DELETE' }), 'Banner cleared')}>Clear</button>
          </div>
        )}
        <form
          className="stack-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api('/api/admin/announcements', { body: { body: annBody, severity } });
              setAnnBody('');
            }, 'Announcement sent');
          }}
        >
          <textarea
            value={annBody}
            onChange={(e) => setAnnBody(e.target.value)}
            rows={3}
            maxLength={1000}
            required
            aria-label="Announcement text"
            placeholder="e.g. Microsoft 365 (Teams and Outlook) is down. Use Relay for chat, mail and calls. Next update 14:00."
          />
          <div className="row gap-s wrap">
            {(['info', 'warning', 'critical'] as const).map((s) => (
              <label key={s} className={`sev-option sev-${s} ${severity === s ? 'on' : ''}`}>
                <input type="radio" name="sev" checked={severity === s} onChange={() => setSeverity(s)} /> {s[0].toUpperCase() + s.slice(1)}
              </label>
            ))}
            <span className="grow" />
            <button className="btn primary">Post to everyone</button>
          </div>
        </form>
        {history.length > 0 && (
          <details>
            <summary>Previous announcements</summary>
            <ul className="ann-history">
              {history.map((a) => (
                <li key={a.id}>
                  <span className={`dot sev-${a.severity}`} /> {a.body} <small className="muted">— {a.author}, {timeShort(a.createdAt)}{a.clearedAt ? '' : ' (live)'}</small>
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="card">
        <h2><Icon name="shield" /> Outage readiness</h2>
        <p className="muted">A backup channel only helps if people can sign in when the main tools are down. Get everyone to activate their account now, not during the outage.</p>
        {ready && (
          <div className="readiness">
            <div className="meter" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Accounts activated">
              <span style={{ width: `${pct}%` }} />
            </div>
            <div className="stats">
              <div><strong>{ready.total}</strong><small>accounts</small></div>
              <div><strong>{ready.activated}</strong><small>activated ({pct}%)</small></div>
              <div><strong>{ready.active30d}</strong><small>signed in, last 30 days</small></div>
            </div>
            {ready.activated < ready.total && (
              <button
                className="btn ghost small"
                onClick={() =>
                  downloadCsv(
                    'relay-not-activated.csv',
                    [['name', 'email'], ...users.filter((u) => !u.activated && !u.disabled).map((u) => [u.name, u.email])],
                  )
                }
              >
                <Icon name="download" size={14} /> Export people who haven’t activated
              </button>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h2><Icon name="people" /> Add people</h2>
        <p className="muted">
          Paste one person per line as <code>name, email, title</code> (a CSV export from HR works). Each gets a one-time password they must change at first sign-in.
          Hand these out through a channel that doesn’t depend on your main email: SMS, printout, or your HR system.
        </p>
        <form
          className="stack-sm"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              const r = await api('/api/admin/users', { body: { text: roster } });
              setResult(r);
              if (r.created.length) setRoster('');
            });
          }}
        >
          <textarea value={roster} onChange={(e) => setRoster(e.target.value)} rows={5} required aria-label="People to add" placeholder={'Jane Doe, jane@company.com, Finance lead\nSam Lee, sam@company.com, IT'} />
          <div className="row"><button className="btn primary">Create accounts</button></div>
        </form>
        {result && (
          <div className="provision-result">
            {result.created.length > 0 && (
              <>
                <div className="row gap-s">
                  <strong>{result.created.length} created.</strong>
                  <span className="muted small">Passwords are shown only once.</span>
                  <button className="btn small" onClick={() => downloadCsv('relay-new-accounts.csv', [['name', 'email', 'one-time password'], ...result.created.map((c) => [c.name, c.email, c.password])])}>
                    <Icon name="download" size={14} /> Download CSV
                  </button>
                </div>
                <table className="table">
                  <thead><tr><th>Name</th><th>Email</th><th>One-time password</th></tr></thead>
                  <tbody>{result.created.map((c) => <tr key={c.email}><td>{c.name}</td><td>{c.email}</td><td><code>{c.password}</code></td></tr>)}</tbody>
                </table>
              </>
            )}
            {result.skipped.length > 0 && (
              <div className="skipped">
                <strong>{result.skipped.length} skipped:</strong>
                <ul>{result.skipped.map((s) => <li key={s.line}>Line {s.line} ({s.email || 'no email'}): {s.reason}</li>)}</ul>
              </div>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <div className="row gap-s">
          <h2 className="grow"><Icon name="user" /> Accounts</h2>
          <input className="input-sm" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" aria-label="Filter accounts" />
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Person</th><th>Role</th><th>Status</th><th>Last seen</th><th aria-label="Actions" /></tr>
            </thead>
            <tbody>
              {shown.map((u) => (
                <tr key={u.id} className={u.disabled ? 'disabled' : ''}>
                  <td>
                    <span className="row gap-s">
                      <Avatar user={u} size={28} />
                      <span>{u.name}<br /><small className="muted">{u.email}</small></span>
                    </span>
                  </td>
                  <td>
                    <select
                      value={u.role}
                      aria-label={`Role for ${u.name}`}
                      onChange={(e) => void run(() => api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { role: e.target.value } }), 'Role updated')}
                    >
                      <option value="member">Member</option>
                      <option value="admin">Admin</option>
                    </select>
                  </td>
                  <td>
                    {u.disabled ? <span className="pill">Disabled</span> : u.activated ? <span className="pill ok">Activated</span> : <span className="pill warn">Not activated</span>}
                  </td>
                  <td className="muted small">{u.online ? 'Online now' : u.lastSeenAt ? timeShort(u.lastSeenAt) : 'Never'}</td>
                  <td className="actions">
                    <button
                      className="btn small ghost"
                      onClick={() =>
                        confirm(`Reset ${u.name}'s password? They will be signed out everywhere.`) &&
                        void run(async () => {
                          const r = await api(`/api/admin/users/${u.id}/reset-password`, { method: 'POST' });
                          setReset({ name: u.name, email: u.email, password: r.password });
                        })
                      }
                    >
                      Reset password
                    </button>
                    {u.id !== me.id && (
                      <button
                        className="btn small ghost"
                        onClick={() => void run(() => api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { disabled: !u.disabled } }), u.disabled ? 'Account enabled' : 'Account disabled')}
                      >
                        {u.disabled ? 'Enable' : 'Disable'}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {reset && (
        <Modal title="Temporary password" onClose={() => setReset(null)}>
          <p>Give this to <strong>{reset.name}</strong> ({reset.email}). They’ll choose a new one when they sign in. It won’t be shown again.</p>
          <p className="big-code"><code>{reset.password}</code></p>
          <div className="modal-actions">
            <button className="btn" onClick={() => void navigator.clipboard?.writeText(reset.password).then(() => toast('Copied', 'success'))}><Icon name="copy" size={14} /> Copy</button>
            <button className="btn primary" onClick={() => setReset(null)}>Done</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
