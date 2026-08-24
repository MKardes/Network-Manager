import { describe, it, expect } from 'vitest';
import { SftpService } from '../../src/session/sftp.js';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

/**
 * US3 SFTP integration (T049). Requires an OpenSSH fixture with SFTP enabled
 * (RUN_INTEGRATION=1 + SSH_* env). Validates list, upload→download byte-for-byte
 * roundtrip, and that a bad path surfaces an error (never a silent success).
 */
const enabled = process.env.RUN_INTEGRATION === '1' && !!process.env.SSH_HOST;

describe.skipIf(!enabled)('US3: SFTP transfer', () => {
  const svc = () =>
    new SftpService({
      host: process.env.SSH_HOST!,
      port: Number.parseInt(process.env.SSH_PORT ?? '22', 10),
      username: process.env.SSH_USER ?? 'root',
      privateKey: readFileSync(process.env.SSH_KEY_PATH!, 'utf8'),
      knownHostKey: null,
    });

  const dir = process.env.SFTP_DIR ?? '/tmp';

  it('lists a directory', async () => {
    const entries = await svc().list(dir);
    expect(Array.isArray(entries)).toBe(true);
  });

  it('uploads then downloads a file byte-for-byte', async () => {
    const payload = randomBytes(4096);
    const remote = `${dir}/wgnm-test-${Date.now()}.bin`;
    await svc().upload(remote, payload);
    const back = await svc().download(remote);
    expect(Buffer.compare(back, payload)).toBe(0);
  });

  it('reports an error for a nonexistent path (not a partial success)', async () => {
    await expect(svc().download(`${dir}/definitely-missing-${Date.now()}`)).rejects.toBeTruthy();
  });
});
