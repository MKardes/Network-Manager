import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';
import { encryptField, decryptField } from './encrypted.js';

/**
 * Device repository (FR-002/002a). A device is either a WireGuard `peer` (with a
 * tunnel address + keypair) or a non-peer `host`. The peer private key is stored
 * encrypted and never returned in views.
 */

export type DeviceKind = 'peer' | 'host';
export type DeviceOrigin = 'created' | 'imported';
export type ManagementState = 'managed' | 'needs_review';

export interface DeviceRow {
  id: string;
  server_id: string;
  name: string;
  kind: DeviceKind;
  segment_id: string | null;
  is_wake_controller: number;
  mac_address: string | null;
  tunnel_address: string | null;
  peer_public_key: string | null;
  peer_private_key: string | null; // ciphertext
  ssh_target_id: string | null;
  reachability: 'connected' | 'offline' | 'unknown';
  last_seen_at: string | null;
  origin: DeviceOrigin;
  management_state: ManagementState;
  allowed_ips: string | null; // imported peers: verbatim AllowedIPs
  created_at: string;
  updated_at: string;
}

export interface DeviceView {
  id: string;
  serverId: string;
  name: string;
  kind: DeviceKind;
  segmentId: string | null;
  isWakeController: boolean;
  macAddress: string | null;
  tunnelAddress: string | null;
  peerPublicKey: string | null;
  sshTargetId: string | null;
  reachability: 'connected' | 'offline' | 'unknown';
  lastSeenAt: string | null;
  origin: DeviceOrigin;
  managementState: ManagementState;
  allowedIps: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toDeviceView(row: DeviceRow): DeviceView {
  return {
    id: row.id,
    serverId: row.server_id,
    name: row.name,
    kind: row.kind,
    segmentId: row.segment_id,
    isWakeController: row.is_wake_controller === 1,
    macAddress: row.mac_address,
    tunnelAddress: row.tunnel_address,
    peerPublicKey: row.peer_public_key,
    sshTargetId: row.ssh_target_id,
    reachability: row.reachability,
    lastSeenAt: row.last_seen_at,
    origin: row.origin,
    managementState: row.management_state,
    allowedIps: row.allowed_ips,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateDeviceRow {
  serverId: string;
  name: string;
  kind: DeviceKind;
  segmentId?: string | null;
  macAddress?: string | null;
  tunnelAddress?: string | null;
  peerPublicKey?: string | null;
  peerPrivateKey?: string | null; // plaintext (encrypted here)
  sshTargetId?: string | null;
  origin?: DeviceOrigin;
  managementState?: ManagementState;
  allowedIps?: string | null;
}

export class DeviceRepo {
  constructor(private readonly db: DB) {}

  listByServer(serverId: string): DeviceRow[] {
    return this.db
      .prepare('SELECT * FROM device WHERE server_id = ? ORDER BY name')
      .all(serverId) as DeviceRow[];
  }

  get(id: string): DeviceRow | undefined {
    return this.db.prepare('SELECT * FROM device WHERE id = ?').get(id) as DeviceRow | undefined;
  }

  /** Find a peer device by its WireGuard public key within a server (reconcile). */
  getByPublicKey(serverId: string, publicKey: string): DeviceRow | undefined {
    return this.db
      .prepare('SELECT * FROM device WHERE server_id = ? AND peer_public_key = ?')
      .get(serverId, publicKey) as DeviceRow | undefined;
  }

  /** First device wired to an SSH target (used to locate its jump host). */
  findBySshTarget(sshTargetId: string): DeviceRow | undefined {
    return this.db
      .prepare('SELECT * FROM device WHERE ssh_target_id = ? ORDER BY created_at LIMIT 1')
      .get(sshTargetId) as DeviceRow | undefined;
  }

  usedAddresses(serverId: string): string[] {
    return (
      this.db
        .prepare(
          'SELECT tunnel_address FROM device WHERE server_id = ? AND tunnel_address IS NOT NULL',
        )
        .all(serverId) as { tunnel_address: string }[]
    ).map((r) => r.tunnel_address);
  }

  /**
   * All CIDR entries considered "in use" on a server: managed/created peers
   * contribute their single host as /32; imported peers contribute either their
   * single tunnel_address/32 or every entry of their verbatim allowed_ips.
   */
  usedCidrs(serverId: string): string[] {
    const rows = this.db
      .prepare(
        `SELECT tunnel_address, allowed_ips FROM device
           WHERE server_id = ? AND kind = 'peer'
             AND (tunnel_address IS NOT NULL OR allowed_ips IS NOT NULL)`,
      )
      .all(serverId) as { tunnel_address: string | null; allowed_ips: string | null }[];
    const out: string[] = [];
    for (const r of rows) {
      if (r.tunnel_address) out.push(`${r.tunnel_address}/32`);
      if (r.allowed_ips) {
        for (const part of r.allowed_ips.split(',')) {
          const trimmed = part.trim();
          if (trimmed) out.push(trimmed);
        }
      }
    }
    return out;
  }

  create(input: CreateDeviceRow): DeviceRow {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO device
           (id, server_id, name, kind, segment_id, mac_address, tunnel_address,
            peer_public_key, peer_private_key, ssh_target_id, origin, management_state, allowed_ips)
         VALUES (@id, @serverId, @name, @kind, @segmentId, @macAddress, @tunnelAddress,
            @peerPublicKey, @peerPrivateKey, @sshTargetId, @origin, @managementState, @allowedIps)`,
      )
      .run({
        id,
        serverId: input.serverId,
        name: input.name,
        kind: input.kind,
        segmentId: input.segmentId ?? null,
        macAddress: input.macAddress ?? null,
        tunnelAddress: input.tunnelAddress ?? null,
        peerPublicKey: input.peerPublicKey ?? null,
        peerPrivateKey: input.peerPrivateKey ? encryptField(input.peerPrivateKey) : null,
        sshTargetId: input.sshTargetId ?? null,
        origin: input.origin ?? 'created',
        managementState: input.managementState ?? 'managed',
        allowedIps: input.allowedIps ?? null,
      });
    return this.get(id)!;
  }

  /**
   * Import a peer discovered on the server as a needs-review device (feature
   * 002). No private key is available for externally-created peers.
   */
  importPeer(input: {
    serverId: string;
    name: string;
    publicKey: string;
    tunnelAddress: string | null;
    allowedIps: string | null;
  }): DeviceRow {
    return this.create({
      serverId: input.serverId,
      name: input.name,
      kind: 'peer',
      tunnelAddress: input.tunnelAddress,
      peerPublicKey: input.publicKey,
      allowedIps: input.allowedIps,
      origin: 'imported',
      managementState: 'needs_review',
    });
  }

  /** Adopt an imported peer: assign a name and mark it managed (feature 002). */
  adopt(id: string, name: string): DeviceRow | undefined {
    this.db
      .prepare(
        `UPDATE device SET name = ?, management_state = 'managed', updated_at = datetime('now')
         WHERE id = ?`,
      )
      .run(name, id);
    return this.get(id);
  }

  update(id: string, patch: Partial<DeviceRow>): DeviceRow | undefined {
    const row = this.get(id);
    if (!row) return undefined;
    const merged = { ...row, ...patch };
    this.db
      .prepare(
        `UPDATE device SET
           name = @name, segment_id = @segment_id, is_wake_controller = @is_wake_controller,
           mac_address = @mac_address, ssh_target_id = @ssh_target_id,
           reachability = @reachability, updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({
        id,
        name: merged.name,
        segment_id: merged.segment_id,
        is_wake_controller: merged.is_wake_controller,
        mac_address: merged.mac_address,
        ssh_target_id: merged.ssh_target_id,
        reachability: merged.reachability,
      });
    return this.get(id);
  }

  /**
   * Update only a device's reachability snapshot from a connectivity test
   * (feature 003). Narrow update — does not disturb the full-row merge in
   * `update`. `lastSeenAt` is the value to persist (pass the new timestamp on a
   * successful probe, or the prior value to preserve it).
   */
  setReachability(
    id: string,
    state: 'connected' | 'offline' | 'unknown',
    lastSeenAt: string | null,
  ): void {
    this.db
      .prepare(
        `UPDATE device SET reachability = ?, last_seen_at = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(state, lastSeenAt, id);
  }

  /** Replace peer keys (key rotation, FR-004). */
  rotateKeys(id: string, publicKey: string, privateKeyPlain: string): void {
    this.db
      .prepare(
        `UPDATE device SET peer_public_key = ?, peer_private_key = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(publicKey, encryptField(privateKeyPlain), id);
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM device WHERE id = ?').run(id).changes > 0;
  }

  /** Decrypt the peer private key (requires unlock). */
  peerPrivateKey(id: string): string | null {
    const row = this.get(id);
    return decryptField(row?.peer_private_key ?? null);
  }
}
