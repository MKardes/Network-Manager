import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError, type DeviceGroups, type Device, type Segment } from '../api/client';
import { useActiveServer } from '../app/activeServer';
import { SegmentForm } from '../components/SegmentForm';
import { WakeControls } from '../components/WakeControls';

/** Devices page: list grouped by LAN, add/edit, rotate/revoke, download profile (T043). */
export function Devices() {
  const [active] = useActiveServer();
  const [data, setData] = useState<DeviceGroups | null>(null);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', kind: 'peer' as 'peer' | 'host', macAddress: '', segmentId: '' });

  const load = useCallback(async () => {
    if (!active) return;
    try {
      const [groups, segs] = await Promise.all([
        api.get<DeviceGroups>(`/servers/${active}/devices`),
        api.get<{ segments: Segment[] }>(`/servers/${active}/segments`),
      ]);
      setData(groups);
      setSegments(segs.segments);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load devices.');
    }
  }, [active]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!active) return <p className="muted">Select a server on the Servers page first.</p>;

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
      });
      setForm({ ...form, name: '', macAddress: '' });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add device.');
    }
  };

  const rotate = async (id: string) => {
    await api.post(`/devices/${id}/rotate-keys`).catch(() => undefined);
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
      </td>
      <td className="actions">
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

      {data?.groups.map((g) => (
        <div key={g.segment.id} className="segment-group">
          <h3>
            {g.segment.name}
            {g.wakeControllerDeviceId && <span className="muted"> · has wake controller</span>}
          </h3>
          <table className="grid">
            <tbody>{g.devices.map((d) => renderDevice(d, g.wakeControllerDeviceId))}</tbody>
          </table>
        </div>
      ))}

      <div className="segment-group">
        <h3>Ungrouped</h3>
        <table className="grid">
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
        <label>
          MAC address (for Wake-on-LAN)
          <input
            value={form.macAddress}
            onChange={(e) => setForm({ ...form, macAddress: e.target.value })}
            placeholder="AA:BB:CC:DD:EE:FF"
          />
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
