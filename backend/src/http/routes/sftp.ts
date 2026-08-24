import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { errors } from '../errors.js';
import { requireAuthAndUnlocked } from '../middleware/guard.js';
import { SftpService } from '../../session/sftp.js';
import { HostKeyMismatchError } from '../../remote/runner.js';

/**
 * REST SFTP routes for browse + simple up/download (rest-api.md / FR-010).
 * Larger/streaming transfers use the WebSocket channel. A partial/failed
 * transfer surfaces as an error, never a success (US3 scenario 4).
 */
export async function registerSftpRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const guard = { preHandler: requireAuthAndUnlocked(ctx) };

  const sftpFor = (deviceId: string): SftpService => {
    const device = ctx.devices.get(deviceId);
    if (!device) throw errors.notFound('Device not found');
    if (!device.ssh_target_id) throw errors.precondition('Device has no SSH connection configured');
    const info = ctx.sshTargets.connectionInfo(device.ssh_target_id);
    if (!info) throw errors.precondition('SSH target missing');
    return new SftpService(info);
  };

  const mapError = (e: unknown): never => {
    if (e instanceof HostKeyMismatchError) {
      throw errors.conflict('host_key_mismatch', 'Host key does not match the recorded key');
    }
    throw errors.precondition('SFTP operation failed');
  };

  app.get('/sftp/:deviceId', guard, async (req) => {
    const { deviceId } = req.params as { deviceId: string };
    const { path } = z.object({ path: z.string().default('/') }).parse(req.query);
    try {
      return { path, entries: await sftpFor(deviceId).list(path) };
    } catch (e) {
      return mapError(e);
    }
  });

  app.get('/sftp/:deviceId/download', guard, async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string };
    const { path } = z.object({ path: z.string().min(1) }).parse(req.query);
    try {
      const data = await sftpFor(deviceId).download(path);
      ctx.audit.record({
        actor: 'operator',
        action: 'sftp_transfer',
        targetType: 'device',
        targetId: deviceId,
        outcome: 'success',
        detail: `download ${path} (${data.length} bytes)`,
      });
      reply.header('Content-Type', 'application/octet-stream');
      reply.header('Content-Disposition', `attachment; filename="${path.split('/').pop() ?? 'file'}"`);
      return reply.send(data);
    } catch (e) {
      ctx.audit.record({
        actor: 'operator',
        action: 'sftp_transfer',
        targetType: 'device',
        targetId: deviceId,
        outcome: 'failure',
        detail: `download ${path}`,
      });
      return mapError(e);
    }
  });

  app.post('/sftp/:deviceId/upload', guard, async (req, reply) => {
    const { deviceId } = req.params as { deviceId: string };
    const { path } = z.object({ path: z.string().min(1) }).parse(req.query);
    const mp = await req.file();
    if (!mp) throw errors.validation('Multipart file required');
    const data = await mp.toBuffer();
    try {
      await sftpFor(deviceId).upload(path, data);
      ctx.audit.record({
        actor: 'operator',
        action: 'sftp_transfer',
        targetType: 'device',
        targetId: deviceId,
        outcome: 'success',
        detail: `upload ${path} (${data.length} bytes)`,
      });
      return reply.code(201).send({ path, bytes: data.length });
    } catch (e) {
      ctx.audit.record({
        actor: 'operator',
        action: 'sftp_transfer',
        targetType: 'device',
        targetId: deviceId,
        outcome: 'failure',
        detail: `upload ${path}`,
      });
      return mapError(e);
    }
  });
}
