import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { DeviceRepo } from '../store/devices.js';
import { ServerRepo } from '../store/servers.js';
import { SshTargetRepo } from '../store/ssh-targets.js';
import { AuditService } from '../audit/audit.js';
import { connect as realConnect } from '../remote/runner.js';
import { errors } from '../http/errors.js';

const execFileAsync = promisify(execFile);
const ACTOR = 'operator';

export type Vantage = 'server' | 'controller';

/** Low-level probe result (no auditing, no persistence). */
export interface ProbeResult {
  reachable: boolean;
  latencyMs: number | null;
  vantage: Vantage;
}

/** Endpoint-facing test result. */
export interface ReachabilityResult {
  reachability: 'connected' | 'offline' | 'unknown';
  latencyMs: number | null;
  vantage: Vantage;
  testedAt: string;
}

/** Injectable seams so the SSH connect and local ping can be faked in tests. */
export interface ReachabilityDeps {
  connect?: typeof realConnect;
  localPing?: (host: string) => Promise<boolean>;
}

/**
 * On-demand connectivity testing (feature 003, FR-002/003/004). A device is
 * probed from the vantage that actually sits on its network path: a peer's
 * tunnel address is pinged from its WireGuard server (locally for a local
 * server, over the vetted SSH runner for a remote one). Non-peer hosts have no
 * stored address to probe and surface a precondition instead.
 */
export class ReachabilityService {
  private readonly connect: typeof realConnect;
  private readonly localPing: (host: string) => Promise<boolean>;

  constructor(
    private readonly devices: DeviceRepo,
    private readonly servers: ServerRepo,
    private readonly sshTargets: SshTargetRepo,
    private readonly audit: AuditService,
    deps: ReachabilityDeps = {},
  ) {
    this.connect = deps.connect ?? realConnect;
    this.localPing = deps.localPing ?? ((host) => defaultLocalPing(host));
  }

  /**
   * Run a probe and persist/audit the outcome (the `POST /devices/:id/test`
   * path). A missing/unreachable vantage leaves reachability `unknown` and
   * re-throws as a precondition so the caller returns not-live (FR-004).
   */
  async test(deviceId: string): Promise<ReachabilityResult> {
    const device = this.devices.get(deviceId);
    if (!device) throw errors.notFound('Device not found');
    const testedAt = new Date().toISOString();
    try {
      const r = await this.probe(deviceId);
      const reachability = r.reachable ? 'connected' : 'offline';
      this.devices.setReachability(
        deviceId,
        reachability,
        r.reachable ? testedAt : device.last_seen_at,
      );
      this.audit.record({
        actor: ACTOR,
        action: 'device_test',
        targetType: 'device',
        targetId: deviceId,
        outcome: 'success',
        detail: `${reachability} via ${r.vantage}`,
      });
      return { reachability, latencyMs: r.reachable ? r.latencyMs : null, vantage: r.vantage, testedAt };
    } catch (e) {
      this.devices.setReachability(deviceId, 'unknown', device.last_seen_at);
      this.audit.record({
        actor: ACTOR,
        action: 'device_test',
        targetType: 'device',
        targetId: deviceId,
        outcome: 'failure',
        detail: e instanceof Error ? e.message : 'probe failed',
      });
      throw e;
    }
  }

  /**
   * Probe a device without side effects (used by `test` and by the wake
   * verification loop). Throws a precondition when there is no vantage/address
   * to probe or the vantage cannot be reached.
   */
  async probe(deviceId: string): Promise<ProbeResult> {
    const device = this.devices.get(deviceId);
    if (!device) throw errors.notFound('Device not found');

    if (device.kind !== 'peer' || !device.tunnel_address) {
      throw errors.precondition('Cannot test: device has no tunnel address to probe');
    }
    const host = device.tunnel_address.split('/')[0];
    const server = this.servers.get(device.server_id);
    if (!server) throw errors.precondition('Cannot test: device server not found');

    const started = Date.now();
    let reachable: boolean;
    if (server.location === 'local') {
      reachable = await this.localPing(host);
    } else {
      if (!server.ssh_target_id) {
        throw errors.precondition('Cannot test: the server has no SSH connection configured');
      }
      const info = this.sshTargets.connectionInfo(server.ssh_target_id);
      if (!info) throw errors.precondition('Cannot test: the server SSH target is missing');
      let runner;
      try {
        runner = await this.connect(info);
      } catch {
        // Vantage unreachable → not-live, not "offline" (FR-004).
        throw errors.precondition('Cannot test: the server vantage is unreachable (not live)');
      }
      try {
        const res = await runner.runVetted('probe', [host]);
        reachable = res.code === 0;
      } finally {
        runner.end();
      }
    }
    return { reachable, latencyMs: reachable ? Date.now() - started : null, vantage: 'server' };
  }
}

async function defaultLocalPing(host: string): Promise<boolean> {
  try {
    await execFileAsync('ping', ['-c', '1', '-W', '3', host]);
    return true;
  } catch {
    return false;
  }
}
