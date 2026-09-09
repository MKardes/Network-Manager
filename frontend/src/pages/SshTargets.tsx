import { useEffect, useState } from 'react';
import { api, ApiError, type SshTarget } from '../api/client';

/**
 * SSH Targets page: create/list/trust/delete the SSH connections used by remote
 * servers and devices (FR-010a). The app generates the keypair; only the public
 * key is ever returned — install it on the target host's authorized_keys.
 */
export function SshTargets() {
  const [targets, setTargets] = useState<SshTarget[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({ host: '', port: '22', username: '' });

  const load = async () => {
    try {
      const { sshTargets } = await api.get<{ sshTargets: SshTarget[] }>('/ssh-targets');
      setTargets(sshTargets);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load SSH targets.');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const { sshTarget } = await api.post<{ sshTarget: SshTarget; publicKey: string }>('/ssh-targets', {
        host: form.host,
        username: form.username,
        port: Number(form.port) || 22,
      });
      setNotice(
        `Created ${sshTarget.username}@${sshTarget.host}. Install its public key on the target (below), then use "Trust" to record the host key.`,
      );
      setForm({ host: '', port: '22', username: '' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create SSH target.');
    }
  };

  const trust = async (t: SshTarget) => {
    setError(null);
    setNotice(null);
    setBusy(t.id);
    try {
      await api.post(`/ssh-targets/${t.id}/trust`);
      setNotice(`Recorded host key for ${t.username}@${t.host}.`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not connect to record the host key.');
    } finally {
      setBusy(null);
    }
  };

  const remove = async (t: SshTarget) => {
    if (!confirm(`Delete SSH target ${t.username}@${t.host}? Servers/devices using it will lose their connection.`))
      return;
    setError(null);
    setNotice(null);
    try {
      await api.del(`/ssh-targets/${t.id}`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete SSH target.');
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice('Public key copied to clipboard.');
    } catch {
      setNotice('Copy failed — select the key text manually.');
    }
  };

  return (
    <div>
      <h1>SSH Targets</h1>
      <p className="muted">
        An SSH target is a remote host the app manages over SSH (remote WireGuard servers, SFTP, Wake-on-LAN). The
        app generates an ed25519 keypair per target; install the public key on the host, then record its host key
        with <strong>Trust</strong>.
      </p>
      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      <table className="grid">
        <thead>
          <tr>
            <th>Host</th>
            <th>Port</th>
            <th>User</th>
            <th>Host key</th>
            <th>Public key</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {targets.map((t) => (
            <tr key={t.id}>
              <td>{t.host}</td>
              <td>{t.port}</td>
              <td>{t.username}</td>
              <td>
                {t.knownHostKey ? (
                  <span className="badge connected">trusted</span>
                ) : (
                  <span className="badge unknown">untrusted</span>
                )}
              </td>
              <td>
                <code className="break">{t.publicKey}</code>
                <button className="linklike" onClick={() => copy(t.publicKey)}>
                  Copy
                </button>
              </td>
              <td>
                <button onClick={() => trust(t)} disabled={busy === t.id}>
                  {busy === t.id ? 'Trusting…' : 'Trust'}
                </button>
                <button className="danger" onClick={() => remove(t)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {targets.length === 0 && (
            <tr>
              <td colSpan={6} className="muted">
                No SSH targets yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <form className="card" onSubmit={create}>
        <h2>Add an SSH target</h2>
        <label>
          Host
          <input
            value={form.host}
            onChange={(e) => setForm({ ...form, host: e.target.value })}
            placeholder="server.example.com or 10.0.0.2"
            required
          />
        </label>
        <label>
          Port
          <input
            type="number"
            min={1}
            max={65535}
            value={form.port}
            onChange={(e) => setForm({ ...form, port: e.target.value })}
          />
        </label>
        <label>
          Username
          <input
            value={form.username}
            onChange={(e) => setForm({ ...form, username: e.target.value })}
            placeholder="root"
            required
          />
        </label>
        <button type="submit">Create</button>
      </form>
    </div>
  );
}
