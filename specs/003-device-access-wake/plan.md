# Implementation Plan: Reach & Wake Machines Behind WireGuard Servers

**Branch**: `003-device-access-wake` | **Date**: 2026-08-28 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/003-device-access-wake/spec.md`

## Summary

The spec asks for three capabilities: (1) see and verify that a machine is reachable through the tunnel, (2) wake a sleeping machine with a magic packet relayed by an on-LAN wake controller, and (3) open an interactive SSH/SFTP session to a machine through its server.

**Important reuse finding**: features 001 and 002 already implement most of this surface. Wake-on-LAN (`WakeService`, `POST /devices/:id/wake`, the vetted `wake` command, segment→controller resolution with precondition errors and auditing), LAN segments/regions with a designated wake controller (`lan_segment`, segment CRUD, `is_wake_controller`), per-device MAC + segment membership, and interactive SSH/SFTP sessions with host-key trust and a session registry (`session/ssh-ws.ts`, `session/sftp-ws.ts`, `http/routes/sftp.ts`, `http/routes/sessions.ts`) all exist and ship today. Therefore this plan does **not** rebuild those; it scopes 003 to the genuine gaps the spec introduces on top of them.

**True delta implemented by 003:**

1. **On-demand connectivity test + populated reachability** (FR-001/002/003/004): add a vetted `probe` command and a `POST /devices/:id/test` endpoint that pings a device from an appropriate vantage point (the server for a peer's tunnel address; the segment's wake controller for a non-peer LAN host), bounded by a timeout, and persists the result to `device.reachability` + `last_seen_at`. Today `device.reachability` exists but is never driven by live data.
2. **Per-region wake targeting (broadcast + port)** (FR-007/010/012): add `broadcast_address` and `wol_port` to `lan_segment`, thread them through the vetted `wake` command (`wakeonlan -i <broadcast> -p <port> <mac>`), with validation; absent values preserve today's behavior.
3. **Richer wake outcome + safety** (FR-014/015/016): wake returns a three-state outcome (`already_reachable` / `relayed` / `relayed_still_down`) via a short bounded post-dispatch re-probe, refuses a device as its own relay, and refuses on a duplicate-MAC-in-segment conflict; today wake returns only `{ dispatched, controller }`.

Interactive sessions (US3) are already delivered by 001; this plan only verifies the spec's acceptance scenarios against the existing implementation and closes any small gaps found (no new session transport).

## Technical Context

**Language/Version**: TypeScript (Node.js, ESM, `"type":"module"`), React 18 + Vite (frontend)

**Primary Dependencies**: Fastify, better-sqlite3 (synchronous SQLite), zod, ssh2 (remote runner + interactive channels), pino; Vitest for tests

**Storage**: SQLite via `better-sqlite3`, forward-only SQL migrations in `backend/src/store/migrations/`; secrets encrypted at rest with an in-memory passphrase-derived key

**Testing**: Vitest — `backend/tests/{unit,contract,integration}`, in-memory DB harness (`tests/helpers/app.ts`)

**Target Platform**: Linux server, shipped as Docker images; management UI reachable only over WireGuard/localhost

**Project Type**: Web application (backend Fastify service + React SPA frontend)

**Performance Goals**: Interactive admin tool. Connectivity test bounded to a few seconds (`ping -c1 -W`); wake dispatch immediate, with a bounded (≤ ~15 s) best-effort online-verification re-probe. Success targets from the spec: reachable/not-reachable verdict < 10 s (SC-002); wake relayed < 30 s (SC-003)

**Constraints**: Remote actions run ONLY through the fixed vetted command set (`wg show`/`syncconf`/`wg-quick`/`wake`/**new** `probe`) — never arbitrary commands; probe/wake arguments validated + shell-escaped; no secret values in logs or responses; migrations forward-only and additive; per-server scoping and auditing on every action

**Scale/Scope**: Single administrator; tens–low-hundreds of devices per server; IPv4 tunnel/LAN addressing (IPv6 allowed-IPs displayed but not probed for allocation)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution (`.specify/memory/constitution.md`) is an unfilled template with placeholder principles only — no ratified, enforceable gates. The de-facto architectural conventions established by features 001/002 are treated as the working constitution and are honored:

- **Vetted-commands-only for remote management**: the connectivity probe and the broadcast/port wake are added as new *vetted* command factories with validated, escaped arguments — no arbitrary command path is introduced. Interactive shells remain the separate, deliberately-opened session path. **PASS**
- **Secrets never leak**: no new secret columns; probe/wake responses carry only status, never keys or credentials. **PASS**
- **Forward-only, additive migrations; encrypted-at-rest**: `lan_segment` gains two nullable columns via an additive `0005` migration; no data rewrite, no plaintext secret columns. **PASS**
- **Per-server scoping & auditing**: connectivity tests and the enriched wake outcome are server/device-scoped and audited like existing device actions (wake already audits; test adds an audit entry). **PASS**
- **Non-destructive / least-surprise**: absent segment broadcast/port preserves current wake behavior exactly; the test endpoint is read-only apart from updating the device's own reachability snapshot. **PASS**

No violations → Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/003-device-access-wake/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── rest-api.md      # Phase 1 output (endpoint delta)
├── checklists/
│   └── requirements.md  # From /speckit-specify
└── tasks.md             # From /speckit-tasks (NOT created here)
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── store/
│   │   ├── migrations/0005_segment_wol_target.sql  # NEW: lan_segment.broadcast_address, wol_port
│   │   └── devices.ts                              # EDIT: setReachability(id, state, lastSeenAt) helper
│   ├── remote/
│   │   └── commands.ts                             # EDIT: new vetted `probe(host)`; `wake` gains optional broadcast/port
│   ├── devices/
│   │   └── segments.ts                             # EDIT: broadcastAddress/wolPort on create/update + validation
│   ├── wol/
│   │   └── service.ts                              # EDIT: pass broadcast/port; already-reachable + self-relay + dup-MAC; 3-state outcome via re-probe
│   ├── reachability/
│   │   └── service.ts                              # NEW: ReachabilityService.test(deviceId) → probe via server/controller, persist result
│   └── http/
│       ├── context.ts                              # EDIT: wire ReachabilityService; inject into WakeService for re-probe
│       └── routes/
│           ├── devices.ts                          # EDIT: POST /devices/:id/test; wake response shape
│           └── segments.ts                         # EDIT: broadcastAddress/wolPort in create/patch schemas
└── tests/
    ├── unit/commands.test.ts                       # NEW/EDIT: probe + wake(broadcast,port) rendering & arg validation
    ├── unit/reachability.test.ts                   # NEW: vantage-point selection, timeout → offline, result mapping
    ├── unit/wol.test.ts                            # EDIT: self-relay, dup-MAC, already-reachable, 3-state outcome
    └── contract/reach-wake.test.ts                 # NEW: /devices/:id/test, enriched /devices/:id/wake, segment WoL fields

frontend/
├── src/
│   ├── api/client.ts                               # EDIT: test() call, WakeResult states, segment WoL fields
│   ├── pages/Devices.tsx                           # EDIT: "Test" action + reachability badge; wake outcome messaging
│   └── pages/Servers.tsx or Segments UI            # EDIT: broadcast address + WoL port fields on a segment
```

**Structure Decision**: Existing two-package web app (`backend/` Fastify service + `frontend/` React SPA). 003 is an incremental extension of the modules 001/002 already established. The one new backend module is `reachability/service.ts`, kept separate so probing/vantage-point logic does not bloat `WakeService` or `DeviceService`; `WakeService` depends on it for the post-dispatch online check. No new packages, no new session transport, no changes to the peer-reconcile or config-apply paths.

## Complexity Tracking

No constitution violations — not applicable.
