-- Peer import & manual client IP (feature 002).
-- Track a peer's origin (created in-app vs imported from the server) and its
-- management state (managed vs imported/needs-review), plus the verbatim
-- AllowedIPs for imported peers that are not a single clean /32 host.

ALTER TABLE device ADD COLUMN origin TEXT NOT NULL DEFAULT 'created'
  CHECK (origin IN ('created','imported'));

ALTER TABLE device ADD COLUMN management_state TEXT NOT NULL DEFAULT 'managed'
  CHECK (management_state IN ('managed','needs_review'));

ALTER TABLE device ADD COLUMN allowed_ips TEXT;
