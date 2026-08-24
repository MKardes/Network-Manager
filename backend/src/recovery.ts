import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { loadConfig } from './config/index.js';
import { openDb } from './store/db.js';
import { runMigrations } from './store/migrate.js';
import { OperatorRepo } from './auth/auth.js';

/**
 * Host-level recovery CLI (FR-024a). Run via:
 *   docker compose run --rm backend node dist/recovery.js
 *
 * Lets an operator who is locked out reset the password or disable 2FA WITHOUT
 * unlocking the vault. Disabling 2FA clears the (encrypted) TOTP secret and
 * recovery codes; resetting the password only rewrites the Argon2 hash. Neither
 * action needs the master passphrase, and neither exposes any secret.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const db = openDb(config.dataDir);
  runMigrations(db);
  const operators = new OperatorRepo(db);

  if (!operators.exists()) {
    stdout.write('No operator account exists yet. Complete first-run setup in the UI.\n');
    process.exit(1);
  }

  const rl = createInterface({ input: stdin, output: stdout });
  stdout.write('WireGuard Network Manager — recovery\n');
  stdout.write('  1) Reset password\n');
  stdout.write('  2) Disable 2FA (TOTP)\n');
  stdout.write('  3) Reset password AND disable 2FA\n');
  const choice = (await rl.question('Choose [1-3]: ')).trim();

  const resetPw = choice === '1' || choice === '3';
  const disable2fa = choice === '2' || choice === '3';

  if (resetPw) {
    const pw = (await rl.question('New password (min 8 chars): ')).trim();
    if (pw.length < 8) {
      stdout.write('Password too short. Aborting.\n');
      await rl.close();
      process.exit(1);
    }
    await operators.setPassword(pw);
    stdout.write('Password reset.\n');
  }
  if (disable2fa) {
    operators.disableTotp();
    stdout.write('2FA disabled.\n');
  }
  if (!resetPw && !disable2fa) {
    stdout.write('No action taken.\n');
  }

  // Clear any lockout so the operator can log in again.
  db.prepare(`UPDATE operator SET failed_attempts = 0, locked_until = NULL WHERE id = 1`).run();
  db.prepare(
    `INSERT INTO audit_event (id, actor, action, outcome, detail)
     VALUES (lower(hex(randomblob(16))), 'recovery-cli', 'recovery_used', 'success', ?)`,
  ).run(`reset_pw=${resetPw} disable_2fa=${disable2fa}`);

  await rl.close();
  db.close();
  process.exit(0);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('recovery failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
