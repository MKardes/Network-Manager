import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, ApiError, type AuditEvent } from '../api/client';
import { useActiveServer } from '../app/activeServer';
import {
  ActionBar,
  DeviceStatus,
  ProfileRow,
  SpecTable,
  SshTargetField,
  useDeviceTest,
} from '../components/DeviceDetail';
import { FileBrowser } from '../components/FileBrowser';
import { TerminalView } from '../components/Terminal';
import { Panel } from '../components/ui/Panel';
import { shortTime } from '../lib/format';
import { useServerData } from '../lib/useServerData';

type Tab = 'overview' | 'terminal' | 'files' | 'keys';

const TABS: { value: Tab; label: string }[] = [
  { value: 'overview', label: 'Overview' },
  { value: 'terminal', label: 'Terminal' },
  { value: 'files', label: 'Files' },
  { value: 'keys', label: 'Keys' },
];

/**
 * Layout B's detail surface: a full page at /devices/:deviceId whose tabs host
 * the same content the rail shows in its drawer, plus the existing terminal and
 * file-browser components.
 */
export function DeviceDetailPage() {
  const nav = useNavigate();
  const { deviceId } = useParams<{ deviceId: string }>();
  const [activeId, setActive] = useActiveServer();
  const dropServer = useCallback(() => setActive(null), [setActive]);
  const { devices, sshTargets, peers, loading, error, reload } = useServerData(
    activeId,
    dropServer,
  );

  const [params, setParams] = useSearchParams();
  const tabParam = params.get('tab') as Tab | null;
  const tab: Tab = TABS.some((t) => t.value === tabParam) ? (tabParam as Tab) : 'overview';
  const setTab = (t: Tab) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true });

  const [history, setHistory] = useState<AuditEvent[]>([]);
  const device = devices.find((d) => d.id === deviceId) ?? null;
  const peer = peers?.peers.find((p) => p.deviceId === deviceId);
  const { tested, busy, error: testError, test } = useDeviceTest(deviceId ?? '', reload);

  useEffect(() => {
    if (!deviceId) return;
    void (async () => {
      try {
        const res = await api.get<{ events: AuditEvent[] }>(
          `/audit?targetId=${encodeURIComponent(deviceId)}&limit=6`,
        );
        setHistory(res.events);
      } catch (err) {
        // History is supporting detail; a failure here must not blank the page.
        if (!(err instanceof ApiError)) throw err;
      }
    })();
  }, [deviceId]);

  const hasSsh = Boolean(device?.sshTargetId);
  const tabs = useMemo(
    () => TABS.filter((t) => (t.value === 'terminal' || t.value === 'files' ? hasSsh : true)),
    [hasSsh],
  );

  if (!deviceId) return <Navigate to="/devices" replace />;
  if (!device) {
    return loading ? (
      <div className="loading">Loading…</div>
    ) : (
      <div className="page">
        {error && <div className="error">{error}</div>}
        <p className="empty">
          This device is no longer on the active server. <Link to="/devices">Back to devices</Link>
        </p>
      </div>
    );
  }

  return (
    <div className="detail">
      <div className="breadcrumb">
        <Link to="/devices">Devices</Link>
        <span>/</span>
        <span>{device.segmentName}</span>
        <span>/</span>
        <span>{device.name}</span>
      </div>

      <div className="page-head">
        <div>
          <h1 className="detail__title detail__title--page" style={{ margin: 0 }}>
            {device.name}
          </h1>
          <DeviceStatus
            device={device}
            peer={peer}
            tested={tested}
            busy={busy}
            onTest={() => void test()}
          />
        </div>
        <ActionBar
          device={device}
          onChanged={reload}
          onRevoked={() => nav('/devices')}
          onOpenTool={(tool) => setTab(tool)}
        />
      </div>

      {(error || testError) && <div className="error">{error ?? testError}</div>}

      <div className="detail-tabs" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            className="tab"
            aria-selected={t.value === tab}
            onClick={() => setTab(t.value)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid-2 grid-2--tight">
          <Panel title="Specification">
            <SpecTable device={device} peer={peer} />
          </Panel>
          <Panel title="Access">
            <div className="stack">
              <ProfileRow device={device} />
              <SshTargetField device={device} sshTargets={sshTargets} onChanged={reload} />
              <table className="rows">
                <tbody>
                  {history.map((e) => (
                    <tr key={e.id}>
                      <td className="rows__time">{shortTime(e.occurred_at)}</td>
                      <td>
                        {e.action}
                        {e.outcome === 'failure' ? ' · failed' : ''}
                      </td>
                    </tr>
                  ))}
                  {history.length === 0 && (
                    <tr>
                      <td className="empty">No recorded activity for this device.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {tab === 'terminal' && hasSsh && <TerminalView deviceId={device.id} />}
      {tab === 'files' && hasSsh && <FileBrowser deviceId={device.id} />}

      {tab === 'keys' && (
        <div className="grid-2 grid-2--tight">
          <Panel title="Keys" meta={device.origin === 'imported' ? 'imported' : 'managed'}>
            <table className="rows">
              <tbody>
                <tr>
                  <td className="rows__key">Public key</td>
                  <td className="rows__value break">
                    {device.peerPublicKey ?? peer?.publicKey ?? '—'}
                  </td>
                </tr>
                <tr>
                  <td className="rows__key">Private key held</td>
                  <td className="rows__value">{peer?.hasPrivateKey ? 'yes — in vault' : 'no'}</td>
                </tr>
                <tr>
                  <td className="rows__key">Allowed IPs</td>
                  <td className="rows__value">{device.allowedIps ?? '—'}</td>
                </tr>
              </tbody>
            </table>
          </Panel>
          <Panel title="Profile" intro="The .conf a peer installs to join the tunnel.">
            <ProfileRow device={device} />
          </Panel>
        </div>
      )}
    </div>
  );
}
