/**
 * Build a WireGuard client connection profile (FR-003) and render the server-side
 * interface config applied via `wg`/syncconf.
 *
 * Both renderers target the plain wg-quick layout that is known to work against
 * our servers:
 *
 *   server                          client
 *   [Interface]                     [Interface]
 *   Address = 10.0.0.1/24           PrivateKey = <peer priv>
 *   MTU = 1420                      Address = 10.0.0.2/32
 *   SaveConfig = true               DNS = 1.1.1.1
 *   ListenPort = 51820
 *   PrivateKey = <server priv>      [Peer]
 *                                   PublicKey = <server pub>
 *   [Peer]                          Endpoint = vpn.host.com:51820
 *   PublicKey = <peer pub>          AllowedIPs = 10.0.0.0/24
 *   AllowedIPs = 10.0.0.2/32        PersistentKeepalive = 25
 */

/** Tunnel MTU: 1420 leaves room for the WireGuard header inside a 1500-byte path. */
export const DEFAULT_MTU = 1420;
/** Resolver handed to clients while the tunnel is up. */
export const DEFAULT_CLIENT_DNS = '1.1.1.1';

export interface ClientProfileInput {
  peerPrivateKey: string;
  peerAddress: string; // e.g. 10.0.0.2/32
  serverPublicKey: string;
  serverEndpoint: string; // host:port
  /**
   * Routes pushed to the client. Required: leaving it to a default is how a
   * profile silently becomes a full tunnel (`0.0.0.0/0, ::/0`), sending every
   * packet the client sends over WireGuard. Callers pass the server's tunnel
   * network so only tunnel traffic is routed (split tunnel).
   */
  allowedIps: string;
  /** Defaults to {@link DEFAULT_CLIENT_DNS}; pass null/'' to omit the line. */
  dns?: string | null;
}

export function buildClientProfile(input: ClientProfileInput): string {
  const dns = input.dns === undefined ? DEFAULT_CLIENT_DNS : input.dns;
  const lines = [
    '[Interface]',
    `PrivateKey = ${input.peerPrivateKey}`,
    `Address = ${input.peerAddress}`,
  ];
  if (dns) lines.push(`DNS = ${dns}`);
  lines.push(
    '',
    '[Peer]',
    `PublicKey = ${input.serverPublicKey}`,
    `Endpoint = ${input.serverEndpoint}`,
    `AllowedIPs = ${input.allowedIps}`,
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
  /** Defaults to {@link DEFAULT_MTU}; pass null to omit the line. */
  mtu?: number | null;
  /**
   * Emit `SaveConfig = true` (default). wg-quick then writes the live interface
   * back to this file on `wg-quick down`; harmless here because every apply
   * re-renders the file from our own peer list, and imported live peers are
   * folded in first.
   */
  saveConfig?: boolean;
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
  const mtu = input.mtu === undefined ? DEFAULT_MTU : input.mtu;
  const parts = ['[Interface]', `Address = ${input.addressRange}`];
  if (mtu) parts.push(`MTU = ${mtu}`);
  if (input.saveConfig ?? true) parts.push('SaveConfig = true');
  parts.push(`ListenPort = ${input.listenPort}`, `PrivateKey = ${input.serverPrivateKey}`, '');
  for (const peer of input.peers) {
    const allowed = peer.allowedIps ?? `${peer.tunnelAddress}/32`;
    parts.push('[Peer]', `PublicKey = ${peer.publicKey}`, `AllowedIPs = ${allowed}`, '');
  }
  return parts.join('\n');
}
