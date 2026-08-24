import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { errors } from '../errors.js';
import { verifyPassword } from '../../auth/auth.js';
import { initVault, isInitialized } from '../../crypto/vault.js';
import { verifyTotp, generateTotpSecret, totpProvisioningUri } from '../../auth/totp.js';
import { generateRecoveryCodes, consumeRecoveryCode } from '../../auth/recovery-codes.js';
import { requireAuth } from '../middleware/guard.js';

const setupSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(8).max(256),
  passphrase: z.string().min(8).max(256),
});

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
  totp: z.string().optional(),
});

/**
 * Auth lifecycle routes (rest-api.md): setup, login, logout, 2FA enable/verify/
 * disable. Login enforces lockout/backoff (FR-021) and TOTP when enabled.
 */
export async function registerAuthRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  const cookieName = ctx.config.sessionCookieName;
  const cookieOpts = {
    httpOnly: true,
    secure: true,
    sameSite: 'strict' as const,
    path: '/',
  };

  // First-run: create the single operator + initialize the vault (FR-019/018).
  app.post('/auth/setup', async (req, reply) => {
    if (ctx.operators.exists() || isInitialized(ctx.db)) {
      throw errors.conflict('already_initialized', 'Already set up');
    }
    const body = setupSchema.parse(req.body);
    // Initialize the vault first so the operator can be created while unlocked.
    await initVault(ctx.db, body.passphrase);
    await ctx.operators.create(body.username, body.password);
    ctx.audit.record({ actor: body.username, action: 'setup', outcome: 'success' });
    const sid = ctx.sessions.create(true);
    reply.setCookie(cookieName, sid, cookieOpts);
    return reply.code(201).send({ user: { username: body.username } });
  });

  // Login: password (+ TOTP if enabled). Lockout on repeated failure.
  app.post('/auth/login', async (req, reply) => {
    const body = loginSchema.parse(req.body);
    const status = ctx.lockout.status();
    if (status.locked) {
      throw errors.lockedOut();
    }
    const op = ctx.operators.get();
    if (!op || op.username !== body.username) {
      ctx.lockout.recordFailure();
      ctx.audit.record({ actor: body.username, action: 'login', outcome: 'failure' });
      throw errors.unauthorized('Invalid credentials');
    }
    const ok = await verifyPassword(op.password_hash, body.password);
    if (!ok) {
      ctx.lockout.recordFailure();
      ctx.audit.record({ actor: body.username, action: 'login', outcome: 'failure' });
      throw errors.unauthorized('Invalid credentials');
    }
    // TOTP second factor (only if the vault is unlocked can we read the secret;
    // a recovery code also satisfies 2FA once).
    if (op.totp_enabled) {
      const token = body.totp?.trim();
      if (!token) throw errors.unauthorized('TOTP code required');
      const secret = ctx.operators.getTotpSecret();
      let second = secret ? verifyTotp(token, secret) : false;
      if (!second) {
        const codes = ctx.operators.getRecoveryCodes();
        if (codes) {
          const updated = consumeRecoveryCode(codes, token);
          if (updated) {
            ctx.operators.setRecoveryCodes(updated);
            second = true;
            ctx.audit.record({ actor: op.username, action: 'recovery_used', outcome: 'success' });
          }
        }
      }
      if (!second) {
        ctx.lockout.recordFailure();
        ctx.audit.record({ actor: op.username, action: 'login', outcome: 'failure', detail: 'bad_totp' });
        throw errors.unauthorized('Invalid TOTP code');
      }
    }
    ctx.lockout.reset();
    const sid = ctx.sessions.create(true);
    reply.setCookie(cookieName, sid, cookieOpts);
    ctx.audit.record({ actor: op.username, action: 'login', outcome: 'success' });
    return reply.send({ user: { username: op.username } });
  });

  app.post('/auth/logout', { preHandler: requireAuth(ctx) }, async (req, reply) => {
    const sid = (req as typeof req & { sessionId?: string }).sessionId;
    if (sid) ctx.sessions.destroy(sid);
    reply.clearCookie(cookieName, { path: '/' });
    ctx.audit.record({ actor: 'operator', action: 'logout', outcome: 'success' });
    return reply.send({ ok: true });
  });

  // Begin TOTP enrollment → provisioning URI + one-time recovery codes.
  app.post('/auth/2fa/enable', { preHandler: requireAuth(ctx) }, async (_req, reply) => {
    const op = ctx.operators.get();
    if (!op) throw errors.notFound('Operator not found');
    const secret = generateTotpSecret();
    const { plaintext, stored } = generateRecoveryCodes();
    // Store secret + codes now; activation is confirmed by /2fa/verify.
    ctx.operators.enableTotp(secret, stored);
    // Keep totp_enabled off until verified: re-disable the flag, keep the secret.
    ctx.db.prepare('UPDATE operator SET totp_enabled = 0 WHERE id = 1').run();
    return reply.send({
      provisioningUri: totpProvisioningUri(op.username, secret),
      recoveryCodes: plaintext,
    });
  });

  app.post('/auth/2fa/verify', { preHandler: requireAuth(ctx) }, async (req, reply) => {
    const token = z.object({ totp: z.string() }).parse(req.body).totp;
    const secret = ctx.operators.getTotpSecret();
    if (!secret || !verifyTotp(token, secret)) {
      throw errors.unauthorized('Invalid TOTP code');
    }
    ctx.db.prepare('UPDATE operator SET totp_enabled = 1 WHERE id = 1').run();
    ctx.audit.record({ actor: 'operator', action: '2fa_enable', outcome: 'success' });
    return reply.send({ enabled: true });
  });

  app.post('/auth/2fa/disable', { preHandler: requireAuth(ctx) }, async (req, reply) => {
    const body = z.object({ password: z.string() }).parse(req.body);
    const op = ctx.operators.get();
    if (!op || !(await verifyPassword(op.password_hash, body.password))) {
      throw errors.unauthorized('Re-authentication required');
    }
    ctx.operators.disableTotp();
    ctx.audit.record({ actor: 'operator', action: '2fa_disable', outcome: 'success' });
    return reply.send({ enabled: false });
  });
}
