import { useState } from 'react';
import { api, ApiError, type Segment } from '../api/client';
import { Dialog } from './ui/Dialog';

/**
 * Create a device. Replaces the always-visible form the old Devices page kept
 * below its tables — the list is now the page, and creation is a deliberate
 * action from the header button.
 */
export function AddDeviceDialog({
  serverId,
  segments,
  onClose,
  onCreated,
}: {
  serverId: string;
  segments: Segment[];
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [form, setForm] = useState({
    name: '',
    kind: 'peer' as 'peer' | 'host',
    tunnelAddress: '',
    macAddress: '',
    segmentId: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post(`/servers/${serverId}/devices`, {
        name: form.name,
        kind: form.kind,
        macAddress: form.macAddress || null,
        segmentId: form.segmentId || null,
        tunnelAddress:
          form.kind === 'peer' && form.tunnelAddress ? form.tunnelAddress : undefined,
      });
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add device.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Add device" onClose={onClose}>
      <form onSubmit={submit}>
        <div className="field">
          <label className="field__label" htmlFor="add-name">
            Name
          </label>
          <input
            id="add-name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
          />
        </div>

        <div className="field">
          <label className="field__label" htmlFor="add-kind">
            Kind
          </label>
          <select
            id="add-kind"
            value={form.kind}
            onChange={(e) => setForm({ ...form, kind: e.target.value as 'peer' | 'host' })}
          >
            <option value="peer">peer (WireGuard)</option>
            <option value="host">host (non-peer)</option>
          </select>
        </div>

        {form.kind === 'peer' && (
          <div className="field">
            <label className="field__label" htmlFor="add-address">
              Tunnel address
            </label>
            <input
              id="add-address"
              value={form.tunnelAddress}
              onChange={(e) => setForm({ ...form, tunnelAddress: e.target.value })}
              placeholder="10.0.0.50"
            />
            <span className="field__hint">Leave blank to auto-assign from the server range.</span>
          </div>
        )}

        <div className="field">
          <label className="field__label" htmlFor="add-mac">
            MAC address
          </label>
          <input
            id="add-mac"
            value={form.macAddress}
            onChange={(e) => setForm({ ...form, macAddress: e.target.value })}
            placeholder="AA:BB:CC:DD:EE:FF"
          />
          <span className="field__hint">Required for Wake-on-LAN.</span>
        </div>

        <div className="field">
          <label className="field__label" htmlFor="add-segment">
            Segment
          </label>
          <select
            id="add-segment"
            value={form.segmentId}
            onChange={(e) => setForm({ ...form, segmentId: e.target.value })}
          >
            <option value="">— none —</option>
            {segments.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="dialog__actions">
          <button type="button" className="btn-outline" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn--compact" disabled={busy}>
            {busy ? 'Adding…' : 'Add device'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
