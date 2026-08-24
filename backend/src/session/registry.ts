import { randomUUID } from 'node:crypto';

export type SessionKind = 'ssh' | 'sftp';

export interface ActiveSession {
  id: string;
  kind: SessionKind;
  deviceId: string;
  openedAt: string;
  lastActiveAt: number;
  close: (reason: string) => void;
}

export interface ActiveSessionView {
  id: string;
  kind: SessionKind;
  deviceId: string;
  openedAt: string;
}

/**
 * Tracks active interactive SSH/SFTP sessions (FR-013). Supports listing,
 * force-close, and idle-timeout sweeping. Credentials live only inside the
 * session's own closures and are discarded when the session closes.
 */
export class SessionRegistry {
  private readonly sessions = new Map<string, ActiveSession>();
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly idleTimeoutMs: number) {}

  open(kind: SessionKind, deviceId: string, close: (reason: string) => void): ActiveSession {
    const session: ActiveSession = {
      id: randomUUID(),
      kind,
      deviceId,
      openedAt: new Date().toISOString(),
      lastActiveAt: Date.now(),
      close,
    };
    this.sessions.set(session.id, session);
    this.ensureSweeper();
    return session;
  }

  touch(id: string): void {
    const s = this.sessions.get(id);
    if (s) s.lastActiveAt = Date.now();
  }

  remove(id: string): void {
    this.sessions.delete(id);
    if (this.sessions.size === 0 && this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = null;
    }
  }

  list(): ActiveSessionView[] {
    return [...this.sessions.values()].map((s) => ({
      id: s.id,
      kind: s.kind,
      deviceId: s.deviceId,
      openedAt: s.openedAt,
    }));
  }

  forceClose(id: string): boolean {
    const s = this.sessions.get(id);
    if (!s) return false;
    s.close('user');
    this.remove(id);
    return true;
  }

  private ensureSweeper(): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => {
      const now = Date.now();
      for (const s of this.sessions.values()) {
        if (now - s.lastActiveAt > this.idleTimeoutMs) {
          s.close('idle');
          this.sessions.delete(s.id);
        }
      }
    }, 30_000);
    // Do not keep the process alive solely for the sweeper.
    this.sweeper.unref?.();
  }

  /** Shut down all sessions (server stop). */
  closeAll(): void {
    for (const s of this.sessions.values()) s.close('shutdown');
    this.sessions.clear();
    if (this.sweeper) {
      clearInterval(this.sweeper);
      this.sweeper = null;
    }
  }
}
