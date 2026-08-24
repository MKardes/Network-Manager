import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type DB = Database.Database;

let instance: DB | null = null;

/**
 * Open (or return the already-open) SQLite database in WAL mode.
 * The file lives on the durable data volume (DATA_DIR).
 */
export function openDb(dataDir: string): DB {
  if (instance) return instance;
  const file = join(dataDir, 'wgnm.sqlite');
  mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  instance = db;
  return db;
}

/** For tests: open an isolated in-memory database. */
export function openMemoryDb(): DB {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  return db;
}

export function closeDb(): void {
  if (instance) {
    instance.close();
    instance = null;
  }
}
