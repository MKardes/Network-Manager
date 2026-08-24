import { describe, it, expect } from 'vitest';
import { buildClientProfile, buildServerConfig } from '../../src/servers/profile.js';
import { parseWgDump } from '../../src/servers/status.js';

describe('WireGuard config rendering', () => {
  it('builds a client profile with interface + peer sections', () => {
    const profile = buildClientProfile({
      peerPrivateKey: 'PRIV',
      peerAddress: '10.0.0.2/32',
      serverPublicKey: 'SRVPUB',
      serverEndpoint: 'vpn.example.com:51820',
    });
    expect(profile).toContain('[Interface]');
    expect(profile).toContain('PrivateKey = PRIV');
    expect(profile).toContain('Address = 10.0.0.2/32');
    expect(profile).toContain('[Peer]');
    expect(profile).toContain('PublicKey = SRVPUB');
    expect(profile).toContain('Endpoint = vpn.example.com:51820');
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
