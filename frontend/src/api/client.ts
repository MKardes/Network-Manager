/**
 * Typed REST/WS client. All calls go to the same origin (nginx proxies /api and
 * /ws to the backend), carry the HttpOnly session cookie automatically, and
 * surface the backend's { error: { code, message } } shape as ApiError.
 */

const BASE = '/api/v1';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) {
    const err = (data as { error?: { code: string; message: string } })?.error;
    throw new ApiError(res.status, err?.code ?? 'error', err?.message ?? res.statusText);
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),

  /** Download a text/binary response as a Blob (profiles, files). */
  async download(path: string): Promise<Blob> {
    const res = await fetch(`${BASE}${path}`, { credentials: 'same-origin' });
    if (!res.ok) throw new ApiError(res.status, 'download_failed', 'Download failed');
    return res.blob();
  },

  /** Open a WebSocket to a backend channel (SSH terminal / SFTP). */
  ws(path: string): WebSocket {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    return new WebSocket(`${proto}://${window.location.host}${BASE}${path}`);
  },
};

// ---- Shared response types (mirror the backend views) ----

export interface VaultStatus {
  initialized: boolean;
  unlocked: boolean;
  operatorExists: boolean;
  totpEnabled: boolean;
}

export interface Server {
  id: string;
  name: string;
  location: 'local' | 'remote';
  interfaceName: string;
  addressRange: string;
  listenEndpoint: string;
  serverPublicKey: string;
  sshTargetId: string | null;
  status: 'up' | 'down' | 'unknown';
  lastSyncedAt: string | null;
}

export interface Device {
  id: string;
  serverId: string;
  name: string;
  kind: 'peer' | 'host';
  segmentId: string | null;
  isWakeController: boolean;
  macAddress: string | null;
  tunnelAddress: string | null;
  peerPublicKey: string | null;
  sshTargetId: string | null;
  reachability: 'connected' | 'offline' | 'unknown';
  lastSeenAt: string | null;
}

export interface Segment {
  id: string;
  serverId: string;
  name: string;
  wakeControllerDeviceId: string | null;
}

export interface DeviceGroups {
  groups: { segment: Segment; wakeControllerDeviceId: string | null; devices: Device[] }[];
  ungrouped: Device[];
}

export interface AuditEvent {
  id: string;
  occurred_at: string;
  actor: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  outcome: 'success' | 'failure';
  detail: string | null;
}
