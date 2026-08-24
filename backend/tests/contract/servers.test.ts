import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestApp, setupAndLogin, type TestApp } from '../helpers/app.js';

/**
 * Contract tests for /servers (T030): private-key omission and address-conflict
 * rejection.
 */
describe('servers contract', () => {
  let t: TestApp;
  let cookie: string;
  beforeEach(async () => {
    t = await makeTestApp();
    cookie = await setupAndLogin(t);
  });

  const create = (payload: Record<string, unknown>) =>
    t.app.inject({ method: 'POST', url: '/api/v1/servers', headers: { cookie }, payload });

  it('registers a local server and never returns the private key', async () => {
    const res = await create({
      name: 'home',
      location: 'local',
      addressRange: '10.0.0.0/24',
      listenEndpoint: 'vpn.example.com:51820',
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.server.serverPublicKey).toBeTruthy();
    expect(JSON.stringify(body)).not.toContain('server_private_key');
    expect(body.server).not.toHaveProperty('serverPrivateKey');
  });

  it('rejects an overlapping address range (FR-007)', async () => {
    await create({
      name: 'a',
      location: 'local',
      addressRange: '10.0.0.0/24',
      listenEndpoint: 'a:51820',
    });
    const res = await create({
      name: 'b',
      location: 'local',
      addressRange: '10.0.0.128/25',
      listenEndpoint: 'b:51820',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('address_conflict');
  });

  it('rejects a remote server without an ssh_target', async () => {
    const res = await create({
      name: 'remote1',
      location: 'remote',
      addressRange: '10.1.0.0/24',
      listenEndpoint: 'r:51820',
    });
    expect(res.statusCode).toBe(400);
  });
});
