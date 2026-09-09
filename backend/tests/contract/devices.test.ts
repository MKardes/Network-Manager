import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestApp, setupAndLogin, type TestApp } from '../helpers/app.js';

/**
 * Contract tests for /devices (T030): peer key omission, address assignment,
 * profile download, and grouped-by-segment listing.
 */
describe('devices contract', () => {
  let t: TestApp;
  let cookie: string;
  let serverId: string;

  beforeEach(async () => {
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

  const addDevice = (payload: Record<string, unknown>) =>
    t.app.inject({
      method: 'POST',
      url: `/api/v1/servers/${serverId}/devices`,
      headers: { cookie },
      payload,
    });

  it('adds a peer with an assigned address and omits the private key', async () => {
    const res = await addDevice({ name: 'laptop', kind: 'peer' });
    expect(res.statusCode).toBe(201);
    const device = res.json().device;
    expect(device.tunnelAddress).toBe('10.0.0.2');
    expect(device.peerPublicKey).toBeTruthy();
    expect(device).not.toHaveProperty('peerPrivateKey');
    expect(JSON.stringify(res.json())).not.toContain('peer_private_key');
  });

  it('assigns unique sequential addresses to peers', async () => {
    const a = await addDevice({ name: 'a', kind: 'peer' });
    const b = await addDevice({ name: 'b', kind: 'peer' });
    expect(a.json().device.tunnelAddress).toBe('10.0.0.2');
    expect(b.json().device.tunnelAddress).toBe('10.0.0.3');
  });

  it('downloads a client profile for a peer', async () => {
    const dev = await addDevice({ name: 'laptop', kind: 'peer' });
    const id = dev.json().device.id;
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/devices/${id}/profile`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('[Interface]');
    expect(res.body).toContain('[Peer]');
    // Split tunnel: only the server's tunnel network, never all traffic.
    expect(res.body).toContain('AllowedIPs = 10.0.0.0/24');
    expect(res.body).not.toContain('0.0.0.0/0');
  });

  it('rotates peer keys, changing the public key', async () => {
    const dev = await addDevice({ name: 'laptop', kind: 'peer' });
    const id = dev.json().device.id;
    const before = dev.json().device.peerPublicKey;
    const res = await t.app.inject({
      method: 'POST',
      url: `/api/v1/devices/${id}/rotate-keys`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().device.peerPublicKey).not.toBe(before);
  });

  it('groups devices by segment in the listing', async () => {
    await addDevice({ name: 'host1', kind: 'host', macAddress: 'AA:BB:CC:DD:EE:FF' });
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/servers/${serverId}/devices`,
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty('groups');
    expect(body).toHaveProperty('ungrouped');
    expect(body.ungrouped).toHaveLength(1);
  });
});
