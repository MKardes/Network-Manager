import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { makeTestApp, setupAndLogin, type TestApp } from '../helpers/app.js';
import { DeviceRepo } from '../../src/store/devices.js';

/**
 * Contract tests for feature 002: reconciled peers view (US1), manual client IP
 * assignment (US2), and adopting an imported peer (US3).
 *
 * Setup/login (argon2 KDF) and the server run once for the file; each test's
 * devices are wiped afterwards so state stays isolated without repeated KDF cost.
 */
describe('peers & manual IP contract', () => {
  let t: TestApp;
  let cookie: string;
  let serverId: string;

  beforeAll(async () => {
    t = await makeTestApp();
    cookie = await setupAndLogin(t);
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/servers',
      headers: { cookie },
      payload: {
        name: 'home',
        location: 'local',
        addressRange: '10.0.0.0/24',
        listenEndpoint: 'vpn.example.com:51820',
      },
    });
    serverId = res.json().server.id;
  });

  afterEach(() => {
    t.db.prepare('DELETE FROM device WHERE server_id = ?').run(serverId);
  });

  const addDevice = (payload: Record<string, unknown>) =>
    t.app.inject({
      method: 'POST',
      url: `/api/v1/servers/${serverId}/devices`,
      headers: { cookie },
      payload,
    });

  const seedImportedPeer = (opts: { publicKey: string; tunnelAddress?: string | null; allowedIps?: string | null }) =>
    new DeviceRepo(t.db).importPeer({
      serverId,
      name: `imported-${opts.publicKey.slice(0, 8)}`,
      publicKey: opts.publicKey,
      tunnelAddress: opts.tunnelAddress ?? null,
      allowedIps: opts.allowedIps ?? null,
    });

  // US1 -------------------------------------------------------------------
  it('lists managed and imported peers, labeled, without private keys', async () => {
    await addDevice({ name: 'laptop', kind: 'peer' }); // managed/created
    seedImportedPeer({ publicKey: 'IMPORTEDKEYAAAA', tunnelAddress: '10.0.0.9' });

    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/servers/${serverId}/peers`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('live');
    expect(body.peers).toHaveLength(2);

    const states = body.peers.map((p: { managementState: string }) => p.managementState).sort();
    expect(states).toEqual(['managed', 'needs_review']);
    const imported = body.peers.find((p: { managementState: string }) => p.managementState === 'needs_review');
    expect(imported.origin).toBe('imported');
    expect(imported.hasPrivateKey).toBe(false);
    expect(imported.presentOnServer).toBe(false); // no live wg in test env
    expect(JSON.stringify(body)).not.toContain('peer_private_key');
    expect(JSON.stringify(body)).not.toContain('privateKey');
  });

  // US2 -------------------------------------------------------------------
  it('creates a peer at a specific in-range address and reflects it in the profile', async () => {
    const res = await addDevice({ name: 'fixed', kind: 'peer', tunnelAddress: '10.0.0.50' });
    expect(res.statusCode).toBe(201);
    const id = res.json().device.id;
    expect(res.json().device.tunnelAddress).toBe('10.0.0.50');

    const profile = await t.app.inject({
      method: 'GET',
      url: `/api/v1/devices/${id}/profile`,
      headers: { cookie },
    });
    expect(profile.body).toContain('Address = 10.0.0.50/32');
  });

  it('rejects a duplicate manual address with 409', async () => {
    await addDevice({ name: 'a', kind: 'peer', tunnelAddress: '10.0.0.50' });
    const dup = await addDevice({ name: 'b', kind: 'peer', tunnelAddress: '10.0.0.50' });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe('address_in_use');
  });

  it('rejects an out-of-range manual address with 400', async () => {
    const res = await addDevice({ name: 'oob', kind: 'peer', tunnelAddress: '10.0.9.9' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('validation_error');
  });

  it('rejects an address inside an imported peer subnet with 409', async () => {
    seedImportedPeer({ publicKey: 'SUBNETKEYAAAA', allowedIps: '10.0.0.32/27' }); // .32-.63
    const res = await addDevice({ name: 'clash', kind: 'peer', tunnelAddress: '10.0.0.40' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('address_in_use');
  });

  it('auto-assigns when no address is supplied', async () => {
    const res = await addDevice({ name: 'auto', kind: 'peer' });
    expect(res.statusCode).toBe(201);
    expect(res.json().device.tunnelAddress).toBe('10.0.0.2');
  });

  it('auto-assign skips addresses used by an imported peer', async () => {
    seedImportedPeer({ publicKey: 'USED2KEYAAAA', tunnelAddress: '10.0.0.2' });
    const res = await addDevice({ name: 'auto', kind: 'peer' });
    expect(res.json().device.tunnelAddress).toBe('10.0.0.3');
  });

  // US3 -------------------------------------------------------------------
  it('adopts an imported peer, retaining address and public key', async () => {
    const imported = seedImportedPeer({ publicKey: 'ADOPTKEYAAAA', tunnelAddress: '10.0.0.9' });
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/devices/${imported.id}/adopt`,
      headers: { cookie },
      payload: { name: 'office-printer' },
    });
    expect(res.statusCode).toBe(200);
    const device = res.json().device;
    expect(device.managementState).toBe('managed');
    expect(device.name).toBe('office-printer');
    expect(device.tunnelAddress).toBe('10.0.0.9');
    expect(device.peerPublicKey).toBe('ADOPTKEYAAAA');
  });

  it('adopted peer has no profile until keys are reissued', async () => {
    const imported = seedImportedPeer({ publicKey: 'NOKEYAAAA', tunnelAddress: '10.0.0.9' });
    await t.app.inject({
      method: 'POST',
      url: `/api/v1/devices/${imported.id}/adopt`,
      headers: { cookie },
      payload: { name: 'printer' },
    });
    const before = await t.app.inject({
      method: 'GET',
      url: `/api/v1/devices/${imported.id}/profile`,
      headers: { cookie },
    });
    expect(before.statusCode).toBe(422); // precondition_failed: no private key

    await t.app.inject({
      method: 'POST',
      url: `/api/v1/devices/${imported.id}/rotate-keys`,
      headers: { cookie },
    });
    const after = await t.app.inject({
      method: 'GET',
      url: `/api/v1/devices/${imported.id}/profile`,
      headers: { cookie },
    });
    expect(after.statusCode).toBe(200);
    expect(after.body).toContain('[Interface]');
  });

  it('rejects adopting a device that is not needs_review with 400', async () => {
    const created = await addDevice({ name: 'managed', kind: 'peer' });
    const id = created.json().device.id;
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/devices/${id}/adopt`,
      headers: { cookie },
      payload: { name: 'nope' },
    });
    expect(res.statusCode).toBe(400);
  });
});
