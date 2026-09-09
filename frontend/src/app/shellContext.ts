import { createContext, useContext } from 'react';
import type { ShellData } from './useShell';

/**
 * The shell fetches the server list once and shares it: pages read the active
 * server's name, range and status from here instead of each issuing their own
 * GET /servers.
 */
export const ShellContext = createContext<ShellData | null>(null);

export function useShellData(): ShellData {
  const ctx = useContext(ShellContext);
  if (!ctx) throw new Error('useShellData must be used within the app shell');
  return ctx;
}
