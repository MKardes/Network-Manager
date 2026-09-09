import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../app/auth';
import { rememberUser } from '../app/session';

/** Password (+ optional TOTP) login (FR-017/021). */
export function Login() {
  const nav = useNavigate();
  const { status, refresh } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [totp, setTotp] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await api.post<{ user: { username: string } }>('/auth/login', {
        username,
        password,
        totp: totp || undefined,
      });
      // The session is an HttpOnly cookie, so the shell's "signed in as" line
      // reads the name from here rather than from the API.
      rememberUser(res.user.username);
      await refresh();
      // After login the vault may still be locked → Unlock; else the app.
      nav('/unlock');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'locked_out') {
        setError('Too many attempts. The account is temporarily locked.');
      } else {
        setError(err instanceof ApiError ? err.message : 'Login failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center">
      <form className="auth-card" onSubmit={submit}>
        <div className="kicker">WG Manager</div>
        <h1>Sign in</h1>
        <div className="field">
          <label className="field__label" htmlFor="login-user">
            Username
          </label>
          <input
            id="login-user"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="login-password">
            Password
          </label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {status?.totpEnabled && (
          <div className="field">
            <label className="field__label" htmlFor="login-totp">
              2FA code (or recovery code)
            </label>
            <input
              id="login-totp"
              value={totp}
              onChange={(e) => setTotp(e.target.value)}
              autoComplete="one-time-code"
            />
          </div>
        )}
        {error && <div className="error">{error}</div>}
        <div className="form-actions">
          <button className="btn" disabled={busy} type="submit">
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </div>
      </form>
    </div>
  );
}
