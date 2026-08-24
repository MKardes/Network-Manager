import type { FastifyReply, FastifyRequest } from 'fastify';
import type { AppContext } from '../context.js';
import { isUnlocked } from '../../crypto/vault.js';
import { errors } from '../errors.js';

/**
 * Auth + vault gate (rest-api.md): every /api/v1 route except the auth/vault
 * lifecycle endpoints requires an authenticated, non-idle session AND an
 * unlocked vault. The session cookie carries only an opaque id.
 */

export function requireAuth(ctx: AppContext) {
  return async (req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const sid = req.cookies?.[ctx.config.sessionCookieName];
    const session = ctx.sessions.touch(sid);
    if (!session || session.authed !== 1) {
      throw errors.unauthorized();
    }
    (req as FastifyRequest & { sessionId?: string }).sessionId = session.id;
  };
}

export function requireUnlocked() {
  return async (_req: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!isUnlocked()) {
      throw errors.vaultLocked();
    }
  };
}

/** Combined guard used by all protected routes. */
export function requireAuthAndUnlocked(ctx: AppContext) {
  const auth = requireAuth(ctx);
  const unlocked = requireUnlocked();
  return async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    await auth(req, reply);
    await unlocked(req, reply);
  };
}
