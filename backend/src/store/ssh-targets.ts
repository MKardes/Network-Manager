import { randomUUID } from 'node:crypto';
import ssh2 from 'ssh2';

const sshUtils = ssh2.utils;
import type { DB } from './db.js';
import { encryptField, decryptField } from './encrypted.js';
import type { SshConnectionInfo } from '../remote/runner.js';

/**
 * SSHTarget repository (FR-010a). The app generates and manages the SSH keypair;
 * the private key is stored encrypted and never returned in API responses. The
 * public key is returned once so the operator can install it on the target.
 */

export interface SshTargetRow {
  id: string;
  host: string;
  port: number;
  username: string;
  private_key: string; // ciphertext
  public_key: string;
  known_host_key: string | null;
  created_at: string;
  updated_at: string;
}

/** Public view (never includes the private key). */
export interface SshTargetView {
  id: string;
  host: string;
  port: number;
  username: string;
  publicKey: string;
  knownHostKey: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toView(row: SshTargetRow): SshTargetView {
  return {
    id: row.id,
    host: row.host,
    port: row.port,
    username: row.username,
    publicKey: row.public_key,
    knownHostKey: row.known_host_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface CreateSshTargetInput {
  host: string;
  port?: number;
  username: string;
}

export class SshTargetRepo {
  constructor(private readonly db: DB) {}

  /** Create a target with a freshly generated ed25519 keypair. */
  create(input: CreateSshTargetInput): SshTargetRow {
    const { private: privateKey, public: publicKey } = sshUtils.generateKeyPairSync('ed25519');
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO ssh_target (id, host, port, username, private_key, public_key)
         VALUES (@id, @host, @port, @username, @privateKey, @publicKey)`,
      )
      .run({
        id,
        host: input.host,
        port: input.port ?? 22,
        username: input.username,
        privateKey: encryptField(privateKey),
        publicKey,
      });
    return this.getRow(id)!;
  }

  list(): SshTargetRow[] {
    return this.db.prepare('SELECT * FROM ssh_target ORDER BY host').all() as SshTargetRow[];
  }

  getRow(id: string): SshTargetRow | undefined {
    return this.db.prepare('SELECT * FROM ssh_target WHERE id = ?').get(id) as SshTargetRow | undefined;
  }

  update(id: string, patch: Partial<CreateSshTargetInput>): SshTargetRow | undefined {
    const row = this.getRow(id);
    if (!row) return undefined;
    this.db
      .prepare(
        `UPDATE ssh_target SET host = @host, port = @port, username = @username, updated_at = datetime('now') WHERE id = @id`,
      )
      .run({
        id,
        host: patch.host ?? row.host,
        port: patch.port ?? row.port,
        username: patch.username ?? row.username,
      });
    return this.getRow(id);
  }

  delete(id: string): boolean {
    return this.db.prepare('DELETE FROM ssh_target WHERE id = ?').run(id).changes > 0;
  }

  /** Record the trusted host-key fingerprint (TOFU confirmation). */
  recordHostKey(id: string, fingerprint: string): void {
    this.db
      .prepare(`UPDATE ssh_target SET known_host_key = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(fingerprint, id);
  }

  /** Build connection info with the decrypted private key (requires unlock). */
  connectionInfo(id: string): SshConnectionInfo | undefined {
    const row = this.getRow(id);
    if (!row) return undefined;
    return {
      host: row.host,
      port: row.port,
      username: row.username,
      privateKey: decryptField(row.private_key)!,
      knownHostKey: row.known_host_key,
    };
  }
}
