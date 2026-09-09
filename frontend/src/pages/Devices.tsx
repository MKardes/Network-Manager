import { useCallback, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, type WakeResult } from '../api/client';
import { useActiveServer } from '../app/activeServer';
import { usePrefs } from '../app/prefs';
import { useShellData } from '../app/shellContext';
import { AddDeviceDialog } from '../components/AddDeviceDialog';
import { DeviceDrawer } from '../components/DeviceDrawer';
import { SegmentsDialog } from '../components/SegmentsDialog';
import { Segmented } from '../components/ui/Segmented';
import { Tag, deviceState } from '../components/ui/Tag';
import { accessSummary, relativeTime } from '../lib/format';
import { FILTERS, visible, type Filter } from '../lib/deviceFilter';
import { useServerData, type DeviceRow, type SegmentSummary } from '../lib/useServerData';

/**
 * Devices — a filterable list of everything on the active server. Per-row
 * actions live in the detail surface (drawer in the rail layout, page in the
 * bar layout); the row itself is the only control here.
 */
export function Devices() {
  const nav = useNavigate();
  const { effectiveLayout } = usePrefs();
  const { servers } = useShellData();
  const [activeId, setActive] = useActiveServer();
  const dropServer = useCallback(() => setActive(null), [setActive]);
  const { groups, devices, segments, sshTargets, peers, loading, error, reload } = useServerData(
    activeId,
    dropServer,
  );

  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [showSegments, setShowSegments] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const server = servers.find((s) => s.id === activeId) ?? null;
  const showAdd = params.get('add') === '1';
  const selectedId = params.get('device');

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value === null) next.delete(key);
    else next.set(key, value);
    setParams(next, { replace: true });
  };

  const needle = query.trim().toLowerCase();
  const shown = useMemo(
    () => devices.filter((d) => visible(d, filter, needle)),
    [devices, filter, needle],
  );

  const boards = useMemo<SegmentSummary[]>(
    () =>
      groups
        .map((g) => ({
          ...g,
          devices: g.devices.filter((d) => visible(d, filter, needle)),
        }))
        .filter((g) => g.devices.length > 0),
    [groups, filter, needle],
  );

  /** Row click opens the detail: the drawer in the rail, a page in the bar. */
  const open = (id: string) => {
    if (effectiveLayout === 'rail') setParam('device', id);
    else nav(`/devices/${id}`);
  };

  const wakeAll = async (group: SegmentSummary) => {
    setNotice(null);
    setActionError(null);
    const targets = group.devices.filter((d) => d.macAddress);
    if (targets.length === 0) {
      setActionError(`No device in ${group.name} has a MAC address on record.`);
      return;
    }
    let woken = 0;
    for (const d of targets) {
      try {
        await api.post<WakeResult>(`/devices/${d.id}/wake`);
        woken += 1;
      } catch {
        /* per-device preconditions are reported in the summary below */
      }
    }
    setNotice(`Sent wake packets to ${woken} of ${targets.length} devices in ${group.name}.`);
    await reload();
  };

  if (!activeId) {
    return (
      <p className="empty">{error ?? 'Register a server on the Servers page to get started.'}</p>
    );
  }

  const rowProps = (d: DeviceRow) => ({
    'data-clickable': true,
    tabIndex: 0,
    role: 'button' as const,
    'aria-label': `Open ${d.name}`,
    onClick: () => open(d.id),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        open(d.id);
      }
    },
  });

  const nameCell = (d: DeviceRow) => (
    <>
      <span className="device-name">{d.name}</span>
      <span className="device-kind">{d.kind}</span>
      {d.isController && (
        <Tag state="review" className="tag-inline">
          wake ctrl
        </Tag>
      )}
    </>
  );

  const messages = (
    <>
      {error && <div className="error">{error}</div>}
      {actionError && <div className="error">{actionError}</div>}
      {notice && <div className="notice">{notice}</div>}
      {loading && <div className="loading">Loading…</div>}
    </>
  );

  // The drawer is layout A's detail surface; layout B navigates to a page.
  const selected = effectiveLayout === 'rail' ? devices.find((d) => d.id === selectedId) : undefined;

  const dialogs = (
    <>
      {selected && (
        <DeviceDrawer
          device={selected}
          peer={peers?.peers.find((p) => p.deviceId === selected.id)}
          sshTargets={sshTargets}
          onChanged={reload}
          onRevoked={() => setParam('device', null)}
          onClose={() => setParam('device', null)}
        />
      )}
      {showAdd && activeId && (
        <AddDeviceDialog
          serverId={activeId}
          segments={segments}
          onClose={() => setParam('add', null)}
          onCreated={async () => {
            setParam('add', null);
            await reload();
          }}
        />
      )}
      {showSegments && activeId && (
        <SegmentsDialog
          serverId={activeId}
          segments={segments}
          devices={devices}
          onClose={() => setShowSegments(false)}
          onChange={reload}
        />
      )}
    </>
  );

  if (effectiveLayout === 'bar') {
    return (
      <div className="page">
        <div className="page-head">
          <h1 className="h1" style={{ fontSize: 32, margin: 0 }}>
            Devices
          </h1>
          <div className="toolbar">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter devices"
              aria-label="Filter devices"
              style={{ minWidth: 200 }}
            />
            <Segmented
              options={FILTERS}
              value={filter}
              onChange={setFilter}
              label="Device state filter"
            />
            <button type="button" className="btn-outline" onClick={() => setShowSegments(true)}>
              Segments
            </button>
            <button
              type="button"
              className="btn btn--compact"
              onClick={() => setParam('add', '1')}
            >
              Add device
            </button>
          </div>
        </div>

        {messages}

        {boards.map((g) => (
          <section className="board-panel" key={g.id ?? 'ungrouped'}>
            <div className="board-panel__head">
              <h2>{g.name}</h2>
              <span className="panel__meta">
                {g.up}/{g.devices.length} up
              </span>
              <span className="muted" style={{ fontSize: 12 }}>
                {g.controllerName ? `wake controller: ${g.controllerName}` : 'no wake controller'}
              </span>
              <div className="spacer" />
              <button type="button" className="btn-link" onClick={() => void wakeAll(g)}>
                Wake all
              </button>
            </div>
            <table className="table">
              <tbody>
                {g.devices.map((d) => (
                  <tr key={d.id} {...rowProps(d)}>
                    <td>{nameCell(d)}</td>
                    <td className="cell-mono">{d.tunnelAddress ?? d.macAddress ?? '—'}</td>
                    <td>
                      <Tag state={deviceState(d)} />
                    </td>
                    <td className="cell-access">{accessSummary(d)}</td>
                    <td className="table__chevron">›</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
        {boards.length === 0 && !loading && (
          <p className="empty">No devices match this filter.</p>
        )}

        {dialogs}
      </div>
    );
  }

  return (
    <div className="page" style={{ gap: 14 }}>
      <div className="page-head">
        <div>
          <div className="kicker">{server?.name ?? 'Server'}</div>
          <h1 className="h1">Devices</h1>
        </div>
        <button type="button" className="btn" onClick={() => setParam('add', '1')}>
          Add device
        </button>
      </div>

      <div className="toolbar">
        <input
          className="toolbar__search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter by name, address or MAC"
          aria-label="Filter by name, address or MAC"
        />
        <Segmented
          options={FILTERS}
          value={filter}
          onChange={setFilter}
          label="Device state filter"
        />
        <button type="button" className="btn-outline" onClick={() => setShowSegments(true)}>
          Segments
        </button>
      </div>

      {messages}

      <div className="table-scroll">
        <table className="table table--edge">
          <thead>
            <tr>
              <th>Device</th>
              <th>Segment</th>
              <th>Address</th>
              <th>State</th>
              <th>Access</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((d) => (
              <tr key={d.id} {...rowProps(d)}>
                <td>{nameCell(d)}</td>
                <td className="muted">{d.segmentName}</td>
                <td className="cell-mono">{d.tunnelAddress ?? d.macAddress ?? '—'}</td>
                <td>
                  <Tag state={deviceState(d)} />
                  {d.reachability !== 'connected' && (
                    <span className="cell-seen">{relativeTime(d.lastSeenAt)}</span>
                  )}
                </td>
                <td className="cell-access">{accessSummary(d)}</td>
                <td className="table__chevron">›</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {shown.length === 0 && !loading && <p className="empty">No devices match this filter.</p>}
      <div className="muted" style={{ fontSize: 12 }}>
        {shown.length} of {devices.length} devices
      </div>

      {dialogs}
    </div>
  );
}
