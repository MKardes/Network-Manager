-- Core security tables: Operator, VaultState, AuditEvent, Session.

-- Single administrator account (id is always 1; single-admin invariant).
CREATE TABLE operator (
  id              INTEGER PRIMARY KEY CHECK (id = 1),
  username        TEXT NOT NULL,
  password_hash   TEXT NOT NULL,
  totp_enabled    INTEGER NOT NULL DEFAULT 0,
  totp_secret     TEXT,            -- 🔒 encrypted (present only when 2FA enabled)
  recovery_codes  TEXT,            -- 🔒 encrypted JSON array of {code_hash, used_at?}
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Wrapped data-encryption key + KDF parameters (never stores passphrase/KEK/DEK).
CREATE TABLE vault_state (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  kdf_salt    BLOB NOT NULL,
  kdf_params  TEXT NOT NULL,       -- JSON: {type, timeCost, memoryCost, parallelism}
  wrapped_dek BLOB NOT NULL,       -- DEK encrypted under the passphrase-derived KEK
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Append-only audit log (retained >= 12 months; no secret values).
CREATE TABLE audit_event (
  id          TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  actor       TEXT NOT NULL,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  outcome     TEXT NOT NULL CHECK (outcome IN ('success','failure')),
  detail      TEXT
);
CREATE INDEX idx_audit_occurred_at ON audit_event (occurred_at);
CREATE INDEX idx_audit_action ON audit_event (action);

-- Server-side sessions.
CREATE TABLE session (
  id             TEXT PRIMARY KEY,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  last_active_at TEXT NOT NULL DEFAULT (datetime('now')),
  authed         INTEGER NOT NULL DEFAULT 0
);
