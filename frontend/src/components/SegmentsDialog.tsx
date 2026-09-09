import { useState } from 'react';
import { api, ApiError, type Device, type Segment } from '../api/client';
import { Dialog } from './ui/Dialog';

/**
 * LAN segment management (FR-014a): create segments, pick the wake controller
 * and set the broadcast target Wake-on-LAN packets go to. The device list is
 * grouped by these, so this stays reachable from the Devices toolbar.
 */
export function SegmentsDialog({
  serverId,
  segments,
  devices,
  onClose,
  onChange,
}: {
  serverId: string;
  segments: Segment[];
  devices: Device[];
  onClose: () => void;
  onChange: () => void | Promise<void>;
}) {
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post(`/servers/${serverId}/segments`, { name });
      setName('');
      await onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create segment.');
    }
  };

  const patch = async (
    segmentId: string,
    body: {
      wakeControllerDeviceId?: string | null;
      broadcastAddress?: string | null;
      wolPort?: number | null;
    },
  ) => {
    setError(null);
    try {
      await api.patch(`/segments/${segmentId}`, body);
      await onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update the segment.');
    }
  };

  return (
    <Dialog title="LAN segments" onClose={onClose} wide>
      {error && <div className="error">{error}</div>}

      <ul className="plain stack">
        {segments.map((seg) => (
          <li
            key={seg.id}
            style={{
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-md)',
              padding: '10px 12px',
            }}
          >
            <strong>{seg.name}</strong>
            <div className="field">
              <label className="field__label" htmlFor={`ctrl-${seg.id}`}>
                Wake controller
              </label>
              <select
                id={`ctrl-${seg.id}`}
                value={seg.wakeControllerDeviceId ?? ''}
                onChange={(e) => patch(seg.id, { wakeControllerDeviceId: e.target.value || null })}
              >
                <option value="">— none —</option>
                {devices.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="inline-form">
              <div className="field" style={{ flex: 1, minWidth: 160 }}>
                <label className="field__label" htmlFor={`bcast-${seg.id}`}>
                  Broadcast address
                </label>
                <input
                  id={`bcast-${seg.id}`}
                  defaultValue={seg.broadcastAddress ?? ''}
                  placeholder="192.168.1.255"
                  onBlur={(e) => patch(seg.id, { broadcastAddress: e.target.value.trim() || null })}
                />
              </div>
              <div className="field" style={{ width: 110 }}>
                <label className="field__label" htmlFor={`wol-${seg.id}`}>
                  WoL port
                </label>
                <input
                  id={`wol-${seg.id}`}
                  type="number"
                  min={1}
                  max={65535}
                  defaultValue={seg.wolPort ?? ''}
                  placeholder="9"
                  onBlur={(e) =>
                    patch(seg.id, { wolPort: e.target.value ? Number(e.target.value) : null })
                  }
                />
              </div>
            </div>
          </li>
        ))}
        {segments.length === 0 && <li className="empty">No segments yet.</li>}
      </ul>

      <form className="inline-form" onSubmit={create} style={{ marginTop: 14 }}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="New segment name"
          aria-label="New segment name"
          required
          style={{ flex: 1, minWidth: 180 }}
        />
        <button type="submit" className="btn-outline btn-outline--accent">
          Add segment
        </button>
      </form>
    </Dialog>
  );
}
