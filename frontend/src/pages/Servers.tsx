import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type Server, type SshTarget } from '../api/client';
import { useActiveServer, reconcileActiveServer } from '../app/activeServer';
import { ConfirmDialog, Dialog } from '../components/ui/Dialog';
import { Tag } from '../components/ui/Tag';

const SERVER_STATE = { up: 'connected', down: 'offline', unknown: 'unknown' } as const;

/**
 * Servers page: register, apply and delete WireGuard servers (T042). The active
 * server is now picked in the app chrome, so this page is purely CRUD.
 */
export function Servers() {
  const [servers, setServers] = useState<Server[]>([]);
  const [sshTargets, setSshTargets] = useState<SshTarget[]>([]);
  const [active, setActive] = useActiveServer();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Server | null>(null);
  const [showRegister, setShowRegister] = useState(false);
  const [form, setForm] = useState({
    name: '',
    location: 'local' as 'local' | 'remote',
    addressRange: '10.0.0.0/24',
    listenEndpoint: '',
    sshTargetId: '',
  });

  const load = async () => {
    try {
      const { servers } = await api.get<{ servers: Server[] }>('/servers');
      setServers(servers);
      // Also drops a stale selection (deleted server / fresh DATA_DIR), which
      // would otherwise 404 as "Server not found" on every other page.
      setActive(reconcileActiveServer(active, servers));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load servers.');
    }
  };

  const loadSshTargets = async () => {
    try {
      const { sshTargets } = await api.get<{ sshTargets: SshTarget[] }>('/ssh-targets');
      setSshTargets(sshTargets);
    } catch {
      // Non-fatal: the dropdown just stays empty and links to the SSH Targets page.
    }
  };

  useEffect(() => {
    void load();
    void loadSshTargets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const register = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post('/servers', {
        name: form.name,
        location: form.location,
        addressRange: form.addressRange,
        listenEndpoint: form.listenEndpoint,
        sshTargetId: form.location === 'remote' ? form.sshTargetId || null : null,
      });
      setForm({ ...form, name: '', listenEndpoint: '' });
      setShowRegister(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to register server.');
    } finally {
      setBusy(false);
    }
  };

  const apply = async (id: string) => {
    setError(null);
    try {
      await api.post(`/servers/${id}/apply`);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Apply failed.');
    }
  };

  const remove = async () => {
    if (!pendingDelete) return;
    setBusy(true);
    setError(null);
    try {
      await api.del(`/servers/${pendingDelete.id}`);
      if (active === pendingDelete.id) setActive(null);
      setPendingDelete(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete the server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="kicker">Infrastructure</div>
          <h1 className="h1">Servers</h1>
        </div>
        <button type="button" className="btn" onClick={() => setShowRegister(true)}>
          Register server
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="table-scroll">
        <table className="table table--edge">
          <thead>
            <tr>
              <th>Name</th>
              <th>Location</th>
              <th>Range</th>
              <th>Endpoint</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {servers.map((s) => (
              <tr key={s.id}>
                <td>
                  <span className="device-name">{s.name}</span>
                  {active === s.id && (
                    <Tag state="connected" className="tag-inline">
                      active
                    </Tag>
                  )}
                </td>
                <td className="muted">{s.location}</td>
                <td className="cell-mono">{s.addressRange}</td>
                <td className="cell-mono">{s.listenEndpoint}</td>
                <td>
                  <Tag state={SERVER_STATE[s.status]}>{s.status}</Tag>
                </td>
                <td>
                  <div className="inline-form" style={{ justifyContent: 'flex-end' }}>
                    {active !== s.id && (
                      <button
                        type="button"
                        className="btn-outline btn-outline--sm"
                        onClick={() => setActive(s.id)}
                      >
                        Make active
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-outline btn-outline--sm"
                      onClick={() => void apply(s.id)}
                    >
                      Apply
                    </button>
                    <button
                      type="button"
                      className="btn-outline btn-outline--danger btn-outline--sm"
                      onClick={() => setPendingDelete(s)}
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {servers.length === 0 && (
              <tr>
                <td colSpan={6} className="empty">
                  No servers yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showRegister && (
        <Dialog title="Register a server" onClose={() => setShowRegister(false)} wide>
          <form onSubmit={register}>
            <div className="field">
              <label className="field__label" htmlFor="srv-name">
                Name
              </label>
              <input
                id="srv-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="srv-location">
                Location
              </label>
              <select
                id="srv-location"
                value={form.location}
                onChange={(e) =>
                  setForm({ ...form, location: e.target.value as 'local' | 'remote' })
                }
              >
                <option value="local">local</option>
                <option value="remote">remote</option>
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="srv-range">
                Address range (CIDR)
              </label>
              <input
                id="srv-range"
                value={form.addressRange}
                onChange={(e) => setForm({ ...form, addressRange: e.target.value })}
                required
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="srv-endpoint">
                Listen endpoint (host:port)
              </label>
              <input
                id="srv-endpoint"
                value={form.listenEndpoint}
                onChange={(e) => setForm({ ...form, listenEndpoint: e.target.value })}
                placeholder="vpn.example.com:51820"
                required
              />
            </div>
            {form.location === 'remote' && (
              <div className="field">
                <label className="field__label" htmlFor="srv-ssh">
                  SSH target
                </label>
                {sshTargets.length > 0 ? (
                  <select
                    id="srv-ssh"
                    value={form.sshTargetId}
                    onChange={(e) => setForm({ ...form, sshTargetId: e.target.value })}
                    required
                  >
                    <option value="">— select an SSH target —</option>
                    {sshTargets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.username}@{t.host}:{t.port}
                        {t.knownHostKey ? '' : ' (untrusted)'}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="field__hint">
                    No SSH targets yet — create one on the{' '}
                    <Link to="/ssh-targets">SSH Targets</Link> page first.
                  </span>
                )}
              </div>
            )}
            <div className="dialog__actions">
              <button
                type="button"
                className="btn-outline"
                onClick={() => setShowRegister(false)}
                disabled={busy}
              >
                Cancel
              </button>
              <button type="submit" className="btn btn--compact" disabled={busy}>
                {busy ? 'Registering…' : 'Register'}
              </button>
            </div>
          </form>
        </Dialog>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title="Delete server"
          message={`Delete ${pendingDelete.name} and every device recorded against it. This cannot be undone.`}
          confirmLabel="Delete server"
          danger
          busy={busy}
          onConfirm={() => void remove()}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}
