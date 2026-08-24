import { useState } from 'react';
import { api, ApiError, type Device } from '../api/client';

/** Wake a device via its segment controller, surfacing precondition errors (FR-016). */
export function WakeControls({ device }: { device: Device }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const wake = async () => {
    setMsg(null);
    setBusy(true);
    try {
      const res = await api.post<{ dispatched: boolean; controller: string }>(
        `/devices/${device.id}/wake`,
      );
      setMsg(`Wake dispatched via ${res.controller}.`);
    } catch (err) {
      // 422 preconditions carry a human-readable explanation.
      setMsg(err instanceof ApiError ? err.message : 'Wake failed.');
    } finally {
      setBusy(false);
    }
  };

  if (device.kind !== 'host' && !device.macAddress) return null;
  return (
    <span className="wake">
      <button disabled={busy} onClick={wake} title="Wake-on-LAN via segment controller">
        {busy ? 'Waking…' : 'Wake'}
      </button>
      {msg && <span className="wake-msg">{msg}</span>}
    </span>
  );
}
