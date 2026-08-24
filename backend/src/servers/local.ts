import { execFile } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { parseWgDump, type PeerStatus } from './status.js';

const execFileAsync = promisify(execFile);

/**
 * Apply configuration to the LOCAL WireGuard server by invoking wg/wg-quick as
 * child processes (FR-001b). Config is rendered to a file on the durable volume
 * and applied via `wg syncconf` (peer changes without dropping the interface).
 */
export class LocalApplier {
  constructor(private readonly dataDir: string) {}

  private confPath(iface: string): string {
    return join(this.dataDir, 'wg', `${iface}.conf`);
  }

  async apply(iface: string, config: string): Promise<void> {
    const path = this.confPath(iface);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, config, { mode: 0o600 });

    // Ensure the interface exists (wg-quick up is idempotent-ish: down then up
    // would drop it, so only bring up if `wg show` fails).
    try {
      await execFileAsync('wg', ['show', iface]);
      // Interface exists → sync peers without dropping it.
      await execFileAsync('wg', ['syncconf', iface, path]);
    } catch {
      await execFileAsync('wg-quick', ['up', path]);
    }
  }

  async down(iface: string): Promise<void> {
    await execFileAsync('wg-quick', ['down', this.confPath(iface)]).catch(() => undefined);
  }

  async status(iface: string): Promise<{ up: boolean; peers: PeerStatus[] }> {
    try {
      const { stdout } = await execFileAsync('wg', ['show', iface, 'dump']);
      return { up: true, peers: parseWgDump(stdout) };
    } catch {
      return { up: false, peers: [] };
    }
  }
}
