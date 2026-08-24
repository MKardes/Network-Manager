import { useState } from 'react';
import { api, ApiError, type Segment, type Device } from '../api/client';

/** Create/manage LAN segments and set the wake controller (FR-014a). */
export function SegmentForm({
  serverId,
  segments,
  devices,
  onChange,
}: {
  serverId: string;
  segments: Segment[];
  devices: Device[];
  onChange: () => void;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post(`/servers/${serverId}/segments`, { name });
      setName('');
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create segment.');
    }
  };

  const setController = async (segmentId: string, deviceId: string) => {
    await api
      .patch(`/segments/${segmentId}`, { wakeControllerDeviceId: deviceId || null })
      .catch((e) => setError(e instanceof ApiError ? e.message : 'Failed to set controller.'));
    onChange();
  };

  return (
    <div className="card">
      <h2>LAN segments</h2>
      {error && <div className="error">{error}</div>}
      <ul className="plain">
        {segments.map((seg) => (
          <li key={seg.id}>
            <strong>{seg.name}</strong>
            <label className="inline">
              controller:
              <select
                value={seg.wakeControllerDeviceId ?? ''}
                onChange={(e) => setController(seg.id, e.target.value)}
              >
                <option value="">— none —</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          </li>
        ))}
        {segments.length === 0 && <li className="muted">No segments yet.</li>}
      </ul>
      <form onSubmit={create} className="inline-form">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="new segment name" required />
        <button type="submit">Add segment</button>
      </form>
    </div>
  );
}
