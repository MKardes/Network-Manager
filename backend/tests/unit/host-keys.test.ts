import { describe, it, expect } from 'vitest';
import { hostKeyFingerprint, evaluateHostKey } from '../../src/remote/host-keys.js';

describe('host-key verification (FR-011)', () => {
  const key = Buffer.from('ssh-ed25519 AAAAC3NzaC1lZDI1', 'utf8');

  it('produces a stable SHA256 fingerprint', () => {
    const fp = hostKeyFingerprint(key);
    expect(fp).toMatch(/^SHA256:/);
    expect(hostKeyFingerprint(key)).toBe(fp);
  });

  it('accepts a trusted key', () => {
    const fp = hostKeyFingerprint(key);
    expect(evaluateHostKey(key, fp)).toEqual({ kind: 'trusted' });
  });

  it('records the fingerprint on first use', () => {
    const decision = evaluateHostKey(key, null);
    expect(decision.kind).toBe('first-use');
  });

  it('blocks on a mismatch', () => {
    const decision = evaluateHostKey(key, 'SHA256:someotherkey');
    expect(decision.kind).toBe('mismatch');
  });
});
