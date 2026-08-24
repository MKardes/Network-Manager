import Fastify, { type FastifyInstance, type FastifyBaseLogger } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import type { WebSocket } from 'ws';
import type { AppContext } from './context.js';
import { ApiError } from './errors.js';
import { isUnlocked } from '../crypto/vault.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerVaultRoutes } from './routes/vault.js';
import { registerSshTargetRoutes } from './routes/ssh-targets.js';
import { registerServerRoutes } from './routes/servers.js';
import { registerDeviceRoutes } from './routes/devices.js';
import { registerSegmentRoutes } from './routes/segments.js';
import { registerSessionRoutes } from './routes/sessions.js';
import { registerSftpRoutes } from './routes/sftp.js';
import { registerAuditRoutes } from './routes/audit.js';
import { handleSshWs } from '../session/ssh-ws.js';
import { handleSftpWs } from '../session/sftp-ws.js';
import type { SshConnectionInfo } from '../remote/runner.js';

const API_PREFIX = '/api/v1';

/**
 * Build the Fastify app: REST + WS registration, a global error handler that
 * never leaks secrets, and /healthz. All state flows through the AppContext.
 */
export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: ctx.log as unknown as FastifyBaseLogger,
    bodyLimit: 25 * 1024 * 1024,
  });

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: 100 * 1024 * 1024 } });
  await app.register(websocket);

  // Global error handler: map ApiError → { error: { code, message } }; never
  // surface internal details or secrets (FR-012/018).
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.statusCode).send({ error: { code: err.code, message: err.message } });
    }
    if (err.validation || err.name === 'ZodError') {
      return reply.code(400).send({ error: { code: 'validation_error', message: 'Invalid request' } });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: { code: 'internal_error', message: 'Internal error' } });
  });

  // Liveness (no auth, no secrets).
  app.get('/healthz', async () => ({ status: 'ok' }));

  // REST routes under /api/v1.
  await app.register(
    async (api) => {
      await registerAuthRoutes(api, ctx);
      await registerVaultRoutes(api, ctx);
      await registerSshTargetRoutes(api, ctx);
      await registerServerRoutes(api, ctx);
      await registerDeviceRoutes(api, ctx);
      await registerSegmentRoutes(api, ctx);
      await registerSessionRoutes(api, ctx);
      await registerSftpRoutes(api, ctx);
      await registerAuditRoutes(api, ctx);
    },
    { prefix: API_PREFIX },
  );

  // WebSocket channels. Auth + unlock are verified in-handler; a device must
  // have an SSH target to resolve a connection.
  await app.register(async (wsScope) => {
    const authorizeWs = (req: import('fastify').FastifyRequest): SshConnectionInfo | { error: number } => {
      const sid = req.cookies?.[ctx.config.sessionCookieName];
      const session = ctx.sessions.touch(sid);
      if (!session || session.authed !== 1 || !isUnlocked()) return { error: 4401 };
      const { deviceId } = req.params as { deviceId: string };
      const device = ctx.devices.get(deviceId);
      if (!device || !device.ssh_target_id) return { error: 4503 };
      const info = ctx.sshTargets.connectionInfo(device.ssh_target_id);
      if (!info) return { error: 4503 };
      return info;
    };

    wsScope.get('/ws/ssh/:deviceId', { websocket: true }, (socket: WebSocket, req) => {
      const { deviceId } = req.params as { deviceId: string };
      const auth = authorizeWs(req);
      if ('error' in auth) {
        socket.close(auth.error);
        return;
      }
      void handleSshWs(socket, deviceId, auth, ctx.registry, ctx.audit, (fp) => {
        const device = ctx.devices.get(deviceId);
        if (device?.ssh_target_id && !auth.knownHostKey) {
          ctx.sshTargets.recordHostKey(device.ssh_target_id, fp);
        }
      });
    });

    wsScope.get('/ws/sftp/:deviceId', { websocket: true }, (socket: WebSocket, req) => {
      const { deviceId } = req.params as { deviceId: string };
      const auth = authorizeWs(req);
      if ('error' in auth) {
        socket.close(auth.error);
        return;
      }
      void handleSftpWs(socket, deviceId, auth, ctx.registry, ctx.audit);
    });
  }, { prefix: API_PREFIX });

  return app;
}
