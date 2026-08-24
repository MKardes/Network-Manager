import { useEffect, useState } from 'react';
import { api, ApiError, type Server } from '../api/client';
import { useActiveServer } from '../app/activeServer';

/** Servers page: list, register/edit, select-active, apply, and status (T042). */
export function Servers() {
  const [servers, setServers] = useState<Server[]>([]);
  const [active, setActive] = useActiveServer();
  const [error, setError] = useState<string | null>(null);
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
      if (!active && servers.length) setActive(servers[0].id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load servers.');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const register = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/servers', {
        name: form.name,
        location: form.location,
        addressRange: form.addressRange,
        listenEndpoint: form.listenEndpoint,
        sshTargetId: form.location === 'remote' ? form.sshTargetId || null : null,
      });
      setForm({ ...form, name: '', listenEndpoint: '' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to register server.');
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

  const remove = async (id: string) => {
    if (!confirm('Delete this server and all its devices?')) return;
    await api.del(`/servers/${id}`).catch(() => undefined);
    if (active === id) setActive(null);
    await load();
  };

  return (
    <div>
      <h1>Servers</h1>
      {error && <div className="error">{error}</div>}

      <table className="grid">
        <thead>
          <tr>
            <th></th>
            <th>Name</th>
            <th>Location</th>
            <th>Range</th>
            <th>Endpoint</th>
            <th>Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {servers.map((s) => (
            <tr key={s.id} className={active === s.id ? 'active-row' : ''}>
              <td>
                <input
                  type="radio"
                  name="active"
                  checked={active === s.id}
                  onChange={() => setActive(s.id)}
                  aria-label={`Select ${s.name}`}
                />
              </td>
              <td>{s.name}</td>
              <td>{s.location}</td>
              <td>{s.addressRange}</td>
              <td>{s.listenEndpoint}</td>
              <td>
                <span className={`badge ${s.status}`}>{s.status}</span>
              </td>
              <td>
                <button onClick={() => apply(s.id)}>Apply</button>
                <button className="danger" onClick={() => remove(s.id)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
          {servers.length === 0 && (
            <tr>
              <td colSpan={7} className="muted">
                No servers yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <form className="card" onSubmit={register}>
        <h2>Register a server</h2>
        <label>
          Name
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </label>
        <label>
          Location
          <select
            value={form.location}
            onChange={(e) => setForm({ ...form, location: e.target.value as 'local' | 'remote' })}
          >
            <option value="local">local</option>
            <option value="remote">remote</option>
          </select>
        </label>
        <label>
          Address range (CIDR)
          <input
            value={form.addressRange}
            onChange={(e) => setForm({ ...form, addressRange: e.target.value })}
            required
          />
        </label>
        <label>
          Listen endpoint (host:port)
          <input
            value={form.listenEndpoint}
            onChange={(e) => setForm({ ...form, listenEndpoint: e.target.value })}
            placeholder="vpn.example.com:51820"
            required
          />
        </label>
        {form.location === 'remote' && (
          <label>
            SSH target ID
            <input
              value={form.sshTargetId}
              onChange={(e) => setForm({ ...form, sshTargetId: e.target.value })}
              placeholder="uuid of an SSH target"
            />
          </label>
        )}
        <button type="submit">Register</button>
      </form>
    </div>
  );
}
