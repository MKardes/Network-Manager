import { randomUUID } from 'node:crypto';
import type { DB } from './db.js';
import { encryptField, decryptField } from './encrypted.js';

/**
 * WireGuardServer repository (FR-001). The server private key is stored
 * encrypted and never included in views/API responses.
 */

export interface ServerRow {
  id: string;
  name: string;
  location: 'local' | 'remote';
  interface_name: string;
  address_range: string;
  listen_endpoint: string;
  server_private_key: string; // ciphertext
  server_public_key: string;
  ssh_target_id: string | null;
  status: 'up' | 'down' | 'unknown';
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ServerView {
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
  createdAt: string;
  updatedAt: string;
}

export function toServerView(row: ServerRow): ServerView {
  return {
    id: row.id,
    name: row.name,
    location: row.location,
    interfaceName: row.interface_name,
    addressRange: row.address_range,
    listenEndpoint: row.listen_endpoint,
    serverPublicKey: row.server_public_key,
    sshTargetId: row.ssh_target_id,
    status: row.status,
    lastSyncedAt: row.last_synced_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateServerRow {
  name: string;
  location: 'local' | 'remote';
  interfaceName: string;
  addressRange: string;
  listenEndpoint: string;
  serverPrivateKey: string; // plaintext (encrypted here)
  serverPublicKey: string;
  sshTargetId?: string | null;
}

export class ServerRepo {
  constructor(private readonly db: DB) {}

  list(): ServerRow[] {
    return this.db.prepare('SELECT * FROM wireguard_server ORDER BY name').all() as ServerRow[];
  }

  get(id: string): ServerRow | undefined {
    return this.db.prepare('SELECT * FROM wireguard_server WHERE id = ?').get(id) as
      | ServerRow
      | undefined;
  }

  getByName(name: string): ServerRow | undefined {
    return this.db.prepare('SELECT * FROM wireguard_server WHERE name = ?').get(name) as
      | ServerRow
      | undefined;
  }

  create(input: CreateServerRow): ServerRow {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO wireguard_server
           (id, name, location, interface_name, address_range, listen_endpoint,
            server_private_key, server_public_key, ssh_target_id)
         VALUES (@id, @name, @location, @interfaceName, @addressRange, @listenEndpoint,
            @serverPrivateKey, @serverPublicKey, @sshTargetId)`,
      )
      .run({
        id,
        name: input.name,
        location: input.location,
        interfaceName: input.interfaceName,
        addressRange: input.addressRange,
        listenEndpoint: input.listenEndpoint,
        serverPrivateKey: encryptField(input.serverPrivateKey),
        serverPublicKey: input.serverPublicKey,
        sshTargetId: input.sshTargetId ?? null,
      });
    return this.get(id)!;
  }

  update(
    id: string,
    patch: Partial<Pick<ServerRow, 'name' | 'address_range' | 'listen_endpoint' | 'ssh_target_id'>>,
  ): ServerRow | undefined {
    const row = this.get(id);
    if (!row) return undefined;
    this.db
      .prepare(
        `UPDATE wireguard_server
           SET name = @name, address_range = @addressRange, listen_endpoint = @listenEndpoint,
               ssh_target_id = @sshTargetId, updated_at = datetime('now')
         WHERE id = @id`,
      )
      .run({
        id,
        name: patch.name ?? row.name,
        addressRange: patch.address_range ?? row.address_range,
        listenEndpoint: patch.listen_endpoint ?? row.listen_endpoint,
        sshTargetId: patch.ssh_target_id ?? row.ssh_target_id,
      });
    return this.get(id);
  }

  setStatus(id: string, status: ServerRow['status'], synced: boolean): void {
    this.db
      .prepare(
        `UPDATE wireguard_server SET status = ?, last_synced_at = ${synced ? "datetime('now')" : 'last_synced_at'}, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(status, id);
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM wireguard_server WHERE id = ?').run(id).changes > 0;
  }

  /** Decrypt the server private key (requires unlock). */
  privateKey(id: string): string | null {
    const row = this.get(id);
    return decryptField(row?.server_private_key ?? null);
  }
}
