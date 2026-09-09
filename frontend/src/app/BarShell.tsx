import type { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import { Tag } from '../components/ui/Tag';
import { NAV } from './nav';
import { PrefControls } from './PrefControls';
import type { ShellData } from './useShell';

const SERVER_STATE = { up: 'connected', down: 'offline', unknown: 'unknown' } as const;

/**
 * Layout B — top command bar (server tabs + nav) over a full-width content
 * column. Device detail is a page here rather than a drawer.
 */
export function BarShell({ shell, children }: { shell: ShellData; children: ReactNode }) {
  const { servers, activeId, setActive, username, logout } = shell;

  return (
    <div>
      <header className="bar-shell__bar">
        <div className="brand" style={{ padding: 0 }}>
          WG Manager
        </div>

        {servers.length > 0 && (
          <div className="segmented" role="group" aria-label="Active server">
            {servers.map((s) => (
              <button
                key={s.id}
                type="button"
                className="server-tab"
                aria-pressed={s.id === activeId}
                onClick={() => setActive(s.id)}
              >
                <span>{s.name}</span>
                <Tag state={SERVER_STATE[s.status]}>{s.status}</Tag>
              </button>
            ))}
          </div>
        )}

        <div className="spacer" />

        <nav className="bar-shell__tabs" aria-label="Main">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className="tab">
              {n.label}
            </NavLink>
          ))}
        </nav>

        <PrefControls />
        <button type="button" className="btn-link" onClick={() => void logout()}>
          Log out ({username})
        </button>
      </header>

      <main className="bar-shell__main">{children}</main>
    </div>
  );
}
