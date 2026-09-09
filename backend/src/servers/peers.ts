import type { DeviceRepo, ManagementState, DeviceOrigin } from '../store/devices.js';
import type { ServerRepo } from '../store/servers.js';
import type { ServerService } from './service.js';
import type { PeerStatus } from './status.js';
import { addressOutOfRange } from './net.js';
import { errors } from '../http/errors.js';

const IPV4_HOST_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/** First host address referenced by a tunnel_address or an allowed_ips list. */
function firstHost(tunnelAddress: string | null, allowedIps: string | null): string | null {
  if (tunnelAddress) return tunnelAddress;
  if (!allowedIps) return null;
  const first = allowedIps.split(',')[0]?.trim();
  if (!first) return null;
  return first.split('/')[0];
}

/**
 * Decide how to store an imported peer's address (data-model.md): a single free
 * IPv4 /32 goes in tunnel_address (unique index); anything else (subnet, multiple
 * IPs, IPv6, or a colliding host) is kept verbatim in allowed_ips.
 */
export function deriveImportAddress(
  allowedIps: string,
  usedAddresses: string[],
): { tunnelAddress: string | null; allowedIps: string | null } {
  const raw = (allowedIps ?? '').trim();
  if (!raw || raw === '(none)') return { tunnelAddress: null, allowedIps: null };
  const entries = raw.split(',').map((e) => e.trim()).filter(Boolean);
  if (entries.length === 1) {
    const [ip, prefix] = entries[0].split('/');
    if ((prefix === undefined || prefix === '32') && IPV4_HOST_RE.test(ip) && !usedAddresses.includes(ip)) {
      return { tunnelAddress: ip, allowedIps: null };
    }
  }
  return { tunnelAddress: null, allowedIps: raw };
}

/**
 * Import any live peer not already tracked as a needs-review device (FR-002a/017).
 * Idempotent by public key; returns the number imported. Used by both the peers
 * view and non-destructive apply so a sync never drops an external peer.
 */
export function importLivePeers(devices: DeviceRepo, serverId: string, peers: PeerStatus[]): number {
  let imported = 0;
  const used = devices.usedAddresses(serverId);
  for (const p of peers) {
    if (!p.publicKey) continue;
    if (devices.getByPublicKey(serverId, p.publicKey)) continue;
    const { tunnelAddress, allowedIps } = deriveImportAddress(p.allowedIps, used);
    devices.importPeer({
      serverId,
      name: `imported-${p.publicKey.slice(0, 8)}`,
      publicKey: p.publicKey,
      tunnelAddress,
      allowedIps,
    });
    if (tunnelAddress) used.push(tunnelAddress);
    imported += 1;
  }
  return imported;
}

export interface ReconciledPeer {
  deviceId: string;
  name: string;
  managementState: ManagementState;
  origin: DeviceOrigin;
  publicKey: string | null;
  tunnelAddress: string | null;
  allowedIps: string | null;
  presentOnServer: boolean;
  connected: boolean;
  latestHandshake: number | null;
  endpoint: string | null;
  outOfRange: boolean;
  hasPrivateKey: boolean;
}

/**
 * Reconcile tracked peers against the server's live WireGuard peers (US1):
 * import unknown peers, then return the merged view including discrepancies
 * (tracked-but-absent) and out-of-range flags. `live=false` when peer data could
 * not be read — persisted peers are still returned, marked not-live (FR-005).
 */
export class PeerReconcileService {
  constructor(
    private readonly servers: ServerRepo,
    private readonly devices: DeviceRepo,
    private readonly serverService: ServerService,
  ) {}

  async reconcile(serverId: string): Promise<{ live: boolean; peers: ReconciledPeer[] }> {
    const server = this.servers.get(serverId);
    if (!server) throw errors.notFound('Server not found');

    const { status, peers } = await this.serverService.status(serverId);
    const live = status !== 'unknown';
    if (live) importLivePeers(this.devices, serverId, peers);

    const liveByKey = new Map(peers.map((p) => [p.publicKey, p]));
    const rows = this.devices.listByServer(serverId).filter((d) => d.kind === 'peer');

    const view: ReconciledPeer[] = rows.map((d) => {
      const lp = d.peer_public_key ? liveByKey.get(d.peer_public_key) : undefined;
      const addr = firstHost(d.tunnel_address, d.allowed_ips);
      return {
        deviceId: d.id,
        name: d.name,
        managementState: d.management_state,
        origin: d.origin,
        publicKey: d.peer_public_key,
        tunnelAddress: d.tunnel_address,
        allowedIps: d.allowed_ips,
        presentOnServer: live ? Boolean(lp) : false,
        connected: lp?.connected ?? false,
        latestHandshake: lp?.latestHandshake ?? null,
        endpoint: lp?.endpoint ?? null,
        outOfRange: addr ? addressOutOfRange(addr, server.address_range) : false,
        hasPrivateKey: Boolean(d.peer_private_key),
      };
    });

    return { live, peers: view };
  }
}
