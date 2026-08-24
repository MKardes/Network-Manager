import { randomUUID } from 'node:crypto';
import type { DB } from '../store/db.js';

export type AuditOutcome = 'success' | 'failure';

export interface AuditEventInput {
  actor: string;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  outcome: AuditOutcome;
  detail?: string | null;
}

export interface AuditEventRow {
  id: string;
  occurred_at: string;
  actor: string;
  action: string;
  target_type: string | null;
  target_id: string | null;
  outcome: AuditOutcome;
  detail: string | null;
}

const RETENTION_MONTHS = 12;

/**
 * Records security-relevant events (FR-020). Never store secret values in
 * `detail`. Retention pruning keeps >= 12 months.
 */
export class AuditService {
  constructor(private readonly db: DB) {}

  record(evt: AuditEventInput): void {
    this.db
      .prepare(
        `INSERT INTO audit_event (id, actor, action, target_type, target_id, outcome, detail)
         VALUES (@id, @actor, @action, @targetType, @targetId, @outcome, @detail)`,
      )
      .run({
        id: randomUUID(),
        actor: evt.actor,
        action: evt.action,
        targetType: evt.targetType ?? null,
        targetId: evt.targetId ?? null,
        outcome: evt.outcome,
        detail: evt.detail ?? null,
      });
  }

  query(opts: {
    action?: string;
    from?: string;
    to?: string;
    targetId?: string;
    limit?: number;
    offset?: number;
  }): { total: number; events: AuditEventRow[] } {
    const where: string[] = [];
    const params: Record<string, unknown> = {};
    if (opts.action) {
      where.push('action = @action');
      params.action = opts.action;
    }
    if (opts.from) {
      where.push('occurred_at >= @from');
      params.from = opts.from;
    }
    if (opts.to) {
      where.push('occurred_at <= @to');
      params.to = opts.to;
    }
    if (opts.targetId) {
      where.push('target_id = @targetId');
      params.targetId = opts.targetId;
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = Math.min(opts.limit ?? 100, 500);
    const offset = opts.offset ?? 0;

    const total = (
      this.db.prepare(`SELECT COUNT(*) AS n FROM audit_event ${clause}`).get(params) as { n: number }
    ).n;
    const events = this.db
      .prepare(
        `SELECT * FROM audit_event ${clause} ORDER BY occurred_at DESC LIMIT @limit OFFSET @offset`,
      )
      .all({ ...params, limit, offset }) as AuditEventRow[];
    return { total, events };
  }

  /** Delete events older than the retention window. */
  prune(): number {
    const info = this.db
      .prepare(`DELETE FROM audit_event WHERE occurred_at < datetime('now', ?)`)
      .run(`-${RETENTION_MONTHS} months`);
    return info.changes;
  }
}
