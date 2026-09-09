import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { errors } from '../errors.js';
import { toView } from '../../store/ssh-targets.js';
import { connect, HostKeyMismatchError, SshAuthError } from '../../remote/runner.js';
import { resolveTargetConnection } from '../../remote/connection.js';
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
    // A target on a tunnel address is only reachable through its device's
    // WireGuard server, so the probe uses the same jump host a session would.
    const resolved = resolveTargetConnection(ctx.devices, ctx.servers, ctx.sshTargets, id);
    if (!resolved) throw errors.notFound('SSH target not found');
    const { info } = resolved;
    let captured: string | null = null;
    let jumpCaptured: string | null = null;
    try {
      // Force TOFU capture by clearing the known key for this probe.
      const runner = await connect(
        { ...info, knownHostKey: info.knownHostKey ?? null },
        {
          onFirstUse: (fp) => (captured = fp),
          onJumpFirstUse: (fp) => (jumpCaptured = fp),
        },
      );
      runner.end();
    } catch (e) {
      if (e instanceof HostKeyMismatchError) {
        throw errors.conflict('host_key_mismatch', 'Presented host key does not match the recorded key');
      }
      // The host key is presented before authentication, so a login failure
      // still yields a fingerprint worth recording — same as ssh writing
      // known_hosts before it gives up on auth.
      if (e instanceof SshAuthError) {
        if (captured) ctx.sshTargets.recordHostKey(id, captured);
        throw errors.precondition(
          `Recorded the host key for ${info.username}@${info.host}, but authentication failed. ` +
            `Install this target's public key in ${info.username}'s authorized_keys on the host.`,
        );
      }
      // Anything else (timeout, refused, no route, jump host unable to reach
      // the address) — say which, an opaque failure here is unactionable.
      const reason = e instanceof Error ? e.message : 'connection failed';
      const via = info.jump ? ` via ${info.jump.username}@${info.jump.host}` : '';
      throw errors.precondition(
        `Could not connect to ${info.username}@${info.host}:${info.port}${via} to record the host key: ${reason}`,
      );
    }
    if (captured) {
      ctx.sshTargets.recordHostKey(id, captured);
    }
    // The jump host is normally trusted already; record it if this was its first use.
    if (jumpCaptured && resolved.jumpTargetId) {
      ctx.sshTargets.recordHostKey(resolved.jumpTargetId, jumpCaptured);
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
