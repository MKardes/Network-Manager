import { useState } from 'react';
import {
  Activity,
  Download,
  Folder,
  Plus,
  Power,
  RotateCw,
  Terminal as TerminalIcon,
  Trash2,
} from 'lucide-react';
import {
  api,
  ApiError,
  type Peer,
  type ReachabilityResult,
  type SshTarget,
} from '../api/client';
import { Tag, deviceState } from './ui/Tag';
import { IconButton } from './ui/IconButton';
import { ConfirmDialog, Dialog } from './ui/Dialog';
import { relativeTime, truncateMiddle } from '../lib/format';
import { useWake } from './WakeControls';
import type { DeviceRow } from '../lib/useServerData';

export interface DetailProps {
  device: DeviceRow;
  /** Live peer view for this device, when the server had one. */
  peer?: Peer;
  sshTargets: SshTarget[];
  /** Refetch the server data after a mutation. */
  onChanged: () => void | Promise<void>;
  /** Called after a successful revoke, so the container can dismiss itself. */
  onRevoked: () => void;
  /** Terminal/Files open a route in the drawer and a tab on the detail page. */
  onOpenTool: (tool: 'terminal' | 'files') => void;
}

/** Tag + the one line of context that goes with it, plus the on-demand probe. */
export function DeviceStatus({
  device,
  peer,
  tested,
  onTest,
  busy,
}: {
  device: DeviceRow;
  peer?: Peer;
  tested: number | null;
  onTest: () => void;
  busy: boolean;
}) {
  const text =
    tested !== null
      ? `probed from server · ${tested} ms`
      : device.reachability === 'connected'
        ? `handshake ${relativeTime(peer?.latestHandshake ?? device.lastSeenAt)}`
        : `last seen ${relativeTime(device.lastSeenAt)}`;

  return (
    <div className="detail__status">
      <Tag state={deviceState(device)} />
      <span className="detail__status-text">{text}</span>
      <IconButton
        icon={Activity}
        label="Test"
        hint="Probe reachability from the server"
        variant="accent"
        disabled={busy}
        onClick={onTest}
      >
        <span>Test</span>
      </IconButton>
    </div>
  );
}

/** The device's immutable-ish facts, key on the left and mono value on the right. */
export function SpecTable({ device, peer }: { device: DeviceRow; peer?: Peer }) {
  const rows: [string, string][] = [
    ['Tunnel address', device.kind === 'peer' ? (device.tunnelAddress ?? '—') : '—'],
    ['MAC address', device.macAddress ?? '—'],
    ['Public key', truncateMiddle(device.peerPublicKey ?? peer?.publicKey ?? null)],
    ['Endpoint', peer?.endpoint ?? '—'],
    ['Latest handshake', peer?.latestHandshake ? relativeTime(peer.latestHandshake) : '—'],
    [
      'Allowed IPs',
      device.allowedIps ?? (device.tunnelAddress ? `${device.tunnelAddress}/32` : '—'),
    ],
    [
      'Origin',
      device.origin === 'imported' ? 'imported · unmanaged' : 'created · managed',
    ],
  ];
  return (
    <table className="rows">
      <tbody>
        {rows.map(([k, v]) => (
          <tr key={k}>
            <td className="rows__key">{k}</td>
            <td className="rows__value">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Peers carry a downloadable WireGuard profile; hosts do not. */
export function ProfileRow({ device }: { device: DeviceRow }) {
  const [error, setError] = useState<string | null>(null);
  if (device.kind !== 'peer') return null;

  const download = async () => {
    setError(null);
    try {
      const blob = await api.download(`/devices/${device.id}/profile`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${device.name}.conf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not download the profile.');
    }
  };

  return (
    <div>
      <div className="profile-row">
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 500 }}>WireGuard profile</div>
          <div className="profile-row__name">
            {device.name}.conf · {device.tunnelAddress ?? '—'}/32
          </div>
        </div>
        <IconButton
          icon={Download}
          label="Download profile"
          hint="Save the .conf for this peer"
          variant="accent"
          onClick={() => void download()}
        />
      </div>
      {error && <div className="error">{error}</div>}
    </div>
  );
}

/** Binding a target is what enables Terminal and Files for the device. */
export function SshTargetField({
  device,
  sshTargets,
  onChanged,
}: {
  device: DeviceRow;
  sshTargets: SshTarget[];
  onChanged: () => void | Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);

  const attach = async (sshTargetId: string | null) => {
    setError(null);
    try {
      await api.patch(`/devices/${device.id}`, { sshTargetId });
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to set the SSH target.');
    }
  };

  return (
    <div className="field" style={{ margin: 0 }}>
      <span className="field__label">SSH target</span>
      <select
        aria-label={`SSH target for ${device.name}`}
        value={device.sshTargetId ?? ''}
        onChange={(e) => void attach(e.target.value || null)}
      >
        <option value="">— none —</option>
        {sshTargets.map((t) => (
          <option key={t.id} value={t.id}>
            {t.username}@{t.host}:{t.port}
          </option>
        ))}
      </select>
      <span className="field__hint">
        {device.sshTargetId
          ? 'Terminal and Files route through the WireGuard server.'
          : 'Bind a target to enable Terminal and Files.'}
      </span>
      {error && <div className="error">{error}</div>}
    </div>
  );
}

/**
 * The device's verbs. Primary (solid) actions open a session or adopt the peer;
 * outline actions are the occasional maintenance ones; revoke sits apart at the
 * far end. Everything destructive goes through a confirm dialog.
 */
export function ActionBar({
  device,
  onChanged,
  onRevoked,
  onOpenTool,
  className = '',
}: {
  device: DeviceRow;
  onChanged: () => void | Promise<void>;
  onRevoked: () => void;
  onOpenTool: (tool: 'terminal' | 'files') => void;
  className?: string;
}) {
  const [confirm, setConfirm] = useState<'rotate' | 'revoke' | null>(null);
  const [adopting, setAdopting] = useState(false);
  const [adoptName, setAdoptName] = useState(device.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const wake = useWake(device);

  const imported = device.managementState === 'needs_review';
  const hasSsh = Boolean(device.sshTargetId);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'The action failed.');
    } finally {
      setBusy(false);
    }
  };

  const adopt = () =>
    run(async () => {
      await api.post(`/devices/${device.id}/adopt`, { name: adoptName });
      setAdopting(false);
      await onChanged();
    });

  const rotate = () =>
    run(async () => {
      await api.post(`/devices/${device.id}/rotate-keys`);
      setConfirm(null);
      await onChanged();
    });

  const revoke = () =>
    run(async () => {
      await api.del(`/devices/${device.id}`);
      setConfirm(null);
      onRevoked();
      await onChanged();
    });

  return (
    <>
      <div className={`action-bar ${className}`.trim()}>
        {imported ? (
          <IconButton
            icon={Plus}
            label="Adopt"
            hint="Move into the vault and manage this peer"
            variant="primary"
            onClick={() => {
              setAdoptName(device.name);
              setAdopting(true);
            }}
          />
        ) : (
          <>
            <IconButton
              icon={TerminalIcon}
              label="Terminal"
              hint={hasSsh ? 'Open SSH terminal via the server' : 'Bind an SSH target first'}
              variant="primary"
              disabled={!hasSsh}
              onClick={() => onOpenTool('terminal')}
            />
            <IconButton
              icon={Folder}
              label="Files"
              hint={hasSsh ? 'Browse files over SFTP' : 'Bind an SSH target first'}
              variant="primary"
              disabled={!hasSsh}
              onClick={() => onOpenTool('files')}
            />
          </>
        )}

        <span className="divider-v" />

        {device.kind === 'peer' && !imported && (
          <IconButton
            icon={RotateCw}
            label="Rotate keys"
            hint="Generate a new keypair; the old profile stops working"
            onClick={() => setConfirm('rotate')}
          />
        )}
        <IconButton
          icon={Power}
          label="Wake"
          hint={device.macAddress ? 'Send a wake-on-LAN packet' : 'No MAC address on record'}
          disabled={!device.macAddress || wake.busy}
          onClick={() => void wake.wake()}
        />

        <IconButton
          icon={Trash2}
          label="Revoke"
          hint="Remove from the server and the vault"
          variant="danger"
          className="action-bar__end"
          onClick={() => setConfirm('revoke')}
        />
      </div>

      {wake.message && <div className="wake-msg">{wake.message}</div>}
      {error && <div className="error">{error}</div>}

      {adopting && (
        <Dialog
          title="Adopt peer"
          onClose={() => setAdopting(false)}
          actions={
            <>
              <button
                type="button"
                className="btn-outline"
                onClick={() => setAdopting(false)}
                disabled={busy}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn--compact"
                onClick={() => void adopt()}
                disabled={busy || !adoptName.trim()}
              >
                {busy ? 'Adopting…' : 'Adopt'}
              </button>
            </>
          }
        >
          <p style={{ marginTop: 0 }}>
            Bring this peer into the vault so the app manages its keys and profile.
          </p>
          <div className="field">
            <label className="field__label" htmlFor="adopt-name">
              Name
            </label>
            <input
              id="adopt-name"
              value={adoptName}
              onChange={(e) => setAdoptName(e.target.value)}
            />
          </div>
        </Dialog>
      )}

      {confirm === 'rotate' && (
        <ConfirmDialog
          title="Rotate keys"
          message={`Generate a new keypair for ${device.name}. Its current profile stops working immediately and must be reinstalled.`}
          confirmLabel="Rotate keys"
          busy={busy}
          onConfirm={() => void rotate()}
          onCancel={() => setConfirm(null)}
        />
      )}

      {confirm === 'revoke' && (
        <ConfirmDialog
          title="Revoke device"
          message={`Remove ${device.name} from the server and delete its record from the vault. This cannot be undone.`}
          confirmLabel="Revoke"
          danger
          busy={busy}
          onConfirm={() => void revoke()}
          onCancel={() => setConfirm(null)}
        />
      )}
    </>
  );
}

/** Shared hook for the on-demand connectivity probe used by both containers. */
export function useDeviceTest(deviceId: string, onChanged: () => void | Promise<void>) {
  const [tested, setTested] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const test = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<ReachabilityResult>(`/devices/${deviceId}/test`);
      setTested(res.latencyMs);
      await onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Connectivity test unavailable.');
    } finally {
      setBusy(false);
    }
  };

  return { tested, busy, error, test };
}
