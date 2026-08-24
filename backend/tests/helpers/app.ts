import { openMemoryDb } from '../../src/store/db.js';
import { runMigrations } from '../../src/store/migrate.js';
import { buildContext } from '../../src/http/context.js';
import { buildApp } from '../../src/http/app.js';
import { createLogger } from '../../src/http/logger.js';
import { loadConfig } from '../../src/config/index.js';
import { _resetForTests } from '../../src/crypto/vault.js';
import type { FastifyInstance } from 'fastify';

export interface TestApp {
  app: FastifyInstance;
  db: ReturnType<typeof openMemoryDb>;
  cookie?: string;
}

/** Build an app backed by an in-memory DB for contract/integration tests. */
export async function makeTestApp(): Promise<TestApp> {
  _resetForTests();
  const db = openMemoryDb();
  runMigrations(db);
  const config = loadConfig({ ...process.env, DATA_DIR: '/tmp/wgnm-test', LOG_LEVEL: 'silent' });
  const ctx = buildContext(db, config, createLogger('silent'));
  const app = await buildApp(ctx);
  await app.ready();
  return { app, db };
}

/** Run first-run setup + login, returning the session cookie. */
export async function setupAndLogin(t: TestApp): Promise<string> {
  const res = await t.app.inject({
    method: 'POST',
    url: '/api/v1/auth/setup',
    payload: { username: 'admin', password: 'password123', passphrase: 'master-pass-1' },
  });
  const cookie = res.cookies[0];
  t.cookie = `${cookie.name}=${cookie.value}`;
  return t.cookie;
}
