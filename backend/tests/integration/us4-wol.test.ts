import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestApp, setupAndLogin, type TestApp } from '../helpers/app.js';

/**
 * US4 integration (T054): wake precondition-failure explanations are testable
 * without a live controller (they fail before any SSH connect). The successful
 * dispatch path (controller emits the packet) is validated in the fixtured
 * Docker/CI environment.
 */
describe('US4: Wake-on-LAN preconditions (FR-016)', () => {
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

  const addDevice = (payload: Record<string, unknown>) =>
    t.app
      .inject({
        method: 'POST',
        url: `/api/v1/servers/${serverId}/devices`,
        headers: { cookie },
        payload,
      })
      .then((r) => r.json().device);

  const wake = (id: string) =>
    t.app.inject({ method: 'POST', url: `/api/v1/devices/${id}/wake`, headers: { cookie } });

  it('refuses to wake a device with no MAC address', async () => {
    const d = await addDevice({ name: 'nomac', kind: 'host' });
    const res = await wake(d.id);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/MAC/i);
  });

  it('refuses to wake a device not on a segment', async () => {
    const d = await addDevice({ name: 'nosegment', kind: 'host', macAddress: 'AA:BB:CC:DD:EE:FF' });
    const res = await wake(d.id);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/segment/i);
  });

  it('refuses to wake when the segment has no controller', async () => {
    const seg = await t.app.inject({
      method: 'POST',
      url: `/api/v1/servers/${serverId}/segments`,
      headers: { cookie },
      payload: { name: 'office' },
    });
    const segId = seg.json().segment.id;
    const d = await addDevice({
      name: 'target',
      kind: 'host',
      macAddress: 'AA:BB:CC:DD:EE:FF',
      segmentId: segId,
    });
    const res = await wake(d.id);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.message).toMatch(/controller/i);
  });

  it('groups devices by segment and labels the controller (FR-014b)', async () => {
    const seg = await t.app.inject({
      method: 'POST',
      url: `/api/v1/servers/${serverId}/segments`,
      headers: { cookie },
      payload: { name: 'office' },
    });
    const segId = seg.json().segment.id;
    const ctrl = await addDevice({ name: 'always-on', kind: 'host', segmentId: segId });
    await t.app.inject({
      method: 'PATCH',
      url: `/api/v1/segments/${segId}`,
      headers: { cookie },
      payload: { wakeControllerDeviceId: ctrl.id },
    });
    const list = await t.app.inject({
      method: 'GET',
      url: `/api/v1/servers/${serverId}/devices`,
      headers: { cookie },
    });
    const group = list.json().groups.find((g: { segment: { id: string } }) => g.segment.id === segId);
    expect(group.wakeControllerDeviceId).toBe(ctrl.id);
  });
});
