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
