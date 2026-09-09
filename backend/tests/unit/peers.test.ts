import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openMemoryDb, type DB } from '../../src/store/db.js';
import { runMigrations } from '../../src/store/migrate.js';
import { ServerRepo } from '../../src/store/servers.js';
import { DeviceRepo } from '../../src/store/devices.js';
import { _resetForTests } from '../../src/crypto/vault.js';
import {
  deriveImportAddress,
  importLivePeers,
  PeerReconcileService,
} from '../../src/servers/peers.js';
import type { PeerStatus } from '../../src/servers/status.js';
import type { ServerService } from '../../src/servers/service.js';

function livePeer(publicKey: string, allowedIps: string, connected = false): PeerStatus {
  return {
    publicKey,
    endpoint: null,
    allowedIps,
    latestHandshake: connected ? Math.floor(Date.now() / 1000) : 0,
    rxBytes: 0,
    txBytes: 0,
    connected,
  };
}

describe('deriveImportAddress (feature 002)', () => {
  it('stores a single free /32 host in tunnel_address', () => {
    expect(deriveImportAddress('10.0.0.9/32', [])).toEqual({
      tunnelAddress: '10.0.0.9',
      allowedIps: null,
    });
  });

  it('keeps a subnet or multi-entry AllowedIPs verbatim', () => {
    expect(deriveImportAddress('10.0.5.0/24', [])).toEqual({
      tunnelAddress: null,
      allowedIps: '10.0.5.0/24',
    });
    expect(deriveImportAddress('10.0.0.9/32, 10.0.6.0/24', [])).toEqual({
      tunnelAddress: null,
      allowedIps: '10.0.0.9/32, 10.0.6.0/24',
    });
  });

  it('falls back to allowed_ips when the /32 host is already used', () => {
    expect(deriveImportAddress('10.0.0.9/32', ['10.0.0.9'])).toEqual({
      tunnelAddress: null,
      allowedIps: '10.0.0.9/32',
    });
  });

  it('handles an empty / (none) AllowedIPs', () => {
    expect(deriveImportAddress('(none)', [])).toEqual({ tunnelAddress: null, allowedIps: null });
  });
});

describe('peer reconciliation (feature 002)', () => {
  let db: DB;
  let servers: ServerRepo;
  let devices: DeviceRepo;
  let serverId: string;

  beforeEach(() => {
    _resetForTests();
    db = openMemoryDb();
    runMigrations(db);
    servers = new ServerRepo(db);
    devices = new DeviceRepo(db);
    // Insert the server row directly (bypassing ServerRepo.create's private-key
    // encryption) so this stays a pure unit test with no vault/argon2 dependency;
    // reconciliation never decrypts the server key.
    serverId = randomUUID();
    db.prepare(
      `INSERT INTO wireguard_server
         (id, name, location, interface_name, address_range, listen_endpoint,
          server_private_key, server_public_key)
       VALUES (?, 'home', 'local', 'wg0', '10.0.0.0/24', 'vpn.example.com:51820', 'x', 'PUB')`,
    ).run(serverId);
  });

  it('imports unknown live peers as needs_review, idempotently', () => {
    const peers = [livePeer('KEYAAAAAA', '10.0.0.9/32'), livePeer('KEYBBBBBB', '10.0.5.0/24')];
    expect(importLivePeers(devices, serverId, peers)).toBe(2);
    // Second call imports nothing (correlated by public key).
    expect(importLivePeers(devices, serverId, peers)).toBe(0);

    const rows = devices.listByServer(serverId);
    expect(rows).toHaveLength(2);
    const a = devices.getByPublicKey(serverId, 'KEYAAAAAA')!;
    expect(a.management_state).toBe('needs_review');
    expect(a.origin).toBe('imported');
    expect(a.tunnel_address).toBe('10.0.0.9');
    expect(a.peer_private_key).toBeNull();
    const b = devices.getByPublicKey(serverId, 'KEYBBBBBB')!;
    expect(b.tunnel_address).toBeNull();
    expect(b.allowed_ips).toBe('10.0.5.0/24');
  });

  it('reconcile labels managed vs imported, flags discrepancy and out-of-range', async () => {
    // A managed/created peer present on the server. (No private key set here to
    // keep this a pure unit test — encryption requires an unlocked vault.)
    const managed = devices.create({
      serverId,
      name: 'laptop',
      kind: 'peer',
      tunnelAddress: '10.0.0.2',
      peerPublicKey: 'MANAGEDKEY',
    });
    // A managed peer that is NOT on the live server (discrepancy).
    devices.create({
      serverId,
      name: 'ghost',
      kind: 'peer',
      tunnelAddress: '10.0.0.3',
      peerPublicKey: 'GHOSTKEY',
    });

    // Stub server status to inject live peers: the managed one + an unknown one
    // whose address is OUT of the server's range.
    const stubServerService = {
      status: async () => ({
        status: 'up',
        peers: [
          livePeer('MANAGEDKEY', '10.0.0.2/32', true),
          livePeer('OUTSIDEKEY', '10.9.9.9/32'),
        ],
      }),
    } as unknown as ServerService;

    const svc = new PeerReconcileService(servers, devices, stubServerService);
    const { live, peers } = await svc.reconcile(serverId);
    expect(live).toBe(true);

    const byKey = Object.fromEntries(peers.map((p) => [p.publicKey, p]));
    expect(byKey['MANAGEDKEY'].managementState).toBe('managed');
    expect(byKey['MANAGEDKEY'].presentOnServer).toBe(true);
    expect(byKey['MANAGEDKEY'].connected).toBe(true);

    // The ghost is tracked but absent from the live set.
    expect(byKey['GHOSTKEY'].presentOnServer).toBe(false);

    // The unknown live peer was imported and flagged out of range.
    expect(byKey['OUTSIDEKEY'].managementState).toBe('needs_review');
    expect(byKey['OUTSIDEKEY'].outOfRange).toBe(true);
    expect(byKey['OUTSIDEKEY'].hasPrivateKey).toBe(false);

    expect(managed.management_state).toBe('managed');
  });

  it('reports live=false and marks peers not-live when status is unknown', async () => {
    devices.create({
      serverId,
      name: 'laptop',
      kind: 'peer',
      tunnelAddress: '10.0.0.2',
      peerPublicKey: 'MANAGEDKEY',
    });
    const stub = {
      status: async () => ({ status: 'unknown', peers: [] }),
    } as unknown as ServerService;
    const svc = new PeerReconcileService(servers, devices, stub);
    const { live, peers } = await svc.reconcile(serverId);
    expect(live).toBe(false);
    expect(peers).toHaveLength(1);
    expect(peers[0].presentOnServer).toBe(false);
    expect(peers[0].connected).toBe(false);
  });
});
