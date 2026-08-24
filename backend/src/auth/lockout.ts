import type { DB } from '../store/db.js';

/**
 * Brute-force protection (FR-021). Exponential backoff on repeated failed
 * logins, escalating to a temporary hard lockout. State is kept on the single
 * operator row (failed_attempts / locked_until).
 */

const BACKOFF_THRESHOLD = 3; // start delaying after this many failures
const HARD_LOCK_THRESHOLD = 5; // lock the account after this many
const HARD_LOCK_MS = 15 * 60 * 1000; // 15 minutes

export interface LockoutStatus {
  locked: boolean;
  lockedUntil?: string;
  retryAfterMs?: number;
}

interface OperatorLockRow {
  failed_attempts: number;
  locked_until: string | null;
}

export class LockoutService {
  constructor(private readonly db: DB) {}

  private row(): OperatorLockRow | undefined {
    return this.db
      .prepare('SELECT failed_attempts, locked_until FROM operator WHERE id = 1')
      .get() as OperatorLockRow | undefined;
  }

  status(): LockoutStatus {
    const row = this.row();
    if (!row) return { locked: false };
    if (row.locked_until) {
      const until = Date.parse(`${row.locked_until}Z`);
      if (until > Date.now()) {
        return { locked: true, lockedUntil: row.locked_until, retryAfterMs: until - Date.now() };
      }
    }
    // Backoff delay based on accumulated failures (no hard lock yet).
    if (row.failed_attempts >= BACKOFF_THRESHOLD) {
      const delay = Math.min(2 ** (row.failed_attempts - BACKOFF_THRESHOLD) * 1000, 30_000);
      return { locked: false, retryAfterMs: delay };
    }
    return { locked: false };
  }

  recordFailure(): LockoutStatus {
    const row = this.row();
    if (!row) return { locked: false };
    const attempts = row.failed_attempts + 1;
    let lockedUntil: string | null = null;
    if (attempts >= HARD_LOCK_THRESHOLD) {
      lockedUntil = new Date(Date.now() + HARD_LOCK_MS).toISOString().replace('T', ' ').slice(0, 19);
    }
    this.db
      .prepare(
        `UPDATE operator SET failed_attempts = ?, locked_until = ?, updated_at = datetime('now') WHERE id = 1`,
      )
      .run(attempts, lockedUntil);
    return this.status();
  }

  reset(): void {
    this.db
      .prepare(
        `UPDATE operator SET failed_attempts = 0, locked_until = NULL, updated_at = datetime('now') WHERE id = 1`,
      )
      .run();
  }
}
