import { createHash } from 'node:crypto';

/**
 * Host-key trust-on-first-use + verification (FR-011).
 *
 * The recorded fingerprint is the base64 SHA-256 of the server's public host
 * key (the same value OpenSSH prints as `SHA256:...`). On every connection the
 * presented key must match the recorded one; a mismatch blocks the session.
 */

export function hostKeyFingerprint(key: Buffer): string {
  return `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}`;
}

export type HostKeyDecision =
  | { kind: 'trusted' }
  | { kind: 'first-use'; fingerprint: string }
  | { kind: 'mismatch'; expected: string; presented: string };

export function evaluateHostKey(
  presentedKey: Buffer,
  knownFingerprint: string | null | undefined,
): HostKeyDecision {
  const presented = hostKeyFingerprint(presentedKey);
  if (!knownFingerprint) {
    return { kind: 'first-use', fingerprint: presented };
  }
  if (presented === knownFingerprint) {
    return { kind: 'trusted' };
  }
  return { kind: 'mismatch', expected: knownFingerprint, presented };
}
