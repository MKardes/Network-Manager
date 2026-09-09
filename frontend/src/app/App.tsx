import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
  Outlet,
  useLocation,
  useParams,
} from 'react-router-dom';
import { AuthProvider, useAuth } from './auth';
import { PrefsProvider, usePrefs } from './prefs';
import { RailShell } from './RailShell';
import { BarShell } from './BarShell';
import { useShell } from './useShell';
import { ShellContext } from './shellContext';
import { Setup } from '../pages/Setup';
import { Login } from '../pages/Login';
import { Unlock } from '../pages/Unlock';
import { Servers } from '../pages/Servers';
import { SshTargets } from '../pages/SshTargets';
import { Devices } from '../pages/Devices';
import { Terminal } from '../pages/Terminal';
import { Files } from '../pages/Files';
import { Audit } from '../pages/Audit';
import { Settings } from '../pages/Settings';
import { Overview } from '../pages/Overview';

/**
 * App shell: routing + auth/unlock guards (T024). The guard reads vault status
 * and steers the operator to Setup (uninitialized), Login (not authed), or
 * Unlock (locked) before the authenticated app is reachable.
 */
function Gate() {
  const { status, loading } = useAuth();
  const location = useLocation();
  if (loading) return <div className="center loading">Loading…</div>;
  if (!status) return <div className="center error">Cannot reach the server.</div>;
  if (!status.operatorExists) return <Navigate to="/setup" replace />;
  // We cannot tell "authed" from status alone; the API returns 401/423 and the
  // pages redirect. The vault lock state is authoritative for the unlock gate.
  if (!status.unlocked && location.pathname !== '/unlock') {
    return <Navigate to="/unlock" replace />;
  }
  return <Outlet />;
}

/** Renders whichever shell the layout preference resolves to. */
function Shell() {
  const shell = useShell();
  const { effectiveLayout } = usePrefs();
  const Chrome = effectiveLayout === 'rail' ? RailShell : BarShell;
  return (
    <ShellContext.Provider value={shell}>
      <Chrome shell={shell}>
        <Outlet />
      </Chrome>
    </ShellContext.Provider>
  );
}

/**
 * The device-detail page only exists in the bar layout; the rail shows the same
 * content in its drawer, so a deep link folds into the list's selection.
 */
function DeviceDetailRoute() {
  const { deviceId } = useParams<{ deviceId: string }>();
  const { effectiveLayout } = usePrefs();
  if (effectiveLayout === 'rail') {
    return <Navigate to={`/devices?device=${deviceId ?? ''}`} replace />;
  }
  return <Navigate to="/devices" replace />;
}

export function App() {
  return (
    <AuthProvider>
      <PrefsProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/setup" element={<Setup />} />
            <Route path="/login" element={<Login />} />
            <Route path="/unlock" element={<Unlock />} />
            <Route element={<Gate />}>
              <Route element={<Shell />}>
                <Route path="/" element={<Overview />} />
                <Route path="/devices" element={<Devices />} />
                <Route path="/devices/:deviceId" element={<DeviceDetailRoute />} />
                <Route path="/devices/:deviceId/terminal" element={<Terminal />} />
                <Route path="/devices/:deviceId/files" element={<Files />} />
                <Route path="/servers" element={<Servers />} />
                <Route path="/ssh-targets" element={<SshTargets />} />
                <Route path="/audit" element={<Audit />} />
                <Route path="/settings" element={<Settings />} />
              </Route>
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </BrowserRouter>
      </PrefsProvider>
    </AuthProvider>
  );
}
