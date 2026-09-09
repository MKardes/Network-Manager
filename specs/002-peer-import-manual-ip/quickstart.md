# Quickstart / Validation: Peer Import & Manual Client IP

**Feature**: 002-peer-import-manual-ip | **Date**: 2026-08-27

Validates the three user stories end-to-end. Contract/unit tests run without a real WireGuard server (live peers are injected via the applier); the manual UI walkthrough assumes a running deployment.

## Prerequisites

- Backend deps installed: `cd backend && npm install`
- Frontend deps installed: `cd frontend && npm install`

## Automated validation

```bash
# Backend unit + contract + integration tests (Vitest)
cd backend && npm test

# Type-check the frontend
cd frontend && npm run build
```

Expected: all suites green, including the new `tests/unit/net.test.ts` cases (subnet coverage + manual-address validation), `tests/unit/peers.test.ts` (reconciliation/import/out-of-range), and `tests/contract/peers.test.ts` (peers endpoint, manual IP, adopt).

## Story validation

### US1 — See current peers (managed + imported)

1. Register a local server with range `10.0.0.0/24`.
2. Simulate an externally-added peer (in tests: stub `applier.status` to return a peer whose public key is unknown to the app; in a real deployment: `wg set wg0 peer <pubkey> allowed-ips 10.0.0.9/32`).
3. `GET /api/v1/servers/:id/peers`.

**Expected**: the response lists the external peer with `managementState: "needs_review"`, `origin: "imported"`, its address, and `presentOnServer: true`; app-created peers show `managementState: "managed"`. A peer the app knows but that is absent from the live set shows `presentOnServer: false`. When live data cannot be read, `live: false` and peers are marked not-live.

### US2 — Assign a specific tunnel IP

1. `POST /api/v1/servers/:id/devices` with `{ "name": "fixed", "kind": "peer", "tunnelAddress": "10.0.0.50" }`.
2. Confirm the created device has `tunnelAddress: "10.0.0.50"` and `GET /api/v1/devices/:id/profile` contains `Address = 10.0.0.50/32`.
3. Repeat with the same address → `409 address_in_use`.
4. Try `10.0.9.9` (out of range) → `400 validation`; try an address inside an imported peer's advertised subnet → `409 address_in_use`.
5. Omit `tunnelAddress` → auto-assigns the next free host (existing behavior).

### US3 — Adopt an imported peer

1. From US1, take the `needs_review` peer's `deviceId`.
2. `POST /api/v1/devices/:id/adopt` with `{ "name": "office-printer" }`.
3. Confirm the device now reports `managementState: "managed"` and retains its original address and public key.
4. `GET /api/v1/devices/:id/profile` → `422 precondition` (no private key); after `POST /api/v1/devices/:id/rotate-keys`, the profile downloads and the public key changes.

### Cross-cutting — Non-destructive apply

1. With an external peer present on the server (unknown to the app) and at least one app-created peer, call `POST /api/v1/servers/:id/apply`.
2. Inspect the rendered/applied server config.

**Expected**: the applied config contains BOTH the app-created peer and the external peer (imported during apply), so `wg syncconf` does not remove the external peer (FR-016/018).

## UI walkthrough (deployed)

- Open **Devices** for the selected server → the **Current peers** panel lists every peer with a managed / needs-review badge, connection state, and warning badges for `not on server` / `out of range`.
- Use **Adopt** on a needs-review peer, provide a name → it moves to managed.
- In **Add device**, choose kind `peer` → a **Tunnel address** field appears; leave blank for auto, or type a specific in-range address.

## References

- Endpoints: [contracts/rest-api.md](./contracts/rest-api.md)
- Fields & validation: [data-model.md](./data-model.md)
- Decisions: [research.md](./research.md)
