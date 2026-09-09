import { useState } from 'react';
import { api, ApiError, type Device, type WakeResult } from '../api/client';

function wakeMessage(res: WakeResult): string {
  switch (res.result) {
    case 'already_reachable':
      return `Already reachable — packet still sent via ${res.controller}.`;
    case 'relayed':
      return `Woken: relayed via ${res.controller}, now reachable.`;
    case 'relayed_still_down':
      return `Packet sent via ${res.controller}, but the machine is not reachable yet.`;
  }
}

/** Wake a device via its segment controller, surfacing precondition errors (FR-016). */
export function WakeControls({ device }: { device: Device }) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const wake = async () => {
    setMsg(null);
    setBusy(true);
    try {
      const res = await api.post<WakeResult>(`/devices/${device.id}/wake`);
      setMsg(wakeMessage(res));
    } catch (err) {
      // 422/409 preconditions carry a human-readable explanation.
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
