import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { errors } from '../errors.js';
import { toView } from '../../store/ssh-targets.js';
import { connect, HostKeyMismatchError } from '../../remote/runner.js';
import { requireAuthAndUnlocked } from '../middleware/guard.js';

const createSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().min(1),
});

/**
 * SSH target routes (FR-010a). Create returns the app-generated PUBLIC key to
 * install; the private key is never returned. `/trust` records the host key
 * (TOFU) on first connect.
 */
export async function registerSshTargetRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const guard = { preHandler: requireAuthAndUnlocked(ctx) };

  app.get('/ssh-targets', guard, async () => ({
    sshTargets: ctx.sshTargets.list().map(toView),
  }));

  app.post('/ssh-targets', guard, async (req, reply) => {
    const body = createSchema.parse(req.body);
    const row = ctx.sshTargets.create(body);
    ctx.audit.record({
      actor: 'operator',
      action: 'ssh_target_create',
      targetType: 'ssh_target',
      targetId: row.id,
      outcome: 'success',
    });
    // Include the public key so the operator can install it on the target.
    return reply.code(201).send({ sshTarget: toView(row), publicKey: row.public_key });
  });

  app.patch('/ssh-targets/:id', guard, async (req) => {
    const { id } = req.params as { id: string };
    const body = createSchema.partial().parse(req.body);
    const row = ctx.sshTargets.update(id, body);
    if (!row) throw errors.notFound('SSH target not found');
    return { sshTarget: toView(row) };
  });

  app.delete('/ssh-targets/:id', guard, async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!ctx.sshTargets.delete(id)) throw errors.notFound('SSH target not found');
    ctx.audit.record({
      actor: 'operator',
      action: 'ssh_target_delete',
      targetType: 'ssh_target',
      targetId: id,
      outcome: 'success',
    });
    return reply.code(204).send();
  });

  // Trust-on-first-use: connect, capture the presented host key, and record it.
  app.post('/ssh-targets/:id/trust', guard, async (req) => {
    const { id } = req.params as { id: string };
    const info = ctx.sshTargets.connectionInfo(id);
    if (!info) throw errors.notFound('SSH target not found');
    let captured: string | null = null;
    try {
      // Force TOFU capture by clearing the known key for this probe.
      const runner = await connect(
        { ...info, knownHostKey: info.knownHostKey ?? null },
        { onFirstUse: (fp) => (captured = fp) },
      );
      runner.end();
    } catch (e) {
      if (e instanceof HostKeyMismatchError) {
        throw errors.conflict('host_key_mismatch', 'Presented host key does not match the recorded key');
      }
      throw errors.precondition('Could not connect to record host key');
    }
    if (captured) {
      ctx.sshTargets.recordHostKey(id, captured);
    }
    ctx.audit.record({
      actor: 'operator',
      action: 'ssh_target_trust',
      targetType: 'ssh_target',
      targetId: id,
      outcome: 'success',
    });
    return { knownHostKey: captured ?? info.knownHostKey };
  });
}
