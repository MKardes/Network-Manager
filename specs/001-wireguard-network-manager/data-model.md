# Phase 1 Data Model: WireGuard Network Manager

Persistence: embedded SQLite. Fields marked **🔒 encrypted** are stored as XChaCha20-Poly1305 ciphertext (envelope-encrypted; decryptable only while unlocked with the master passphrase). All timestamps are UTC.

## Entity: Operator (single row)

The sole administrator account.

| Field | Type | Notes |
|-------|------|-------|
| id | int PK | always 1 (single-admin invariant enforced) |
| username | text | display/login identifier |
| password_hash | text | Argon2id hash (not reversible; not counted as an encrypted secret) |
| totp_enabled | bool | whether 2FA is active |
| totp_secret | text 🔒 | present only when 2FA enabled |
| recovery_codes | json 🔒 | list of {code_hash, used_at?} one-time codes |
| failed_attempts | int | for lockout backoff |
| locked_until | datetime? | brute-force lockout expiry |
| created_at / updated_at | datetime | |

**Rules**: exactly one Operator row (FR-019). `totp_secret`/`recovery_codes` populated on 2FA setup (FR-024a). Lockout applied via `failed_attempts`/`locked_until` (FR-021).

## Entity: VaultState (single row)

Holds the wrapped data-encryption key; enables unlock and passphrase change.

| Field | Type | Notes |
|-------|------|-------|
| id | int PK | always 1 |
| kdf_salt | blob | Argon2id salt for the KEK |
| kdf_params | json | Argon2id time/memory/parallelism |
| wrapped_dek | blob | DEK encrypted under the passphrase-derived KEK |
| created_at / updated_at | datetime | |

**Rules**: never stores the passphrase, KEK, or plaintext DEK (FR-018). Passphrase change re-wraps the same DEK (no field re-encryption).

## Entity: WireGuardServer

A managed WireGuard network the operator can select.

| Field | Type | Notes |
|-------|------|-------|
| id | uuid PK | |
| name | text | friendly name, unique |
| location | enum | `local` \| `remote` (FR-001) |
| address_range | cidr | tunnel subnet (e.g., 10.0.0.0/24) |
| listen_endpoint | text | host:port advertised to peers |
| server_private_key | text 🔒 | WireGuard server key |
| server_public_key | text | derived, shareable |
| ssh_target_id | uuid? FK → SSHTarget | required when `location=remote` (how the app reaches it) |
| status | enum | `up` \| `down` \| `unknown` |
| last_synced_at | datetime? | last successful config apply/query |
| created_at / updated_at | datetime | |

**Rules**: `local` servers operated via `wg`/`wg-quick` on host (FR-001b); `remote` servers operated over SSH via `ssh_target_id` (FR-001c). Address assignments to devices validated against `address_range` (FR-007).

## Entity: LANSegment

A local network grouping used for Wake-on-LAN.

| Field | Type | Notes |
|-------|------|-------|
| id | uuid PK | |
| server_id | uuid FK → WireGuardServer | owning server |
| name | text | label, unique within server |
| wake_controller_device_id | uuid? FK → Device | the always-on host that emits magic packets (FR-014a) |
| created_at / updated_at | datetime | |

**Rules**: a wake action requires a non-null `wake_controller_device_id` (FR-016). UI groups devices by segment and shows the controller (FR-014b).

## Entity: Device

A managed machine — either a WireGuard peer or a non-peer LAN host.

| Field | Type | Notes |
|-------|------|-------|
| id | uuid PK | |
| server_id | uuid FK → WireGuardServer | |
| name | text | friendly name |
| kind | enum | `peer` \| `host` (FR-002/002a) |
| segment_id | uuid? FK → LANSegment | LAN membership (needed for WOL) |
| is_wake_controller | bool | true if this device controls its segment's WOL |
| mac_address | text? | required to be a wake target |
| tunnel_address | ip? | **peer only** — assigned WG address (unique within server) |
| peer_public_key | text? | **peer only** |
| peer_private_key | text? 🔒 | **peer only** — for generated client profiles |
| ssh_target_id | uuid? FK → SSHTarget | how to reach it for SSH/SFTP (if applicable) |
| reachability | enum | `connected` \| `offline` \| `unknown` |
| last_seen_at | datetime? | from WG handshake or probe |
| created_at / updated_at | datetime | |

**Rules**:
- `kind=peer` ⇒ `tunnel_address`, `peer_public_key` required and unique within server; WG fields ignored/empty for `kind=host` (FR-002a/003).
- Wake target ⇒ `mac_address` + `segment_id` + segment has a controller (FR-016).
- Key rotation replaces `peer_public_key`/`peer_private_key`, invalidating old credentials (FR-004). Revoke = remove from server config so it can no longer connect (FR-005).

## Entity: SSHTarget

Reusable SSH connection details for a remote server or device (app-managed key auth).

| Field | Type | Notes |
|-------|------|-------|
| id | uuid PK | |
| host | text | IP/hostname reachable from deployment |
| port | int | default 22 |
| username | text | SSH login |
| private_key | text 🔒 | app-managed SSH private key (FR-010a) |
| public_key | text | to install on the target |
| known_host_key | text? | trusted host key fingerprint (TOFU-recorded) |
| created_at / updated_at | datetime | |

**Rules**: connections use key-based auth (FR-010a). On connect, the presented host key must match `known_host_key`; a mismatch blocks the session and warns (FR-011). First connection records the key (trust-on-first-use) with operator confirmation.

## Entity: AuditEvent (append-only)

| Field | Type | Notes |
|-------|------|-------|
| id | uuid PK | |
| occurred_at | datetime | |
| actor | text | operator username (always the single admin) |
| action | enum | login, logout, unlock, server_create/update/delete, device_add/update/remove, key_rotate, ssh_session_open/close, sftp_transfer, wake, recovery_used, passphrase_change, … |
| target_type | text? | e.g., server/device |
| target_id | text? | |
| outcome | enum | `success` \| `failure` |
| detail | text? | non-secret context (never contains secret values — FR-018) |

**Rules**: written for every security-relevant action (FR-020); retained ≥ 12 months. No secret values recorded.

## Entity: Session (server-side, may be in-memory or table-backed)

| Field | Type | Notes |
|-------|------|-------|
| id | text PK | opaque session id (cookie value) |
| created_at | datetime | |
| last_active_at | datetime | idle-timeout basis (30 min — FR-024) |
| authed | bool | password (+TOTP if enabled) satisfied |

**Rules**: invalidated on logout and after 30 minutes idle (FR-024). Distinct from the vault unlock state, which is process-global (FR-018a).

## Relationships (summary)

```text
Operator (1) ── (owns) ── everything
VaultState (1) ── protects ── all 🔒 fields
WireGuardServer (1) ──< Device (N)
WireGuardServer (1) ──< LANSegment (N)
LANSegment (1) ──< Device (N)         # membership
LANSegment (1) ──1 Device             # wake controller
WireGuardServer (0..1) ──1 SSHTarget  # remote server access
Device (0..1) ──1 SSHTarget           # device SSH/SFTP access
AuditEvent (N) ── reference ── any entity (by target_type/id)
```

## Lifecycle notes

- **Vault**: `uninitialized` → (set passphrase) → `locked` → (unlock) → `unlocked`; returns to `locked` on restart (FR-018a).
- **Device (peer)**: `draft` → `active` (in server config) → `revoked`/`removed`. Key rotation keeps identity, swaps keys (FR-004).
- **Server**: config changes are staged then applied (`wg syncconf` locally / vetted command remotely); `status`/`last_synced_at` updated on apply.
