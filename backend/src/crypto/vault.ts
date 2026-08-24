import sodium from 'libsodium-wrappers';
import argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import type { DB } from '../store/db.js';

/**
 * Envelope encryption vault (FR-018 / FR-018a).
 *
 *   passphrase --Argon2id(salt)--> KEK --unwrap--> DEK --XChaCha20-Poly1305--> secret fields
 *
 * Only the wrapped DEK + KDF salt/params are persisted. The passphrase, KEK, and
 * plaintext DEK live in process memory only, held after unlock and zeroized on
 * lock/exit. On restart the vault returns to the locked state.
 */

const KDF_PARAMS = {
  type: argon2.argon2id,
  timeCost: 3,
  memoryCost: 1 << 16, // 64 MiB
  parallelism: 1,
  hashLength: 32, // 256-bit KEK
} as const;

interface StoredKdfParams {
  type: number;
  timeCost: number;
  memoryCost: number;
  parallelism: number;
  hashLength: number;
}

interface VaultRow {
  kdf_salt: Buffer;
  kdf_params: string;
  wrapped_dek: Buffer;
}

// Module-scoped unlock state — process-global as required by FR-018a.
let dek: Buffer | null = null;

async function ready(): Promise<void> {
  await sodium.ready;
}

async function deriveKek(passphrase: string, salt: Buffer, params: StoredKdfParams): Promise<Buffer> {
  const raw = await argon2.hash(passphrase, {
    type: params.type as 0 | 1 | 2,
    timeCost: params.timeCost,
    memoryCost: params.memoryCost,
    parallelism: params.parallelism,
    hashLength: params.hashLength,
    salt,
    raw: true,
  });
  return Buffer.from(raw);
}

function wrap(dekPlain: Buffer, kek: Buffer): Buffer {
  const nonce = randomBytes(sodium.crypto_secretbox_NONCEBYTES);
  const cipher = sodium.crypto_secretbox_easy(dekPlain, nonce, kek);
  return Buffer.concat([nonce, Buffer.from(cipher)]);
}

function unwrap(wrapped: Buffer, kek: Buffer): Buffer | null {
  const nonce = wrapped.subarray(0, sodium.crypto_secretbox_NONCEBYTES);
  const cipher = wrapped.subarray(sodium.crypto_secretbox_NONCEBYTES);
  try {
    const plain = sodium.crypto_secretbox_open_easy(cipher, nonce, kek);
    return Buffer.from(plain);
  } catch {
    return null;
  }
}

export function isInitialized(db: DB): boolean {
  const row = db.prepare('SELECT 1 FROM vault_state WHERE id = 1').get();
  return !!row;
}

export function isUnlocked(): boolean {
  return dek !== null;
}

/** First-run: create the vault with a random DEK wrapped by the passphrase. */
export async function initVault(db: DB, passphrase: string): Promise<void> {
  await ready();
  if (isInitialized(db)) {
    throw new Error('Vault already initialized');
  }
  const salt = randomBytes(16);
  const kek = await deriveKek(passphrase, salt, KDF_PARAMS);
  const dekPlain = randomBytes(32);
  const wrapped = wrap(dekPlain, kek);

  db.prepare(
    `INSERT INTO vault_state (id, kdf_salt, kdf_params, wrapped_dek)
     VALUES (1, ?, ?, ?)`,
  ).run(salt, JSON.stringify(KDF_PARAMS), wrapped);

  kek.fill(0);
  // Leave unlocked immediately after init so setup can proceed.
  dek = dekPlain;
}

/** Unlock the vault by deriving the KEK and unwrapping the DEK. */
export async function unlock(db: DB, passphrase: string): Promise<boolean> {
  await ready();
  const row = db.prepare('SELECT kdf_salt, kdf_params, wrapped_dek FROM vault_state WHERE id = 1').get() as
    | VaultRow
    | undefined;
  if (!row) throw new Error('Vault not initialized');

  const params = JSON.parse(row.kdf_params) as StoredKdfParams;
  const kek = await deriveKek(passphrase, row.kdf_salt, params);
  const dekPlain = unwrap(row.wrapped_dek, kek);
  kek.fill(0);
  if (!dekPlain) return false;
  dek = dekPlain;
  return true;
}

/** Zeroize in-memory key material and lock the vault. */
export function lock(): void {
  if (dek) {
    dek.fill(0);
    dek = null;
  }
}

/** Change the master passphrase: re-wrap the SAME DEK under a new KEK. */
export async function changePassphrase(
  db: DB,
  currentPassphrase: string,
  newPassphrase: string,
): Promise<boolean> {
  await ready();
  const row = db.prepare('SELECT kdf_salt, kdf_params, wrapped_dek FROM vault_state WHERE id = 1').get() as
    | VaultRow
    | undefined;
  if (!row) throw new Error('Vault not initialized');

  const params = JSON.parse(row.kdf_params) as StoredKdfParams;
  const oldKek = await deriveKek(currentPassphrase, row.kdf_salt, params);
  const dekPlain = unwrap(row.wrapped_dek, oldKek);
  oldKek.fill(0);
  if (!dekPlain) return false;

  const newSalt = randomBytes(16);
  const newKek = await deriveKek(newPassphrase, newSalt, KDF_PARAMS);
  const newWrapped = wrap(dekPlain, newKek);
  newKek.fill(0);

  db.prepare(
    `UPDATE vault_state SET kdf_salt = ?, kdf_params = ?, wrapped_dek = ?, updated_at = datetime('now') WHERE id = 1`,
  ).run(newSalt, JSON.stringify(KDF_PARAMS), newWrapped);

  // Refresh the in-memory DEK reference (same key material).
  if (dek) dek.fill(0);
  dek = dekPlain;
  return true;
}

/** Encrypt a UTF-8 secret. Requires an unlocked vault. Returns base64 ciphertext. */
export function encryptSecret(plaintext: string): string {
  if (!dek) throw new VaultLockedError();
  const nonce = randomBytes(sodium.crypto_secretbox_NONCEBYTES);
  const cipher = sodium.crypto_secretbox_easy(sodium.from_string(plaintext), nonce, dek);
  return Buffer.concat([nonce, Buffer.from(cipher)]).toString('base64');
}

/** Decrypt a base64 secret produced by encryptSecret. Requires unlock. */
export function decryptSecret(b64: string): string {
  if (!dek) throw new VaultLockedError();
  const buf = Buffer.from(b64, 'base64');
  const nonce = buf.subarray(0, sodium.crypto_secretbox_NONCEBYTES);
  const cipher = buf.subarray(sodium.crypto_secretbox_NONCEBYTES);
  const plain = sodium.crypto_secretbox_open_easy(cipher, nonce, dek);
  return sodium.to_string(Buffer.from(plain));
}

export class VaultLockedError extends Error {
  constructor() {
    super('Vault is locked');
    this.name = 'VaultLockedError';
  }
}

/** Test-only: reset in-memory unlock state. */
export function _resetForTests(): void {
  lock();
}
