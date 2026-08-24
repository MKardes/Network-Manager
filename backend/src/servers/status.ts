/**
 * Parse `wg show <iface> dump` output (FR-006). The first line is the interface;
 * subsequent lines are peers: publicKey, presharedKey, endpoint, allowedIps,
 * latestHandshake (unix seconds), rxBytes, txBytes, keepalive.
 */

export interface PeerStatus {
  publicKey: string;
  endpoint: string | null;
  allowedIps: string;
  latestHandshake: number; // unix seconds; 0 = never
  rxBytes: number;
  txBytes: number;
  connected: boolean;
}

const HANDSHAKE_FRESH_SECONDS = 180;

export function parseWgDump(dump: string): PeerStatus[] {
  const lines = dump.trim().split('\n').filter(Boolean);
  const peers: PeerStatus[] = [];
  // Skip line 0 (interface). Peers start at line 1.
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split('\t');
    if (cols.length < 8) continue;
    const latestHandshake = Number.parseInt(cols[4], 10) || 0;
    const now = Math.floor(Date.now() / 1000);
    peers.push({
      publicKey: cols[0],
      endpoint: cols[2] === '(none)' ? null : cols[2],
      allowedIps: cols[3],
      latestHandshake,
      rxBytes: Number.parseInt(cols[5], 10) || 0,
      txBytes: Number.parseInt(cols[6], 10) || 0,
      connected: latestHandshake > 0 && now - latestHandshake < HANDSHAKE_FRESH_SECONDS,
    });
  }
  return peers;
}
