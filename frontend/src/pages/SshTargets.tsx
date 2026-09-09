import { useEffect, useState } from 'react';
import { api, ApiError, type SshTarget } from '../api/client';
import { ConfirmDialog, Dialog } from '../components/ui/Dialog';
import { Tag } from '../components/ui/Tag';

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
  const [pendingDelete, setPendingDelete] = useState<SshTarget | null>(null);
  const [showAdd, setShowAdd] = useState(false);
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
      const { sshTarget } = await api.post<{ sshTarget: SshTarget; publicKey: string }>(
        '/ssh-targets',
        { host: form.host, username: form.username, port: Number(form.port) || 22 },
      );
      setNotice(
        `Created ${sshTarget.username}@${sshTarget.host}. Install its public key on the target (below), then use "Trust" to record the host key.`,
      );
      setForm({ host: '', port: '22', username: '' });
      setShowAdd(false);
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

  const remove = async () => {
    if (!pendingDelete) return;
    setError(null);
    setNotice(null);
    setBusy(pendingDelete.id);
    try {
      await api.del(`/ssh-targets/${pendingDelete.id}`);
      setPendingDelete(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete SSH target.');
    } finally {
      setBusy(null);
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
    <div className="page">
      <div className="page-head">
        <div>
          <div className="kicker">Access</div>
          <h1 className="h1">SSH targets</h1>
        </div>
        <button type="button" className="btn" onClick={() => setShowAdd(true)}>
          Add target
        </button>
      </div>

      <p className="panel__body" style={{ maxWidth: '68ch' }}>
        An SSH target is a remote host the app manages over SSH (remote WireGuard servers, SFTP,
        Wake-on-LAN). The app generates an ed25519 keypair per target; install the public key on the
        host, then record its host key with <strong>Trust</strong>.
      </p>

      {error && <div className="error">{error}</div>}
      {notice && <div className="notice">{notice}</div>}

      <div className="table-scroll">
        <table className="table table--edge">
          <thead>
            <tr>
              <th>Host</th>
              <th>Port</th>
              <th>User</th>
              <th>Host key</th>
              <th>Public key</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {targets.map((t) => (
              <tr key={t.id}>
                <td className="device-name">{t.host}</td>
                <td className="cell-mono">{t.port}</td>
                <td className="muted">{t.username}</td>
                <td>
                  {t.knownHostKey ? (
                    <Tag state="connected">trusted</Tag>
                  ) : (
                    <Tag state="unknown">untrusted</Tag>
                  )}
                </td>
                <td style={{ maxWidth: 320 }}>
                  <code className="mono break" style={{ fontSize: 11 }}>
                    {t.publicKey}
                  </code>
                  <button type="button" className="btn-link" onClick={() => void copy(t.publicKey)}>
                    Copy
                  </button>
                </td>
                <td>
                  <div className="inline-form" style={{ justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      className="btn-outline btn-outline--sm"
                      onClick={() => void trust(t)}
                      disabled={busy === t.id}
                    >
                      {busy === t.id ? 'Trusting…' : 'Trust'}
                    </button>
                    <button
                      type="button"
                      className="btn-outline btn-outline--danger btn-outline--sm"
                      onClick={() => setPendingDelete(t)}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {targets.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  No SSH targets yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showAdd && (
        <Dialog title="Add an SSH target" onClose={() => setShowAdd(false)}>
          <form onSubmit={create}>
            <div className="field">
              <label className="field__label" htmlFor="ssh-host">
                Host
              </label>
              <input
                id="ssh-host"
                value={form.host}
                onChange={(e) => setForm({ ...form, host: e.target.value })}
                placeholder="server.example.com or 10.0.0.2"
                required
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="ssh-port">
                Port
              </label>
              <input
                id="ssh-port"
                type="number"
                min={1}
                max={65535}
                value={form.port}
                onChange={(e) => setForm({ ...form, port: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="ssh-user">
                Username
              </label>
              <input
                id="ssh-user"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="root"
                required
              />
            </div>
            <div className="dialog__actions">
              <button type="button" className="btn-outline" onClick={() => setShowAdd(false)}>
                Cancel
              </button>
              <button type="submit" className="btn btn--compact">
                Create
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete SSH target"
          message={`Delete ${pendingDelete.username}@${pendingDelete.host}. Servers and devices using it will lose their connection.`}
          confirmLabel="Delete target"
          danger
          busy={busy === pendingDelete.id}
          onConfirm={() => void remove()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
