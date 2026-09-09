---
description: "Task list for feature 003-device-access-wake"
---

# Tasks: Reach & Wake Machines Behind WireGuard Servers

**Input**: Design documents from `/specs/003-device-access-wake/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/rest-api.md, quickstart.md

**Tests**: Included — the project has established Vitest unit/contract suites and quickstart.md names specific new test files.

**Organization**: Grouped by user story (US1 P1, US2 P2, US3 P3) after shared foundational work.

**Reuse note**: Wake-on-LAN, segments/wake-controllers, and SSH/SFTP sessions already ship from features 001/002. These tasks implement only the 003 delta (connectivity test, per-region broadcast/port, richer/safer wake outcome, and US3 verification tests).

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

**⚠️ CRITICAL**: Shared schema/plumbing changes that both US1 and US2 depend on.

- [X] T002 Add forward-only migration `backend/src/store/migrations/0005_segment_wol_target.sql`: `ALTER TABLE lan_segment ADD COLUMN broadcast_address TEXT;` and `ALTER TABLE lan_segment ADD COLUMN wol_port INTEGER;` (both nullable, no default).
- [X] T003 Extend `SegmentRow`, `SegmentView`, and `toSegmentView` in `backend/src/devices/segments.ts` with `broadcast_address`/`broadcastAddress` and `wol_port`/`wolPort`; make `create`/`update` accept and persist them, validating `broadcastAddress` as IPv4 (reuse `net.ts` IPv4 parsing) and `wolPort` as an integer in 1..65535 (per data-model.md validation rules).
- [X] T004 [P] In `backend/src/remote/commands.ts`: add vetted `probe(host)` → `ping -c 1 -W <timeout> <ipv4>` (validate host with the existing IPv4 rule; fixed default timeout of 3s); extend `wake(mac, opts?)` so that when `opts.broadcast`/`opts.port` are present it renders `wakeonlan -i <broadcast> -p <port> <mac>` (validate broadcast IPv4 and port 1..65535), else preserves today's `wakeonlan <mac> || etherwake <mac>`.
- [X] T005 [P] Add `setReachability(id, state, lastSeenAt)` to `DeviceRepo` in `backend/src/store/devices.ts`: a narrow `UPDATE device SET reachability=?, last_seen_at=?, updated_at=datetime('now') WHERE id=?` that does not disturb the full-row merge path.

**Checkpoint**: Segment WoL columns + segment view/validation + vetted probe/wake + reachability writer ready.

---

## Phase 3: User Story 1 — See & verify reachability (Priority: P1) 🎯 MVP

**Goal**: Add an on-demand connectivity test that probes a device from the right vantage (server for a peer's tunnel address; segment controller for a LAN host), bounded by a timeout, and persists the result to `device.reachability` + `last_seen_at`.

**Independent Test**: `POST /devices/:id/test` for an up peer returns `{reachability:"connected", vantage:"server", latencyMs}` and the device list reflects it; for a down device it returns `offline` within seconds; when the vantage is unreachable it returns not-live `unknown`.

### Tests for User Story 1

- [X] T006 [P] [US1] Unit test `backend/tests/unit/commands.test.ts`: `vetted.probe` renders bounded `ping -c 1 -W ...`, rejects a non-IPv4 host with `VettedCommandError`; `vetted.wake` with broadcast/port renders `wakeonlan -i .. -p .. <mac>` and rejects bad broadcast/port, and with no opts preserves the legacy string.
- [X] T007 [P] [US1] Unit test `backend/tests/unit/reachability.test.ts`: vantage selection (peer→server, host→segment controller), probe exit 0 → `connected` with latency, non-zero/timeout → `offline`, missing vantage → precondition/`unknown` (using a fake runner + repo).

### Implementation for User Story 1

- [X] T008 [US1] Implement `ReachabilityService` in `backend/src/reachability/service.ts`: `test(deviceId)` resolves the vantage (peer's server SSH runner for `tunnel_address`; else the segment wake controller's SSH runner), runs `vetted.probe(targetHost)`, measures wall-clock latency, maps exit code/timeout to `connected`/`offline`, persists via `devices.setReachability`, records a `device_test` audit entry, and returns `{ reachability, latencyMs, vantage, testedAt }`; missing vantage → `errors.precondition` and reachability left `unknown`.
- [X] T009 [US1] Wire `ReachabilityService` into `AppContext` in `backend/src/http/context.ts` (export as `reachabilityService`), constructing it after `serverService`/`devices`/`segmentService`/`sshTargets`.
- [X] T010 [US1] Add `POST /devices/:id/test` in `backend/src/http/routes/devices.ts` calling `ctx.reachabilityService.test(id)` and returning its result (404 when device missing; 422 when no vantage).
- [X] T011 [P] [US1] Contract test `backend/tests/contract/reach-wake.test.ts`: `POST /devices/:id/test` shape and codes — connected result updates the device view; offline; 422 no-vantage; 404 unknown device (fake/stub runner in the app harness).
- [X] T012 [P] [US1] Frontend `frontend/src/api/client.ts`: add `test(deviceId)` returning the reachability result type; `frontend/src/pages/Devices.tsx`: add a per-device "Test" action and a reachability badge (connected/offline/unknown + last-seen).

**Checkpoint**: On-demand reachability works end-to-end and the device list is truthful.

---

## Phase 4: User Story 2 — Wake a sleeping machine, richer & safer (Priority: P2)

**Goal**: Thread per-region broadcast/port into the wake packet, return a three-state outcome (`already_reachable`/`relayed`/`relayed_still_down`) via a bounded post-dispatch re-probe, and refuse self-relay and ambiguous-MAC waves.

**Independent Test**: Wake of an off device with a controller returns `relayed` and the device becomes reachable; wake of an on device returns `already_reachable`; a device that is its own controller → 422; two devices sharing a MAC in a segment → 409.

### Tests for User Story 2

- [X] T013 [P] [US2] Unit test `backend/tests/unit/wol.test.ts` (extend if present): self-relay refusal, duplicate-MAC-in-segment refusal (409), already-reachable pre-check sets `already_reachable`, and the three-state outcome mapping given a fake ReachabilityService (online-in-window → `relayed`, still-down → `relayed_still_down`).
- [X] T014 [P] [US2] Extend contract test `backend/tests/contract/reach-wake.test.ts`: `POST /devices/:id/wake` returns `{result, alreadyReachable, controller}`; segment `POST`/`PATCH` accept/validate `broadcastAddress`/`wolPort` and echo them in `SegmentView` (400 on bad IPv4/port).

### Implementation for User Story 2

- [X] T015 [US2] Update `WakeService` in `backend/src/wol/service.ts`: read the segment's `broadcastAddress`/`wolPort` and pass to `vetted.wake`; add self-relay guard (controller id === target id → precondition) and duplicate-MAC-in-segment guard (>1 device in segment with the target MAC → conflict); pre-probe via `ReachabilityService` for `alreadyReachable`; after dispatch run a bounded best-effort re-probe loop and return `{ result, alreadyReachable, controller }`; extend audit `detail` with `result`. Inject `ReachabilityService` via constructor.
- [X] T016 [US2] Update `backend/src/http/context.ts` to pass `reachabilityService` into `WakeService`; update `backend/src/http/routes/devices.ts` wake handler only if the response passthrough needs the new shape (it returns the service result directly).
- [X] T017 [P] [US2] Add `broadcastAddress`/`wolPort` to the `POST /servers/:id/segments` and `PATCH /segments/:id` zod schemas in `backend/src/http/routes/segments.ts` (optional; nullable on PATCH), forwarding to `segmentService`.
- [X] T018 [P] [US2] Frontend: add broadcast-address + WoL-port fields to the segment editor UI (`frontend/src/pages/Servers.tsx` or the segment component) and surface the three-state wake outcome message in `frontend/src/pages/Devices.tsx`; update `frontend/src/api/client.ts` `Segment`/`WakeResult` types.

**Checkpoint**: Wake honors per-region LAN targeting, reports a truthful outcome, and cannot misfire.

---

## Phase 5: User Story 3 — Interactive session verification (Priority: P3)

**Goal**: Assert the already-shipped SSH/SFTP session stack meets the spec's US3 acceptance scenarios; close only small gaps found.

**Independent Test**: An SSH session to a reachable, SSH-associated device establishes through the server as jump host and tears down on close; a device with no SSH target offers none; an untrusted host key is refused.

- [X] T019 [P] [US3] Add verification tests (`backend/tests/contract/reach-wake.test.ts` or a dedicated `sessions` spec): session/SFTP unavailable with clear message when a device has no `ssh_target_id` (FR-019); host-key mismatch surfaces `HostKeyMismatchError`/`host_key_mismatch` rather than connecting (FR-020); `DELETE /sessions/:id` force-closes and it leaves `GET /sessions` (FR-021).
- [X] T020 [US3] If any T019 assertion fails against current behavior, make the minimal fix in the relevant `backend/src/session/*` or `backend/src/http/routes/{sftp,sessions}.ts` file; otherwise record "verified, no change" in the task notes.

**Checkpoint**: US3 acceptance scenarios proven against the existing implementation.

---

## Phase 6: Polish & Cross-Cutting

- [X] T021 Run the full backend suite (`cd backend && npm test`) and frontend build (`cd frontend && npm run build`); all green.
- [X] T022 [P] Walk quickstart.md scenarios 1–3 and confirm the SC-001…SC-006 mapping holds; fix any doc/behavior drift.
- [X] T023 [P] Confirm audit coverage: `wake` (with `result` detail) and `device_test` entries are recorded (SC-005).

---

## Dependencies & Execution Order

- **Setup (T001)** → **Foundational (T002–T005)** block everything.
- **US1 (T006–T012)** depends only on Foundational. It is the MVP and delivers "reach + verify" alone.
- **US2 (T013–T018)** depends on Foundational **and** on `ReachabilityService` from US1 (T008) for the pre-/post-probe. Do US1 before US2.
- **US3 (T019–T020)** is independent (verification of existing code) and can run any time after Setup.
- **Polish (T021–T023)** last.

## Parallel Opportunities

- Foundational: T004 and T005 are `[P]` (different files) after T002/T003.
- US1: T006, T007, T011, T012 are `[P]`; core impl T008→T009→T010 is sequential (same context wiring).
- US2: T013, T014, T017, T018 are `[P]`; T015→T016 sequential.
- US3: T019 `[P]`.

## Implementation Strategy

- **MVP = US1** (T001–T012): the only capability genuinely missing for "reach my machines" — on-demand reachability. Shippable on its own.
- **Increment 2 = US2** (T013–T018): richer/safer wake with per-region LAN targeting on top of the existing wake path.
- **Increment 3 = US3** (T019–T020): lock in the existing session behavior with tests.
