import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestApp, setupAndLogin, type TestApp } from '../helpers/app.js';

/**
 * Performance validation (T065) against the management-call target: interactive
 * management endpoints process in <300 ms (plan.md). SSH-command (<10 s, SC-003)
 * and wake (<5 s, SC-008) targets are validated in the fixtured environment.
 */
describe('performance: management calls <300ms', () => {
  let t: TestApp;
  let cookie: string;
  beforeEach(async () => {
    t = await makeTestApp();
    cookie = await setupAndLogin(t);
  });

  it('registers a server and lists devices well under budget', async () => {
    const s = await t.app.inject({
      method: 'POST',
      url: '/api/v1/servers',
      headers: { cookie },
      payload: { name: 's', location: 'local', addressRange: '10.0.0.0/24', listenEndpoint: 'e:51820' },
    });
    const serverId = s.json().server.id;
    // Add a handful of peers.
    for (let i = 0; i < 5; i++) {
      await t.app.inject({
        method: 'POST',
        url: `/api/v1/servers/${serverId}/devices`,
        headers: { cookie },
        payload: { name: `p${i}`, kind: 'peer' },
      });
    }
    const start = performance.now();
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/v1/servers/${serverId}/devices`,
      headers: { cookie },
    });
    const elapsed = performance.now() - start;
    expect(res.statusCode).toBe(200);
    expect(elapsed).toBeLessThan(300);
  });
});
