# REST API Contract Delta: Peer Import & Manual Client IP

**Feature**: 002-peer-import-manual-ip | **Date**: 2026-08-27

Extends the feature-001 REST surface (`specs/001-wireguard-network-manager/contracts/rest-api.md`). All routes are under `/api/v1`, require an authenticated + unlocked session (`requireAuthAndUnlocked`), and use the standard error envelope `{ error: { code, message } }`. Private keys are never returned.

## New: `GET /servers/:id/peers`

Reconcile the app's tracked peers against the server's live WireGuard peers, importing unknown peers into `needs_review` state, and return the merged view (US1).

**Response 200**

```json
{
  "live": true,
  "peers": [
    {
      "deviceId": "…",
      "name": "laptop",
      "managementState": "managed",
      "origin": "created",
      "publicKey": "base64…",
      "tunnelAddress": "10.0.0.2",
      "allowedIps": null,
      "presentOnServer": true,
      "connected": true,
      "latestHandshake": 1756272000,
      "endpoint": "203.0.113.5:51820",
      "outOfRange": false,
      "hasPrivateKey": true
    },
    {
      "deviceId": "…",
      "name": "imported-9f3ac1b2",
      "managementState": "needs_review",
      "origin": "imported",
      "publicKey": "base64…",
      "tunnelAddress": "10.0.0.9",
      "allowedIps": null,
      "presentOnServer": true,
      "connected": false,
      "latestHandshake": 0,
      "endpoint": null,
      "outOfRange": false,
      "hasPrivateKey": false
    }
  ]
}
```

- `live: false` ⇒ live peer data unavailable; `peers` still lists persisted peer devices with `presentOnServer=false` (FR-005).
- A tracked device with `presentOnServer=false` while `live=true` is a discrepancy (peer removed on the server) (FR-004).
- `404 not_found` if the server does not exist.

## Changed: `POST /servers/:id/devices`

Add optional `tunnelAddress` for a manually-assigned peer address (US2). Backward compatible — omitting it preserves auto-assignment.

**Request body (additions in bold)**

```jsonc
{
  "name": "laptop",
  "kind": "peer",              // or "host"
  "tunnelAddress": "10.0.0.50", // OPTIONAL, peer only; omit for auto-assign
  "segmentId": null,
  "macAddress": null,
  "sshTargetId": null
}
```

**Responses**
- `201` `{ device }` — created with the requested (or auto) address.
- `400 validation` — `tunnelAddress` malformed, out of range, or a reserved address.
- `409 address_in_use` — the address is already covered by a peer on the server (managed or imported subnet).
- `409 address_exhausted` — auto-assign with no free address.

## New: `POST /devices/:id/adopt`

Adopt an imported (`needs_review`) peer into managed state (US3). Preserves address and public key; assigns a friendly name.

**Request body**

```json
{ "name": "office-printer", "segmentId": null }
```

**Responses**
- `200` `{ device }` — `managementState` now `managed`.
- `400 validation` — device is not in `needs_review` state, or `name` missing/invalid.
- `409 address_conflict` — the peer's address collides with another managed device.
- `404 not_found` — device does not exist.
- Profile note: if `hasPrivateKey=false`, `GET /devices/:id/profile` remains `422 precondition` until keys are rotated (FR-012).

## Changed: device view (`GET /servers/:id/devices`, `GET /devices/:id`)

`DeviceView` gains three fields, mirroring the new columns:

```jsonc
{
  // …existing fields…
  "origin": "created",           // "created" | "imported"
  "managementState": "managed",  // "managed" | "needs_review"
  "allowedIps": null             // string | null
}
```

## Behavioral note: `POST /servers/:id/apply`

Unchanged signature. Now reconciles (imports live peers) before rendering, so the applied config includes externally-added peers and `wg syncconf` is non-destructive (FR-016/017/018). Response shape unchanged (`{ server }`).
