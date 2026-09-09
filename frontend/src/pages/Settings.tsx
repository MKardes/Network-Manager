import { useState } from 'react';
import { api, ApiError } from '../api/client';
import { useAuth } from '../app/auth';
import { usePrefs, type Density, type Layout, type Theme } from '../app/prefs';
import { Panel } from '../components/ui/Panel';
import { Segmented } from '../components/ui/Segmented';

const LAYOUTS: { value: Layout; label: string }[] = [
  { value: 'rail', label: 'Rail' },
  { value: 'bar', label: 'Bar' },
];

const THEMES: { value: Theme; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

const DENSITIES: { value: Density; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'comfortable', label: 'Comfortable' },
];

/** Settings: appearance preferences, 2FA enrolment and the master passphrase. */
export function Settings() {
  const { status, refresh } = useAuth();
  const { layout, theme, density, setLayout, setTheme, setDensity } = usePrefs();
  const [provisioning, setProvisioning] = useState<string | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [totp, setTotp] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pw, setPw] = useState('');
  const [passphrase, setPassphrase] = useState({ current: '', next: '' });

  const begin2fa = async () => {
    setMsg(null);
    setError(null);
    try {
      const res = await api.post<{ provisioningUri: string; recoveryCodes: string[] }>(
        '/auth/2fa/enable',
      );
      setProvisioning(res.provisioningUri);
      setRecoveryCodes(res.recoveryCodes);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to begin 2FA enrollment.');
    }
  };

  const verify2fa = async () => {
    setMsg(null);
    setError(null);
    try {
      await api.post('/auth/2fa/verify', { totp });
      setMsg('2FA enabled.');
      setProvisioning(null);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verification failed.');
    }
  };

  const disable2fa = async () => {
    setMsg(null);
    setError(null);
    try {
      await api.post('/auth/2fa/disable', { password: pw });
      setMsg('2FA disabled.');
      setPw('');
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to disable 2FA.');
    }
  };

  const changePassphrase = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setError(null);
    try {
      await api.post('/auth/passphrase', {
        currentPassphrase: passphrase.current,
        newPassphrase: passphrase.next,
      });
      setMsg('Master passphrase changed.');
      setPassphrase({ current: '', next: '' });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to change passphrase.');
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="kicker">Preferences</div>
          <h1 className="h1">Settings</h1>
        </div>
      </div>

      {msg && <div className="notice">{msg}</div>}
      {error && <div className="error">{error}</div>}

      <div className="grid-2">
        <Panel title="Appearance">
          <div className="field">
            <span className="field__label">Layout</span>
            <Segmented options={LAYOUTS} value={layout} onChange={setLayout} label="Layout" />
            <span className="field__hint">
              Rail puts navigation on the left and device detail in a drawer. Bar puts navigation on
              top and device detail on its own page. Below 900px the bar layout is used regardless.
            </span>
          </div>

          <div className="field">
            <span className="field__label">Theme</span>
            <Segmented options={THEMES} value={theme} onChange={setTheme} label="Theme" />
            <span className="field__hint">System follows your operating system setting.</span>
          </div>

          <div className="field">
            <span className="field__label">Table density</span>
            <Segmented
              options={DENSITIES}
              value={density}
              onChange={setDensity}
              label="Table density"
            />
          </div>
        </Panel>

        <Panel title="Two-factor authentication">
          <p className="panel__body">
            Status: {status?.totpEnabled ? 'enabled' : 'disabled'}
          </p>

          {!status?.totpEnabled && !provisioning && (
            <button type="button" className="btn btn--compact" onClick={() => void begin2fa()}>
              Enable 2FA
            </button>
          )}

          {provisioning && (
            <div className="stack">
              <p style={{ margin: 0 }}>Add this to your authenticator app:</p>
              <code className="mono break" style={{ fontSize: 11.5 }}>
                {provisioning}
              </code>
              {recoveryCodes && (
                <>
                  <p style={{ margin: 0 }}>
                    <strong>Save these one-time recovery codes now</strong> — they are shown only
                    once:
                  </p>
                  <ul className="codes">
                    {recoveryCodes.map((c) => (
                      <li key={c}>{c}</li>
                    ))}
                  </ul>
                </>
              )}
              <div className="field">
                <label className="field__label" htmlFor="totp">
                  Enter a code to confirm
                </label>
                <input id="totp" value={totp} onChange={(e) => setTotp(e.target.value)} />
              </div>
              <div>
                <button type="button" className="btn btn--compact" onClick={() => void verify2fa()}>
                  Confirm
                </button>
              </div>
            </div>
          )}

          {status?.totpEnabled && (
            <div className="inline-form" style={{ marginTop: 10 }}>
              <input
                type="password"
                placeholder="password to disable"
                aria-label="Password to disable 2FA"
                value={pw}
                onChange={(e) => setPw(e.target.value)}
              />
              <button
                type="button"
                className="btn-outline btn-outline--danger"
                onClick={() => void disable2fa()}
                disabled={!pw}
              >
                Disable 2FA
              </button>
            </div>
          )}
        </Panel>
      </div>

      <Panel title="Master passphrase">
        <form onSubmit={changePassphrase} style={{ maxWidth: 420 }}>
          <div className="field">
            <label className="field__label" htmlFor="pp-current">
              Current passphrase
            </label>
            <input
              id="pp-current"
              type="password"
              value={passphrase.current}
              onChange={(e) => setPassphrase({ ...passphrase, current: e.target.value })}
              required
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="pp-next">
              New passphrase
            </label>
            <input
              id="pp-next"
              type="password"
              value={passphrase.next}
              onChange={(e) => setPassphrase({ ...passphrase, next: e.target.value })}
              minLength={8}
              required
            />
          </div>
          <div className="form-actions">
            <button type="submit" className="btn btn--compact">
              Change passphrase
            </button>
          </div>
        </form>
      </Panel>
    </div>
  );
}
