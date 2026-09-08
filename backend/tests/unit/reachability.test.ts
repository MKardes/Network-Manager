import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openMemoryDb, type DB } from '../../src/store/db.js';
import { runMigrations } from '../../src/store/migrate.js';
import { ServerRepo } from '../../src/store/servers.js';
import { DeviceRepo } from '../../src/store/devices.js';
import { SshTargetRepo } from '../../src/store/ssh-targets.js';
import { AuditService } from '../../src/audit/audit.js';
import { _resetForTests } from '../../src/crypto/vault.js';
import { ReachabilityService } from '../../src/reachability/service.js';
import type { Runner } from '../../src/remote/runner.js';
import { ApiError } from '../../src/http/errors.js';

/** Minimal fake SSH target repo — avoids the vault/decrypt path in unit tests. */
const fakeSshTargets = {
  connectionInfo: () => ({
    host: 'h',
    port: 22,
    username: 'u',
    privateKey: 'KEY',
    knownHostKey: null,
  }),
} as unknown as SshTargetRepo;

/** A runner whose vetted `probe` returns the given exit code. */
function fakeRunner(code: number): Runner {
  return {
    runVetted: async () => ({ code, stdout: '', stderr: '' }),
    exec: async () => ({ code, stdout: '', stderr: '' }),
    shell: async () => ({}) as never,
    sftp: async () => ({}) as never,
    end: () => undefined,
  };
}

describe('ReachabilityService.test (feature 003)', () => {
  let db: DB;
  let servers: ServerRepo;
  let devices: DeviceRepo;
  let audit: AuditService;

  const insertServer = (location: 'local' | 'remote'): string => {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO wireguard_server
         (id, name, location, interface_name, address_range, listen_endpoint,
          server_private_key, server_public_key, ssh_target_id)
       VALUES (?, ?, ?, 'wg0', '10.0.0.0/24', 'e:51820', 'x', 'PUB', ?)`,
    ).run(id, `s-${id.slice(0, 4)}`, location, location === 'remote' ? 'sshtgt' : null);
    return id;
  };

  beforeEach(() => {
    _resetForTests();
    db = openMemoryDb();
    runMigrations(db);
    servers = new ServerRepo(db);
    devices = new DeviceRepo(db);
    audit = new AuditService(db);
    // Dummy SSH target to satisfy the FK on remote servers (connect is faked).
    db.prepare(
      `INSERT INTO ssh_target (id, host, port, username, private_key, public_key)
       VALUES ('sshtgt', 'h', 22, 'u', 'x', 'y')`,
    ).run();
  });

  it('probes a peer from its local server and records connected + latency', async () => {
    const serverId = insertServer('local');
    const dev = devices.create({ serverId, name: 'pc', kind: 'peer', tunnelAddress: '10.0.0.2' });
    const svc = new ReachabilityService(devices, servers, fakeSshTargets, audit, {
      localPing: async () => true,
    });

    const res = await svc.test(dev.id);
    expect(res.reachability).toBe('connected');
    expect(res.vantage).toBe('server');
    expect(res.latencyMs).not.toBeNull();
    expect(devices.get(dev.id)!.reachability).toBe('connected');
    expect(devices.get(dev.id)!.last_seen_at).toBe(res.testedAt);
  });

  it('records offline when the local ping fails', async () => {
    const serverId = insertServer('local');
    const dev = devices.create({ serverId, name: 'pc', kind: 'peer', tunnelAddress: '10.0.0.3' });
    const svc = new ReachabilityService(devices, servers, fakeSshTargets, audit, {
      localPing: async () => false,
    });

    const res = await svc.test(dev.id);
    expect(res.reachability).toBe('offline');
    expect(res.latencyMs).toBeNull();
    expect(devices.get(dev.id)!.reachability).toBe('offline');
  });

  it('probes a peer on a remote server via the injected SSH runner', async () => {
    const serverId = insertServer('remote');
    const dev = devices.create({ serverId, name: 'pc', kind: 'peer', tunnelAddress: '10.0.0.4' });
    const svc = new ReachabilityService(devices, servers, fakeSshTargets, audit, {
      connect: async () => fakeRunner(0),
    });

    const res = await svc.test(dev.id);
    expect(res.reachability).toBe('connected');
    expect(res.vantage).toBe('server');
  });

  it('rejects a device with no tunnel address to probe and leaves reachability unknown', async () => {
    const serverId = insertServer('local');
    const dev = devices.create({ serverId, name: 'nas', kind: 'host', macAddress: 'AA:BB:CC:DD:EE:FF' });
    const svc = new ReachabilityService(devices, servers, fakeSshTargets, audit);

    await expect(svc.test(dev.id)).rejects.toBeInstanceOf(ApiError);
    expect(devices.get(dev.id)!.reachability).toBe('unknown');
  });

  it('treats an unreachable vantage as not-live (unknown), not offline', async () => {
    const serverId = insertServer('remote');
    const dev = devices.create({ serverId, name: 'pc', kind: 'peer', tunnelAddress: '10.0.0.5' });
    const svc = new ReachabilityService(devices, servers, fakeSshTargets, audit, {
      connect: async () => {
        throw new Error('connection refused');
      },
    });

    await expect(svc.test(dev.id)).rejects.toMatchObject({ statusCode: 422 });
    expect(devices.get(dev.id)!.reachability).toBe('unknown');
  });
});
