import { randomBytes, createHash } from 'node:crypto';

/**
 * One-time recovery codes (FR-024a). Codes are shown once at generation; only
 * their hashes are persisted (encrypted alongside the TOTP secret). Each code is
 * single-use.
 */

export interface RecoveryCode {
  code_hash: string;
  used_at?: string;
}

const CODE_COUNT = 10;

function hashCode(code: string): string {
  return createHash('sha256').update(code.replace(/\s+/g, '').toLowerCase()).digest('hex');
}

/** Generate plaintext codes (to display once) plus their storable hashes. */
export function generateRecoveryCodes(): { plaintext: string[]; stored: RecoveryCode[] } {
  const plaintext: string[] = [];
  const stored: RecoveryCode[] = [];
  for (let i = 0; i < CODE_COUNT; i++) {
    // 10 hex chars grouped as xxxxx-xxxxx
    const raw = randomBytes(5).toString('hex');
    const code = `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
    plaintext.push(code);
    stored.push({ code_hash: hashCode(code) });
  }
  return { plaintext, stored };
}

/**
 * Attempt to consume a recovery code. Returns the updated list if the code
 * matched an unused entry (now marked used), or null if it did not match.
 */
export function consumeRecoveryCode(
  codes: RecoveryCode[],
  candidate: string,
): RecoveryCode[] | null {
  const h = hashCode(candidate);
  const idx = codes.findIndex((c) => c.code_hash === h && !c.used_at);
  if (idx === -1) return null;
  const updated = codes.map((c, i) =>
    i === idx ? { ...c, used_at: new Date().toISOString() } : c,
  );
  return updated;
}
