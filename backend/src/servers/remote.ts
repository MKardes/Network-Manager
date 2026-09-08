import { connect, type SshConnectionInfo } from '../remote/runner.js';
import { parseWgDump, type PeerStatus } from './status.js';
import { stripForSync } from './profile.js';

/**
 * Apply configuration to a REMOTE WireGuard server over SSH using only the fixed
 * vetted command set (FR-001c/001d). Arbitrary commands are never issued here.
 */
export class RemoteApplier {
  constructor(private readonly connInfo: SshConnectionInfo) {}

  async apply(iface: string, config: string): Promise<void> {
    const confPath = `/etc/wireguard/${iface}.conf`;
    const syncPath = `/etc/wireguard/${iface}.sync.conf`;
    const runner = await connect(this.connInfo);
    try {
      // Write the canonical wg-quick config (with Address/…) that wg-quick up
      // reads. Streamed on stdin via the vetted writeConfig.
      const write = await runner.runVetted('writeConfig', [confPath], config);
      if (write.code !== 0) {
        throw new Error(`Failed to write remote config: ${write.stderr || write.code}`);
      }
      // Try syncconf; if the interface is down, bring it up.
      const show = await runner.runVetted('wgShow', [iface]);
      if (show.code === 0) {
        // syncconf uses wg's native parser and rejects wg-quick-only keys, so
        // stage a stripped config alongside the canonical one.
        const writeSync = await runner.runVetted('writeConfig', [syncPath], stripForSync(config));
        if (writeSync.code !== 0) {
          throw new Error(`Failed to write remote sync config: ${writeSync.stderr || writeSync.code}`);
        }
        const sync = await runner.runVetted('wgSyncConf', [iface, syncPath]);
        if (sync.code !== 0) throw new Error(`wg syncconf failed: ${sync.stderr}`);
      } else {
        const up = await runner.runVetted('wgQuick', ['up', iface]);
        if (up.code !== 0) throw new Error(`wg-quick up failed: ${up.stderr}`);
      }
    } finally {
      runner.end();
    }
  }

  async status(iface: string): Promise<{ up: boolean; peers: PeerStatus[] }> {
    const runner = await connect(this.connInfo);
    try {
      const show = await runner.runVetted('wgShow', [iface]);
      if (show.code !== 0) return { up: false, peers: [] };
      return { up: true, peers: parseWgDump(show.stdout) };
    } finally {
      runner.end();
    }
  }
}
