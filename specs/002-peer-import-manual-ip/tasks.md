---
description: "Task list for feature 002-peer-import-manual-ip"
---

# Tasks: Existing Peer Visibility & Manual Client IP Assignment

**Input**: Design documents from `/specs/002-peer-import-manual-ip/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/rest-api.md, quickstart.md

**Tests**: Included — the project has established unit/contract/integration suites (Vitest) and quickstart.md names specific new test files.

**Organization**: Grouped by user story (US1 P1, US2 P2, US3 P3) after shared foundational work.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 / US2 / US3 for story-phase tasks

## Path Conventions

Web app: `backend/src/`, `backend/tests/`, `frontend/src/`.

---

## Phase 1: Setup

- [X] T001 Confirm baseline is green before changes: run `cd backend && npm test` and `cd frontend && npm run build`; note any pre-existing failures so new failures are attributable.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: Blocks all user stories. These are shared schema/plumbing changes.

- [X] T002 Add forward-only migration `backend/src/store/migrations/0004_peer_import.sql`: `ALTER TABLE device` add `origin TEXT NOT NULL DEFAULT 'created' CHECK (origin IN ('created','imported'))`, `management_state TEXT NOT NULL DEFAULT 'managed' CHECK (management_state IN ('managed','needs_review'))`, and `allowed_ips TEXT`.
- [X] T003 Extend `DeviceRow`, `DeviceView`, and `toDeviceView` in `backend/src/store/devices.ts` with `origin`, `managementState`/`management_state`, and `allowedIps`/`allowed_ips` (per data-model.md).
- [X] T004 [P] Generalize address math in `backend/src/servers/net.ts`: parse a used entry as CIDR when it contains `/` else treat as `/32`; add `addressCovered(addr, cidrs)` using integer range containment; make `allocateAddress(range, used)` skip any candidate covered by a used range (keep bare-IP inputs working); add `validateAssignableAddress(range, addr, used)` that rejects malformed / out-of-range / network / server(.1) / broadcast / covered addresses with distinguishable reasons; add `addressOutOfRange(addr, range)`. Skip non-IPv4 entries safely.
- [X] T005 Extend `DeviceRepo` in `backend/src/store/devices.ts`: `create` accepts `origin`/`managementState`/`allowedIps`; add `getByPublicKey(serverId, publicKey)`, `usedCidrs(serverId)` (managed → `tunnel_address/32`, imported → split `allowed_ips`), `importPeer({serverId,name,publicKey,tunnelAddress,allowedIps})` inserting `origin='imported', management_state='needs_review'`, and `adopt(id, name)` setting `name` + `management_state='managed'`.
- [X] T006 [P] Update `buildServerConfig` in `backend/src/servers/profile.ts`: `ServerPeer` gains optional `allowedIps`; render `AllowedIPs = <allowedIps>` when present, else `<tunnelAddress>/32`.

**Checkpoint**: Schema + repo + address helpers + config renderer ready.

---

## Phase 3: User Story 1 — See current peers, non-destructive apply (Priority: P1) 🎯 MVP

**Goal**: Reconcile live server peers with tracked devices, import unknown peers as `needs_review`, display managed/needs-review with connection state and discrepancy/out-of-range flags, and make `apply` non-destructive.

**Independent Test**: With a stubbed live peer unknown to the app, `GET /servers/:id/peers` lists it as `needs_review`/`imported` and `presentOnServer:true`; `apply` renders a config that still contains it.

### Tests for User Story 1

- [X] T007 [P] [US1] Unit test `backend/tests/unit/peers.test.ts`: reconciliation correlates by public key, imports unknown live peers as `needs_review`, flags `presentOnServer:false` for tracked-but-absent, sets `outOfRange` for out-of-range addresses, single-`/32` stored in `tunnel_address` vs subnet stored in `allowed_ips`.
- [X] T008 [P] [US1] Contract test `backend/tests/contract/peers.test.ts`: `GET /servers/:id/peers` shape (`live`, `peers[]`), managed vs needs_review labeling, and `live:false` when status is unknown (stub the applier via a device with an unreachable/`unknown` server).

### Implementation for User Story 1

- [X] T009 [US1] Implement `PeerReconcileService` in `backend/src/servers/peers.ts`: `reconcile(serverId)` calls `serverService.status(serverId)`, correlates live peers to devices by public key, imports unknowns via `devices.importPeer` (address-derivation rule from data-model.md, using `usedAddresses`), and returns `{ live, peers: ReconciledPeer[] }` including `presentOnServer`, `connected`, `latestHandshake`, `endpoint`, `outOfRange`, `hasPrivateKey`.
- [X] T010 [US1] Wire `PeerReconcileService` into `AppContext` in `backend/src/http/context.ts` (construct after `serverService`/`devices`, export as `peerService`).
- [X] T011 [US1] Update `ServerService` in `backend/src/servers/service.ts`: `renderConfig` includes ALL peer devices with a public key (managed + needs_review), using `allowed_ips` when present else `tunnel_address/32`; `apply(id)` reconciles (imports live peers) before rendering so syncconf is non-destructive (FR-016/017/018). Avoid a circular dep (do reconciliation inline in ServerService or inject the reconciler).
- [X] T012 [US1] Add `GET /servers/:id/peers` route in `backend/src/http/routes/servers.ts` calling `ctx.peerService.reconcile(id)` (404 if server missing).
- [X] T013 [P] [US1] Frontend: add `Peer`/`PeersResponse` types and `managementState`/`origin`/`allowedIps` to `Device` in `frontend/src/api/client.ts`.
- [X] T014 [US1] Frontend: add a **Current peers** panel to `frontend/src/pages/Devices.tsx` that loads `/servers/:id/peers`, renders each peer with a managed/needs-review badge, connection state, and warning badges for `not on server` (discrepancy) and `out of range`; show a not-live notice when `live:false`.

**Checkpoint**: US1 fully functional — peers visible, imports persisted, apply preserves external peers.

---

## Phase 4: User Story 2 — Assign a specific tunnel IP (Priority: P2)

**Goal**: Operator can supply an exact tunnel address when adding a peer; validation rejects out-of-range/reserved/in-use (including imported subnets); omitting it auto-assigns as before.

**Independent Test**: `POST /servers/:id/devices` with `tunnelAddress:"10.0.0.50"` creates that exact address; duplicate → `409`; out-of-range → `400`; inside an imported subnet → `409`.

### Tests for User Story 2

- [X] T015 [P] [US2] Unit tests in `backend/tests/unit/net.test.ts`: `addressCovered` with a `/24`, `allocateAddress` skips a subnet-covered range, and `validateAssignableAddress` distinguishes out-of-range / reserved / in-use.
- [X] T016 [P] [US2] Contract tests in `backend/tests/contract/peers.test.ts`: manual `tunnelAddress` accepted; duplicate → `409 address_in_use`; out-of-range → `400 validation`; address within an imported peer's subnet → `409`; omitted → auto-assign preserved.

### Implementation for User Story 2

- [X] T017 [US2] Add optional `tunnelAddress` to the create schema in `backend/src/http/routes/devices.ts` (string, peer-only; partial schema for PATCH unaffected).
- [X] T018 [US2] Update `DeviceService.add` in `backend/src/devices/service.ts`: for peers, if `tunnelAddress` supplied → `validateAssignableAddress(server.address_range, addr, devices.usedCidrs(serverId))` and use it; else `allocateAddress(range, usedCidrs)`. Map failures to `422 validation` / `409 address_in_use` / `409 address_exhausted`; audit detail notes manual vs auto.
- [X] T019 [P] [US2] Frontend: in `frontend/src/pages/Devices.tsx`, show a **Tunnel address** input on the add-device form when kind is `peer` (blank = auto) and pass `tunnelAddress` in the POST body.

**Checkpoint**: US1 + US2 both work; manual and auto addressing coexist.

---

## Phase 5: User Story 3 — Adopt an imported peer (Priority: P3)

**Goal**: Operator adopts a `needs_review` peer into `managed`, keeping its address and public key; profile stays unavailable until keys are reissued.

**Independent Test**: `POST /devices/:id/adopt` with a name flips the peer to `managed` retaining address/public key; profile is `412` until `rotate-keys`.

### Tests for User Story 3

- [X] T020 [P] [US3] Contract tests in `backend/tests/contract/peers.test.ts`: adopt flips `managementState` to `managed`, retains address/public key; adopting a non-`needs_review` device → `422`; profile before reissue → `412`, after `rotate-keys` → `200`.

### Implementation for User Story 3

- [X] T021 [US3] Add `DeviceService.adopt(id, { name, segmentId? })` in `backend/src/devices/service.ts`: require `management_state='needs_review'`; reject if address collides with another managed device (`409 address_conflict`); set name + managed via `devices.adopt`; audit `device_adopt`.
- [X] T022 [US3] Add `POST /devices/:id/adopt` route in `backend/src/http/routes/devices.ts` (zod body `{ name, segmentId? }`).
- [X] T023 [P] [US3] Frontend: add an **Adopt** action (name prompt) to the Current-peers panel in `frontend/src/pages/Devices.tsx` for `needs_review` peers, refreshing the list on success.

**Checkpoint**: All three stories independently functional.

---

## Phase 6: Polish & Cross-Cutting

- [X] T024 [P] Add a `buildServerConfig` allowed-IPs rendering case to `backend/tests/unit/profile.test.ts` (imported peer renders its `allowedIps` verbatim; created peer renders `/32`).
- [X] T025 [P] Verify no secret leakage: peers/adopt responses never include `peer_private_key` (assert in contract tests) — fold into T008/T020 if simpler.
- [X] T026 Run full validation: `cd backend && npm test` and `cd frontend && npm run build`; walk quickstart.md US1–US3 + non-destructive-apply checks.

---

## Dependencies & Execution Order

- **Setup (T001)** → **Foundational (T002–T006)** blocks everything.
  - Within Foundational: T002→T003→T005 (same file `devices.ts`, sequential); T004 and T006 are `[P]` (separate files).
- **US1 (T007–T014)**: after Foundational. T009 depends on T004/T005; T011 depends on T006/T009; T012 depends on T009/T010; frontend T013 `[P]`, T014 after T013.
- **US2 (T015–T019)**: after Foundational (needs T004/T005). Independent of US1 except shared `devices.ts`/`Devices.tsx` (sequence edits to those files).
- **US3 (T020–T023)**: after Foundational; adoption acts on imported peers produced by US1 in practice but the endpoint is independently testable by seeding a `needs_review` device.
- **Polish (T024–T026)**: after the stories it covers.

### Within each story

- Tests written first and expected to fail, then implementation (TDD).
- Repo/model changes before services; services before routes; backend before the frontend that consumes it.

## Parallel Opportunities

- Foundational: T004 and T006 in parallel.
- Per story, the `[P]` test tasks run together; frontend type task (T013) parallel with backend.
- Same-file edits (`backend/src/store/devices.ts`, `backend/src/devices/service.ts`, `frontend/src/pages/Devices.tsx`, `backend/tests/contract/peers.test.ts`) MUST be sequential.

## Implementation Strategy

- **MVP = US1**: Setup + Foundational + US1 delivers the headline value (see all peers) *and* the safety-critical non-destructive apply. Stop and validate here if needed.
- Then US2 (manual IP), then US3 (adopt) as incremental additions.
