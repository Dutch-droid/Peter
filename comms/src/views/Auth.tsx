import { useEffect, useState } from 'react';
import { api, type User } from '../api';
import { Icon } from '../components/ui';

export function Brand() {
  return (
    <div className="brand">
      <img src="/icon.svg" alt="" width={36} height={36} />
      <span>Relay</span>
    </div>
  );
}

export function Login({ onSignedIn }: { onSignedIn: (u: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [signup, setSignup] = useState<'first-admin' | 'code' | 'closed'>('closed');
  const [form, setForm] = useState({ email: '', password: '', name: '', title: '', code: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/api/auth/config').then((r) => {
      setSignup(r.signup);
      if (r.signup === 'first-admin') setMode('register');
    });
  }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { user } = await api(mode === 'login' ? '/api/auth/login' : '/api/auth/register', { body: form });
      onSignedIn(user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <div className="auth-side">
        <Brand />
        <h1>When the usual tools go dark, keep talking.</h1>
        <p>Chat, mail and calls for your organisation, hosted on your own infrastructure and independent of Microsoft 365, Google Workspace or any other cloud suite.</p>
        <ul className="auth-points">
          <li><Icon name="chat" /> Team channels, group chats and direct messages</li>
          <li><Icon name="mail" /> Internal email with folders, threads and attachments</li>
          <li><Icon name="video" /> Voice and video calls with screen sharing</li>
          <li><Icon name="megaphone" /> Outage announcements to everyone at once</li>
        </ul>
      </div>
      <form className="auth-card" onSubmit={submit}>
        <h2>{mode === 'login' ? 'Sign in' : signup === 'first-admin' ? 'Set up Relay' : 'Create your account'}</h2>
        {signup === 'first-admin' && <p className="muted">You’re the first person here, so you’ll be the administrator.</p>}
        {mode === 'register' && (
          <>
            <label className="field"><span>Full name</span><input value={form.name} onChange={set('name')} required maxLength={80} autoComplete="name" /></label>
            <label className="field"><span>Job title (optional)</span><input value={form.title} onChange={set('title')} maxLength={80} autoComplete="organization-title" /></label>
          </>
        )}
        <label className="field"><span>Email</span><input type="email" value={form.email} onChange={set('email')} required autoComplete="username" autoFocus /></label>
        <label className="field">
          <span>Password</span>
          <input type="password" value={form.password} onChange={set('password')} required minLength={mode === 'register' ? 8 : undefined} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
        </label>
        {mode === 'register' && signup === 'code' && (
          <label className="field"><span>Sign-up code from your admin</span><input value={form.code} onChange={set('code')} required /></label>
        )}
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="btn primary full" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</button>
        {signup === 'code' && (
          <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>
            {mode === 'login' ? 'Have a sign-up code? Create an account' : 'Already have an account? Sign in'}
          </button>
        )}
        {signup === 'closed' && mode === 'login' && <p className="muted small">No account? Your administrator creates them.</p>}
      </form>
    </div>
  );
}

export function PasswordForm({ forced, onDone }: { forced?: boolean; onDone: (u: User) => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (next !== confirm) return setError('The new passwords don’t match');
    try {
      const { user } = await api('/api/me/password', { body: { current, next } });
      setCurrent('');
      setNext('');
      setConfirm('');
      onDone(user);
    } catch (err) {
      setError((err as Error).message);
    }
  };
  return (
    <form className="stack" onSubmit={submit}>
      <label className="field"><span>{forced ? 'One-time password' : 'Current password'}</span><input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required autoComplete="current-password" /></label>
      <label className="field"><span>New password (8+ characters)</span><input type="password" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} required autoComplete="new-password" /></label>
      <label className="field"><span>Confirm new password</span><input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required autoComplete="new-password" /></label>
      {error && <div className="form-error" role="alert">{error}</div>}
      <button className="btn primary">{forced ? 'Activate my account' : 'Change password'}</button>
    </form>
  );
}

export function Activate({ user, onDone, onLogout }: { user: User; onDone: (u: User) => void; onLogout: () => void }) {
  return (
    <div className="auth">
      <div className="auth-side">
        <Brand />
        <h1>Welcome, {user.name.split(' ')[0]}.</h1>
        <p>Choose your own password to activate your account. Keep it somewhere you can reach during an outage, such as a password manager on your phone, because your usual email may not be available then.</p>
      </div>
      <div className="auth-card">
        <h2>Activate your account</h2>
        <PasswordForm forced onDone={onDone} />
        <button className="link" onClick={onLogout}>Sign out</button>
      </div>
    </div>
  );
}
