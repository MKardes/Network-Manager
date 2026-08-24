import { useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../app/auth';

/** Settings: enable/disable 2FA, view recovery codes, change passphrase (T060). */
export function Settings() {
  const { status, refresh } = useAuth();
  const [provisioning, setProvisioning] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [totp, setTotp] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [passphrase, setPassphrase] = useState({ current: '', next: '' });

  const begin2fa = async () => {
    setMsg(null);
    try {
      const res = await api.post<{ provisioningUri: string; recoveryCodes: string[] }>(
        '/auth/2fa/enable',
      );
      setProvisioning(res.provisioningUri);
      setRecoveryCodes(res.recoveryCodes);
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Failed to begin 2FA enrollment.');
    }
  };

  const verify2fa = async () => {
    setMsg(null);
    try {
      await api.post('/auth/2fa/verify', { totp });
      setMsg('2FA enabled.');
      setProvisioning(null);
      await refresh();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Verification failed.');
    }
  };

  const disable2fa = async () => {
    setMsg(null);
    try {
      await api.post('/auth/2fa/disable', { password: pw });
      setMsg('2FA disabled.');
      await refresh();
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Failed to disable 2FA.');
    }
  };

  const changePassphrase = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    try {
      await api.post('/auth/passphrase', {
        currentPassphrase: passphrase.current,
        newPassphrase: passphrase.next,
      });
      setMsg('Master passphrase changed.');
      setPassphrase({ current: '', next: '' });
    } catch (err) {
      setMsg(err instanceof ApiError ? err.message : 'Failed to change passphrase.');
    }
  };

  return (
    <div>
      <h1>Settings</h1>
      {msg && <div className="notice">{msg}</div>}

      <section className="card">
        <h2>Two-factor authentication</h2>
        <p className="muted">Status: {status?.totpEnabled ? 'enabled' : 'disabled'}</p>
        {!status?.totpEnabled && !provisioning && <button onClick={begin2fa}>Enable 2FA</button>}
        {provisioning && (
          <div>
            <p>Add this to your authenticator app:</p>
            <code className="break">{provisioning}</code>
            {recoveryCodes && (
              <>
                <p>
                  <strong>Save these one-time recovery codes now</strong> — they are shown only once:
                </p>
                <ul className="codes">
                  {recoveryCodes.map((c) => (
                    <li key={c}>
                      <code>{c}</code>
                    </li>
                  ))}
                </ul>
              </>
            )}
            <label>
              Enter a code to confirm
              <input value={totp} onChange={(e) => setTotp(e.target.value)} />
            </label>
            <button onClick={verify2fa}>Confirm</button>
          </div>
        )}
        {status?.totpEnabled && (
          <div className="inline-form">
            <input
              type="password"
              placeholder="password to disable"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
            />
            <button className="danger" onClick={disable2fa}>
              Disable 2FA
            </button>
          </div>
        )}
      </section>

      <form className="card" onSubmit={changePassphrase}>
        <h2>Change master passphrase</h2>
        <label>
          Current passphrase
          <input
            type="password"
            value={passphrase.current}
            onChange={(e) => setPassphrase({ ...passphrase, current: e.target.value })}
            required
          />
        </label>
        <label>
          New passphrase
          <input
            type="password"
            value={passphrase.next}
            onChange={(e) => setPassphrase({ ...passphrase, next: e.target.value })}
            minLength={8}
            required
          />
        </label>
        <button type="submit">Change passphrase</button>
      </form>
    </div>
  );
}
