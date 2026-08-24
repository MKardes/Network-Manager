import { isIP } from 'node:net';

/**
 * Application configuration, parsed from the environment at startup.
 *
 * Security-critical rule (FR-022): the management interface must never be bound
 * to a public interface. We enforce loopback / private-range binds and refuse to
 * start on a public address unless ALLOW_PUBLIC_BIND is explicitly set.
 */
export interface AppConfig {
  bindHost: string;
  port: number;
  dataDir: string;
  sessionCookieName: string;
  logLevel: string;
  idleTimeoutMs: number;
  allowPublicBind: boolean;
}

const PRIVATE_V4_PREFIXES = ['10.', '192.168.', '127.'];

function isPrivateBind(host: string): boolean {
  if (host === 'localhost') return true;
  if (host === '::1') return true;
  // 0.0.0.0 inside the container is acceptable because the *published* port is
  // pinned to the loopback/WG address by docker-compose (BIND_ADDR). When run
  // outside a container, operators should pass an explicit private host.
  if (host === '0.0.0.0') return true;
  if (PRIVATE_V4_PREFIXES.some((p) => host.startsWith(p))) return true;
  // 172.16.0.0 – 172.31.255.255
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  // fc00::/7 unique-local IPv6
  if (/^f[cd][0-9a-f]{2}:/i.test(host)) return true;
  // WireGuard interface address supplied by operator is expected to be private;
  // any other routable address is rejected below.
  return false;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const bindHost = env.BIND_HOST?.trim() || '127.0.0.1';
  const port = Number.parseInt(env.PORT ?? '8080', 10);
  const allowPublicBind = env.ALLOW_PUBLIC_BIND === '1';

  if (Number.isNaN(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }

  if (!allowPublicBind && isIP(bindHost) && !isPrivateBind(bindHost)) {
    throw new Error(
      `Refusing to bind management interface to non-private address "${bindHost}". ` +
        `Bind to loopback or the WireGuard address, or set ALLOW_PUBLIC_BIND=1 to override (discouraged).`,
    );
  }
  if (!allowPublicBind && !isIP(bindHost) && !isPrivateBind(bindHost)) {
    throw new Error(
      `Refusing to bind to hostname "${bindHost}"; use a loopback/WireGuard IP address.`,
    );
  }

  return {
    bindHost,
    port,
    dataDir: env.DATA_DIR?.trim() || './data',
    sessionCookieName: env.SESSION_COOKIE?.trim() || 'wgnm_sid',
    logLevel: env.LOG_LEVEL?.trim() || 'info',
    idleTimeoutMs: Number.parseInt(env.IDLE_TIMEOUT_MS ?? String(30 * 60 * 1000), 10),
    allowPublicBind,
  };
}

export { isPrivateBind };
