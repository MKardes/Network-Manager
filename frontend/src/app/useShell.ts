import { useCallback, useEffect, useState } from 'react';
import { api, type DeviceGroups, type Server } from '../api/client';
import { useActiveServer, reconcileActiveServer } from './activeServer';
import { currentUser, forgetUser } from './session';

export interface ShellData {
  servers: Server[];
  active: Server | null;
  activeId: string | null;
  setActive: (id: string | null) => void;
  /** Device count for the nav badge; null until the first load resolves. */
  deviceCount: number | null;
  username: string;
  logout: () => Promise<void>;
}

/**
 * Chrome-level data both shells need: the server list that feeds the switcher,
 * the device count next to the Devices nav item, and the operator identity.
 */
export function useShell(): ShellData {
  const [activeId, setActive] = useActiveServer();
  const [servers, setServers] = useState<Server[]>([]);
  const [deviceCount, setDeviceCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { servers } = await api.get<{ servers: Server[] }>('/servers');
        if (cancelled) return;
        setServers(servers);
        // Drop a selection pointing at a server that no longer exists, which
        // would otherwise 404 every page that reads the active server.
        setActive(reconcileActiveServer(activeId, servers));
      } catch {
        /* the pages surface their own load errors; the chrome stays quiet */
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs once: the server list is stable for the life of the shell, and
    // re-running on activeId would re-fetch on every switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeId) {
      setDeviceCount(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const groups = await api.get<DeviceGroups>(`/servers/${activeId}/devices`);
        if (cancelled) return;
        setDeviceCount(groups.groups.flatMap((g) => g.devices).length + groups.ungrouped.length);
      } catch {
        if (!cancelled) setDeviceCount(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  const logout = useCallback(async () => {
    await api.post('/auth/logout').catch(() => undefined);
    forgetUser();
    window.location.href = '/login';
  }, []);

  return {
    servers,
    active: servers.find((s) => s.id === activeId) ?? null,
    activeId,
    setActive,
    deviceCount,
    username: currentUser() ?? 'operator',
    logout,
  };
}
