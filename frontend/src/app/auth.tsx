import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, type VaultStatus } from '../api/client';

/**
 * Auth/vault state shared across the app. Backed by GET /vault/status, which is
 * safe to call unauthenticated and drives routing between Setup / Login / Unlock
 * and the authenticated app.
 */
interface AuthState {
  status: VaultStatus | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      setStatus(await api.get<VaultStatus>('/vault/status'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return <AuthContext.Provider value={{ status, loading, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
