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
  tunnelAddress?: string | null; // host address (without mask); rendered as /32
  allowedIps?: string | null; // imported peers: verbatim AllowedIPs; overrides tunnelAddress
}

export interface ServerConfigInput {
  serverPrivateKey: string;
  addressRange: string; // server's own address within the range, e.g. 10.0.0.1/24
  listenPort: number;
  peers: ServerPeer[];
}

/**
 * wg-quick-only `[Interface]` directives. `wg setconf`/`syncconf` use wg's
 * native parser, which rejects these (e.g. "Line unrecognized: `Address=...'").
 */
const WG_QUICK_ONLY_KEYS = new Set([
  'address',
  'dns',
  'mtu',
  'table',
  'preup',
  'postup',
  'predown',
  'postdown',
  'saveconfig',
]);

/**
 * Strip wg-quick-only directives so the config is accepted by `wg syncconf`.
 * The interface address is already established by the initial `wg-quick up`, so
 * syncconf only needs the private key, listen port, and peers.
 */
export function stripForSync(config: string): string {
  return config
    .split('\n')
    .filter((line) => !WG_QUICK_ONLY_KEYS.has(line.split('=', 1)[0].trim().toLowerCase()))
    .join('\n');
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
    const allowed = peer.allowedIps ?? `${peer.tunnelAddress}/32`;
    parts.push('[Peer]', `PublicKey = ${peer.publicKey}`, `AllowedIPs = ${allowed}`, '');
  }
  return parts.join('\n');
}
