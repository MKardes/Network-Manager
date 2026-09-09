import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError, type AuditEvent } from '../api/client';
import { useActiveServer } from '../app/activeServer';
import { usePrefs } from '../app/prefs';
import { useShellData } from '../app/shellContext';
import { Panel } from '../components/ui/Panel';
import { Tag } from '../components/ui/Tag';
import { useServerData } from '../lib/useServerData';
import { shortTime } from '../lib/format';

interface Stat {
  label: string;
  value: string;
  sub: string;
}

/**
 * Overview (route "/") — the landing screen: how much of the server is up, what
 * arrived from the server that nobody has adopted yet, and what changed
 * recently. Both layouts show the same figures; only the composition differs.
 */
export function Overview() {
  const nav = useNavigate();
  const { effectiveLayout } = usePrefs();
  const [activeId, setActive] = useActiveServer();
  const { servers } = useShellData();
  const dropServer = useCallback(() => setActive(null), [setActive]);
  const { groups, devices, peers, loading, error, reload } = useServerData(activeId, dropServer);

  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [auditError, setAuditError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const server = servers.find((s) => s.id === activeId) ?? null;

  useEffect(() => {
    void (async () => {
      try {
        const res = await api.get<{ events: AuditEvent[] }>('/audit?limit=5');
        setEvents(res.events);
      } catch (err) {
        setAuditError(err instanceof ApiError ? err.message : 'Failed to load recent activity.');
      }
    })();
  }, []);

  const review = useMemo(
    () => devices.filter((d) => d.managementState === 'needs_review'),
    [devices],
  );

  const stats = useMemo<Stat[]>(() => {
    const peerDevices = devices.filter((d) => d.kind === 'peer');
    const connected = peers
      ? peers.peers.filter((p) => p.connected).length
      : peerDevices.filter((d) => d.reachability === 'connected').length;
    const hostsOffline = devices.filter(
      (d) => d.kind === 'host' && d.reachability !== 'connected',
    ).length;
    const withController = groups.filter((g) => g.controllerName).length;
    return [
      {
        label: 'Peers connected',
        value: `${connected}/${peerDevices.length}`,
        sub: peers && !peers.live ? 'last known — server unreachable' : 'live from wg show',
      },
      { label: 'Needs review', value: String(review.length), sub: 'imported, unmanaged' },
      { label: 'Hosts offline', value: String(hostsOffline), sub: 'wake-on-lan available' },
      {
        label: 'Segments',
        value: String(groups.length),
        sub: `${withController} with a wake controller`,
      },
    ];
  }, [devices, groups, peers, review.length]);

  /** Opening a device means the drawer in the rail layout and a page in the bar. */
  const openDevice = (id: string) =>
    nav(effectiveLayout === 'rail' ? `/devices?device=${id}` : `/devices/${id}`);

  const addDevice = () => nav('/devices?add=1');

  /** "Sync from server" re-runs peer reconciliation, importing unknown peers. */
  const sync = async () => {
    setSyncing(true);
    await reload();
    setSyncing(false);
  };

  if (!activeId) {
    return (
      <p className="empty">{error ?? 'Register a server on the Servers page to get started.'}</p>
    );
  }

  const statCells = (
    <>
      {stats.map((k) => (
        <div className="stat" key={k.label}>
          <div className="kicker">{k.label}</div>
          <div className="stat__value">{k.value}</div>
          <div className="stat__sub">{k.sub}</div>
        </div>
      ))}
    </>
  );

  const reviewPanel = (
    <Panel
      title="Needs review"
      meta={server ? `imported from ${server.interfaceName}` : undefined}
      intro={
        effectiveLayout === 'rail'
          ? 'Peers found on the server with no record in the vault. Adopt to manage, or revoke from the peer list.'
          : undefined
      }
    >
      <div className="list-rows">
        {review.map((d) => (
          <div className="list-row" key={d.id}>
            <span className="mono ellipsis" style={{ fontSize: 12 }}>
              {d.tunnelAddress ?? d.allowedIps ?? '—'}
            </span>
            <span className="muted ellipsis" style={{ fontSize: 12.5 }}>
              {d.name}
            </span>
            <button
              type="button"
              className="btn-outline btn-outline--accent btn-outline--sm"
              onClick={() => openDevice(d.id)}
            >
              Adopt
            </button>
          </div>
        ))}
        {review.length === 0 && <p className="empty">Every peer on the server is managed.</p>}
      </div>
    </Panel>
  );

  const segmentsPanel = (
    <Panel title="Segments">
      <table className="rows">
        <tbody>
          {groups.map((g) => (
            <tr key={g.id ?? 'ungrouped'}>
              <td style={{ fontWeight: 500 }}>{g.name}</td>
              <td className="rows__time" style={{ padding: '6px 8px' }}>
                {g.up}/{g.devices.length} up
              </td>
              <td className="muted rows__right" style={{ whiteSpace: 'nowrap' }}>
                {g.controllerName ? `wake via ${g.controllerName}` : 'no wake controller'}
              </td>
            </tr>
          ))}
          {groups.length === 0 && (
            <tr>
              <td className="empty">No segments yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </Panel>
  );

  const activityPanel = (
    <Panel title={<Link to="/audit">Recent activity</Link>}>
      {auditError && <div className="error">{auditError}</div>}
      <table className="rows">
        <tbody>
          {events.map((e) => (
            <tr key={e.id}>
              <td className="rows__time">{shortTime(e.occurred_at)}</td>
              <td className="rows__action">{e.action}</td>
              <td>{e.target_type ? `${e.target_type}:${e.target_id?.slice(0, 8)}` : '—'}</td>
              <td className="rows__right">
                <Tag state={e.outcome === 'success' ? 'connected' : 'offline'}>{e.outcome}</Tag>
              </td>
            </tr>
          ))}
          {events.length === 0 && !auditError && (
            <tr>
              <td className="empty">Nothing recorded yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </Panel>
  );

  if (effectiveLayout === 'bar') {
    return (
      <div className="page" style={{ gap: 18 }}>
        {error && <div className="error">{error}</div>}
        <div
          className="stat-strip"
          style={{ borderColor: 'var(--hair)', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))' }}
        >
          <div
            style={{
              gridColumn: '1/-1',
              padding: '14px 16px 10px',
              borderBottom: '1px solid var(--line)',
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-between',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <div>
              <div className="kicker">
                Interface {server?.interfaceName ?? 'wg0'} · {server?.addressRange ?? ''}
              </div>
              <h1 className="h1" style={{ fontSize: 32 }}>
                {server?.name ?? 'Server'}
              </h1>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn-outline" onClick={() => void sync()} disabled={syncing}>
                {syncing ? 'Syncing…' : 'Sync from server'}
              </button>
              <button type="button" className="btn btn--compact" onClick={addDevice}>
                Add device
              </button>
            </div>
          </div>
          {statCells}
        </div>

        {loading && <div className="loading">Loading…</div>}

        <div className="grid-2 grid-2--tight">
          {reviewPanel}
          {activityPanel}
        </div>
      </div>
    );
  }

  return (
    <div className="page" style={{ gap: 20 }}>
      {error && <div className="error">{error}</div>}
      <div className="page-head">
        <div>
          <div className="kicker">Overview</div>
          <h1 className="h1">{server?.name ?? 'Server'}</h1>
        </div>
        <button type="button" className="btn" onClick={addDevice}>
          Add device
        </button>
      </div>

      <div className="stat-strip">{statCells}</div>

      {loading && <div className="loading">Loading…</div>}

      <div className="grid-2">
        {reviewPanel}
        {segmentsPanel}
      </div>

      {activityPanel}
    </div>
  );
}
