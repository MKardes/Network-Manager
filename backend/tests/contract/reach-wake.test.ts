import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestApp, setupAndLogin, type TestApp } from '../helpers/app.js';

/**
 * Feature 003 contract tests. These exercise only paths that resolve before any
 * real SSH connect or ICMP ping (validation, preconditions, and the pre-dispatch
 * wake guards), so they run hermetically. The successful probe/dispatch paths are
 * covered by unit tests with injected runners and by the fixtured environment.
 */
describe('feature 003: reach & wake contract', () => {
  let t: TestApp;
  let cookie: string;
  let serverId: string;

  beforeEach(async () => {
    t = await makeTestApp();
    cookie = await setupAndLogin(t);
    const s = await t.app.inject({
      method: 'POST',
      url: '/api/v1/servers',
      headers: { cookie },
      payload: { name: 's', location: 'local', addressRange: '10.0.0.0/24', listenEndpoint: 'e:51820' },
    });
    serverId = s.json().server.id;
  });

  const post = (url: string, payload?: Record<string, unknown>) =>
    t.app.inject({ method: 'POST', url: `/api/v1${url}`, headers: { cookie }, payload });
  const patch = (url: string, payload: Record<string, unknown>) =>
    t.app.inject({ method: 'PATCH', url: `/api/v1${url}`, headers: { cookie }, payload });
  const addDevice = (payload: Record<string, unknown>) =>
    post(`/servers/${serverId}/devices`, payload).then((r) => r.json().device);

  describe('segment WoL targeting (US2 data foundation)', () => {
    it('accepts and echoes broadcastAddress + wolPort', async () => {
      const res = await post(`/servers/${serverId}/segments`, {
        name: 'office',
        broadcastAddress: '192.168.1.255',
        wolPort: 9,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json().segment).toMatchObject({ broadcastAddress: '192.168.1.255', wolPort: 9 });
    });

    it('rejects a malformed broadcast address', async () => {
      const res = await post(`/servers/${serverId}/segments`, { name: 'x', broadcastAddress: 'nope' });
      expect(res.statusCode).toBe(400);
    });

    it('rejects an out-of-range WoL port', async () => {
      const seg = await post(`/servers/${serverId}/segments`, { name: 'y' });
      const res = await patch(`/segments/${seg.json().segment.id}`, { wolPort: 70000 });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('connectivity test (US1)', () => {
    it('returns 404 for an unknown device', async () => {
      const res = await post(`/devices/00000000-0000-0000-0000-000000000000/test`);
      expect(res.statusCode).toBe(404);
    });

    it('returns 422 for a device with no tunnel address to probe', async () => {
      const d = await addDevice({ name: 'nas', kind: 'host', macAddress: 'AA:BB:CC:DD:EE:FF' });
      const res = await post(`/devices/${d.id}/test`);
      expect(res.statusCode).toBe(422);
    });
  });

  describe('wake guards (US2)', () => {
    it('returns 409 when two devices in a segment share the MAC', async () => {
      const seg = (await post(`/servers/${serverId}/segments`, { name: 'office' })).json().segment;
      const mac = 'AA:BB:CC:DD:EE:FF';
      const a = await addDevice({ name: 'pc-a', kind: 'peer', tunnelAddress: '10.0.0.2', macAddress: mac, segmentId: seg.id });
      await addDevice({ name: 'pc-b', kind: 'peer', tunnelAddress: '10.0.0.3', macAddress: mac, segmentId: seg.id });
      const res = await post(`/devices/${a.id}/wake`);
      expect(res.statusCode).toBe(409);
      expect(res.json().error.message).toMatch(/MAC/i);
    });

    it('returns 422 when a device is set as its own wake controller (self-relay)', async () => {
      const seg = (await post(`/servers/${serverId}/segments`, { name: 'office' })).json().segment;
      const d = await addDevice({ name: 'pc', kind: 'peer', tunnelAddress: '10.0.0.2', macAddress: 'AA:BB:CC:DD:EE:FF', segmentId: seg.id });
      await patch(`/segments/${seg.id}`, { wakeControllerDeviceId: d.id });
      const res = await post(`/devices/${d.id}/wake`);
      expect(res.statusCode).toBe(422);
      expect(res.json().error.message).toMatch(/itself/i);
    });
  });

  describe('interactive session preconditions (US3, existing behavior)', () => {
    it('offers no SFTP for a device without an SSH connection', async () => {
      const d = await addDevice({ name: 'pc', kind: 'peer', tunnelAddress: '10.0.0.2' });
      const res = await t.app.inject({
        method: 'GET',
        url: `/api/v1/sftp/${d.id}?path=/`,
        headers: { cookie },
      });
      expect(res.statusCode).toBe(422);
    });

    it('lists no active sessions and 404s a force-close of an unknown session', async () => {
      const list = await t.app.inject({ method: 'GET', url: '/api/v1/sessions', headers: { cookie } });
      expect(list.json().sessions).toEqual([]);
      const close = await t.app.inject({ method: 'DELETE', url: '/api/v1/sessions/nope', headers: { cookie } });
      expect(close.statusCode).toBe(404);
    });
  });
});
