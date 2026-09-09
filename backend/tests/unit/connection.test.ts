import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { openMemoryDb, type DB } from '../../src/store/db.js';
import { runMigrations } from '../../src/store/migrate.js';
import { ServerRepo } from '../../src/store/servers.js';
import { DeviceRepo } from '../../src/store/devices.js';
import { SshTargetRepo } from '../../src/store/ssh-targets.js';
import { initVault, _resetForTests } from '../../src/crypto/vault.js';
import {
  resolveDeviceConnection,
  resolveTargetConnection,
} from '../../src/remote/connection.js';

/**
 * A peer's SSH address is on the tunnel network, which the app's host cannot
 * route; the WireGuard server is the only node on both sides. These cover which
 * connections get routed through it and which are dialled directly.
 */
describe('SSH connection resolution (jump host)', () => {
  let db: DB;
  let servers: ServerRepo;
  let devices: DeviceRepo;
  let sshTargets: SshTargetRepo;

  beforeAll(async () => {
    _resetForTests();
    db = openMemoryDb();
    runMigrations(db);
    await initVault(db, 'test-passphrase');
  });

  beforeEach(() => {
    db.exec('DELETE FROM device; DELETE FROM wireguard_server; DELETE FROM ssh_target;');
    servers = new ServerRepo(db);
    devices = new DeviceRepo(db);
    sshTargets = new SshTargetRepo(db);
  });

  const remoteServer = (serverTargetId: string | null) =>
    servers.create({
      name: 'wg',
      location: 'remote',
      interfaceName: 'wg0',
      addressRange: '10.0.0.0/24',
      listenEndpoint: 'vpn.example.com:51820',
      serverPrivateKey: 'SRVPRIV',
      serverPublicKey: 'SRVPUB',
      sshTargetId: serverTargetId,
    });

  it('routes a peer on the tunnel network through its server', () => {
    const serverTarget = sshTargets.create({ host: 'vpn.example.com', username: 'root' });
    const server = remoteServer(serverTarget.id);
    const peerTarget = sshTargets.create({ host: '10.0.0.2', username: 'pi' });
    const device = devices.create({
      serverId: server.id,
      name: 'peer',
      kind: 'peer',
      tunnelAddress: '10.0.0.2',
      sshTargetId: peerTarget.id,
    });

    const resolved = resolveDeviceConnection(devices, servers, sshTargets, device.id)!;
    expect(resolved.info.host).toBe('10.0.0.2');
    expect(resolved.info.jump?.host).toBe('vpn.example.com');
    expect(resolved.info.jump?.username).toBe('root');
    expect(resolved.jumpTargetId).toBe(serverTarget.id);
  });

  it('dials a publicly routable device directly', () => {
    const serverTarget = sshTargets.create({ host: 'vpn.example.com', username: 'root' });
    const server = remoteServer(serverTarget.id);
    const target = sshTargets.create({ host: '203.0.113.5', username: 'ops' });
    const device = devices.create({
      serverId: server.id,
      name: 'public-host',
      kind: 'host',
      sshTargetId: target.id,
    });

    const resolved = resolveDeviceConnection(devices, servers, sshTargets, device.id)!;
    expect(resolved.info.jump).toBeNull();
    expect(resolved.jumpTargetId).toBeNull();
  });

  it('does not jump for a local server (the app shares its network)', () => {
    const server = servers.create({
      name: 'local-wg',
      location: 'local',
      interfaceName: 'wg0',
      addressRange: '10.0.0.0/24',
      listenEndpoint: 'vpn.example.com:51820',
      serverPrivateKey: 'SRVPRIV',
      serverPublicKey: 'SRVPUB',
      sshTargetId: null,
    });
    const target = sshTargets.create({ host: '10.0.0.2', username: 'pi' });
    const device = devices.create({
      serverId: server.id,
      name: 'peer',
      kind: 'peer',
      tunnelAddress: '10.0.0.2',
      sshTargetId: target.id,
    });

    expect(resolveDeviceConnection(devices, servers, sshTargets, device.id)!.info.jump).toBeNull();
  });

  it('never jumps a target through itself', () => {
    const serverTarget = sshTargets.create({ host: '10.0.0.1', username: 'root' });
    const server = remoteServer(serverTarget.id);
    const device = devices.create({
      serverId: server.id,
      name: 'the server itself',
      kind: 'host',
      sshTargetId: serverTarget.id,
    });

    expect(resolveDeviceConnection(devices, servers, sshTargets, device.id)!.info.jump).toBeNull();
  });

  it('returns null for a device with no SSH target', () => {
    const server = remoteServer(null);
    const device = devices.create({ serverId: server.id, name: 'bare', kind: 'peer' });
    expect(resolveDeviceConnection(devices, servers, sshTargets, device.id)).toBeNull();
  });

  it('gives the trust probe the same jump host as a session', () => {
    const serverTarget = sshTargets.create({ host: 'vpn.example.com', username: 'root' });
    const server = remoteServer(serverTarget.id);
    const peerTarget = sshTargets.create({ host: '10.0.0.2', username: 'pi' });
    devices.create({
      serverId: server.id,
      name: 'peer',
      kind: 'peer',
      tunnelAddress: '10.0.0.2',
      sshTargetId: peerTarget.id,
    });

    const resolved = resolveTargetConnection(devices, servers, sshTargets, peerTarget.id)!;
    expect(resolved.info.jump?.host).toBe('vpn.example.com');
    expect(resolved.jumpTargetId).toBe(serverTarget.id);
  });

  it('jumps via the covering server even before the target is bound to a device', () => {
    // The operator trusts from the SSH Targets page, before any device uses it.
    const serverTarget = sshTargets.create({ host: 'vpn.example.com', username: 'root' });
    remoteServer(serverTarget.id);
    const peerTarget = sshTargets.create({ host: '10.0.0.2', username: 'pi' });

    const resolved = resolveTargetConnection(devices, servers, sshTargets, peerTarget.id)!;
    expect(resolved.info.jump?.host).toBe('vpn.example.com');
    expect(resolved.jumpTargetId).toBe(serverTarget.id);
  });

  it('leaves a target no device references dialled directly', () => {
    // Outside every server's range, so there is no vantage point to jump from.
    const orphan = sshTargets.create({ host: '203.0.113.9', username: 'pi' });
    const resolved = resolveTargetConnection(devices, servers, sshTargets, orphan.id)!;
    expect(resolved.info.jump).toBeNull();
  });
});
