import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { requireAuthAndUnlocked } from '../middleware/guard.js';

const createSchema = z.object({
  name: z.string().min(1).max(64),
  location: z.enum(['local', 'remote']),
  addressRange: z.string().min(1),
  listenEndpoint: z.string().min(1),
  interfaceName: z.string().regex(/^[a-zA-Z0-9_-]{1,15}$/).optional(),
  sshTargetId: z.string().uuid().nullable().optional(),
});

/**
 * Server management routes (rest-api.md). Responses never include the server
 * private key. Address-range conflicts and missing ssh_target for remote servers
 * are rejected by the service layer (FR-007).
 */
export async function registerServerRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const guard = { preHandler: requireAuthAndUnlocked(ctx) };

  app.get('/servers', guard, async () => ({ servers: ctx.serverService.list() }));

  app.post('/servers', guard, async (req, reply) => {
    const body = createSchema.parse(req.body);
    const server = await ctx.serverService.create(body);
    return reply.code(201).send({ server });
  });

  app.get('/servers/:id', guard, async (req) => {
    const { id } = req.params as { id: string };
    return { server: ctx.serverService.getView(id) };
  });

  app.patch('/servers/:id', guard, async (req) => {
    const { id } = req.params as { id: string };
    const body = createSchema.partial().parse(req.body);
    return { server: ctx.serverService.update(id, body) };
  });

  app.delete('/servers/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    ctx.serverService.delete(id);
    return reply.code(204).send();
  });

  app.post('/servers/:id/apply', guard, async (req) => {
    const { id } = req.params as { id: string };
    return { server: await ctx.serverService.apply(id) };
  });

  app.get('/servers/:id/status', guard, async (req) => {
    const { id } = req.params as { id: string };
    return ctx.serverService.status(id);
  });

  // Reconciled peer view: imports unknown live peers, labels managed vs
  // needs-review, and flags discrepancies/out-of-range (feature 002, US1).
  app.get('/servers/:id/peers', guard, async (req) => {
    const { id } = req.params as { id: string };
    return ctx.peerService.reconcile(id);
  });
}
