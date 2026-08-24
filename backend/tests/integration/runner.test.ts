import { describe, it, expect } from 'vitest';
import { connect, HostKeyMismatchError } from '../../src/remote/runner.js';
import type { SshConnectionInfo } from '../../src/remote/runner.js';

/**
 * SSH runner integration (T029). Requires a reachable OpenSSH fixture; opt in
 * with RUN_INTEGRATION=1 and provide connection details via env:
 *   SSH_HOST, SSH_PORT, SSH_USER, SSH_KEY_PATH
 * Otherwise the suite self-skips so unit runs stay hermetic.
 */
const enabled = process.env.RUN_INTEGRATION === '1' && !!process.env.SSH_HOST;

describe.skipIf(!enabled)('SSH runner against OpenSSH fixture', () => {
  const baseInfo = (knownHostKey: string | null): SshConnectionInfo => ({
    host: process.env.SSH_HOST!,
    port: Number.parseInt(process.env.SSH_PORT ?? '22', 10),
    username: process.env.SSH_USER ?? 'root',
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    privateKey: require('node:fs').readFileSync(process.env.SSH_KEY_PATH!, 'utf8'),
    knownHostKey,
  });

  it('records the host key on first use and runs a vetted command', async () => {
    let recorded: string | null = null;
    const runner = await connect(baseInfo(null), { onFirstUse: (fp) => (recorded = fp) });
    expect(recorded).toMatch(/^SHA256:/);
    const res = await runner.exec('echo hello');
    expect(res.stdout.trim()).toBe('hello');
    runner.end();
  });

  it('blocks the connection when the host key does not match (FR-011)', async () => {
    await expect(connect(baseInfo('SHA256:deadbeefwrongkey'))).rejects.toBeInstanceOf(
      HostKeyMismatchError,
    );
  });
});
