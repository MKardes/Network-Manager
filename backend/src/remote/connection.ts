import type { DeviceRepo } from '../store/devices.js';
import type { ServerRepo } from '../store/servers.js';
import type { SshTargetRepo } from '../store/ssh-targets.js';
import type { SshConnectionInfo } from './runner.js';
import { addressInRange } from '../servers/net.js';

/**
 * Resolve how the app reaches a device over SSH.
 *
 * A peer's SSH address usually lives on the tunnel network (10.0.0.x), which the
 * app's own host has no route to — only the WireGuard server sits on both sides.
 * So when a device's SSH host falls inside its server's address range, the
 * connection is routed through that server's (already trusted) SSH target as a
 * jump host, matching how reachability probes a peer "via server".
 *
 * A device whose SSH host is publicly routable is still dialled directly.
 */

export interface ResolvedConnection {
  info: SshConnectionInfo;
  /** SSH target the session authenticates against. */
  targetId: string;
  /** Jump host's SSH target, when the connection is tunnelled. */
  jumpTargetId: string | null;
}

/**
 * The jump host for reaching `host` on behalf of a device on `serverId`, or null
 * when the address is not on that server's tunnel network (dial it directly),
 * the server is local (the app already shares its network), or the server has no
 * SSH target of its own.
 */
export function resolveJump(
  servers: ServerRepo,
  sshTargets: SshTargetRepo,
  serverId: string,
  host: string,
  targetId: string,
): { info: SshConnectionInfo; targetId: string } | null {
  const server = servers.get(serverId);
  if (!server || server.location !== 'remote' || !server.ssh_target_id) return null;
  // Never jump through itself (a target that IS the server).
  if (server.ssh_target_id === targetId) return null;
  if (!addressInRange(host, server.address_range)) return null;
  const info = sshTargets.connectionInfo(server.ssh_target_id);
  if (!info) return null;
  return { info, targetId: server.ssh_target_id };
}

/** Connection details for a device's SSH/SFTP session, jump host included. */
export function resolveDeviceConnection(
  devices: DeviceRepo,
  servers: ServerRepo,
  sshTargets: SshTargetRepo,
  deviceId: string,
): ResolvedConnection | null {
  const device = devices.get(deviceId);
  if (!device?.ssh_target_id) return null;
  const info = sshTargets.connectionInfo(device.ssh_target_id);
  if (!info) return null;
  const jump = resolveJump(servers, sshTargets, device.server_id, info.host, device.ssh_target_id);
  return {
    info: { ...info, jump: jump?.info ?? null },
    targetId: device.ssh_target_id,
    jumpTargetId: jump?.targetId ?? null,
  };
}

/**
 * Connection details for an SSH target on its own (the trust probe). The target
 * carries no server of its own, so the jump host is derived from a device that
 * uses it — or, when nothing references it yet, from whichever server's address
 * range covers its host. Without that fallback, trusting a tunnel address would
 * depend on binding the target to a device first, which is the wrong order for
 * an operator working from the SSH Targets page.
 */
export function resolveTargetConnection(
  devices: DeviceRepo,
  servers: ServerRepo,
  sshTargets: SshTargetRepo,
  targetId: string,
): ResolvedConnection | null {
  const info = sshTargets.connectionInfo(targetId);
  if (!info) return null;
  const device = devices.findBySshTarget(targetId);
  const serverId =
    device?.server_id ??
    servers.list().find((s) => addressInRange(info.host, s.address_range))?.id ??
    null;
  const jump = serverId ? resolveJump(servers, sshTargets, serverId, info.host, targetId) : null;
  return {
    info: { ...info, jump: jump?.info ?? null },
    targetId,
    jumpTargetId: jump?.targetId ?? null,
  };
}
