import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../app/auth';

/** Unlock the vault after each restart before secret-dependent actions (FR-018a). */
export function Unlock() {
  const nav = useNavigate();
  const { refresh } = useAuth();
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post('/vault/unlock', { passphrase });
      await refresh();
      nav('/');
    } catch (err) {
      // A wrong passphrase and an expired session both answer 401 with the same
      // error code, so surface the server's message instead of guessing which.
      setError(err instanceof ApiError ? err.message : 'Unlock failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center">
      <form className="auth-card" onSubmit={submit}>
        <div className="kicker">WG Manager</div>
        <h1>Unlock vault</h1>
        <p>Enter the master passphrase to decrypt stored secrets for this session.</p>
        <div className="field">
          <label className="field__label" htmlFor="unlock-passphrase">
            Master passphrase
          </label>
          <input
            id="unlock-passphrase"
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoFocus
            required
          />
        </div>
        {error && <div className="error">{error}</div>}
        <div className="form-actions">
          <button className="btn" disabled={busy} type="submit">
            {busy ? 'Unlocking…' : 'Unlock'}
          </button>
        </div>
      </form>
    </div>
  );
}
