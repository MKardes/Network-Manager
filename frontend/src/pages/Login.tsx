import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../app/auth';

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
      await api.post('/auth/login', {
        username,
        password,
        totp: totp || undefined,
      });
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
      <form className="card" onSubmit={submit}>
        <h1>Sign in</h1>
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} required />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {status?.totpEnabled && (
          <label>
            2FA code (or recovery code)
            <input value={totp} onChange={(e) => setTotp(e.target.value)} autoComplete="one-time-code" />
          </label>
        )}
        {error && <div className="error">{error}</div>}
        <button disabled={busy} type="submit">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
