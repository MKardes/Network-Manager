import { describe, it, expect } from 'vitest';
import { connect, SshAuthError, HostKeyMismatchError } from '../../src/remote/runner.js';
import { readFileSync } from 'node:fs';

/**
 * US2 SSH integration (T044). Requires an OpenSSH fixture (RUN_INTEGRATION=1 +
 * SSH_HOST/SSH_PORT/SSH_USER/SSH_KEY_PATH). Exercises the runner primitives the
 * WebSocket terminal is built on: shell open, host-key-mismatch block, and auth
 * failure.
 */
const enabled = process.env.RUN_INTEGRATION === '1' && !!process.env.SSH_HOST;

describe.skipIf(!enabled)('US2: interactive SSH primitives', () => {
  const info = (over: Partial<{ knownHostKey: string | null; privateKey: string }> = {}) => ({
    host: process.env.SSH_HOST!,
    port: Number.parseInt(process.env.SSH_PORT ?? '22', 10),
    username: process.env.SSH_USER ?? 'root',
    privateKey: over.privateKey ?? readFileSync(process.env.SSH_KEY_PATH!, 'utf8'),
    knownHostKey: over.knownHostKey ?? null,
  });

  it('opens a shell and streams output (happy path)', async () => {
    const runner = await connect(info());
    const stream = await runner.shell({ cols: 80, rows: 24 });
    const output = await new Promise<string>((resolve) => {
      let buf = '';
      stream.on('data', (d: Buffer) => {
        buf += d.toString('utf8');
        if (buf.includes('READY')) resolve(buf);
      });
      stream.write('echo READY\n');
    });
    expect(output).toContain('READY');
    runner.end();
  });

  it('blocks on a changed host key (SC-006)', async () => {
    await expect(connect(info({ knownHostKey: 'SHA256:wrong' }))).rejects.toBeInstanceOf(
      HostKeyMismatchError,
    );
  });

  it('fails clearly on bad credentials (FR-012)', async () => {
    await expect(connect(info({ privateKey: DUMMY_KEY }))).rejects.toBeInstanceOf(SshAuthError);
  });
});

// An unrelated, valid-format key that the fixture will not accept.
const DUMMY_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACDBADYWlg0000000000000000000000000000000000000AAAJi0000000
-----END OPENSSH PRIVATE KEY-----`;
