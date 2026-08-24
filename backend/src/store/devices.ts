import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';
import { encryptField, decryptField } from './encrypted.js';

/**
 * Device repository (FR-002/002a). A device is either a WireGuard `peer` (with a
 * tunnel address + keypair) or a non-peer `host`. The peer private key is stored
 * encrypted and never returned in views.
 */

export type DeviceKind = 'peer' | 'host';

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

  usedAddresses(serverId: string): string[] {
    return (
      this.db
        .prepare(
          'SELECT tunnel_address FROM device WHERE server_id = ? AND tunnel_address IS NOT NULL',
        )
        .all(serverId) as { tunnel_address: string }[]
    ).map((r) => r.tunnel_address);
  }

  create(input: CreateDeviceRow): DeviceRow {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO device
           (id, server_id, name, kind, segment_id, mac_address, tunnel_address,
            peer_public_key, peer_private_key, ssh_target_id)
         VALUES (@id, @serverId, @name, @kind, @segmentId, @macAddress, @tunnelAddress,
            @peerPublicKey, @peerPrivateKey, @sshTargetId)`,
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
      });
    return this.get(id)!;
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
