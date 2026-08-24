import { DeviceRepo } from '../store/devices.js';
import { SegmentService } from '../devices/segments.js';
import { SshTargetRepo } from '../store/ssh-targets.js';
import { AuditService } from '../audit/audit.js';
import { connect } from '../remote/runner.js';
import { errors } from '../http/errors.js';

const ACTOR = 'operator';

export interface WakeResult {
  dispatched: boolean;
  controller: string;
}

/**
 * Wake-on-LAN orchestration (FR-015/016). A wake requires the target to have a
 * MAC, a segment, and that segment to have a wake controller. The magic packet
 * is emitted by the controller (same L2 as the target) via the SSH runner using
 * only the vetted `wake` command.
 */
export class WakeService {
  constructor(
    private readonly devices: DeviceRepo,
    private readonly segments: SegmentService,
    private readonly sshTargets: SshTargetRepo,
    private readonly audit: AuditService,
  ) {}

  async wake(deviceId: string): Promise<WakeResult> {
    const device = this.devices.get(deviceId);
    if (!device) throw errors.notFound('Device not found');

    // Precondition checks (FR-016) — each returns a specific explanation.
    if (!device.mac_address) {
      this.fail(deviceId, 'device has no MAC address');
      throw errors.precondition('Cannot wake: device has no MAC address');
    }
    if (!device.segment_id) {
      this.fail(deviceId, 'device is not on a LAN segment');
      throw errors.precondition('Cannot wake: device is not assigned to a LAN segment');
    }
    const segment = this.segments.getRow(device.segment_id);
    if (!segment || !segment.wake_controller_device_id) {
      this.fail(deviceId, 'segment has no wake controller');
      throw errors.precondition("Cannot wake: the device's segment has no wake controller");
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

    const runner = await connect(info);
    try {
      const res = await runner.runVetted('wake', [device.mac_address]);
      if (res.code !== 0) {
        this.fail(deviceId, `controller command failed: ${res.stderr || res.code}`);
        throw errors.internal('Wake command failed on the controller');
      }
    } finally {
      runner.end();
    }

    this.audit.record({
      actor: ACTOR,
      action: 'wake',
      targetType: 'device',
      targetId: deviceId,
      outcome: 'success',
      detail: `via controller ${controller.name}`,
    });
    return { dispatched: true, controller: controller.name };
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
