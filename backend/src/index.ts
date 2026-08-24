import { loadConfig } from './config/index.js';
import { createLogger } from './http/logger.js';
import { openDb } from './store/db.js';
import { runMigrations } from './store/migrate.js';
import { buildContext } from './http/context.js';
import { buildApp } from './http/app.js';

/**
 * Backend entrypoint: load config (with bind-address enforcement), open the DB,
 * run migrations, wire the context, and start Fastify. The vault starts locked;
 * the operator must unlock it before any secret-dependent action (FR-018a).
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const log = createLogger(config.logLevel);

  const db = openDb(config.dataDir);
  const applied = runMigrations(db);
  if (applied.length) log.info({ applied }, 'applied migrations');

  const ctx = buildContext(db, config, log);
  const app = await buildApp(ctx);

  // Housekeeping: prune expired sessions + old audit events periodically.
  const housekeeping = setInterval(
    () => {
      try {
        ctx.sessions.purgeExpired();
        ctx.audit.prune();
      } catch (e) {
        log.warn({ err: e }, 'housekeeping failed');
      }
    },
    60 * 60 * 1000,
  );
  housekeeping.unref();

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down');
    ctx.registry.closeAll();
    await app.close();
    db.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.bindHost, port: config.port });
  log.info({ host: config.bindHost, port: config.port }, 'listening');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('fatal:', err instanceof Error ? err.message : err);
  process.exit(1);
});
