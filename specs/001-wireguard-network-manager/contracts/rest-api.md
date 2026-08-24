# REST API Contract: WireGuard Network Manager

Base path: `/api/v1`. Transport: HTTPS, bound only to loopback/WireGuard interface (FR-022).
Auth: HttpOnly session cookie after login; all `/api/v1/**` except the auth/unlock endpoints require an authenticated session AND an unlocked vault. Responses are JSON. Secret fields are **never** returned in read responses.

## Conventions

- Errors: `{ "error": { "code": string, "message": string } }` with appropriate HTTP status. Auth/connection failures never leak secret values (FR-012).
- IDs are UUID strings. Timestamps ISO-8601 UTC.
- Mutating endpoints emit an AuditEvent (FR-020).

## Auth & vault lifecycle

| Method | Path | Purpose | Notes |
|--------|------|---------|-------|
| POST | `/auth/setup` | First-run: create the single operator + set master passphrase | Only when uninitialized (FR-019, FR-018) |
| POST | `/auth/login` | Password (+ TOTP if enabled) → session | Lockout/backoff on repeated failure (FR-021) |
| POST | `/auth/logout` | Invalidate session | (FR-024) |
| POST | `/vault/unlock` | Provide master passphrase to unlock secrets | Required after each start (FR-018a) |
| POST | `/vault/lock` | Lock vault (zeroize keys) | |
| GET | `/vault/status` | `{ initialized, unlocked }` | Unauthenticated-safe status |
| POST | `/auth/2fa/enable` | Begin TOTP enrollment → provisioning URI + recovery codes | (FR-024a) |
| POST | `/auth/2fa/verify` | Confirm TOTP code to activate 2FA | |
| POST | `/auth/2fa/disable` | Disable TOTP (requires re-auth) | |
| POST | `/auth/passphrase` | Change master passphrase (re-wraps DEK) | Requires current passphrase |

`POST /auth/login` request: `{ "username", "password", "totp"? }` → `200 { "user": { "username" } }` + `Set-Cookie`. On lockout → `423 { error.code: "locked_out" }`.

## Servers

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/servers` | List servers (no secret fields) |
| POST | `/servers` | Register a server (`location`, `address_range`, `listen_endpoint`, `ssh_target` for remote) — generates server keypair (FR-001/001a) |
| GET | `/servers/{id}` | Server detail + status |
| PATCH | `/servers/{id}` | Edit config |
| DELETE | `/servers/{id}` | Remove server (and its devices) |
| POST | `/servers/{id}/apply` | Push staged config to the WG server (local `wg syncconf` / remote vetted command) (FR-001b/001c) |
| GET | `/servers/{id}/status` | Live status: interface up/down, peer handshakes (FR-006) |

`POST /servers` rejects overlapping `address_range` or missing `ssh_target` for `location=remote` (FR-007). Response never includes `server_private_key`.

## Devices & segments

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/servers/{id}/devices` | List devices grouped by LAN segment; each segment notes its wake controller (FR-014b) |
| POST | `/servers/{id}/devices` | Add device (`kind=peer\|host`, optional `segment_id`, `mac_address`, `ssh_target`) — peers get keypair + assigned address (FR-002/002a/003) |
| GET | `/devices/{id}` | Device detail (no private keys) |
| PATCH | `/devices/{id}` | Edit device |
| DELETE | `/devices/{id}` | Remove/revoke device (FR-005) |
| POST | `/devices/{id}/rotate-keys` | Rotate peer keys; invalidates old credentials (FR-004) |
| GET | `/devices/{id}/profile` | Download peer client connection profile (peer only) (FR-003) |
| POST | `/devices/{id}/wake` | Wake via the device's segment controller (FR-015) |
| GET | `/servers/{id}/segments` | List LAN segments |
| POST | `/servers/{id}/segments` | Create segment |
| PATCH | `/segments/{id}` | Edit segment / set `wake_controller_device_id` (FR-014a) |
| DELETE | `/segments/{id}` | Remove segment |

`POST /devices/{id}/wake` preconditions (else `422` with explanation, FR-016): device has `mac_address`, a `segment_id`, and that segment has a wake controller. Success → `{ "dispatched": true, "controller": "<name>" }`; reports outcome within 5 s (SC-008).

## SSH targets & host-key trust

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/ssh-targets` | List (no private keys) |
| POST | `/ssh-targets` | Create target; app generates keypair, returns **public** key to install (FR-010a) |
| PATCH | `/ssh-targets/{id}` | Edit |
| DELETE | `/ssh-targets/{id}` | Remove |
| POST | `/ssh-targets/{id}/trust` | Confirm/record host key on first connect (TOFU) (FR-011) |

A connection whose presented host key ≠ recorded key is blocked; the API surfaces `409 { error.code: "host_key_mismatch" }` (FR-011, SC-006).

## Sessions & audit

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/sessions` | List active interactive SSH/SFTP sessions |
| DELETE | `/sessions/{id}` | Force-close a session |
| GET | `/audit` | Query audit events (filter by action/date/target); paginated (FR-020) |
| GET | `/sftp/{deviceId}?path=` | List a remote directory (FR-010) |
| GET | `/sftp/{deviceId}/download?path=` | Download a file |
| POST | `/sftp/{deviceId}/upload?path=` | Upload a file (multipart) |

SFTP interactive/large transfers use the WebSocket channel (see `websocket.md`); the REST SFTP endpoints cover browse and simple up/down. Partial/failed transfers are reported, never presented as complete (US3 scenario 4).

## Health

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/healthz` | Liveness (no auth, no secrets) |
