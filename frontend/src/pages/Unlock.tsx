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
      nav('/servers');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('Incorrect master passphrase.');
      } else if (err instanceof ApiError && err.status === 401) {
        nav('/login');
      } else {
        setError(err instanceof ApiError ? err.message : 'Unlock failed.');
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center">
      <form className="card" onSubmit={submit}>
        <h1>Unlock vault</h1>
        <p className="muted">Enter the master passphrase to decrypt stored secrets for this session.</p>
        <label>
          Master passphrase
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoFocus
            required
          />
        </label>
        {error && <div className="error">{error}</div>}
        <button disabled={busy} type="submit">
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
    </div>
  );
}
