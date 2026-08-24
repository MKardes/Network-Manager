import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { errors } from '../errors.js';
import { requireAuthAndUnlocked } from '../middleware/guard.js';

/**
 * Active interactive-session routes (rest-api.md): list and force-close SSH/SFTP
 * sessions. Force-close discards the session's credentials (FR-013).
 */
export async function registerSessionRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const guard = { preHandler: requireAuthAndUnlocked(ctx) };

  app.get('/sessions', guard, async () => ({ sessions: ctx.registry.list() }));

  app.delete('/sessions/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ctx.registry.forceClose(id)) throw errors.notFound('Session not found');
    ctx.audit.record({
      actor: 'operator',
      action: 'session_force_close',
      targetType: 'session',
      targetId: id,
      outcome: 'success',
    });
    return reply.code(204).send();
  });
}
