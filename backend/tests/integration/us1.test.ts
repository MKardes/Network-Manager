import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestApp, setupAndLogin, type TestApp } from '../helpers/app.js';

/**
 * US1 integration (T031): register server → add peers → profile → rotate →
 * revoke, verified through the REST surface with a real (in-memory) store.
 * The actual `wg` apply is exercised in the Docker/CI environment; here we
 * validate the full management flow and credential-invalidation semantics.
 */
describe('US1: manage servers and devices', () => {
  let t: TestApp;
  let cookie: string;

  beforeEach(async () => {
    t = await makeTestApp();
    cookie = await setupAndLogin(t);
  });

  it('runs the full lifecycle: register, add peers, rotate, revoke', async () => {
    // Register two servers with non-overlapping ranges.
    const s1 = await t.app.inject({
      method: 'POST',
      url: '/api/v1/servers',
      headers: { cookie },
      payload: { name: 's1', location: 'local', addressRange: '10.0.0.0/24', listenEndpoint: 'e1:51820' },
    });
    const s2 = await t.app.inject({
      method: 'POST',
      url: '/api/v1/servers',
      headers: { cookie },
      payload: { name: 's2', location: 'local', addressRange: '10.1.0.0/24', listenEndpoint: 'e2:51820' },
    });
    expect(s1.statusCode).toBe(201);
    expect(s2.statusCode).toBe(201);
    const server1 = s1.json().server.id;

    // Add two peers to s1.
    const p1 = await t.app.inject({
      method: 'POST',
      url: `/api/v1/servers/${server1}/devices`,
      headers: { cookie },
      payload: { name: 'peerA', kind: 'peer' },
    });
    const p2 = await t.app.inject({
      method: 'POST',
      url: `/api/v1/servers/${server1}/devices`,
      headers: { cookie },
      payload: { name: 'peerB', kind: 'peer' },
    });
    expect(p1.json().device.tunnelAddress).toBe('10.0.0.2');
    expect(p2.json().device.tunnelAddress).toBe('10.0.0.3');

    // Download both profiles.
    for (const p of [p1, p2]) {
      const prof = await t.app.inject({
        method: 'GET',
        url: `/api/v1/devices/${p.json().device.id}/profile`,
        headers: { cookie },
      });
      expect(prof.body).toContain('PrivateKey =');
    }

    // Rotate peerA's keys → public key changes (old credentials invalidated).
    const oldPub = p1.json().device.peerPublicKey;
    const rot = await t.app.inject({
      method: 'POST',
      url: `/api/v1/devices/${p1.json().device.id}/rotate-keys`,
      headers: { cookie },
    });
    expect(rot.json().device.peerPublicKey).not.toBe(oldPub);

    // Revoke peerB → gone from the listing.
    const del = await t.app.inject({
      method: 'DELETE',
      url: `/api/v1/devices/${p2.json().device.id}`,
      headers: { cookie },
    });
    expect(del.statusCode).toBe(204);

    const list = await t.app.inject({
      method: 'GET',
      url: `/api/v1/servers/${server1}/devices`,
      headers: { cookie },
    });
    const all = [...list.json().ungrouped];
    expect(all.map((d: { name: string }) => d.name)).toEqual(['peerA']);
  });

  it('records audit events for server/device actions (FR-020)', async () => {
    await t.app.inject({
      method: 'POST',
      url: '/api/v1/servers',
      headers: { cookie },
      payload: { name: 's', location: 'local', addressRange: '10.2.0.0/24', listenEndpoint: 'e:51820' },
    });
    const audit = await t.app.inject({ method: 'GET', url: '/api/v1/audit', headers: { cookie } });
    const actions = audit.json().events.map((e: { action: string }) => e.action);
    expect(actions).toContain('server_create');
    // No secret material appears in any audit detail.
    expect(JSON.stringify(audit.json())).not.toMatch(/PrivateKey|BEGIN OPENSSH/);
  });
});
