import { describe, it, expect, beforeEach } from 'vitest';
import { openMemoryDb } from '../../src/store/db.js';
import { runMigrations } from '../../src/store/migrate.js';
import {
  initVault,
  unlock,
  lock,
  isUnlocked,
  encryptSecret,
  decryptSecret,
  changePassphrase,
  VaultLockedError,
  _resetForTests,
} from '../../src/crypto/vault.js';

/**
 * Crypto envelope + KDF (T028): encrypt/decrypt roundtrip, wrong-passphrase
 * failure, lock zeroization, and passphrase change preserving data.
 */
describe('crypto vault', () => {
  let db: ReturnType<typeof openMemoryDb>;

  beforeEach(() => {
    _resetForTests();
    db = openMemoryDb();
    runMigrations(db);
  });

  it('initializes unlocked and roundtrips a secret', async () => {
    await initVault(db, 'correct horse battery staple');
    expect(isUnlocked()).toBe(true);
    const ct = encryptSecret('super-secret-key');
    expect(ct).not.toContain('super-secret-key');
    expect(decryptSecret(ct)).toBe('super-secret-key');
  });

  it('locks and refuses to encrypt/decrypt while locked', async () => {
    await initVault(db, 'passphrase-123');
    const ct = encryptSecret('x');
    lock();
    expect(isUnlocked()).toBe(false);
    expect(() => decryptSecret(ct)).toThrow(VaultLockedError);
  });

  it('unlocks with the correct passphrase and fails with the wrong one', async () => {
    await initVault(db, 'the-right-one');
    const ct = encryptSecret('payload');
    lock();
    expect(await unlock(db, 'the-wrong-one')).toBe(false);
    expect(isUnlocked()).toBe(false);
    expect(await unlock(db, 'the-right-one')).toBe(true);
    expect(decryptSecret(ct)).toBe('payload');
  });

  it('changes the passphrase while keeping existing secrets readable', async () => {
    await initVault(db, 'old-pass-phrase');
    const ct = encryptSecret('durable');
    expect(await changePassphrase(db, 'old-pass-phrase', 'new-pass-phrase')).toBe(true);
    lock();
    expect(await unlock(db, 'old-pass-phrase')).toBe(false);
    expect(await unlock(db, 'new-pass-phrase')).toBe(true);
    expect(decryptSecret(ct)).toBe('durable');
  });
});
