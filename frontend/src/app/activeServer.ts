import { useState, useEffect, useCallback } from 'react';

const KEY = 'wgnm.activeServer';

/** Remember the operator's selected server across pages (per-browser). */
export function useActiveServer(): [string | null, (id: string | null) => void] {
  const [id, setId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  });

  useEffect(() => {
    try {
      if (id) localStorage.setItem(KEY, id);
      else localStorage.removeItem(KEY);
    } catch {
      /* ignore storage failures */
    }
  }, [id]);

  const select = useCallback((next: string | null) => setId(next), []);
  return [id, select];
}

/**
 * Repair a persisted selection that no longer matches the server list.
 *
 * The active server id lives in localStorage, so it outlives the data it points
 * at: deleting the server in another tab, or pointing the backend at a fresh
 * DATA_DIR, leaves the browser holding an id the API answers with 404
 * "Server not found". Fall back to the first server (or nothing at all).
 */
export function reconcileActiveServer(
  active: string | null,
  servers: { id: string }[],
): string | null {
  if (servers.length === 0) return null;
  if (active && servers.some((s) => s.id === active)) return active;
  return servers[0].id;
}
