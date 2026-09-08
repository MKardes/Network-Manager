# Implementation Plan: Existing Peer Visibility & Manual Client IP Assignment

**Branch**: `002-peer-import-manual-ip` | **Date**: 2026-08-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/002-peer-import-manual-ip/spec.md`

## Summary

Extend the existing WireGuard control-plane app so it (1) discovers and displays *every* peer configured on the selected server — not just the ones the app created — importing unknown peers into a persisted "imported / needs review" state, (2) lets the operator assign a specific tunnel IP when adding a new client (with validation), and (3) lets the operator adopt an imported peer into a fully managed device. Critically, applying config to a server becomes **non-destructive**: the app reconciles (imports) live peers before rendering the config it syncs, so `wg syncconf` never removes a peer the operator did not explicitly delete.

Technical approach: add three columns to `device` (`origin`, `management_state`, `allowed_ips`), a reconciliation service that correlates live `wg show` peers to device rows by public key and imports unknowns, generalized address math in `net.ts` that treats subnets as fully-covered ranges, a manual-address path in `DeviceService.add`, an adopt endpoint, and a reconciled peers endpoint. The server-config renderer is updated to include imported peers (using their advertised AllowedIPs) so syncconf preserves them. Frontend: a "Current peers" panel with adopt actions and an optional tunnel-address field on the add-device form.

## Technical Context

**Language/Version**: TypeScript (Node.js, ESM, `"type":"module"`), React 18 + Vite (frontend)

**Primary Dependencies**: Fastify, better-sqlite3 (synchronous SQLite), zod, ssh2 (remote runner), pino; Vitest for tests

**Storage**: SQLite via `better-sqlite3`, forward-only SQL migrations in `backend/src/store/migrations/`; secrets encrypted at rest (`encryptField`/`decryptField`) with a passphrase-derived key held only in memory

**Testing**: Vitest — `backend/tests/{unit,contract,integration}`, in-memory DB harness (`tests/helpers/app.ts`)

**Target Platform**: Linux server, shipped as Docker images; management UI reachable only over WireGuard/localhost

**Project Type**: Web application (backend service + SPA frontend)

**Performance Goals**: Interactive admin tool; peer reconciliation is one `wg show dump` round-trip per view; add/adopt complete in well under the 2-minute / 1-minute success targets

**Constraints**: Non-destructive apply (never silently remove a peer); no secret values in logs or API responses; remote management only via the fixed vetted command set (`wg show`/`syncconf`/`wg-quick`); no private key fabrication for imported peers

**Scale/Scope**: Single administrator; tens–low-hundreds of peers per server; IPv4 tunnel address allocation (IPv6 allowed-IPs displayed but not allocated)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution (`.specify/memory/constitution.md`) is an unfilled template with placeholder principles only — no ratified, enforceable gates. No governance constraints block this feature. The de-facto architectural conventions established by feature 001 are treated as the working constitution and are honored:

- **Secrets never leak**: imported peers carry no private key; the app never fabricates one and never returns private keys in views. PASS
- **Vetted-commands-only for remote management**: reconciliation reuses the existing `wgShow` vetted command; no new arbitrary command paths. PASS
- **Forward-only migrations, encrypted-at-rest**: new columns via an additive `0004` migration; no plaintext secret columns added. PASS
- **Per-server scoping & auditing**: new actions (import, manual-address add, adopt) are server-scoped and audited like existing device actions. PASS

No violations → Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/002-peer-import-manual-ip/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/
│   └── rest-api.md      # Phase 1 output (endpoint delta)
├── checklists/
│   └── requirements.md  # From /speckit-specify + /speckit-clarify
└── tasks.md             # From /speckit-tasks
```

### Source Code (repository root)

```text
backend/
├── src/
│   ├── store/
│   │   ├── migrations/0004_peer_import.sql   # NEW: origin, management_state, allowed_ips
│   │   └── devices.ts                        # EDIT: new fields, getByPublicKey, usedCidrs, adopt/importPeer
│   ├── servers/
│   │   ├── net.ts                            # EDIT: CIDR-aware used set, subnet coverage, manual validation
│   │   ├── profile.ts                        # EDIT: ServerPeer.allowedIps in buildServerConfig
│   │   ├── service.ts                        # EDIT: renderConfig includes imported peers; apply reconciles first
│   │   └── peers.ts                          # NEW: PeerReconcileService (correlate + import + view)
│   ├── devices/
│   │   └── service.ts                        # EDIT: manual tunnelAddress on add; adopt()
│   └── http/
│       ├── context.ts                        # EDIT: wire PeerReconcileService
│       └── routes/
│           ├── devices.ts                    # EDIT: tunnelAddress in create schema; POST /devices/:id/adopt
│           └── servers.ts                    # EDIT: GET /servers/:id/peers
└── tests/
    ├── unit/net.test.ts                      # EDIT: subnet coverage + manual validation
    ├── unit/peers.test.ts                    # NEW: reconciliation/import/out-of-range (pure helpers)
    └── contract/peers.test.ts                # NEW: peers endpoint, manual IP, adopt

frontend/
├── src/
│   ├── api/client.ts                         # EDIT: Peer types, managementState/origin/allowedIps on Device
│   └── pages/Devices.tsx                     # EDIT: Current-peers panel + Adopt + tunnel-address field
```

**Structure Decision**: Existing two-package web app (`backend/` Fastify service + `frontend/` React SPA). This feature is an incremental extension of feature 001's server/device modules — no new packages or structural changes. Reconciliation is isolated in a new `servers/peers.ts` service to keep `ServerService`/`DeviceService` cohesive.

## Complexity Tracking

No constitution violations — not applicable.
