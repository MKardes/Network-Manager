import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../app/auth';

/** First-run setup: create the operator + set the master passphrase (FR-019/018). */
export function Setup() {
  const nav = useNavigate();
  const { refresh } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (passphrase !== confirm) {
      setError('Passphrases do not match.');
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/setup', { username, password, passphrase });
      await refresh();
      nav('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Setup failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center">
      <form className="auth-card" onSubmit={submit}>
        <div className="kicker">WG Manager</div>
        <h1>First-run setup</h1>
        <p>
          Create the administrator account and choose a master passphrase. The passphrase encrypts
          all secrets and is <strong>never stored</strong> — if you lose it, secrets are
          unrecoverable.
        </p>
        <div className="field">
          <label className="field__label" htmlFor="setup-user">
            Username
          </label>
          <input
            id="setup-user"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="setup-password">
            Password
          </label>
          <input
            id="setup-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="setup-passphrase">
            Master passphrase
          </label>
          <input
            id="setup-passphrase"
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            minLength={8}
            required
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="setup-confirm">
            Confirm passphrase
          </label>
          <input
            id="setup-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </div>
        {error && <div className="error">{error}</div>}
        <div className="form-actions">
          <button className="btn" disabled={busy} type="submit">
            {busy ? 'Setting up…' : 'Complete setup'}
          </button>
        </div>
      </form>
    </div>
  );
}
