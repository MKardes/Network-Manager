import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { errors } from '../errors.js';
import { unlock, lock, isUnlocked, isInitialized, changePassphrase } from '../../crypto/vault.js';
import { requireAuth } from '../middleware/guard.js';

/**
 * Vault lifecycle routes (rest-api.md): status (safe), unlock, lock, and change
 * passphrase. The vault must be unlocked after each restart before any
 * secret-dependent action (FR-018a).
 */
export async function registerVaultRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  // Unauthenticated-safe status for the SPA to route setup/login/unlock.
  app.get('/vault/status', async () => {
    return {
      initialized: isInitialized(ctx.db),
      unlocked: isUnlocked(),
      operatorExists: ctx.operators.exists(),
      totpEnabled: ctx.operators.isTotpEnabled(),
    };
  });

  app.post('/vault/unlock', { preHandler: requireAuth(ctx) }, async (req, reply) => {
    const body = z.object({ passphrase: z.string().min(1) }).parse(req.body);
    if (!isInitialized(ctx.db)) throw errors.precondition('Vault not initialized');
    const ok = await unlock(ctx.db, body.passphrase);
    if (!ok) {
      ctx.audit.record({ actor: 'operator', action: 'unlock', outcome: 'failure' });
      throw errors.unauthorized('Incorrect master passphrase');
    }
    ctx.audit.record({ actor: 'operator', action: 'unlock', outcome: 'success' });
    return reply.send({ unlocked: true });
  });

  app.post('/vault/lock', { preHandler: requireAuth(ctx) }, async (_req, reply) => {
    lock();
    ctx.audit.record({ actor: 'operator', action: 'lock', outcome: 'success' });
    return reply.send({ unlocked: false });
  });

  app.post('/auth/passphrase', { preHandler: requireAuth(ctx) }, async (req, reply) => {
    const body = z
      .object({ currentPassphrase: z.string().min(1), newPassphrase: z.string().min(8).max(256) })
      .parse(req.body);
    const ok = await changePassphrase(ctx.db, body.currentPassphrase, body.newPassphrase);
    if (!ok) {
      ctx.audit.record({ actor: 'operator', action: 'passphrase_change', outcome: 'failure' });
      throw errors.unauthorized('Current passphrase is incorrect');
    }
    ctx.audit.record({ actor: 'operator', action: 'passphrase_change', outcome: 'success' });
    return reply.send({ ok: true });
  });
}
