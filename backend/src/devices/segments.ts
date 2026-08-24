import { randomUUID } from 'node:crypto';
import type { DB } from '../store/db.js';
import { AuditService } from '../audit/audit.js';
import { errors } from '../http/errors.js';

/**
 * LAN segment management (FR-014a). Each segment may designate one always-on
 * device as its Wake-on-LAN controller.
 */

export interface SegmentRow {
  id: string;
  server_id: string;
  name: string;
  wake_controller_device_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SegmentView {
  id: string;
  serverId: string;
  name: string;
  wakeControllerDeviceId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toSegmentView(row: SegmentRow): SegmentView {
  return {
    id: row.id,
    serverId: row.server_id,
    name: row.name,
    wakeControllerDeviceId: row.wake_controller_device_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const ACTOR = 'operator';

export class SegmentService {
  constructor(
    private readonly db: DB,
    private readonly audit: AuditService,
  ) {}

  listByServer(serverId: string): SegmentView[] {
    return (
      this.db
        .prepare('SELECT * FROM lan_segment WHERE server_id = ? ORDER BY name')
        .all(serverId) as SegmentRow[]
    ).map(toSegmentView);
  }

  getRow(id: string): SegmentRow | undefined {
    return this.db.prepare('SELECT * FROM lan_segment WHERE id = ?').get(id) as SegmentRow | undefined;
  }

  create(serverId: string, name: string): SegmentView {
    if (!this.db.prepare('SELECT 1 FROM wireguard_server WHERE id = ?').get(serverId)) {
      throw errors.notFound('Server not found');
    }
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO lan_segment (id, server_id, name) VALUES (?, ?, ?)')
      .run(id, serverId, name);
    this.audit.record({
      actor: ACTOR,
      action: 'segment_create',
      targetType: 'segment',
      targetId: id,
      outcome: 'success',
    });
    return toSegmentView(this.getRow(id)!);
  }

  update(id: string, patch: { name?: string; wakeControllerDeviceId?: string | null }): SegmentView {
    const row = this.getRow(id);
    if (!row) throw errors.notFound('Segment not found');
    // If setting a controller, it must be a device on the same server.
    if (patch.wakeControllerDeviceId) {
      const dev = this.db
        .prepare('SELECT server_id FROM device WHERE id = ?')
        .get(patch.wakeControllerDeviceId) as { server_id: string } | undefined;
      if (!dev) throw errors.validation('wake controller device not found');
      if (dev.server_id !== row.server_id) {
        throw errors.validation('wake controller must belong to the same server');
      }
      // Mark the device as controller and clear the flag from any previous one.
      this.db
        .prepare('UPDATE device SET is_wake_controller = 0 WHERE id = ?')
        .run(row.wake_controller_device_id);
      this.db
        .prepare('UPDATE device SET is_wake_controller = 1 WHERE id = ?')
        .run(patch.wakeControllerDeviceId);
    }
    this.db
      .prepare(
        `UPDATE lan_segment SET name = ?, wake_controller_device_id = ?, updated_at = datetime('now') WHERE id = ?`,
      )
      .run(
        patch.name ?? row.name,
        patch.wakeControllerDeviceId === undefined
          ? row.wake_controller_device_id
          : patch.wakeControllerDeviceId,
        id,
      );
    this.audit.record({
      actor: ACTOR,
      action: 'segment_update',
      targetType: 'segment',
      targetId: id,
      outcome: 'success',
    });
    return toSegmentView(this.getRow(id)!);
  }

  delete(id: string): void {
    const row = this.getRow(id);
    if (!row) throw errors.notFound('Segment not found');
    this.db.prepare('DELETE FROM lan_segment WHERE id = ?').run(id);
    this.audit.record({
      actor: ACTOR,
      action: 'segment_delete',
      targetType: 'segment',
      targetId: id,
      outcome: 'success',
    });
  }
}
