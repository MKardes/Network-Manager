import { ServerRepo, toServerView, type ServerView, type ServerRow } from '../store/servers.js';
import { DeviceRepo } from '../store/devices.js';
import { SshTargetRepo } from '../store/ssh-targets.js';
import { AuditService } from '../audit/audit.js';
import { generateWgKeyPair } from './keys.js';
import { buildServerConfig } from './profile.js';
import { serverAddress, cidrsOverlap, parseCidr } from './net.js';
import { LocalApplier } from './local.js';
import { RemoteApplier } from './remote.js';
import type { PeerStatus } from './status.js';
import { ApiError, errors } from '../http/errors.js';

export interface CreateServerInput {
  name: string;
  location: 'local' | 'remote';
  addressRange: string;
  listenEndpoint: string;
  interfaceName?: string;
  sshTargetId?: string | null;
}

const ACTOR = 'operator';

/**
 * Server orchestration (FR-001…007): create with generated keypair + address
 * conflict checks, edit/delete, apply staged config to the WG server (local or
 * remote), and query live status.
 */
export class ServerService {
  constructor(
    private readonly servers: ServerRepo,
    private readonly devices: DeviceRepo,
    private readonly sshTargets: SshTargetRepo,
    private readonly audit: AuditService,
    private readonly dataDir = process.env.DATA_DIR ?? './data',
  ) {}

  list(): ServerView[] {
    return this.servers.list().map(toServerView);
  }

  getView(id: string): ServerView {
    const row = this.servers.get(id);
    if (!row) throw errors.notFound('Server not found');
    return toServerView(row);
  }

  async create(input: CreateServerInput): Promise<ServerView> {
    // Validate CIDR + endpoint.
    try {
      parseCidr(input.addressRange);
    } catch {
      throw errors.validation(`Invalid address_range: ${input.addressRange}`);
    }
    if (input.location === 'remote' && !input.sshTargetId) {
      throw errors.validation('remote servers require an ssh_target');
    }
    if (input.sshTargetId && !this.sshTargets.getRow(input.sshTargetId)) {
      throw errors.validation('ssh_target not found');
    }
    if (this.servers.getByName(input.name)) {
      throw errors.conflict('name_conflict', 'A server with that name already exists');
    }
    // Reject overlapping address ranges (FR-007).
    for (const existing of this.servers.list()) {
      if (cidrsOverlap(existing.address_range, input.addressRange)) {
        throw errors.conflict(
          'address_conflict',
          `address_range overlaps server "${existing.name}"`,
        );
      }
    }

    const keys = await generateWgKeyPair();
    const row = this.servers.create({
      name: input.name,
      location: input.location,
      interfaceName: input.interfaceName ?? 'wg0',
      addressRange: input.addressRange,
      listenEndpoint: input.listenEndpoint,
      serverPrivateKey: keys.privateKey,
      serverPublicKey: keys.publicKey,
      sshTargetId: input.sshTargetId ?? null,
    });
    this.audit.record({
      actor: ACTOR,
      action: 'server_create',
      targetType: 'server',
      targetId: row.id,
      outcome: 'success',
      detail: `location=${row.location}`,
    });
    return toServerView(row);
  }

  update(id: string, patch: Partial<CreateServerInput>): ServerView {
    const existing = this.servers.get(id);
    if (!existing) throw errors.notFound('Server not found');
    if (patch.addressRange && patch.addressRange !== existing.address_range) {
      for (const other of this.servers.list()) {
        if (other.id !== id && cidrsOverlap(other.address_range, patch.addressRange)) {
          throw errors.conflict('address_conflict', `address_range overlaps server "${other.name}"`);
        }
      }
    }
    const row = this.servers.update(id, {
      name: patch.name,
      address_range: patch.addressRange,
      listen_endpoint: patch.listenEndpoint,
      ssh_target_id: patch.sshTargetId ?? undefined,
    })!;
    this.audit.record({
      actor: ACTOR,
      action: 'server_update',
      targetType: 'server',
      targetId: id,
      outcome: 'success',
    });
    return toServerView(row);
  }

  delete(id: string): void {
    const row = this.servers.get(id);
    if (!row) throw errors.notFound('Server not found');
    this.servers.delete(id); // cascades devices/segments
    this.audit.record({
      actor: ACTOR,
      action: 'server_delete',
      targetType: 'server',
      targetId: id,
      outcome: 'success',
    });
  }

  /** Render the current server config from its peers. */
  private renderConfig(row: ServerRow): string {
    const privateKey = this.servers.privateKey(row.id)!;
    const peers = this.devices
      .listByServer(row.id)
      .filter((d) => d.kind === 'peer' && d.peer_public_key && d.tunnel_address)
      .map((d) => ({ publicKey: d.peer_public_key!, tunnelAddress: d.tunnel_address! }));
    const [, portStr] = row.listen_endpoint.split(':');
    return buildServerConfig({
      serverPrivateKey: privateKey,
      addressRange: serverAddress(row.address_range),
      listenPort: Number.parseInt(portStr, 10) || 51820,
      peers,
    });
  }

  private applier(row: ServerRow): LocalApplier | RemoteApplier {
    if (row.location === 'local') return new LocalApplier(this.dataDir);
    const info = this.sshTargets.connectionInfo(row.ssh_target_id!);
    if (!info) throw errors.precondition('ssh_target missing for remote server');
    return new RemoteApplier(info);
  }

  /** Push staged config to the WG server (FR-001b/001c). */
  async apply(id: string): Promise<ServerView> {
    const row = this.servers.get(id);
    if (!row) throw errors.notFound('Server not found');
    const config = this.renderConfig(row);
    try {
      await this.applier(row).apply(row.interface_name, config);
      this.servers.setStatus(id, 'up', true);
      this.audit.record({
        actor: ACTOR,
        action: 'server_apply',
        targetType: 'server',
        targetId: id,
        outcome: 'success',
      });
    } catch (e) {
      this.servers.setStatus(id, 'down', false);
      this.audit.record({
        actor: ACTOR,
        action: 'server_apply',
        targetType: 'server',
        targetId: id,
        outcome: 'failure',
        detail: e instanceof Error ? e.message : 'apply failed',
      });
      if (e instanceof ApiError) throw e;
      throw errors.internal('Failed to apply server config');
    }
    return toServerView(this.servers.get(id)!);
  }

  /** Live status: interface up/down + peer handshakes (FR-006). */
  async status(id: string): Promise<{ status: string; peers: PeerStatus[] }> {
    const row = this.servers.get(id);
    if (!row) throw errors.notFound('Server not found');
    try {
      const { up, peers } = await this.applier(row).status(row.interface_name);
      this.servers.setStatus(id, up ? 'up' : 'down', false);
      return { status: up ? 'up' : 'down', peers };
    } catch {
      this.servers.setStatus(id, 'unknown', false);
      return { status: 'unknown', peers: [] };
    }
  }
}
