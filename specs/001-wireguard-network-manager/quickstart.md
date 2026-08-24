# Quickstart & Validation Guide: WireGuard Network Manager

This guide validates the feature end-to-end after implementation. It maps runnable scenarios to the spec's user stories and success criteria. It is a run/validation guide — implementation lives in `tasks.md` and code.

## Prerequisites

- Docker + Docker Compose on a Linux host.
- Host supports WireGuard (`/dev/net/tun`, ability to grant `NET_ADMIN`).
- For remote-server and SFTP scenarios: at least one reachable machine running OpenSSH (a second container fixture works).
- Reference: [contracts/rest-api.md](./contracts/rest-api.md), [contracts/websocket.md](./contracts/websocket.md), [data-model.md](./data-model.md).

## First run (setup)

```bash
# From repo root — starts the two services (backend Node/TS + frontend nginx)
cp deploy/.env.example deploy/.env   # set deploy-time config (no secrets baked into images)
docker compose -f deploy/docker-compose.yml up --build -d
# Compose grants the BACKEND service NET_ADMIN + /dev/net/tun, mounts the shared data volume,
# and publishes the FRONTEND (nginx) port bound to the WireGuard/localhost interface only.
```

1. Connect to the host (or the WireGuard network) and open the UI (localhost/WG address, HTTPS). nginx proxies `/api` and `/ws` to the backend.
2. **Setup**: create the single operator and set the **master passphrase** (`POST /auth/setup`). Expect a warning that a lost passphrase is unrecoverable.
3. Log in (`POST /auth/login`). Optionally enable 2FA and **save the recovery codes** (`/auth/2fa/enable`).

**Validates**: FR-017/018/019/024a. Confirm no secret appears in `docker logs` (SC-004).

## Scenario A — Manage a server and peers (User Story 1, P1)

1. Register a **local** server with an address range and endpoint (`POST /servers`). Confirm the response omits the private key.
2. Add two **peer** devices (`POST /servers/{id}/devices`, `kind=peer`); download each connection profile (`GET /devices/{id}/profile`).
3. Apply config (`POST /servers/{id}/apply`) and bring up the two peers using their profiles.
4. Check status (`GET /servers/{id}/status`) — both peers show `connected` with assigned addresses.
5. Rotate one peer's keys (`POST /devices/{id}/rotate-keys`); confirm the old profile stops working.
6. Revoke a device (`DELETE /devices/{id}`); confirm it can no longer connect.

**Validates**: FR-001…FR-007, FR-004/005; SC-001 (<15 min to two connected devices), SC-002 (<2 min to add+profile).

## Scenario B — In-browser SSH (User Story 2, P2)

1. Create an SSH target for a reachable device; install the returned **public** key on it; confirm/record the host key on first connect (`/ssh-targets/{id}/trust`).
2. Open the terminal (`WS /ws/ssh/{deviceId}`), run a command, see output, close cleanly.
3. Simulate a changed host key on the target → the session is **blocked** with `host_key_mismatch` and warns (SC-006).
4. Attempt with wrong credentials → clear failure, no secret leakage (FR-012).

**Validates**: FR-009/011/012/013; SC-003 (command within 10 s), SC-006.

## Scenario C — SFTP transfer (User Story 3, P3)

1. Open the file browser (`GET /sftp/{deviceId}?path=/`), list a directory.
2. Upload a file, then download it back; verify byte-for-byte match.
3. Interrupt a transfer → an `error` (not `done`) is reported; no partial file shown as complete.

**Validates**: FR-010; US3 acceptance scenarios.

## Scenario D — Wake-on-LAN via segment controller (User Story 4, P4)

1. Create a LAN segment; add an always-on device and set it as the segment's **wake controller** (`PATCH /segments/{id}`).
2. Add a **host** device (non-peer) on that segment with a MAC address.
3. View the device list — devices are grouped by segment and the controller is labeled (FR-014b).
4. Trigger wake (`POST /devices/{id}/wake`) — the app instructs the controller to emit the packet; outcome reported < 5 s (SC-008).
5. Try to wake a device missing a MAC / segment / controller → action prevented with an explanation (FR-016).

**Validates**: FR-014/014a/014b/015/016; SC-008.

## Scenario E — Remote server management (control plane over SSH)

1. Register a **remote** server pointing at a machine reachable by IP, via an SSH target.
2. Add a peer and apply config → the app runs the **vetted** WireGuard command set on the remote host over SSH (FR-001c).
3. Confirm arbitrary commands are NOT available through management flows (only via a deliberately opened SSH terminal) (FR-001d).

**Validates**: FR-001c/001d.

## Scenario F — Security posture & restart

1. Confirm the UI is **not** reachable on a public interface (only WG/localhost) (FR-022).
2. Restart the container. On restart, servers/devices are present but secret-dependent actions are blocked until you enter the master passphrase (`/vault/unlock`) (FR-018a, SC-007).
3. Verify session auto-logout after 30 minutes idle (FR-024).
4. Trigger repeated bad logins → lockout/backoff engages (FR-021, SC-009).
5. Review the audit log (`GET /audit`) — every action above appears with actor/time/outcome, no secrets (FR-020, SC-005).
6. Recovery: run the host-level CLI `docker compose run --rm backend node dist/recovery.js` to reset password / disable 2FA; and validate a one-time recovery code bypasses 2FA once (FR-024a).

**Validates**: FR-018a/020/021/022/024/024a; SC-004/005/007/009.

## Done criteria

All scenarios A–F pass, and every Success Criterion SC-001…SC-009 is demonstrably met with no secret values in logs or API responses.
