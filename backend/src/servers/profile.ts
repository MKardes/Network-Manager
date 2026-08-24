/**
 * Build a WireGuard client connection profile (FR-003) and render the server-side
 * interface config applied via `wg`/syncconf.
 */

export interface ClientProfileInput {
  peerPrivateKey: string;
  peerAddress: string; // e.g. 10.0.0.2/32
  serverPublicKey: string;
  serverEndpoint: string; // host:port
  allowedIps?: string; // routes pushed to the client
  dns?: string;
}

export function buildClientProfile(input: ClientProfileInput): string {
  const lines = [
    '[Interface]',
    `PrivateKey = ${input.peerPrivateKey}`,
    `Address = ${input.peerAddress}`,
  ];
  if (input.dns) lines.push(`DNS = ${input.dns}`);
  lines.push(
    '',
    '[Peer]',
    `PublicKey = ${input.serverPublicKey}`,
    `Endpoint = ${input.serverEndpoint}`,
    `AllowedIPs = ${input.allowedIps ?? '0.0.0.0/0, ::/0'}`,
    'PersistentKeepalive = 25',
  );
  return lines.join('\n') + '\n';
}

export interface ServerPeer {
  publicKey: string;
  tunnelAddress: string; // host address (without mask); rendered as /32
}

export interface ServerConfigInput {
  serverPrivateKey: string;
  addressRange: string; // server's own address within the range, e.g. 10.0.0.1/24
  listenPort: number;
  peers: ServerPeer[];
}

/** Render the server interface config (wgN.conf). */
export function buildServerConfig(input: ServerConfigInput): string {
  const parts = [
    '[Interface]',
    `Address = ${input.addressRange}`,
    `ListenPort = ${input.listenPort}`,
    `PrivateKey = ${input.serverPrivateKey}`,
    '',
  ];
  for (const peer of input.peers) {
    parts.push('[Peer]', `PublicKey = ${peer.publicKey}`, `AllowedIPs = ${peer.tunnelAddress}/32`, '');
  }
  return parts.join('\n');
}
