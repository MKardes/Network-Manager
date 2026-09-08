import { DeviceRepo } from '../store/devices.js';
import { SegmentService } from '../devices/segments.js';
import { SshTargetRepo } from '../store/ssh-targets.js';
import { AuditService } from '../audit/audit.js';
import { connect as realConnect } from '../remote/runner.js';
import { ReachabilityService } from '../reachability/service.js';
import { errors } from '../http/errors.js';

const ACTOR = 'operator';

export type WakeOutcome = 'already_reachable' | 'relayed' | 'relayed_still_down';

export interface WakeResult {
  result: WakeOutcome;
  alreadyReachable: boolean;
  controller: string;
}

/** Injectable seams + tunables for the post-dispatch verification loop. */
export interface WakeDeps {
  connect?: typeof realConnect;
  verifyAttempts?: number; // number of post-dispatch re-probes
  verifyDelayMs?: number; // delay between re-probes
}

/**
 * Wake-on-LAN orchestration (FR-013/014/015/016). A wake requires the target to
 * have a MAC, a segment, and that segment to have a wake controller. The magic
 * packet is emitted by the controller (same L2 as the target) via the SSH runner
 * using only the vetted `wake` command, directed to the segment's broadcast
 * address/port when configured (feature 003). The outcome distinguishes an
 * already-up target, a relayed packet that brought the target online, and a
 * relayed packet after which the target stayed down.
 */
export class WakeService {
  private readonly connect: typeof realConnect;
  private readonly verifyAttempts: number;
  private readonly verifyDelayMs: number;

  constructor(
    private readonly devices: DeviceRepo,
    private readonly segments: SegmentService,
    private readonly sshTargets: SshTargetRepo,
    private readonly audit: AuditService,
    private readonly reachability: ReachabilityService,
    deps: WakeDeps = {},
  ) {
    this.connect = deps.connect ?? realConnect;
    this.verifyAttempts = deps.verifyAttempts ?? 5;
    this.verifyDelayMs = deps.verifyDelayMs ?? 2000;
  }

  async wake(deviceId: string): Promise<WakeResult> {
    const device = this.devices.get(deviceId);
    if (!device) throw errors.notFound('Device not found');

    // Precondition checks (FR-013/016) — each returns a specific explanation.
    if (!device.mac_address) {
      this.fail(deviceId, 'device has no MAC address');
      throw errors.precondition('Cannot wake: device has no MAC address');
    }
    if (!device.segment_id) {
      this.fail(deviceId, 'device is not on a LAN segment');
      throw errors.precondition('Cannot wake: device is not assigned to a LAN segment');
    }
    // Ambiguous target: two devices in the segment carrying the same MAC (FR-016).
    const sameMac = this.devices
      .listByServer(device.server_id)
      .filter((d) => d.segment_id === device.segment_id && d.mac_address === device.mac_address);
    if (sameMac.length > 1) {
      this.fail(deviceId, 'ambiguous MAC in segment');
      throw errors.conflict(
        'ambiguous_mac',
        'Cannot wake: more than one device in this segment shares the MAC address',
      );
    }
    const segment = this.segments.getRow(device.segment_id);
    if (!segment || !segment.wake_controller_device_id) {
      this.fail(deviceId, 'segment has no wake controller');
      throw errors.precondition("Cannot wake: the device's segment has no wake controller");
    }
    // A device cannot relay its own magic packet (FR-016).
    if (segment.wake_controller_device_id === deviceId) {
      this.fail(deviceId, 'device is its own wake controller');
      throw errors.precondition('Cannot wake: a device cannot wake itself');
    }
    const controller = this.devices.get(segment.wake_controller_device_id);
    if (!controller || !controller.ssh_target_id) {
      this.fail(deviceId, 'wake controller is unreachable (no SSH target)');
      throw errors.precondition('Cannot wake: the wake controller has no SSH connection configured');
    }

    const info = this.sshTargets.connectionInfo(controller.ssh_target_id);
    if (!info) {
      this.fail(deviceId, 'wake controller SSH target missing');
      throw errors.precondition('Cannot wake: the wake controller SSH target is missing');
    }

    // Was the target already up before we sent anything? (FR-014)
    const alreadyReachable = (await this.safeProbe(deviceId)) === true;

    const runner = await this.connect(info);
    try {
      const res = await runner.runVetted('wake', [
        device.mac_address,
        { broadcast: segment.broadcast_address, port: segment.wol_port },
      ]);
      if (res.code !== 0) {
        this.fail(deviceId, `controller command failed: ${res.stderr || res.code}`);
        throw errors.internal('Wake command failed on the controller');
      }
    } finally {
      runner.end();
    }

    // Determine the outcome (FR-015).
    let result: WakeOutcome;
    if (alreadyReachable) {
      result = 'already_reachable';
    } else {
      const online = await this.verifyOnline(deviceId);
      result = online === false ? 'relayed_still_down' : 'relayed';
    }

    this.audit.record({
      actor: ACTOR,
      action: 'wake',
      targetType: 'device',
      targetId: deviceId,
      outcome: 'success',
      detail: `via controller ${controller.name}: ${result}`,
    });
    return { result, alreadyReachable, controller: controller.name };
  }

  /** Probe without throwing; null = indeterminate (no address/vantage error). */
  private async safeProbe(deviceId: string): Promise<boolean | null> {
    try {
      return (await this.reachability.probe(deviceId)).reachable;
    } catch {
      return null;
    }
  }

  /**
   * Bounded post-dispatch verification. Returns true as soon as the target is
   * reachable, false if it stayed down across all attempts, or null if it could
   * not be verified at all (no probeable address).
   */
  private async verifyOnline(deviceId: string): Promise<boolean | null> {
    for (let i = 0; i < this.verifyAttempts; i++) {
      const r = await this.safeProbe(deviceId);
      if (r === true) return true;
      if (r === null) return null; // cannot verify this device
      if (i < this.verifyAttempts - 1) await sleep(this.verifyDelayMs);
    }
    return false;
  }

  private fail(deviceId: string, reason: string): void {
    this.audit.record({
      actor: ACTOR,
      action: 'wake',
      targetType: 'device',
      targetId: deviceId,
      outcome: 'failure',
      detail: reason,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
