import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { requireAuthAndUnlocked } from '../middleware/guard.js';

/**
 * LAN segment routes (rest-api.md / FR-014a). Setting the wake controller is a
 * PATCH on the segment.
 */
export async function registerSegmentRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const guard = { preHandler: requireAuthAndUnlocked(ctx) };

  app.get('/servers/:id/segments', guard, async (req) => {
    const { id } = req.params as { id: string };
    return { segments: ctx.segmentService.listByServer(id) };
  });

  app.post('/servers/:id/segments', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        name: z.string().min(1).max(64),
        broadcastAddress: z.string().nullable().optional(),
        wolPort: z.number().int().min(1).max(65535).nullable().optional(),
      })
      .parse(req.body);
    const segment = ctx.segmentService.create(id, body.name, {
      broadcastAddress: body.broadcastAddress,
      wolPort: body.wolPort,
    });
    return reply.code(201).send({ segment });
  });

  app.patch('/segments/:id', guard, async (req) => {
    const { id } = req.params as { id: string };
    const body = z
      .object({
        name: z.string().min(1).max(64).optional(),
        wakeControllerDeviceId: z.string().uuid().nullable().optional(),
        broadcastAddress: z.string().nullable().optional(),
        wolPort: z.number().int().min(1).max(65535).nullable().optional(),
      })
      .parse(req.body);
    return { segment: ctx.segmentService.update(id, body) };
  });

  app.delete('/segments/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    ctx.segmentService.delete(id);
    return reply.code(204).send();
  });
}
