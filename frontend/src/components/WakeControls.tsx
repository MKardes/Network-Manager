import { useState } from 'react';
import { api, ApiError, type Device, type WakeResult } from '../api/client';

/** The three outcomes a wake attempt can report, in the operator's words. */
export function wakeMessage(res: WakeResult): string {
  switch (res.result) {
    case 'already_reachable':
      return `Already reachable — packet still sent via ${res.controller}.`;
    case 'relayed':
      return `Woken: relayed via ${res.controller}, now reachable.`;
    case 'relayed_still_down':
      return `Packet sent via ${res.controller}, but the machine is not reachable yet.`;
  }
}

/**
 * Wake a device via its segment controller, surfacing precondition errors
 * (FR-016). The detail action bar drives this; the message it returns is shown
 * inline next to the device's status.
 */
export function useWake(device: Pick<Device, 'id'>) {
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const wake = async () => {
    setMessage(null);
    setBusy(true);
    try {
      const res = await api.post<WakeResult>(`/devices/${device.id}/wake`);
      setMessage(wakeMessage(res));
    } catch (err) {
      // 422/409 preconditions carry a human-readable explanation.
      setMessage(err instanceof ApiError ? err.message : 'Wake failed.');
    } finally {
      setBusy(false);
    }
  };

  return { wake, message, busy, clear: () => setMessage(null) };
}
