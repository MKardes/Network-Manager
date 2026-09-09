import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useDrawerSlot } from '../app/drawerSlot';
import {
  ActionBar,
  DeviceStatus,
  ProfileRow,
  SpecTable,
  SshTargetField,
  useDeviceTest,
  type DetailProps,
} from './DeviceDetail';

/**
 * Layout A's detail surface: a sticky panel beside the device list, portalled
 * into the slot the rail shell reserves so it sits outside the main column's
 * padding. Escape closes it.
 */
export function DeviceDrawer({
  device,
  peer,
  sshTargets,
  onChanged,
  onRevoked,
  onClose,
}: Omit<DetailProps, 'onOpenTool'> & { onClose: () => void }) {
  const slot = useDrawerSlot();
  const nav = useNavigate();
  const { tested, busy, error, test } = useDeviceTest(device.id, onChanged);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!slot) return null;

  return createPortal(
    <aside className="drawer" aria-label={`${device.name} detail`}>
      <div className="detail__head">
        <div style={{ minWidth: 0 }}>
          <div className="kicker">
            {device.kind} · {device.segmentName}
          </div>
          <h2 className="detail__title">{device.name}</h2>
        </div>
        <button type="button" className="drawer__close" onClick={onClose} aria-label="Close detail">
          ×
        </button>
      </div>

      <DeviceStatus device={device} peer={peer} tested={tested} busy={busy} onTest={() => void test()} />
      {error && <div className="error">{error}</div>}

      <SpecTable device={device} peer={peer} />
      <ProfileRow device={device} />
      <SshTargetField device={device} sshTargets={sshTargets} onChanged={onChanged} />

      <div style={{ marginTop: 'auto' }}>
        <ActionBar
          device={device}
          onChanged={onChanged}
          onRevoked={onRevoked}
          onOpenTool={(tool) => nav(`/devices/${device.id}/${tool}`)}
          className="action-bar--footer"
        />
      </div>
    </aside>,
    slot,
  );
}
