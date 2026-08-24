import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { api } from '../api/client';
import { Setup } from '../pages/Setup';
import { Login } from '../pages/Login';
import { Unlock } from '../pages/Unlock';
import { Servers } from '../pages/Servers';
import { Devices } from '../pages/Devices';
import { Terminal } from '../pages/Terminal';
import { Files } from '../pages/Files';
import { Audit } from '../pages/Audit';
import { Settings } from '../pages/Settings';

/**
 * App shell: routing + auth/unlock guards (T024). The guard reads vault status
 * and steers the operator to Setup (uninitialized), Login (not authed), or
 * Unlock (locked) before the authenticated app is reachable.
 */
function Gate({ children }: { children: JSX.Element }) {
  const { status, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="center muted">Loading…</div>;
  if (!status) return <div className="center error">Cannot reach the server.</div>;
  if (!status.operatorExists) return <Navigate to="/setup" replace />;
  // We cannot tell "authed" from status alone; the API returns 401/423 and the
  // pages redirect. The vault lock state is authoritative for the unlock gate.
  if (!status.unlocked && location.pathname !== '/unlock') {
    return <Navigate to="/unlock" replace />;
  }
  return children;
}

function Shell({ children }: { children: JSX.Element }) {
  const doLogout = async () => {
    await api.post('/auth/logout').catch(() => undefined);
    window.location.href = '/login';
  };
  return (
    <div className="app">
      <nav className="sidebar">
        <div className="brand">WG Manager</div>
        <Link to="/servers">Servers</Link>
        <Link to="/devices">Devices</Link>
        <Link to="/audit">Audit</Link>
        <Link to="/settings">Settings</Link>
        <button className="linklike" onClick={doLogout}>
          Log out
        </button>
      </nav>
      <main className="content">{children}</main>
    </div>
  );
}

export function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/setup" element={<Setup />} />
          <Route path="/login" element={<Login />} />
          <Route path="/unlock" element={<Unlock />} />
          <Route
            path="/servers"
            element={
              <Gate>
                <Shell>
                  <Servers />
                </Shell>
              </Gate>
            }
          />
          <Route
            path="/devices"
            element={
              <Gate>
                <Shell>
                  <Devices />
                </Shell>
              </Gate>
            }
          />
          <Route
            path="/devices/:deviceId/terminal"
            element={
              <Gate>
                <Shell>
                  <Terminal />
                </Shell>
              </Gate>
            }
          />
          <Route
            path="/devices/:deviceId/files"
            element={
              <Gate>
                <Shell>
                  <Files />
                </Shell>
              </Gate>
            }
          />
          <Route
            path="/audit"
            element={
              <Gate>
                <Shell>
                  <Audit />
                </Shell>
              </Gate>
            }
          />
          <Route
            path="/settings"
            element={
              <Gate>
                <Shell>
                  <Settings />
                </Shell>
              </Gate>
            }
          />
          <Route path="*" element={<Navigate to="/servers" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
