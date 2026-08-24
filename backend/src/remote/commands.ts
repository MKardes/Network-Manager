/**
 * Fixed, vetted command set for automated remote management (FR-001c/001d).
 *
 * Management flows may ONLY run commands built by these factories. Arbitrary
 * command execution is never exposed here — interactive shells are a separate,
 * deliberately-opened path. Every argument is validated and shell-escaped.
 */

const IFACE_RE = /^[a-zA-Z0-9_-]{1,15}$/;
const MAC_RE = /^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/;
const PATH_RE = /^\/[\w./-]*$/; // absolute path, restricted charset

function shq(value: string): string {
  // POSIX single-quote escaping.
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function assertIface(iface: string): void {
  if (!IFACE_RE.test(iface)) throw new VettedCommandError(`Invalid interface name: ${iface}`);
}

export class VettedCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VettedCommandError';
  }
}

export const vetted = {
  /** Show WireGuard interface status (dump format for parsing). */
  wgShow(iface: string): string {
    assertIface(iface);
    return `wg show ${shq(iface)} dump`;
  },

  /** Apply a staged config file via syncconf (no interface drop). */
  wgSyncConf(iface: string, confPath: string): string {
    assertIface(iface);
    if (!PATH_RE.test(confPath)) throw new VettedCommandError(`Invalid config path: ${confPath}`);
    return `wg syncconf ${shq(iface)} ${shq(confPath)}`;
  },

  /** Bring an interface up/down via wg-quick. */
  wgQuick(action: 'up' | 'down', iface: string): string {
    assertIface(iface);
    if (action !== 'up' && action !== 'down') {
      throw new VettedCommandError(`Invalid wg-quick action: ${action}`);
    }
    return `wg-quick ${action} ${shq(iface)}`;
  },

  /** Write a rendered config to a path on the remote (via tee, restricted perms). */
  writeConfig(confPath: string): string {
    if (!PATH_RE.test(confPath)) throw new VettedCommandError(`Invalid config path: ${confPath}`);
    // Content is streamed on stdin; umask keeps the file private.
    return `umask 077 && cat > ${shq(confPath)}`;
  },

  /** Emit a Wake-on-LAN magic packet for a MAC (FR-015). */
  wake(mac: string): string {
    if (!MAC_RE.test(mac)) throw new VettedCommandError(`Invalid MAC address: ${mac}`);
    // Prefer wakeonlan; fall back to etherwake if absent.
    return `wakeonlan ${shq(mac)} || etherwake ${shq(mac)}`;
  },
} as const;

export type VettedCommandName = keyof typeof vetted;
