# Quickstart & Validation: Reach & Wake Machines

**Feature**: 003-device-access-wake | **Date**: 2026-08-28

This guide validates the 003 delta on top of the running app. It assumes features 001/002 are already working (servers, devices, segments, wake controller, SSH/SFTP sessions). See [contracts/rest-api.md](./contracts/rest-api.md) and [data-model.md](./data-model.md) for details.

## Prerequisites

- App running (backend + frontend) with an authenticated, unlocked session.
- At least one server, one segment (region) with a designated wake controller that has a working SSH target, and one target device with a `mac_address`.
- Migration `0005_segment_wol_target.sql` applied (runs automatically via `migrate.ts` on startup).

## Backend checks

```bash
# From backend/
npm test                 # full Vitest suite (unit + contract) must pass
npm run test -- reach-wake commands reachability wol   # the 003 suites specifically
```

Expected: new suites `unit/commands.test.ts` (probe + wake broadcast/port rendering + arg validation), `unit/reachability.test.ts` (vantage selection, timeout → offline), `unit/wol.test.ts` (self-relay, dup-MAC, already-reachable, 3-state), and `contract/reach-wake.test.ts` all green.

## Scenario 1 — Reachability + connectivity test (US1)

1. Confirm the device list returns a reachability snapshot per device (`GET /servers/:id/devices` → each has `reachability`, `lastSeenAt`).
2. Run a test against an up device:
   ```bash
   curl -X POST .../api/v1/devices/$DEVICE_ID/test
   ```
   **Expect**: `200 { "reachability": "connected", "latencyMs": <n>, "vantage": "server", ... }`, and the device list now shows `connected` with a fresh `lastSeenAt`.
3. Power the device off and re-test. **Expect**: within a few seconds, `200 { "reachability": "offline", ... }` — never a hang (FR-003).
4. Stop the vantage (server/controller) and test. **Expect**: `422 precondition` / not-live, reachability reported `unknown`, not `offline` (FR-004).

## Scenario 2 — Wake a sleeping machine (US2)

1. Set the segment's LAN targeting (optional but recommended):
   ```bash
   curl -X PATCH .../api/v1/segments/$SEGMENT_ID \
     -d '{"broadcastAddress":"192.168.1.255","wolPort":9}'
   ```
   **Expect**: `200 { segment: { ..., broadcastAddress, wolPort } }`. A bad IP or out-of-range port → `400 validation`.
2. With the target powered off, send a wake:
   ```bash
   curl -X POST .../api/v1/devices/$DEVICE_ID/wake
   ```
   **Expect**: `200 { "result": "relayed", "alreadyReachable": false, "controller": "..." }` if it comes online in the window, or `"relayed_still_down"` if not (FR-015). Verify via Scenario 1 that it becomes reachable.
3. Wake an already-on device. **Expect**: `200 { "result": "already_reachable", "alreadyReachable": true, ... }` (FR-014).
4. Refusals (FR-013/016):
   - Device without a MAC → `422 precondition` ("no MAC").
   - Segment without a wake controller → `422 precondition`.
   - Target that resolves to itself as controller → `422 precondition` ("cannot wake itself").
   - Two devices in the segment sharing the MAC → `409 conflict` ("ambiguous MAC").
5. Confirm each wake and test is written to the audit log (`GET /audit`).

## Scenario 3 — Interactive session (US3, reused from 001)

1. For a reachable device with an SSH target, open a session from the panel (SSH), route confirmed through the device's server as jump host; run a command.
2. Device with no SSH target → the panel offers no session and explains what to configure (FR-019).
3. Device whose host key is not trusted → session refused with the untrusted-host-key condition (FR-020), not connected insecurely.
4. Close the session (or `DELETE /sessions/:id`) → the underlying connection is torn down; it disappears from `GET /sessions` (FR-021).

These reuse existing behavior; 003 only adds tests asserting the four scenarios above hold.

## Done / success mapping

| Success criterion | Validated by |
|---|---|
| SC-001 reachability shown per device | Scenario 1.1 |
| SC-002 verdict < 10 s, never hangs | Scenario 1.2–1.3 |
| SC-003 wake relayed < 30 s, machine wakes | Scenario 2.2 |
| SC-004 structural refusals are clear + pre-send | Scenario 2.4 |
| SC-005 wake + session audited | Scenario 2.5, 3 |
| SC-006 session reaches a shell, tears down | Scenario 3 |
