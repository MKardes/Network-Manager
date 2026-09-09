# Research: Existing Peer Visibility & Manual Client IP Assignment

**Feature**: 002-peer-import-manual-ip | **Date**: 2026-08-27

All open questions were resolved during `/speckit-clarify` (recorded in spec.md → Clarifications). This document captures the resulting technical decisions and the alternatives weighed.

## Decision 1 — Non-destructive apply (reconcile before sync)

**Decision**: Before rendering the config that `wg syncconf` applies, `ServerService.apply` first reconciles: it reads live peers (`wg show <iface> dump`), imports any peer not already tracked, and then renders the server config from *all* peer devices (managed + imported). `renderConfig` therefore always includes externally-added peers, so syncconf never removes them.

**Rationale**: `wg syncconf` reconciles the interface's peers to exactly the supplied set. The pre-existing `renderConfig` built the peer list only from app-created devices, so any hand-added peer would be silently dropped on the next apply. The clarification chose "preserve" (spec Clarifications Q1). Reconciling inside `apply` makes preservation hold even on the very first apply, before the operator has visited the peers view.

**Alternatives considered**:
- *Merge only peers already imported into the DB*: simpler, but the first apply after an external peer is added (and before any peers-view fetch) would still wipe it. Rejected — violates FR-016/FR-018.
- *Refuse to apply while unknown peers exist*: chosen option C in the clarification was explicitly not selected; blocking is more disruptive than preserving.

## Decision 2 — Correlate peers by public key

**Decision**: Reconciliation matches a live peer to a device row by WireGuard **public key** (`device.peer_public_key` ↔ dump column 0). Tunnel address is a secondary/display signal only.

**Rationale**: The public key is WireGuard's stable peer identity; addresses can repeat or change. Matches spec Assumptions.

**Alternatives considered**: address-based matching — rejected (addresses are mutable and can collide on a misconfigured server).

## Decision 3 — Persist imported peers as `device` rows (hybrid import state)

**Decision**: On first sight, an unknown live peer is inserted as a `device` (kind=`peer`, `origin='imported'`, `management_state='needs_review'`). Adoption flips `management_state` to `managed` and sets a friendly name. Two new columns capture this; a third (`allowed_ips`) stores the peer's advertised AllowedIPs verbatim when they are not a single clean host.

**Rationale**: The clarification chose the hybrid model (spec Clarifications Q2): import all, preserve, mark needs-review, adopt to fully manage. Persisting as device rows means imported peers automatically flow into `renderConfig` (Decision 1) and into address-in-use math (Decision 4) with no parallel store.

**Address storage rule**: if the peer advertises exactly one IPv4 `/32` and that host is free, store it in `tunnel_address` (uses the existing `idx_device_tunnel_addr` unique index) and leave `allowed_ips` null. Otherwise (subnet, multiple IPs, IPv6, or a colliding host) store the raw AllowedIPs string in `allowed_ips` and leave `tunnel_address` null to avoid violating the unique index on a pre-existing server-side conflict.

**Alternatives considered**: a separate `imported_peer` table — rejected as redundant; it would duplicate rendering and allocation logic and complicate adoption (row migration).

## Decision 4 — Subnet-aware address "in use" set

**Decision**: The set of addresses considered "in use" for a server is derived from its peer devices: each managed peer contributes `tunnel_address/32`; each imported peer contributes either `tunnel_address/32` or every CIDR in its stored `allowed_ips`. Membership/allocation uses integer range containment, never a materialized host Set, so a large subnet (e.g. `/8`) is handled without enumerating addresses.

**Rationale**: The clarification chose full-coverage enforcement (spec Clarifications Q3): a new address is rejected if it falls within *any* imported peer's advertised subnet. Range containment keeps this correct and cheap.

**Alternatives considered**:
- *Single-host equality only*: rejected — the clarification explicitly chose full subnet coverage.
- *Expand subnets to a Set*: rejected — unbounded memory for large prefixes.

**Out-of-range handling**: an imported peer whose address falls outside the server's configured range is flagged (`outOfRange: true`) in the peers view rather than rejected (FR-009a); it is still preserved and displayed.

## Decision 5 — No private key fabrication; profile requires reissue

**Decision**: Imported/adopted peers keep `peer_private_key = NULL`. `buildProfile` continues to fail with a precondition error when no private key exists; the UI indicates the profile is unavailable until the operator rotates/reissues keys (which generates a new keypair and changes the peer's public key).

**Rationale**: The private key of an externally-created peer is not recoverable (spec FR-012, Assumptions). Rotating keys is the explicit, auditable way to obtain a downloadable profile, at the cost of re-pairing that client.

## Decision 6 — Compute "in use" from the persisted DB, not a live fetch, at add time

**Decision**: Manual-address validation and auto-allocation read the used set from `device` rows (which already include previously-imported peers), not from a fresh `wg show`.

**Rationale**: Decouples adding a client from live server reachability and keeps add fast. Newly-appeared external peers are folded in at the next reconcile (peers view or apply). Acceptable given single-admin, low churn.

**Alternatives considered**: live fetch on every add — rejected; couples a local write to a possibly-down remote and adds latency for a rare race.

## Decision 7 — Reconciliation reuses existing status path and vetted commands

**Decision**: `PeerReconcileService` obtains live peers through the existing `ServerService.status` (which uses `LocalApplier`/`RemoteApplier` → `wg show dump`). No new remote command is introduced.

**Rationale**: Honors the fixed vetted command set (FR-001d from feature 001) and reuses tested parsing (`parseWgDump`).
