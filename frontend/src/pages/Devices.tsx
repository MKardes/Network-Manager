import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  api,
  ApiError,
  type DeviceGroups,
  type Device,
  type Segment,
  type PeersResponse,
  type ReachabilityResult,
  type SshTarget,
} from '../api/client';
import { useActiveServer } from '../app/activeServer';
import { SegmentForm } from '../components/SegmentForm';
import { WakeControls } from '../components/WakeControls';

/** Devices page: list grouped by LAN, add/edit, rotate/revoke, download profile (T043). */
export function Devices() {
  const [active, setActive] = useActiveServer();
  const [data, setData] = useState<DeviceGroups | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [sshTargets, setSshTargets] = useState<SshTarget[]>([]);
  const [peers, setPeers] = useState<PeersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    kind: 'peer' as 'peer' | 'host',
    macAddress: '',
    segmentId: '',
    tunnelAddress: '',
    sshTargetId: '',
  });

  const load = useCallback(async () => {
    if (!active) return;
    try {
      const [groups, segs, peerView, targets] = await Promise.all([
        api.get<DeviceGroups>(`/servers/${active}/devices`),
        api.get<{ segments: Segment[] }>(`/servers/${active}/segments`),
        api.get<PeersResponse>(`/servers/${active}/peers`),
        api.get<{ sshTargets: SshTarget[] }>('/ssh-targets'),
      ]);
      setData(groups);
      setSegments(segs.segments);
      setPeers(peerView);
      setSshTargets(targets.sshTargets);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        // The remembered server is gone; drop it so the Servers page can pick
        // a live one instead of every call failing with "Server not found".
        setActive(null);
        setError('The selected server no longer exists. Pick a server on the Servers page.');
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Failed to load devices.');
    }
  }, [active, setActive]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!active) return <p className="muted">{error ?? 'Select a server on the Servers page first.'}</p>;

  const allDevices: Device[] = data
    ? [...data.groups.flatMap((g) => g.devices), ...data.ungrouped]
    : [];

  const addDevice = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post(`/servers/${active}/devices`, {
        name: form.name,
        kind: form.kind,
        macAddress: form.macAddress || null,
        segmentId: form.segmentId || null,
        tunnelAddress: form.kind === 'peer' && form.tunnelAddress ? form.tunnelAddress : undefined,
        sshTargetId: form.sshTargetId || null,
      });
      setForm({ ...form, name: '', macAddress: '', tunnelAddress: '' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add device.');
    }
  };

  const adopt = async (deviceId: string, currentName: string) => {
    const name = prompt('Adopt this peer as a managed device. Name:', currentName);
    if (!name) return;
    setError(null);
    try {
      await api.post(`/devices/${deviceId}/adopt`, { name });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to adopt peer.');
    }
  };

  /**
   * Bind an SSH target to a device — the app only offers Terminal/Files once a
   * device has one, and it's what routes the session (via the WireGuard server
   * when the target sits on the tunnel network).
   */
  const attachSsh = async (id: string, sshTargetId: string | null) => {
    setError(null);
    try {
      await api.patch(`/devices/${id}`, { sshTargetId });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to set the SSH target.');
    }
  };

  const rotate = async (id: string) => {
    await api.post(`/devices/${id}/rotate-keys`).catch(() => undefined);
    await load();
  };
  const test = async (id: string) => {
    setError(null);
    try {
      await api.post<ReachabilityResult>(`/devices/${id}/test`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Connectivity test unavailable.');
    }
    await load();
  };
  const revoke = async (id: string) => {
    if (!confirm('Revoke/remove this device?')) return;
    await api.del(`/devices/${id}`).catch(() => undefined);
    await load();
  };
  const downloadProfile = async (d: Device) => {
    const blob = await api.download(`/devices/${d.id}/profile`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${d.name}.conf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const deviceTableHead = (
    <thead>
      <tr>
        <th>Name</th>
        <th>Kind</th>
        <th>Address</th>
        <th>Reachability</th>
        <th>SSH target</th>
        <th></th>
      </tr>
    </thead>
  );

  const renderDevice = (d: Device, controllerId: string | null) => (
    <tr key={d.id}>
      <td>
        {d.name}
        {d.id === controllerId && <span className="badge controller">controller</span>}
      </td>
      <td>{d.kind}</td>
      <td>{d.tunnelAddress ?? d.macAddress ?? '—'}</td>
      <td>
        <span className={`badge ${d.reachability}`}>{d.reachability}</span>
        {d.lastSeenAt && <span className="muted"> · seen {new Date(d.lastSeenAt).toLocaleString()}</span>}
      </td>
      <td>
        {/* Binding a target here is what enables Terminal/Files for the device. */}
        <select
          value={d.sshTargetId ?? ''}
          onChange={(e) => attachSsh(d.id, e.target.value || null)}
          title="SSH target used for Terminal and Files"
          aria-label={`SSH target for ${d.name}`}
        >
          <option value="">— none —</option>
          {sshTargets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.username}@{t.host}
            </option>
          ))}
        </select>
        {sshTargets.length === 0 && (
          <div className="muted">
            <Link to="/ssh-targets">Add an SSH target</Link>
          </div>
        )}
      </td>
      <td className="actions">
        {d.kind === 'peer' && d.tunnelAddress && (
          <button onClick={() => test(d.id)} title="Probe reachability through the server">
            Test
          </button>
        )}
        {d.kind === 'peer' && (
          <>
            <button onClick={() => downloadProfile(d)}>Profile</button>
            <button onClick={() => rotate(d.id)}>Rotate</button>
          </>
        )}
        {d.sshTargetId && (
          <>
            <Link to={`/devices/${d.id}/terminal`}>Terminal</Link>
            <Link to={`/devices/${d.id}/files`}>Files</Link>
          </>
        )}
        <WakeControls device={d} />
        <button className="danger" onClick={() => revoke(d.id)}>
          Revoke
        </button>
      </td>
    </tr>
  );

  return (
    <div>
      <h1>Devices</h1>
      {error && <div className="error">{error}</div>}

      <div className="segment-group">
        <h3>
          Current peers
          {peers && !peers.live && <span className="muted"> · offline snapshot (not live)</span>}
        </h3>
        {peers && peers.peers.length > 0 ? (
          <table className="grid">
            <tbody>
              {peers.peers.map((p) => (
                <tr key={p.deviceId}>
                  <td>{p.name}</td>
                  <td>{p.tunnelAddress ?? p.allowedIps ?? '—'}</td>
                  <td>
                    <span className={`badge ${p.managementState === 'managed' ? 'controller' : 'unknown'}`}>
                      {p.managementState === 'managed' ? 'managed' : 'needs review'}
                    </span>
                    {peers.live && (
                      <span className={`badge ${p.connected ? 'connected' : 'offline'}`}>
                        {p.connected ? 'connected' : 'idle'}
                      </span>
                    )}
                    {peers.live && !p.presentOnServer && <span className="badge offline">not on server</span>}
                    {p.outOfRange && <span className="badge offline">out of range</span>}
                  </td>
                  <td className="actions">
                    {p.managementState === 'needs_review' && (
                      <button onClick={() => adopt(p.deviceId, p.name)}>Adopt</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No peers on this server yet.</p>
        )}
      </div>

      {data?.groups.map((g) => (
        <div key={g.segment.id} className="segment-group">
          <h3>
            {g.segment.name}
            {g.wakeControllerDeviceId && <span className="muted"> · has wake controller</span>}
          </h3>
          <table className="grid">
            {deviceTableHead}
            <tbody>{g.devices.map((d) => renderDevice(d, g.wakeControllerDeviceId))}</tbody>
          </table>
        </div>
      ))}

      <div className="segment-group">
        <h3>Ungrouped</h3>
        <table className="grid">
          {deviceTableHead}
          <tbody>{(data?.ungrouped ?? []).map((d) => renderDevice(d, null))}</tbody>
        </table>
      </div>

      <SegmentForm serverId={active} segments={segments} devices={allDevices} onChange={load} />

      <form className="card" onSubmit={addDevice}>
        <h2>Add device</h2>
        <label>
          Name
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </label>
        <label>
          Kind
          <select
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as 'peer' | 'host' })}
          >
            <option value="peer">peer (WireGuard)</option>
            <option value="host">host (non-peer)</option>
          </select>
        </label>
        {form.kind === 'peer' && (
          <label>
            Tunnel address (optional — blank auto-assigns)
            <input
              value={form.tunnelAddress}
              onChange={(e) => setForm({ ...form, tunnelAddress: e.target.value })}
              placeholder="e.g. 10.0.0.50"
            />
          </label>
        )}
        <label>
          MAC address (for Wake-on-LAN)
          <input
            value={form.macAddress}
            onChange={(e) => setForm({ ...form, macAddress: e.target.value })}
            placeholder="AA:BB:CC:DD:EE:FF"
          />
        </label>
        <label>
          SSH target (for Terminal/Files)
          <select
            value={form.sshTargetId}
            onChange={(e) => setForm({ ...form, sshTargetId: e.target.value })}
          >
            <option value="">— none —</option>
            {sshTargets.map((t) => (
              <option key={t.id} value={t.id}>
                {t.username}@{t.host}
              </option>
            ))}
          </select>
        </label>
        <label>
          Segment
          <select value={form.segmentId} onChange={(e) => setForm({ ...form, segmentId: e.target.value })}>
            <option value="">— none —</option>
            {segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit">Add</button>
      </form>
    </div>
  );
}
