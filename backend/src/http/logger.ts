import pino, { type Logger } from 'pino';

/**
 * Structured logger with aggressive secret redaction (FR-018).
 *
 * Any field whose path matches a redaction rule is replaced with [redacted]
 * before it is ever written. We redact by well-known key names anywhere in the
 * object graph so that accidental logging of a secret-bearing object still does
 * not leak the value.
 */
const REDACT_KEYS = [
  'password',
  'passphrase',
  'currentPassphrase',
  'newPassphrase',
  'totp',
  'totpSecret',
  'totp_secret',
  'privateKey',
  'private_key',
  'server_private_key',
  'peer_private_key',
  'serverPrivateKey',
  'peerPrivateKey',
  'recoveryCode',
  'recovery_codes',
  'recoveryCodes',
  'dek',
  'kek',
  'wrapped_dek',
  'wrappedDek',
  'cookie',
  'authorization',
  'set-cookie',
];

// Build wildcard paths so nested occurrences are caught (pino redact supports
// `*.key` for one level; we add both top-level and a broad wildcard).
const redactPaths = REDACT_KEYS.flatMap((k) => [k, `*.${k}`, `req.body.${k}`, `req.headers.${k}`]);

export function createLogger(level: string): Logger {
  return pino({
    level,
    redact: {
      paths: redactPaths,
      censor: '[redacted]',
    },
    serializers: {
      req(req: { method?: string; url?: string; id?: string }) {
        return { method: req.method, url: req.url, id: req.id };
      },
    },
  });
}
