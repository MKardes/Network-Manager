# Data Model: Reach & Wake Machines

**Feature**: 003-device-access-wake | **Date**: 2026-08-28

This feature reuses the existing `device` and `lan_segment` entities (features 001/002). It adds two columns to `lan_segment` and starts writing an existing-but-dormant `device` column. No new tables.

## Changed entity: `lan_segment`

New columns (migration `0005_segment_wol_target.sql`, additive/forward-only, nullable):

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `broadcast_address` | TEXT NULL | `NULL` | IPv4 broadcast address for the segment's LAN (e.g. `192.168.1.255`). When set, the wake packet is directed here (`wakeonlan -i`). |
| `wol_port` | INTEGER NULL | `NULL` | Wake-on-LAN UDP port (1–65535, conventionally `9`). When set, passed as `wakeonlan -p`. |

Existing relevant columns: `wake_controller_device_id` (the on-LAN relay), `server_id`, `name`, `UNIQUE(server_id, name)`.

**Semantics**: both nullable and independent. If **both** are absent, wake preserves today's behavior (`wakeonlan <mac> || etherwake <mac>`). If present, they are validated and threaded into the vetted `wake` command. `broadcast_address` set without `wol_port` uses the tool default port; `wol_port` alone directs to the tool's default broadcast.

## Reused entity: `device`

No schema change. This feature **activates** the existing `reachability` and `last_seen_at` columns, which are defined and returned in `DeviceView` today but were never written from live data.

| Column | Type | Written by 003 |
|--------|------|----------------|
| `reachability` | TEXT (`connected`\|`offline`\|`unknown`) | Set by a connectivity test result (was only ever the `unknown` default). |
| `last_seen_at` | TEXT NULL | Set to the test timestamp when a probe succeeds. |
| `mac_address` | TEXT NULL | Read for wake targeting (unchanged; set via existing device create/patch). |
| `segment_id` | TEXT NULL | Read to resolve region + controller (unchanged). |

New repository helper: `DeviceRepo.setReachability(id, state, lastSeenAt | null)` — a narrow update that touches only `reachability`, `last_seen_at`, `updated_at` (does not disturb the full-row merge used by `updateDevice`).

## Validation rules

- **Segment `broadcast_address`**: when provided, MUST be a syntactically valid IPv4 address (reuse `net.ts` IPv4 parsing). Malformed → `400 validation`.
- **Segment `wol_port`**: when provided, MUST be an integer in `1..65535`. Out of range → `400 validation`.
- **Connectivity test target**: device MUST exist; a **peer** device MUST have a `tunnel_address` to probe; a **host** device MUST belong to a segment with a reachable wake controller to provide a vantage point. Missing vantage → `422 precondition` ("no reachable vantage on that network") and reachability left `unknown` (FR-004).
- **Wake target** (extends existing checks): MUST have a MAC, a segment, and a segment wake controller with an SSH target (existing FR-013 checks). **New**: the resolved controller MUST NOT be the target itself (`422 precondition`, "a device cannot wake itself"); and no other device in the segment may share the target's MAC (`409 conflict`, "ambiguous MAC in segment") — FR-016.

## Reachability state transitions

```text
             on-demand test succeeds (probe exit 0)
  unknown ───────────────────────────────────────────►  connected  (last_seen_at = now)
     ▲   ◄───────────────────────────────────────────┐      │
     │            on-demand test fails (probe != 0 /  │      │ on-demand test fails
     │            timeout)                            │      ▼
     │                                                └──  offline
     │ vantage unreachable (server/controller down): stays/returns to `unknown`, marked not-live
```

- Reachability reflects the **last** connectivity test (or the peer-reconcile live state where that already applies to peers). It is a snapshot, not a continuous monitor.
- A device on an unreachable server/segment cannot be tested; its reachability is reported as `unknown` / not-live rather than stale-as-current (FR-004).

## Wake outcome model (read model, not persisted)

`WakeService.wake(deviceId)` returns:

| Field | Type | Meaning |
|-------|------|---------|
| `result` | `'already_reachable'` \| `'relayed'` \| `'relayed_still_down'` | Three-state outcome (FR-015). |
| `alreadyReachable` | boolean | Target was up before the packet was sent (FR-014). |
| `controller` | string | Name of the relay device used. |

Pre-send failures (no MAC / no segment / no controller / self-relay / ambiguous MAC / command failure) remain error responses (`422`/`409`/`500`) distinct from the three "sent" results, and are audited as failures (existing behavior, extended).

## Audit entries

- Existing: `wake` (success/failure) — extended with the `result` in `detail`.
- New: `device_test` — actor `operator`, target `device`, outcome success/failure, detail = resulting reachability + vantage used.
