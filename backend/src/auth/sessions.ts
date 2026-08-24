import { randomBytes } from 'node:crypto';
import type { DB } from '../store/db.js';

interface SessionRow {
  id: string;
  created_at: string;
  last_active_at: string;
  authed: number;
}

/**
 * Server-side session store (FR-024). Cookies carry only the opaque id;
 * sessions expire after `idleTimeoutMs` of inactivity and on explicit logout.
 */
export class SessionStore {
  constructor(
    private readonly db: DB,
    private readonly idleTimeoutMs: number,
  ) {}

  create(authed: boolean): string {
    const id = randomBytes(32).toString('base64url');
    this.db
      .prepare(`INSERT INTO session (id, authed) VALUES (?, ?)`)
      .run(id, authed ? 1 : 0);
    return id;
  }

  /** Return the session if valid and not idle-expired, refreshing last_active_at. */
  touch(id: string | undefined): SessionRow | null {
    if (!id) return null;
    const row = this.db.prepare('SELECT * FROM session WHERE id = ?').get(id) as SessionRow | undefined;
    if (!row) return null;
    const lastActive = Date.parse(`${row.last_active_at}Z`);
    if (Date.now() - lastActive > this.idleTimeoutMs) {
      this.destroy(id);
      return null;
    }
    this.db.prepare(`UPDATE session SET last_active_at = datetime('now') WHERE id = ?`).run(id);
    return row;
  }

  markAuthed(id: string, authed: boolean): void {
    this.db.prepare('UPDATE session SET authed = ? WHERE id = ?').run(authed ? 1 : 0, id);
  }

  destroy(id: string): void {
    this.db.prepare('DELETE FROM session WHERE id = ?').run(id);
  }

  /** Purge idle-expired sessions (housekeeping). */
  purgeExpired(): number {
    const cutoffSeconds = Math.floor(this.idleTimeoutMs / 1000);
    return this.db
      .prepare(`DELETE FROM session WHERE last_active_at < datetime('now', ?)`)
      .run(`-${cutoffSeconds} seconds`).changes;
  }
}
