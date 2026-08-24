import { encryptSecret, decryptSecret } from '../crypto/vault.js';

/**
 * Helper for repositories that persist secret-bearing columns. Values are
 * encrypted on write and decrypted on read, and only ever while the vault is
 * unlocked (encryptSecret/decryptSecret throw VaultLockedError otherwise).
 *
 * Ciphertext is stored as base64 text in a TEXT column.
 */

export function encryptField(plaintext: string | null | undefined): string | null {
  if (plaintext === null || plaintext === undefined) return null;
  return encryptSecret(plaintext);
}

export function decryptField(ciphertext: string | null | undefined): string | null {
  if (ciphertext === null || ciphertext === undefined) return null;
  return decryptSecret(ciphertext);
}

/** Encrypt an arbitrary JSON-serializable value (e.g. recovery-code list). */
export function encryptJson(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return encryptSecret(JSON.stringify(value));
}

export function decryptJson<T>(ciphertext: string | null | undefined): T | null {
  if (ciphertext === null || ciphertext === undefined) return null;
  return JSON.parse(decryptSecret(ciphertext)) as T;
}
