import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DB } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Simple forward-only migration runner. Migrations are ordered *.sql files in
 * ./migrations; each is applied once and recorded in schema_migrations.
 */
export function runMigrations(db: DB): string[] {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
       name TEXT PRIMARY KEY,
       applied_at TEXT NOT NULL DEFAULT (datetime('now'))
     );`,
  );

  const dir = join(__dirname, 'migrations');
  const files = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied = new Set(
    db
      .prepare('SELECT name FROM schema_migrations')
      .all()
      .map((r) => (r as { name: string }).name),
  );

  const newlyApplied: string[] = [];
  const record = db.prepare('INSERT INTO schema_migrations (name) VALUES (?)');

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(dir, file), 'utf8');
    const tx = db.transaction(() => {
      db.exec(sql);
      record.run(file);
    });
    tx();
    newlyApplied.push(file);
  }
  return newlyApplied;
}
