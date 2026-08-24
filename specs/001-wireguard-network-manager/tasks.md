---

description: "Task list for WireGuard Network Manager implementation"
---

# Tasks: WireGuard Network Manager

**Input**: Design documents from `/specs/001-wireguard-network-manager/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Stack**: Node.js 22 + TypeScript (Fastify backend) · React + TypeScript (Vite/nginx frontend) · SQLite (better-sqlite3) · Docker Compose

**Tests**: Included. This is a security-critical application; `plan.md` defines a contract/integration testing strategy and `quickstart.md` defines validation scenarios, so targeted test tasks are generated per story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US4 map to spec.md user stories; Setup/Foundational/Polish carry no story label
- Paths follow the two-service layout: `backend/src/…`, `frontend/src/…`, `deploy/…`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Repository scaffolding, toolchains, and container/compose skeleton

- [X] T001 Create the two-service repo structure (`backend/`, `frontend/`, `deploy/`) per plan.md
- [X] T002 [P] Initialize backend Node/TS project in `backend/package.json` + `backend/tsconfig.json` with Fastify, `@fastify/websocket`, `ssh2`, `better-sqlite3`, `argon2`, `libsodium-wrappers`, `otplib`, `zod`, `pino`, `vitest`
- [X] T003 [P] Initialize frontend React/TS project in `frontend/package.json` + `frontend/tsconfig.json` + `frontend/vite.config.ts` with React 18, `xterm.js`, `vitest`, React Testing Library
- [X] T004 [P] Configure ESLint + Prettier for backend in `backend/.eslintrc.cjs` and `backend/.prettierrc`
- [X] T005 [P] Configure ESLint + Prettier for frontend in `frontend/.eslintrc.cjs` and `frontend/.prettierrc`
- [X] T006 [P] Author backend runtime image in `backend/Dockerfile` (multi-stage slim Node base + `wireguard-tools` + `wakeonlan`)
- [X] T007 [P] Author frontend image + proxy in `frontend/Dockerfile` and `frontend/nginx.conf` (Vite build → nginx-alpine; reverse-proxy `/api` and `/ws` to backend)
- [X] T008 Author `deploy/docker-compose.yml` (backend with `cap_add: [NET_ADMIN]`, `/dev/net/tun`, data volume; frontend nginx; ports bound to loopback/WG) and `deploy/.env.example`

**Checkpoint**: `docker compose build` succeeds for both services.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Security core (encryption, auth, audit), persistence, the shared SSH runner, and the app/UI shell that every user story depends on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Backend infrastructure

- [X] T009 Implement config + startup bind-address enforcement (loopback/WG only; refuse public bind unless explicit override) in `backend/src/config/index.ts`
- [X] T010 [P] Configure `pino` structured logging with secret redaction serializers in `backend/src/http/logger.ts`
- [X] T011 SQLite connection (WAL) + migration runner in `backend/src/store/db.ts` and `backend/src/store/migrate.ts`
- [X] T012 Migration for core security tables (Operator, VaultState, AuditEvent, Session) in `backend/src/store/migrations/0001_core.sql`
- [X] T013 [P] Migration for SSHTarget table in `backend/src/store/migrations/0002_ssh_targets.sql`
- [X] T014 [P] Crypto vault: Argon2id KDF, random DEK, XChaCha20-Poly1305 envelope, in-memory unlock/lock + zeroize in `backend/src/crypto/vault.ts`
- [X] T015 [P] Encrypted-field repository helper (encrypt on write / decrypt on read when unlocked) in `backend/src/store/encrypted.ts` (depends on T014)
- [X] T016 Auth core: password hashing (`argon2`), server-side sessions (HttpOnly/Secure/SameSite, 30-min idle), brute-force lockout/backoff in `backend/src/auth/auth.ts`, `backend/src/auth/sessions.ts`, `backend/src/auth/lockout.ts`
- [X] T017 [P] TOTP (`otplib`) enrollment/verify + one-time recovery codes (hashed, single-use) in `backend/src/auth/totp.ts` and `backend/src/auth/recovery-codes.ts`
- [X] T018 Audit service: record security-relevant events + 12-month retention/pruning in `backend/src/audit/audit.ts`
- [X] T019 SSH runner over `ssh2`: key-based connect, host-key TOFU/verify, fixed vetted-command executor, interactive-shell + SFTP factories in `backend/src/remote/runner.ts`, `backend/src/remote/host-keys.ts`, `backend/src/remote/commands.ts`
- [X] T020 SSHTarget repo + REST routes (create returns public key; trust-on-first-use endpoint) in `backend/src/store/ssh-targets.ts` and `backend/src/http/routes/ssh-targets.ts`
- [X] T021 Fastify app bootstrap: REST + WS registration, global error handler (no secret leakage), `/healthz`, in `backend/src/http/app.ts` and `backend/src/index.ts`
- [X] T022 Auth/vault gate middleware + routes: `/auth/setup|login|logout|2fa/*|passphrase`, `/vault/unlock|lock|status` in `backend/src/http/middleware/guard.ts`, `backend/src/http/routes/auth.ts`, `backend/src/http/routes/vault.ts`
- [X] T023 Host-level recovery CLI (reset password / disable 2FA) in `backend/src/recovery.ts`

### Frontend shell

- [X] T024 [P] App shell with routing + auth/unlock route guards in `frontend/src/app/`
- [X] T025 [P] Typed REST/WS API client base in `frontend/src/api/client.ts`
- [X] T026 [P] Setup, Login (password + TOTP), and Unlock pages in `frontend/src/pages/Setup.tsx`, `frontend/src/pages/Login.tsx`, `frontend/src/pages/Unlock.tsx`

### Foundational tests

- [X] T027 [P] Contract tests for auth/vault endpoints in `backend/tests/contract/auth.test.ts`
- [X] T028 [P] Unit tests for crypto envelope + KDF (encrypt/decrypt roundtrip, wrong passphrase fails) in `backend/tests/unit/vault.test.ts`
- [X] T029 [P] Integration test: SSH runner against an OpenSSH fixture (host-key trust + host-key mismatch block + vetted exec) in `backend/tests/integration/runner.test.ts`

**Checkpoint**: Operator can complete first-run setup, log in (optionally with 2FA), unlock the vault; secrets encrypt/decrypt; SSH runner verified. User stories can now begin.

---

## Phase 3: User Story 1 - Manage WireGuard servers and their devices (Priority: P1) 🎯 MVP

**Goal**: Register local/remote WireGuard servers, add peer and non-peer devices, generate keys/profiles, apply config, view status, rotate keys, revoke.

**Independent Test**: Register two servers, select one, add two peers, download profiles, apply, confirm both connect; rotate one peer's keys and confirm the old profile stops working; revoke a device.

### Tests for User Story 1

- [X] T030 [P] [US1] Contract tests for `/servers` and `/devices` (incl. private-key omission, address-conflict rejection) in `backend/tests/contract/servers.test.ts` and `backend/tests/contract/devices.test.ts`
- [X] T031 [P] [US1] Integration test: register server → add peers → apply → status → rotate → revoke in `backend/tests/integration/us1.test.ts`

### Implementation for User Story 1

- [X] T032 [P] [US1] Migration for `wireguard_servers`, `devices`, `lan_segments` tables in `backend/src/store/migrations/0003_servers_devices.sql`
- [X] T033 [P] [US1] WireGuardServer repo (encrypted server key field) in `backend/src/store/servers.ts`
- [X] T034 [P] [US1] Device repo (peer vs host, unique tunnel address per server) in `backend/src/store/devices.ts`
- [X] T035 [US1] WireGuard keypair generation + client connection-profile builder in `backend/src/servers/keys.ts` and `backend/src/servers/profile.ts`
- [X] T036 [US1] Local server apply via `wg`/`wg syncconf`/`wg-quick` child processes in `backend/src/servers/local.ts`
- [X] T037 [US1] Remote server apply via the SSH runner vetted command set in `backend/src/servers/remote.ts` (depends on T019)
- [X] T038 [US1] Server service: create/edit/delete, address allocation + conflict checks, apply, live status in `backend/src/servers/service.ts` (depends on T033, T035, T036, T037)
- [X] T039 [US1] Device service: add/edit/remove, peer/host validation, key rotation, revoke in `backend/src/devices/service.ts` (depends on T034, T035)
- [X] T040 [US1] REST routes for servers, devices (grouped-by-segment listing), and profile download in `backend/src/http/routes/servers.ts` and `backend/src/http/routes/devices.ts`
- [X] T041 [US1] Emit audit events for server/device/key-rotation/revoke actions (wire T018 into T038/T039)
- [X] T042 [P] [US1] Frontend Servers page: list, register/edit form, select-active, status in `frontend/src/pages/Servers.tsx`
- [X] T043 [P] [US1] Frontend Devices page: list grouped by LAN, add/edit device, rotate/revoke, download profile in `frontend/src/pages/Devices.tsx`

**Checkpoint**: User Story 1 fully functional and independently testable (MVP).

---

## Phase 4: User Story 2 - In-browser SSH session (Priority: P2)

**Goal**: Open an interactive SSH terminal to a reachable device in the browser, with host-key verification and clean credential teardown.

**Independent Test**: Open a terminal to a reachable device, run a command, see output, close cleanly; a changed host key blocks the session with a warning; wrong credentials fail clearly.

### Tests for User Story 2

- [X] T044 [P] [US2] Integration test: WS SSH terminal happy path + host-key-mismatch block + auth-failure message in `backend/tests/integration/us2-ssh.test.ts`

### Implementation for User Story 2

- [X] T045 [US2] SSH terminal WebSocket handler bridging `ssh2` shell/PTY (input/output/resize, host-key gate before `ready`) in `backend/src/session/ssh-ws.ts` (depends on T019)
- [X] T046 [US2] Session registry: track active sessions, idle timeout, force-close, discard credentials on close in `backend/src/session/registry.ts`
- [X] T047 [US2] REST `/sessions` list + force-close routes in `backend/src/http/routes/sessions.ts`
- [X] T048 [P] [US2] Frontend Terminal page + `xterm.js` component over the WS channel in `frontend/src/pages/Terminal.tsx` and `frontend/src/components/Terminal.tsx`

**Checkpoint**: User Stories 1 and 2 both work independently.

---

## Phase 5: User Story 3 - SFTP file transfer (Priority: P3)

**Goal**: Browse remote directories and upload/download files over SFTP through the in-app file browser, with correct partial-failure handling.

**Independent Test**: List a directory, upload a file and download it back (byte-for-byte match), and confirm an interrupted transfer is reported as an error (never as complete).

### Tests for User Story 3

- [X] T049 [P] [US3] Integration test: SFTP list/upload/download roundtrip + partial-transfer error in `backend/tests/integration/us3-sftp.test.ts`

### Implementation for User Story 3

- [X] T050 [US3] SFTP service over `ssh2` SFTP subsystem (list/get/put) in `backend/src/session/sftp.ts` (depends on T019)
- [X] T051 [US3] REST SFTP browse/download/upload routes in `backend/src/http/routes/sftp.ts`
- [X] T052 [US3] SFTP streaming WebSocket channel with progress/cancel and error-not-done semantics in `backend/src/session/sftp-ws.ts`
- [X] T053 [P] [US3] Frontend Files page + file-browser component (list/upload/download/progress) in `frontend/src/pages/Files.tsx` and `frontend/src/components/FileBrowser.tsx`

**Checkpoint**: User Stories 1–3 all independently functional.

---

## Phase 6: User Story 4 - Wake-on-LAN via segment controller (Priority: P4)

**Goal**: Organize devices by LAN segment, designate an always-on wake controller per segment, and wake a device by instructing its segment's controller; UI clearly shows LAN grouping and the controller.

**Independent Test**: Create a segment, set a controller, add a host device with a MAC, trigger wake (controller emits the packet, outcome reported <5s), and confirm wake is blocked with an explanation when MAC/segment/controller is missing.

### Tests for User Story 4

- [X] T054 [P] [US4] Integration test: wake dispatched via controller + precondition-failure explanations in `backend/tests/integration/us4-wol.test.ts`

### Implementation for User Story 4

- [X] T055 [US4] Segment service: CRUD + set `wake_controller_device_id` in `backend/src/devices/segments.ts`
- [X] T056 [US4] Wake orchestration: run `wakeonlan`/`etherwake` on the segment controller via the runner, enforce preconditions in `backend/src/wol/service.ts` (depends on T019, T055)
- [X] T057 [US4] REST routes: `/servers/{id}/segments`, `/segments/{id}`, and `/devices/{id}/wake` in `backend/src/http/routes/segments.ts` (extend `backend/src/http/routes/devices.ts` with wake)
- [X] T058 [P] [US4] Frontend: segment management + wake controls + controller labeling on the Devices page in `frontend/src/components/WakeControls.tsx` and `frontend/src/components/SegmentForm.tsx`

**Checkpoint**: All four user stories independently functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Remaining UI, hardening, docs, and full validation across stories.

- [X] T059 [P] Audit log: `/audit` query route (filter/paginate) in `backend/src/http/routes/audit.ts` + Audit viewer page in `frontend/src/pages/Audit.tsx`
- [X] T060 [P] Settings page: enable/disable 2FA, view/regenerate recovery codes, change master passphrase in `frontend/src/pages/Settings.tsx`
- [X] T061 Container hardening in `deploy/docker-compose.yml` + Dockerfiles: non-root, read-only root FS (writable data volume), drop all caps except `NET_ADMIN`, ports bound to loopback/WG
- [X] T062 Security hardening pass: verify no secret appears in any API response or log (redaction), enforce TLS for the private origin, review host-key mismatch handling end-to-end
- [X] T063 [P] Deployment docs in `deploy/README.md`: first-run (set master passphrase), 2FA + recovery codes, host-level recovery, WireGuard capability/`/dev/net/tun` notes
- [X] T064 Run `quickstart.md` scenarios A–F end-to-end and record results
- [X] T065 [P] Performance validation against SC targets (wake <5s SC-008, SSH command <10s SC-003, management calls <300ms) in `backend/tests/integration/perf.test.ts`

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2)**: depends on Setup; **blocks all user stories**. The SSH runner (T019), crypto vault (T014/T015), auth/vault gate (T016/T022), and migrations (T011–T013) are the critical prerequisites.
- **User Stories (Phases 3–6)**: each depends only on Foundational. US2, US3, US4 each additionally reuse the SSH runner (T019) and, for real targets, SSHTargets (T020) — both foundational, so the stories remain mutually independent.
- **Polish (Phase 7)**: depends on the user stories it touches.

### User story dependencies

- **US1 (P1)**: after Foundational. No dependency on other stories.
- **US2 (P2)**: after Foundational. Independent of US1 (uses SSHTargets from Foundational; a device row is convenient but the SSH path stands alone).
- **US3 (P3)**: after Foundational. Independent; shares the SSH runner with US2.
- **US4 (P4)**: after Foundational. Uses segments/devices repos; independently testable with a host device.

### Within each story

- Tests first (write, see fail) → migrations/repos → services → routes → frontend.
- Models/repos before services; services before routes.

### Parallel opportunities

- Setup: T002–T007 in parallel (T004/005 after their inits).
- Foundational: T010, T013, T014, T017 and frontend shell T024–T026 and tests T027–T029 in parallel; T015 after T014; T022 after T016/T017; routes after T021.
- Within US1: T032/T033/T034 in parallel; T042/T043 (frontend) parallel to backend once routes land.
- Across stories: once Foundational is done, US1–US4 can be staffed in parallel.

---

## Parallel Example: User Story 1

```bash
# Tests for US1 together:
Task: "Contract tests for /servers and /devices in backend/tests/contract/servers.test.ts, devices.test.ts"
Task: "Integration test us1 in backend/tests/integration/us1.test.ts"

# Repos/migration for US1 together:
Task: "Migration 0003_servers_devices.sql"
Task: "WireGuardServer repo in backend/src/store/servers.ts"
Task: "Device repo in backend/src/store/devices.ts"
```

---

## Implementation Strategy

### MVP first (User Story 1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational (critical) → 3. Phase 3 US1 → **STOP & validate** (spec Scenario A) → demo. This delivers a working, secured, multi-server WireGuard manager.

### Incremental delivery

Foundation → US1 (MVP) → US2 (SSH) → US3 (SFTP) → US4 (WOL) → Polish. Each story is a deployable increment that doesn't break the previous ones.

### Parallel team strategy

After Foundational, assign US1/US2/US3/US4 to separate developers; they integrate through the shared foundational layer (runner, auth, store) without cross-story coupling.

---

## Notes

- `[P]` = different files, no incomplete dependencies.
- Every secret-bearing field goes through the encrypted repository helper (T015); never return secrets in API responses or logs (T062).
- All mutating routes emit audit events (T018/T041).
- Verify tests fail before implementing; commit after each task or logical group.
- Stop at any checkpoint to validate a story independently against `quickstart.md`.
