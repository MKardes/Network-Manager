import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestApp, setupAndLogin, type TestApp } from '../helpers/app.js';

/**
 * Contract tests for auth/vault endpoints (T027). Validates the setup → login →
 * unlock lifecycle and the auth/unlock gate on protected routes.
 */
describe('auth & vault contract', () => {
  let t: TestApp;
  beforeEach(async () => {
    t = await makeTestApp();
  });

  it('reports uninitialized status before setup', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/vault/status' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ initialized: false, operatorExists: false });
  });

  it('completes first-run setup and issues a session', async () => {
    const cookie = await setupAndLogin(t);
    expect(cookie).toContain('=');
    const status = await t.app.inject({ method: 'GET', url: '/api/v1/vault/status' });
    expect(status.json()).toMatchObject({ operatorExists: true, unlocked: true });
  });

  it('rejects a second setup attempt', async () => {
    await setupAndLogin(t);
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/setup',
      payload: { username: 'x', password: 'password123', passphrase: 'master-pass-1' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('blocks protected routes without a session', async () => {
    await setupAndLogin(t);
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/servers' });
    expect(res.statusCode).toBe(401);
  });

  it('blocks protected routes when the vault is locked', async () => {
    const cookie = await setupAndLogin(t);
    await t.app.inject({ method: 'POST', url: '/api/v1/vault/lock', headers: { cookie } });
    const res = await t.app.inject({ method: 'GET', url: '/api/v1/servers', headers: { cookie } });
    expect(res.statusCode).toBe(423);
  });

  it('unlocks with the correct passphrase and rejects the wrong one', async () => {
    const cookie = await setupAndLogin(t);
    await t.app.inject({ method: 'POST', url: '/api/v1/vault/lock', headers: { cookie } });
    const bad = await t.app.inject({
      method: 'POST',
      url: '/api/v1/vault/unlock',
      headers: { cookie },
      payload: { passphrase: 'wrong' },
    });
    expect(bad.statusCode).toBe(401);
    const good = await t.app.inject({
      method: 'POST',
      url: '/api/v1/vault/unlock',
      headers: { cookie },
      payload: { passphrase: 'master-pass-1' },
    });
    expect(good.statusCode).toBe(200);
  });

  it('locks the account after repeated bad logins (FR-021)', async () => {
    await setupAndLogin(t);
    for (let i = 0; i < 5; i++) {
      await t.app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { username: 'admin', password: 'nope' },
      });
    }
    const res = await t.app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { username: 'admin', password: 'password123' },
    });
    expect(res.statusCode).toBe(423);
    expect(res.json().error.code).toBe('locked_out');
  });
});
