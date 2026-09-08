import { execFile } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { parseWgDump, type PeerStatus } from './status.js';
import { stripForSync } from './profile.js';

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

    // Only bring the interface up if it doesn't exist yet; a `wg-quick down/up`
    // would drop it. Probe with `wg show` first, but keep that probe separate so
    // a later syncconf failure surfaces instead of falling back to `up`.
    let exists = true;
    try {
      await execFileAsync('wg', ['show', iface]);
    } catch {
      exists = false;
    }

    if (exists) {
      // Interface exists → sync peers without dropping it. `wg syncconf` uses
      // wg's native parser and rejects wg-quick-only keys (Address/DNS/MTU/…),
      // so feed it a stripped config.
      const syncPath = `${path}.sync`;
      await writeFile(syncPath, stripForSync(config), { mode: 0o600 });
      await execFileAsync('wg', ['syncconf', iface, syncPath]);
    } else {
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
