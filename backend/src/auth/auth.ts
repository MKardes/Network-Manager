import argon2 from 'argon2';
import type { DB } from '../store/db.js';
import { encryptField, decryptField, encryptJson, decryptJson } from '../store/encrypted.js';
import type { RecoveryCode } from './recovery-codes.js';

/**
 * Operator (single-admin) account management and password verification (FR-017,
 * FR-019). Passwords are Argon2id-hashed (not reversible). The TOTP secret and
 * recovery codes are secret-bearing and stored encrypted via the vault helper.
 */

export interface OperatorRow {
  id: number;
  username: string;
  password_hash: string;
  totp_enabled: number;
  totp_secret: string | null;
  recovery_codes: string | null;
  failed_attempts: number;
  locked_until: string | null;
}

const ARGON_OPTS = {
  type: argon2.argon2id,
  timeCost: 3,
  memoryCost: 1 << 16,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, ARGON_OPTS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

export class OperatorRepo {
  constructor(private readonly db: DB) {}

  exists(): boolean {
    return !!this.db.prepare('SELECT 1 FROM operator WHERE id = 1').get();
  }

  get(): OperatorRow | undefined {
    return this.db.prepare('SELECT * FROM operator WHERE id = 1').get() as OperatorRow | undefined;
  }

  async create(username: string, password: string): Promise<void> {
    if (this.exists()) throw new Error('Operator already exists');
    const hash = await hashPassword(password);
    this.db
      .prepare(`INSERT INTO operator (id, username, password_hash) VALUES (1, ?, ?)`)
      .run(username, hash);
  }

  async setPassword(password: string): Promise<void> {
    const hash = await hashPassword(password);
    this.db
      .prepare(`UPDATE operator SET password_hash = ?, updated_at = datetime('now') WHERE id = 1`)
      .run(hash);
  }

  // --- TOTP (secret stored encrypted) ---

  isTotpEnabled(): boolean {
    return this.get()?.totp_enabled === 1;
  }

  /** Read the decrypted TOTP secret (requires unlocked vault). */
  getTotpSecret(): string | null {
    const row = this.get();
    return decryptField(row?.totp_secret ?? null);
  }

  enableTotp(secret: string, recoveryCodes: RecoveryCode[]): void {
    this.db
      .prepare(
        `UPDATE operator SET totp_enabled = 1, totp_secret = ?, recovery_codes = ?, updated_at = datetime('now') WHERE id = 1`,
      )
      .run(encryptField(secret), encryptJson(recoveryCodes));
  }

  disableTotp(): void {
    this.db
      .prepare(
        `UPDATE operator SET totp_enabled = 0, totp_secret = NULL, recovery_codes = NULL, updated_at = datetime('now') WHERE id = 1`,
      )
      .run();
  }

  getRecoveryCodes(): RecoveryCode[] | null {
    const row = this.get();
    return decryptJson<RecoveryCode[]>(row?.recovery_codes ?? null);
  }

  setRecoveryCodes(codes: RecoveryCode[]): void {
    this.db
      .prepare(`UPDATE operator SET recovery_codes = ?, updated_at = datetime('now') WHERE id = 1`)
      .run(encryptJson(codes));
  }
}
