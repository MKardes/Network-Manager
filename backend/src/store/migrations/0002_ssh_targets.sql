-- Reusable SSH connection details (app-managed key auth, host-key TOFU).
CREATE TABLE ssh_target (
  id             TEXT PRIMARY KEY,
  host           TEXT NOT NULL,
  port           INTEGER NOT NULL DEFAULT 22,
  username       TEXT NOT NULL,
  private_key    TEXT NOT NULL,   -- 🔒 encrypted app-managed SSH private key
  public_key     TEXT NOT NULL,   -- installed on the target
  known_host_key TEXT,            -- trusted host key (TOFU-recorded)
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
