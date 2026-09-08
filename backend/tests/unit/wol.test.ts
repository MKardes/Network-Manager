import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openMemoryDb, type DB } from '../../src/store/db.js';
import { runMigrations } from '../../src/store/migrate.js';
import { ServerRepo } from '../../src/store/servers.js';
import { DeviceRepo } from '../../src/store/devices.js';
import { SshTargetRepo } from '../../src/store/ssh-targets.js';
import { AuditService } from '../../src/audit/audit.js';
import { SegmentService } from '../../src/devices/segments.js';
import { ReachabilityService } from '../../src/reachability/service.js';
import { WakeService } from '../../src/wol/service.js';
import { _resetForTests } from '../../src/crypto/vault.js';
import type { Runner } from '../../src/remote/runner.js';

const fakeSshTargets = {
  connectionInfo: () => ({ host: 'h', port: 22, username: 'u', privateKey: 'K', knownHostKey: null }),
} as unknown as SshTargetRepo;

const okRunner: Runner = {
  runVetted: async () => ({ code: 0, stdout: '', stderr: '' }),
  exec: async () => ({ code: 0, stdout: '', stderr: '' }),
  shell: async () => ({}) as never,
  sftp: async () => ({}) as never,
  end: () => undefined,
};

describe('WakeService (feature 003)', () => {
  let db: DB;
  let servers: ServerRepo;
  let devices: DeviceRepo;
  let segments: SegmentService;
  let audit: AuditService;
  let serverId: string;
  let segId: string;
  let controllerId: string;
  let pingQueue: boolean[];

  /** Reachability whose local ping returns the next queued value (default false). */
  const makeReachability = () =>
    new ReachabilityService(devices, servers, fakeSshTargets, audit, {
      localPing: async () => (pingQueue.length ? pingQueue.shift()! : false),
    });

  const makeWake = () =>
    new WakeService(devices, segments, fakeSshTargets, audit, makeReachability(), {
      connect: async () => okRunner,
      verifyAttempts: 3,
      verifyDelayMs: 1,
    });

  beforeEach(() => {
    _resetForTests();
    db = openMemoryDb();
    runMigrations(db);
    servers = new ServerRepo(db);
    devices = new DeviceRepo(db);
    audit = new AuditService(db);
    segments = new SegmentService(db, audit);
    pingQueue = [];

    // Dummy SSH target to satisfy the controller device FK (connect is faked).
    db.prepare(
      `INSERT INTO ssh_target (id, host, port, username, private_key, public_key)
       VALUES ('sshtgt', 'h', 22, 'u', 'x', 'y')`,
    ).run();

    serverId = randomUUID();
    db.prepare(
      `INSERT INTO wireguard_server
         (id, name, location, interface_name, address_range, listen_endpoint,
          server_private_key, server_public_key)
       VALUES (?, 'home', 'local', 'wg0', '10.0.0.0/24', 'e:51820', 'x', 'PUB')`,
    ).run(serverId);
    segId = segments.create(serverId, 'office', { broadcastAddress: '192.168.1.255', wolPort: 9 }).id;
    // An always-on controller with an SSH target (not the target itself).
    controllerId = devices.create({
      serverId,
      name: 'nas',
      kind: 'host',
      segmentId: segId,
      sshTargetId: 'sshtgt',
    }).id;
    segments.update(segId, { wakeControllerDeviceId: controllerId });
  });

  const target = () =>
    devices.create({
      serverId,
      name: 'pc',
      kind: 'peer',
      tunnelAddress: '10.0.0.2',
      macAddress: 'AA:BB:CC:DD:EE:FF',
      segmentId: segId,
    });

  it('reports already_reachable when the target is up before the packet', async () => {
    const dev = target();
    pingQueue = [true]; // pre-probe: already up
    const res = await makeWake().wake(dev.id);
    expect(res.result).toBe('already_reachable');
    expect(res.alreadyReachable).toBe(true);
    expect(res.controller).toBe('nas');
  });

  it('reports relayed when the target comes online within the window', async () => {
    const dev = target();
    pingQueue = [false, false, true]; // pre-probe down, then online on 2nd verify
    const res = await makeWake().wake(dev.id);
    expect(res.result).toBe('relayed');
    expect(res.alreadyReachable).toBe(false);
  });

  it('reports relayed_still_down when the target never comes online', async () => {
    const dev = target();
    pingQueue = [false, false, false, false]; // pre + all verify attempts down
    const res = await makeWake().wake(dev.id);
    expect(res.result).toBe('relayed_still_down');
  });

  it('refuses to wake a device that is its own controller (self-relay)', async () => {
    const dev = target();
    segments.update(segId, { wakeControllerDeviceId: dev.id });
    await expect(makeWake().wake(dev.id)).rejects.toMatchObject({ statusCode: 422 });
  });

  it('refuses to wake when two devices in the segment share the MAC (ambiguous)', async () => {
    const dev = target();
    devices.create({
      serverId,
      name: 'pc-dup',
      kind: 'peer',
      tunnelAddress: '10.0.0.3',
      macAddress: 'AA:BB:CC:DD:EE:FF',
      segmentId: segId,
    });
    await expect(makeWake().wake(dev.id)).rejects.toMatchObject({ statusCode: 409 });
  });
});
