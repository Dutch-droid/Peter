'use client';
import { useActionState } from 'react';
import { login } from '../actions';

export default function Login() {
  const [state, action, pending] = useActionState(login, null);
  return (
    <main style={{ maxWidth: 380 }}>
      <div className="card">
        <h1>PeopleFlow HR</h1>
        <form action={action} style={{ display: 'grid', gap: 12 }}>
          <label>Email<input name="email" type="email" required autoFocus /></label>
          <label>Password<input name="password" type="password" required /></label>
          {state?.error && <div className="err">{state.error}</div>}
          <button disabled={pending}>{pending ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <p style={{ color: 'var(--mute)', fontSize: 13 }}>
          Demo: admin@example.com / admin123 · manager@example.com / manager123 · amina@example.com / employee123
        </p>
      </div>
    </main>
  );
}
