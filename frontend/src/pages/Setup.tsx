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
      nav('/servers');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Setup failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center">
      <form className="card" onSubmit={submit}>
        <h1>First-run setup</h1>
        <p className="muted">
          Create the administrator account and choose a master passphrase. The passphrase encrypts
          all secrets and is <strong>never stored</strong> — if you lose it, secrets are
          unrecoverable.
        </p>
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
            minLength={8}
            required
          />
        </label>
        <label>
          Master passphrase
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            minLength={8}
            required
          />
        </label>
        <label>
          Confirm passphrase
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button disabled={busy} type="submit">
          {busy ? 'Setting up…' : 'Complete setup'}
        </button>
      </form>
    </div>
  );
}
