# REST API Contract Delta: Reach & Wake Machines

**Feature**: 003-device-access-wake | **Date**: 2026-08-28

Extends the feature-001/002 REST surface. All routes are under `/api/v1`, require an authenticated + unlocked session (`requireAuthAndUnlocked`), and use the standard error envelope `{ error: { code, message } }`. Private keys/credentials are never returned.

Interactive SSH/SFTP session routes (`GET/DELETE /sessions`, `/sftp/*`, the WebSocket channels) are **unchanged** and already satisfy US3; they are listed here only as reused context, not modified.

## New: `POST /devices/:id/test`

Run an on-demand connectivity probe against the device and persist the result to the device's reachability snapshot (US1 / FR-002/003/004).

**Request body**: none (or `{}`).

**Response 200**

```json
{
  "reachability": "connected",
  "latencyMs": 12,
  "vantage": "server",
  "testedAt": "2026-08-28T14:22:05Z"
}
```

- `reachability`: `"connected"` | `"offline"` | `"unknown"`.
- `latencyMs`: wall-clock round-trip of the probe call; omitted/`null` when offline or unknown.
- `vantage`: `"server"` (peer tunnel address) | `"controller"` (LAN host via segment controller) — where the probe ran from.
- Side effect: updates `device.reachability` and, on success, `device.last_seen_at`; a subsequent `GET /servers/:id/devices` reflects it.

**Errors**
- `404 not_found` — device does not exist.
- `422 precondition` — no vantage available to probe (peer without a tunnel address; host whose segment has no reachable controller). Reachability is reported/left `unknown` (not-live), not offline.
- `422 precondition` / server-unreachable — the vantage server/controller cannot be reached; response indicates the result is not live (FR-004).

Bounded by a fixed probe timeout so the call always returns within a few seconds (FR-003, SC-002).

## Changed: `POST /devices/:id/wake`

Same route and preconditions, **enriched response** and two new refusals (US2 / FR-014/015/016). Backward-compatible additive fields; the packet is still relayed by the target segment's wake controller using the vetted `wake` command, now honoring the segment's broadcast/port when set.

**Response 200**

```json
{
  "result": "relayed",
  "alreadyReachable": false,
  "controller": "office-nas"
}
```

- `result`: `"already_reachable"` (was up before the packet) | `"relayed"` (packet sent, target came online within the verification window) | `"relayed_still_down"` (packet sent, target not reachable within the window).
- `alreadyReachable`: boolean (FR-014).
- `controller`: relay device name (existing field retained).

**Errors** (existing + new)
- `422 precondition` — no MAC / not on a segment / segment has no wake controller / controller has no SSH target (existing FR-013); **new**: the resolved controller is the target itself ("a device cannot wake itself").
- `409 conflict` — **new**: more than one device in the segment shares the target's MAC ("ambiguous MAC in segment", FR-016).
- `500 internal` — the controller's wake command failed to execute (distinct from the "sent" results).

## Changed: `POST /servers/:id/segments` and `PATCH /segments/:id`

Add optional per-region LAN targeting fields (US2 data foundation / FR-007/010). Backward compatible — omitting them preserves current behavior.

**Request body (additions in bold)**

```jsonc
// POST /servers/:id/segments
{
  "name": "EU-Office",
  "broadcastAddress": "192.168.1.255", // OPTIONAL, IPv4
  "wolPort": 9                          // OPTIONAL, 1..65535
}

// PATCH /segments/:id  (all optional)
{
  "name": "EU-Office",
  "wakeControllerDeviceId": "…",        // existing
  "broadcastAddress": "192.168.1.255",  // OPTIONAL, IPv4 or null to clear
  "wolPort": 9                          // OPTIONAL, 1..65535 or null to clear
}
```

**Responses**
- `201` / `200` `{ segment }` — the `SegmentView` now includes `broadcastAddress` and `wolPort`.
- `400 validation` — `broadcastAddress` not a valid IPv4, or `wolPort` out of `1..65535`.

## Changed: segment view

`SegmentView` gains two fields mirroring the new columns:

```jsonc
{
  // …existing fields…
  "broadcastAddress": "192.168.1.255", // string | null
  "wolPort": 9                         // number | null
}
```

## Unchanged: device view

`DeviceView` already exposes `reachability` and `lastSeenAt`; no shape change. Their values simply become meaningful once `POST /devices/:id/test` writes them.
