import { useState, type ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Tag } from '../components/ui/Tag';
import { DrawerSlotContext } from './drawerSlot';
import { NAV } from './nav';
import { PrefControls } from './PrefControls';
import type { ShellData } from './useShell';

const SERVER_STATE = { up: 'connected', down: 'offline', unknown: 'unknown' } as const;

/**
 * Layout A — left rail (server switcher + nav) beside the content column, with
 * the device drawer as a sticky sibling of the main column.
 */
export function RailShell({ shell, children }: { shell: ShellData; children: ReactNode }) {
  const [drawerSlot, setDrawerSlot] = useState<HTMLElement | null>(null);
  const { servers, active, activeId, setActive, deviceCount, username, logout } = shell;

  return (
    <div className="rail-shell">
      <nav className="rail" aria-label="Main">
        <div className="brand">WG Manager</div>

        <div className="rail__block">
          <div className="kicker" style={{ padding: '0 4px' }}>
            Server
          </div>
          <select
            aria-label="Active server"
            value={activeId ?? ''}
            onChange={(e) => setActive(e.target.value || null)}
            style={{ width: '100%' }}
          >
            {servers.length === 0 && <option value="">— no servers —</option>}
            {servers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {active && (
            <div className="rail__server-meta">
              <Tag state={SERVER_STATE[active.status]}>{active.status}</Tag>
              <span className="mono" style={{ fontSize: 11 }}>
                {active.addressRange}
              </span>
            </div>
          )}
        </div>

        <div className="rail__nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="nav-item">
              <span>{n.label}</span>
              {n.count === 'devices' && deviceCount !== null && (
                <span className="nav-item__count">{deviceCount}</span>
              )}
            </NavLink>
          ))}
        </div>

        <div className="rail__spacer" />

        <div className="rail__foot">
          <PrefControls />
          <div className="rail__user">signed in as {username}</div>
          <button
            type="button"
            className="btn-link"
            style={{ textAlign: 'left' }}
            onClick={() => void logout()}
          >
            Log out
          </button>
        </div>
      </nav>

      <div className="rail-shell__content">
        <main className="rail-shell__main">
          <DrawerSlotContext.Provider value={drawerSlot}>{children}</DrawerSlotContext.Provider>
        </main>
        {/* display:contents so the portalled drawer is itself the flex item. */}
        <div ref={setDrawerSlot} style={{ display: 'contents' }} />
      </div>
    </div>
  );
}
