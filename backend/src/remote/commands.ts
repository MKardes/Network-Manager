/**
 * Fixed, vetted command set for automated remote management (FR-001c/001d).
 *
 * Management flows may ONLY run commands built by these factories. Arbitrary
 * command execution is never exposed here — interactive shells are a separate,
 * deliberately-opened path. Every argument is validated and shell-escaped.
 */

import { isIpv4 } from '../servers/net.js';

const IFACE_RE = /^[a-zA-Z0-9_-]{1,15}$/;
const MAC_RE = /^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/;
const PATH_RE = /^\/[\w./-]*$/; // absolute path, restricted charset

/** Fixed, bounded timeout (seconds) for the liveness probe so it can never hang. */
const PROBE_TIMEOUT_SECONDS = 3;

/** Optional per-region targeting for the wake packet (feature 003). */
export interface WakeTarget {
  broadcast?: string | null; // IPv4 broadcast address
  port?: number | null; // Wake-on-LAN UDP port (1..65535)
}

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

  /**
   * Emit a Wake-on-LAN magic packet for a MAC (FR-015). When a region supplies a
   * broadcast address and/or UDP port (feature 003), the packet is directed there
   * via `wakeonlan -i/-p`; with neither, the legacy behavior is preserved.
   */
  wake(mac: string, target?: WakeTarget): string {
    if (!MAC_RE.test(mac)) throw new VettedCommandError(`Invalid MAC address: ${mac}`);
    const broadcast = target?.broadcast ?? null;
    const port = target?.port ?? null;
    if (broadcast === null && port === null) {
      // Prefer wakeonlan; fall back to etherwake if absent.
      return `wakeonlan ${shq(mac)} || etherwake ${shq(mac)}`;
    }
    const parts = ['wakeonlan'];
    if (broadcast !== null) {
      if (!isIpv4(broadcast)) throw new VettedCommandError(`Invalid broadcast address: ${broadcast}`);
      parts.push('-i', shq(broadcast));
    }
    if (port !== null) {
      if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new VettedCommandError(`Invalid Wake-on-LAN port: ${port}`);
      }
      parts.push('-p', String(port));
    }
    parts.push(shq(mac));
    return parts.join(' ');
  },

  /** Liveness probe: a single, hard-bounded ICMP ping to an IPv4 host (feature 003). */
  probe(host: string): string {
    if (!isIpv4(host)) throw new VettedCommandError(`Invalid probe host: ${host}`);
    return `ping -c 1 -W ${PROBE_TIMEOUT_SECONDS} ${shq(host)}`;
  },
} as const;

export type VettedCommandName = keyof typeof vetted;
