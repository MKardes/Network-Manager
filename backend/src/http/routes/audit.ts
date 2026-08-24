import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { requireAuthAndUnlocked } from '../middleware/guard.js';

/**
 * Audit query route (rest-api.md / FR-020): filter by action/date/target and
 * paginate. Events never contain secret values.
 */
export async function registerAuditRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const guard = { preHandler: requireAuthAndUnlocked(ctx) };

  const querySchema = z.object({
    action: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    targetId: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  });

  app.get('/audit', guard, async (req) => {
    const q = querySchema.parse(req.query);
    return ctx.audit.query(q);
  });
}
