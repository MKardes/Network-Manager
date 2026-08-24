import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { requireAuthAndUnlocked } from '../middleware/guard.js';
import type { DeviceView } from '../../store/devices.js';

const createSchema = z.object({
  name: z.string().min(1).max(64),
  kind: z.enum(['peer', 'host']),
  segmentId: z.string().uuid().nullable().optional(),
  macAddress: z.string().nullable().optional(),
  sshTargetId: z.string().uuid().nullable().optional(),
});

/**
 * Device routes (rest-api.md). The list is grouped by LAN segment and each
 * segment notes its wake controller (FR-014b). Private keys are never returned;
 * profiles are downloaded via a dedicated endpoint.
 */
export async function registerDeviceRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const guard = { preHandler: requireAuthAndUnlocked(ctx) };

  // Grouped-by-segment device listing.
  app.get('/servers/:id/devices', guard, async (req) => {
    const { id } = req.params as { id: string };
    ctx.serverService.getView(id); // 404 if server missing
    const devices = ctx.deviceService.listByServer(id);
    const segments = ctx.segmentService.listByServer(id);

    const bySegment = new Map<string | null, DeviceView[]>();
    for (const d of devices) {
      const key = d.segmentId ?? null;
      if (!bySegment.has(key)) bySegment.set(key, []);
      bySegment.get(key)!.push(d);
    }
    const groups = segments.map((seg) => ({
      segment: seg,
      wakeControllerDeviceId: seg.wakeControllerDeviceId,
      devices: bySegment.get(seg.id) ?? [],
    }));
    const ungrouped = bySegment.get(null) ?? [];

    return { groups, ungrouped };
  });

  app.post('/servers/:id/devices', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = createSchema.parse(req.body);
    const device = await ctx.deviceService.add(id, body);
    return reply.code(201).send({ device });
  });

  app.get('/devices/:id', guard, async (req) => {
    const { id } = req.params as { id: string };
    return { device: ctx.deviceService.getView(id) };
  });

  app.patch('/devices/:id', guard, async (req) => {
    const { id } = req.params as { id: string };
    const body = createSchema.partial().parse(req.body);
    return { device: ctx.deviceService.update(id, body) };
  });

  app.delete('/devices/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    ctx.deviceService.remove(id);
    return reply.code(204).send();
  });

  app.post('/devices/:id/rotate-keys', guard, async (req) => {
    const { id } = req.params as { id: string };
    return { device: await ctx.deviceService.rotateKeys(id) };
  });

  app.get('/devices/:id/profile', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    const profile = ctx.deviceService.buildProfile(id);
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="wg-${id}.conf"`);
    return reply.send(profile);
  });

  // Wake via the device's segment controller (FR-015). Preconditions enforced
  // in the service; failures surface as 422 with an explanation (FR-016).
  app.post('/devices/:id/wake', guard, async (req) => {
    const { id } = req.params as { id: string };
    return ctx.wakeService.wake(id);
  });
}
