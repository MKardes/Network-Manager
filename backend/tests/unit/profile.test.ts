import { describe, it, expect } from 'vitest';
import { buildClientProfile, buildServerConfig, stripForSync } from '../../src/servers/profile.js';
import { parseWgDump } from '../../src/servers/status.js';

describe('WireGuard config rendering', () => {
  it('builds a client profile with interface + peer sections', () => {
    const profile = buildClientProfile({
      peerPrivateKey: 'PRIV',
      peerAddress: '10.0.0.2/32',
      serverPublicKey: 'SRVPUB',
      serverEndpoint: 'vpn.example.com:51820',
      allowedIps: '10.0.0.0/24',
    });
    expect(profile).toContain('[Interface]');
    expect(profile).toContain('PrivateKey = PRIV');
    expect(profile).toContain('Address = 10.0.0.2/32');
    expect(profile).toContain('[Peer]');
    expect(profile).toContain('PublicKey = SRVPUB');
    expect(profile).toContain('Endpoint = vpn.example.com:51820');
  });

  it('routes only the given network, never a full tunnel', () => {
    const profile = buildClientProfile({
      peerPrivateKey: 'PRIV',
      peerAddress: '10.0.0.2/32',
      serverPublicKey: 'SRVPUB',
      serverEndpoint: 'vpn.example.com:51820',
      allowedIps: '10.0.0.0/24',
    });
    expect(profile).toContain('AllowedIPs = 10.0.0.0/24');
    expect(profile).not.toContain('0.0.0.0/0');
    expect(profile).not.toContain('::/0');
  });

  it('renders the exact client layout: PrivateKey/Address/DNS then peer block', () => {
    const profile = buildClientProfile({
      peerPrivateKey: 'cli1_priv',
      peerAddress: '10.0.0.2/32',
      serverPublicKey: 'pubkey=',
      serverEndpoint: 'vpn.host.com:51820',
      allowedIps: '10.0.0.0/24',
    });
    expect(profile).toBe(
      [
        '[Interface]',
        'PrivateKey = cli1_priv',
        'Address = 10.0.0.2/32',
        'DNS = 1.1.1.1',
        '',
        '[Peer]',
        'PublicKey = pubkey=',
        'Endpoint = vpn.host.com:51820',
        'AllowedIPs = 10.0.0.0/24',
        'PersistentKeepalive = 25',
        '',
      ].join('\n'),
    );
  });

  it('omits DNS when explicitly disabled', () => {
    const profile = buildClientProfile({
      peerPrivateKey: 'PRIV',
      peerAddress: '10.0.0.2/32',
      serverPublicKey: 'SRVPUB',
      serverEndpoint: 'vpn.example.com:51820',
      allowedIps: '10.0.0.0/24',
      dns: null,
    });
    expect(profile).not.toMatch(/DNS/);
  });

  it('renders the exact server layout: Address/MTU/SaveConfig/ListenPort/PrivateKey then peers', () => {
    const conf = buildServerConfig({
      serverPrivateKey: 'priv_key',
      addressRange: '10.0.0.1/24',
      listenPort: 51820,
      peers: [{ publicKey: 'pubkey_cli1', tunnelAddress: '10.0.0.2' }],
    });
    expect(conf).toBe(
      [
        '[Interface]',
        'Address = 10.0.0.1/24',
        'MTU = 1420',
        'SaveConfig = true',
        'ListenPort = 51820',
        'PrivateKey = priv_key',
        '',
        '[Peer]',
        'PublicKey = pubkey_cli1',
        'AllowedIPs = 10.0.0.2/32',
        '',
      ].join('\n'),
    );
  });

  it('builds a server config listing peers with /32 allowed IPs', () => {
    const conf = buildServerConfig({
      serverPrivateKey: 'SRVPRIV',
      addressRange: '10.0.0.1/24',
      listenPort: 51820,
      peers: [{ publicKey: 'PEER1', tunnelAddress: '10.0.0.2' }],
    });
    expect(conf).toContain('ListenPort = 51820');
    expect(conf).toContain('PublicKey = PEER1');
    expect(conf).toContain('AllowedIPs = 10.0.0.2/32');
  });

  it('strips wg-quick-only keys for wg syncconf, keeping wg-native fields', () => {
    const conf = buildServerConfig({
      serverPrivateKey: 'SRVPRIV',
      addressRange: '10.0.0.1/24',
      listenPort: 51820,
      peers: [{ publicKey: 'PEER1', tunnelAddress: '10.0.0.2' }],
    });
    const stripped = stripForSync(conf);
    // `wg syncconf` rejects Address/MTU/SaveConfig; they must all be gone.
    expect(stripped).not.toMatch(/^Address\s*=/m);
    expect(stripped).not.toMatch(/^MTU\s*=/m);
    expect(stripped).not.toMatch(/^SaveConfig\s*=/m);
    // wg-native fields and peers must survive.
    expect(stripped).toContain('ListenPort = 51820');
    expect(stripped).toContain('PrivateKey = SRVPRIV');
    expect(stripped).toContain('[Peer]');
    expect(stripped).toContain('PublicKey = PEER1');
    expect(stripped).toContain('AllowedIPs = 10.0.0.2/32');
  });

  it('strips DNS/MTU from a client-style config regardless of spacing', () => {
    const stripped = stripForSync('[Interface]\nAddress=10.0.0.2/32\nDNS = 1.1.1.1\nMTU=1420\nPrivateKey = P\n');
    expect(stripped).not.toMatch(/Address/);
    expect(stripped).not.toMatch(/DNS/);
    expect(stripped).not.toMatch(/MTU/);
    expect(stripped).toContain('PrivateKey = P');
  });

  it('renders an imported peer with its verbatim AllowedIPs, created peers as /32 (feature 002)', () => {
    const conf = buildServerConfig({
      serverPrivateKey: 'SRVPRIV',
      addressRange: '10.0.0.1/24',
      listenPort: 51820,
      peers: [
        { publicKey: 'CREATED', tunnelAddress: '10.0.0.2' },
        { publicKey: 'IMPORTED', allowedIps: '10.0.5.0/24, 10.0.6.7/32' },
      ],
    });
    expect(conf).toContain('PublicKey = CREATED');
    expect(conf).toContain('AllowedIPs = 10.0.0.2/32');
    expect(conf).toContain('PublicKey = IMPORTED');
    expect(conf).toContain('AllowedIPs = 10.0.5.0/24, 10.0.6.7/32');
  });
});

describe('wg dump parsing', () => {
  it('marks a peer with a fresh handshake as connected', () => {
    const now = Math.floor(Date.now() / 1000);
    const dump = [
      'srvkey\t(none)\t51820\toff', // interface line
      `peerkey\t(none)\t1.2.3.4:1234\t10.0.0.2/32\t${now}\t100\t200\toff`,
    ].join('\n');
    const peers = parseWgDump(dump);
    expect(peers).toHaveLength(1);
    expect(peers[0].publicKey).toBe('peerkey');
    expect(peers[0].connected).toBe(true);
  });

  it('marks a peer that never handshook as disconnected', () => {
    const dump = [
      'srvkey\t(none)\t51820\toff',
      'peerkey\t(none)\t(none)\t10.0.0.3/32\t0\t0\t0\toff',
    ].join('\n');
    const peers = parseWgDump(dump);
    expect(peers[0].connected).toBe(false);
  });
});
