import { DeviceRepo, toDeviceView, type DeviceView, type DeviceKind } from '../store/devices.js';
import { ServerRepo } from '../store/servers.js';
import { AuditService } from '../audit/audit.js';
import { generateWgKeyPair } from '../servers/keys.js';
import { buildClientProfile } from '../servers/profile.js';
import { allocateAddress, validateAssignableAddress } from '../servers/net.js';
import { errors } from '../http/errors.js';

const ACTOR = 'operator';
const MAC_RE = /^([0-9a-fA-F]{2}[:-]){5}[0-9a-fA-F]{2}$/;

export interface CreateDeviceInput {
  name: string;
  kind: DeviceKind;
  segmentId?: string | null;
  macAddress?: string | null;
  sshTargetId?: string | null;
  tunnelAddress?: string | null; // peer only; omit for auto-assignment
}

export interface AdoptDeviceInput {
  name: string;
  segmentId?: string | null;
}

/**
 * Device orchestration (FR-002…005): add/edit/remove, peer vs host validation,
 * peer key generation + address allocation, key rotation, revoke, and client
 * profile building.
 */
export class DeviceService {
  constructor(
    private readonly devices: DeviceRepo,
    private readonly servers: ServerRepo,
    private readonly audit: AuditService,
  ) {}

  listByServer(serverId: string): DeviceView[] {
    return this.devices.listByServer(serverId).map(toDeviceView);
  }

  getView(id: string): DeviceView {
    const row = this.devices.get(id);
    if (!row) throw errors.notFound('Device not found');
    return toDeviceView(row);
  }

  async add(serverId: string, input: CreateDeviceInput): Promise<DeviceView> {
    const server = this.servers.get(serverId);
    if (!server) throw errors.notFound('Server not found');
    if (input.macAddress && !MAC_RE.test(input.macAddress)) {
      throw errors.validation(`Invalid MAC address: ${input.macAddress}`);
    }

    let tunnelAddress: string | null = null;
    let peerPublicKey: string | null = null;
    let peerPrivateKey: string | null = null;

    if (input.kind === 'peer') {
      // Address is either operator-specified (FR-006) or auto-assigned (FR-007).
      // The in-use set spans managed AND imported peers, including subnets (FR-009).
      const used = this.devices.usedCidrs(serverId);
      if (input.tunnelAddress) {
        const check = validateAssignableAddress(server.address_range, input.tunnelAddress, used);
        if (!check.ok) {
          if (check.reason === 'in_use') {
            throw errors.conflict('address_in_use', 'That tunnel address is already in use');
          }
          if (check.reason === 'out_of_range') {
            throw errors.validation(
              `Address ${input.tunnelAddress} is outside the server range ${server.address_range}`,
            );
          }
          if (check.reason === 'reserved') {
            throw errors.validation(`Address ${input.tunnelAddress} is reserved`);
          }
          throw errors.validation(`Invalid tunnel address: ${input.tunnelAddress}`);
        }
        tunnelAddress = input.tunnelAddress.split('/')[0];
      } else {
        try {
          tunnelAddress = allocateAddress(server.address_range, used);
        } catch {
          throw errors.conflict('address_exhausted', 'No free tunnel addresses in range');
        }
      }
      const keys = await generateWgKeyPair();
      peerPublicKey = keys.publicKey;
      peerPrivateKey = keys.privateKey;
    }

    const row = this.devices.create({
      serverId,
      name: input.name,
      kind: input.kind,
      segmentId: input.segmentId ?? null,
      macAddress: input.macAddress ?? null,
      tunnelAddress,
      peerPublicKey,
      peerPrivateKey,
      sshTargetId: input.sshTargetId ?? null,
    });
    this.audit.record({
      actor: ACTOR,
      action: 'device_add',
      targetType: 'device',
      targetId: row.id,
      outcome: 'success',
      detail:
        input.kind === 'peer'
          ? `kind=peer address=${tunnelAddress} assign=${input.tunnelAddress ? 'manual' : 'auto'}`
          : `kind=${row.kind}`,
    });
    return toDeviceView(row);
  }

  /**
   * Adopt an imported (needs-review) peer into managed state (FR-011), keeping
   * its existing address and public key. No private key is fabricated (FR-012).
   */
  adopt(id: string, input: AdoptDeviceInput): DeviceView {
    const row = this.devices.get(id);
    if (!row) throw errors.notFound('Device not found');
    if (row.management_state !== 'needs_review') {
      throw errors.validation('Only imported (needs-review) peers can be adopted');
    }
    // Reject adoption when this peer's address collides with another MANAGED
    // device — a pre-existing conflict on the server (FR-013).
    const addr = row.tunnel_address;
    if (addr) {
      const conflict = this.devices
        .listByServer(row.server_id)
        .some(
          (d) =>
            d.id !== id &&
            d.management_state === 'managed' &&
            d.tunnel_address === addr,
        );
      if (conflict) {
        throw errors.conflict('address_conflict', `Address ${addr} conflicts with a managed device`);
      }
    }
    this.devices.adopt(id, input.name);
    if (input.segmentId !== undefined) {
      this.devices.update(id, { segment_id: input.segmentId });
    }
    this.audit.record({
      actor: ACTOR,
      action: 'device_adopt',
      targetType: 'device',
      targetId: id,
      outcome: 'success',
    });
    return toDeviceView(this.devices.get(id)!);
  }

  update(id: string, patch: Partial<CreateDeviceInput>): DeviceView {
    const row = this.devices.get(id);
    if (!row) throw errors.notFound('Device not found');
    if (patch.macAddress && !MAC_RE.test(patch.macAddress)) {
      throw errors.validation(`Invalid MAC address: ${patch.macAddress}`);
    }
    const updated = this.devices.update(id, {
      name: patch.name ?? row.name,
      segment_id: patch.segmentId === undefined ? row.segment_id : patch.segmentId,
      mac_address: patch.macAddress === undefined ? row.mac_address : patch.macAddress,
      ssh_target_id: patch.sshTargetId === undefined ? row.ssh_target_id : patch.sshTargetId,
    })!;
    this.audit.record({
      actor: ACTOR,
      action: 'device_update',
      targetType: 'device',
      targetId: id,
      outcome: 'success',
    });
    return toDeviceView(updated);
  }

  /** Rotate a peer's keys, invalidating old credentials (FR-004). */
  async rotateKeys(id: string): Promise<DeviceView> {
    const row = this.devices.get(id);
    if (!row) throw errors.notFound('Device not found');
    if (row.kind !== 'peer') throw errors.validation('Only peer devices have keys to rotate');
    const keys = await generateWgKeyPair();
    this.devices.rotateKeys(id, keys.publicKey, keys.privateKey);
    this.audit.record({
      actor: ACTOR,
      action: 'key_rotate',
      targetType: 'device',
      targetId: id,
      outcome: 'success',
    });
    return this.getView(id);
  }

  /** Remove/revoke a device so it can no longer connect (FR-005). */
  remove(id: string): void {
    const row = this.devices.get(id);
    if (!row) throw errors.notFound('Device not found');
    this.devices.delete(id);
    this.audit.record({
      actor: ACTOR,
      action: 'device_remove',
      targetType: 'device',
      targetId: id,
      outcome: 'success',
    });
  }

  /** Build the downloadable client profile for a peer (FR-003). */
  buildProfile(id: string): string {
    const row = this.devices.get(id);
    if (!row) throw errors.notFound('Device not found');
    if (row.kind !== 'peer') throw errors.validation('Only peer devices have profiles');
    const server = this.servers.get(row.server_id)!;
    const privateKey = this.devices.peerPrivateKey(id);
    if (!privateKey) throw errors.precondition('Peer has no private key');
    this.audit.record({
      actor: ACTOR,
      action: 'profile_download',
      targetType: 'device',
      targetId: id,
      outcome: 'success',
    });
    return buildClientProfile({
      peerPrivateKey: privateKey,
      peerAddress: `${row.tunnel_address}/32`,
      serverPublicKey: server.server_public_key,
      serverEndpoint: server.listen_endpoint,
    });
  }
}
