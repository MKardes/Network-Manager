# Data Model: Existing Peer Visibility & Manual Client IP Assignment

**Feature**: 002-peer-import-manual-ip | **Date**: 2026-08-27

This feature extends the existing `device` entity (feature 001). No new tables.

## Changed entity: `device`

New columns (migration `0004_peer_import.sql`, additive/forward-only):

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `origin` | TEXT NOT NULL | `'created'` | `created` (made in-app) or `imported` (discovered on the server). CHECK constraint. |
| `management_state` | TEXT NOT NULL | `'managed'` | `managed` (operator-owned) or `needs_review` (imported, not yet adopted). CHECK constraint. |
| `allowed_ips` | TEXT NULL | `NULL` | For imported peers whose advertised AllowedIPs are not a single free `/32` — stored verbatim (e.g. `10.0.5.0/24, 10.0.6.7/32`). Rendered directly into server config and expanded for address-in-use math. |

Existing relevant columns: `tunnel_address` (single host, unique per server via `idx_device_tunnel_addr` when non-null), `peer_public_key`, `peer_private_key` (encrypted; NULL for imported peers).

### Field derivation on import

For a live peer with public key `K` and dump `allowedIps` string `A`:

- `origin = 'imported'`, `management_state = 'needs_review'`, `kind = 'peer'`, `peer_public_key = K`, `peer_private_key = NULL`.
- `name` = placeholder `imported-<first 8 chars of K>` (operator renames on adopt).
- If `A` is exactly one IPv4 `/32` host `H` and `H` is not already used on the server → `tunnel_address = H`, `allowed_ips = NULL`.
- Else → `tunnel_address = NULL`, `allowed_ips = A`.

### State transitions

```text
                         (live peer unknown to app, first reconcile)
   (absent)  ─────────────────────────────────────────────►  imported / needs_review
                                                                     │
                                          operator adopts (name)     │
                                                                     ▼
   created ─────────────────────────────────────────────────►    managed
   (in-app add: manual or auto address)                             │
                                                                     │ operator removes/revokes
                                                                     ▼
                                                                 (deleted → also removed from server on next apply)
```

- `created` devices are always `managed`.
- Only `needs_review` devices can be adopted; adopting sets `management_state = 'managed'` and a friendly `name`.
- Removal is the **only** action that drops a peer from the server (FR-018).

## Validation rules

- **Manual tunnel address** (new client, kind=peer): MUST be a syntactically valid IPv4 host; MUST be within `server.address_range`; MUST NOT be the network, server (`.1`), or broadcast address; MUST NOT be covered by the server's in-use set (any managed `/32` or any imported peer's `allowed_ips` CIDR, expanded as ranges). Violations → `400 validation` (bad range/format) or `409 address_in_use` (taken).
- **Auto address** (new client, no address supplied): next free host in range, skipping network, server, broadcast, and every in-use range. Exhaustion → `409 address_exhausted`.
- **Adopt**: target device MUST be `management_state = 'needs_review'`; adopted address MUST NOT collide with another **managed** device's address (pre-existing server conflict) → `409 address_conflict`; `name` required (1–64 chars).
- **Out of range imported peer**: not rejected; surfaced with `outOfRange: true` in the peers view (FR-009a).

## Derived read model: Reconciled Peer view

Produced by `PeerReconcileService.reconcile(serverId)`; not persisted beyond the imported `device` rows.

| Field | Type | Source |
|-------|------|--------|
| `deviceId` | string | device row |
| `name` | string | device row |
| `managementState` | `'managed'` \| `'needs_review'` | device row |
| `origin` | `'created'` \| `'imported'` | device row |
| `publicKey` | string \| null | device row |
| `tunnelAddress` | string \| null | device row |
| `allowedIps` | string \| null | device row (imported) |
| `presentOnServer` | boolean | matched in live `wg show` set (false ⇒ discrepancy) |
| `connected` | boolean | live handshake fresh (`PeerStatus.connected`) |
| `latestHandshake` | number \| null | live `PeerStatus` |
| `endpoint` | string \| null | live `PeerStatus` |
| `outOfRange` | boolean | address ∉ `server.address_range` |
| `hasPrivateKey` | boolean | `peer_private_key` present (profile availability) |

Envelope: `{ live: boolean, peers: ReconciledPeer[] }`. `live=false` when the server's peer data could not be read (`status === 'unknown'`); the view still lists persisted peer devices, all with `presentOnServer=false` and `connected=false`, marked not-live for the UI (FR-005).
