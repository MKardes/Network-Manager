# Phase 0 Research: Reach & Wake Machines

**Feature**: 003-device-access-wake | **Date**: 2026-08-28

All open questions from the Technical Context are resolved below. Each decision favors reusing the existing vetted-command + SSH-runner architecture established in features 001/002.

## R1 — Vantage point for the connectivity test

**Decision**: Probe a device from the machine that is actually on the same network path as its address:
- **Peer device** (has `tunnel_address`): probe from the device's **server** SSH runner — the server is the WireGuard endpoint and always sits on the tunnel, so it can reach any peer's tunnel address.
- **Non-peer host** (LAN-only, no tunnel address): probe from the host's **segment wake controller** (the always-on device on that LAN). If the segment has no reachable controller, the test is refused with the same "no vantage on that network" reason the wake path uses.

**Rationale**: Mirrors how wake already chooses the on-LAN controller as the relay. The app never needs a new inbound path to the target; it reuses an existing outbound SSH management connection.

**Alternatives considered**: Probing from the app host directly — rejected, the app host is not guaranteed to be on the tunnel or the target LAN. A TCP connect to the SSH port instead of ICMP — kept as a fallback signal but not the default (a host may be up with SSH closed); ICMP `ping` is the primary liveness probe.

## R2 — The probe command (vetted)

**Decision**: Add `vetted.probe(host)` rendering `ping -c 1 -W <timeout> <host>` where `host` is a validated IPv4 address (reuse the existing IPv4 validation from `net.ts`) and `<timeout>` is a fixed small integer (default 3 seconds). Success = exit code 0; non-zero or runner timeout = offline.

**Rationale**: `ping` is universally present, exit code is an unambiguous liveness signal, and `-c 1 -W` bounds it hard so a test can never hang (FR-003). Argument validation + shell-escaping keeps it inside the vetted-command contract (no arbitrary execution).

**Alternatives considered**: `fping`/`nmap` — extra dependencies not guaranteed on managed hosts. Parsing `ping` RTT for a latency number — nice-to-have; the round-trip indication (SC-002) is derived from the runner's own wall-clock measurement of the call, avoiding brittle output parsing.

## R3 — Persisting reachability

**Decision**: `ReachabilityService.test(deviceId)` runs the probe, then calls a new `DeviceRepo.setReachability(id, 'connected'|'offline', lastSeenAt)` that updates `device.reachability` and (on success) `device.last_seen_at`. The device list (`GET /servers/:id/devices`) already returns these fields, so no view change is needed — the list simply reflects the last test. When the required vantage (server/controller) is unreachable, reachability is set to/left `unknown` and the response says the data is not live (FR-004).

**Rationale**: `device.reachability` already exists in the schema and view but was never written from live data; wiring the test into it is the minimal change that makes the list truthful (FR-001).

**Alternatives considered**: A background reachability poller — out of scope for 003 (the spec asks for on-demand tests, not continuous monitoring); would add scheduling complexity. Kept as a possible future feature.

## R4 — Per-region broadcast address and WoL port

**Decision**: Add nullable `broadcast_address` (IPv4) and `wol_port` (INTEGER, 1–65535) to `lan_segment` (migration `0005`). Extend `vetted.wake(mac, opts?)` to render `wakeonlan -i <broadcast> -p <port> <mac>` when provided, falling back to today's `wakeonlan <mac> || etherwake <mac>` when both are absent. Validate broadcast as IPv4 and port as 1–65535 at the segment API boundary (FR-010).

**Rationale**: Directed broadcast to a specific segment address makes wake reliable across multi-NIC controllers and non-default ports, which is exactly the "actual LAN info" the spec calls for (FR-007). Nullable + fallback means existing segments keep working unchanged (least surprise).

**Alternatives considered**: Storing broadcast/port per device — rejected; broadcast domain is a property of the LAN (region), not the individual PC. Requiring these fields — rejected; would break existing wake flows.

## R5 — Three-state wake outcome (FR-014/015)

**Decision**: `WakeService.wake(deviceId)` returns `{ result, controller, alreadyReachable }` where `result ∈ { 'already_reachable', 'relayed', 'relayed_still_down' }`:
1. Before dispatch, if a quick probe (R2) shows the target already up → dispatch anyway (harmless) but mark `alreadyReachable: true`, `result: 'already_reachable'`.
2. After dispatch, run a **bounded** best-effort re-probe loop (a few attempts over ≤ ~15 s). Online within the window → `relayed`; still down → `relayed_still_down` (packet sent, machine did not come online).
3. Packet could not be sent (precondition/command failure) → the existing precondition/`internal` errors are unchanged (distinct from the "sent" states).

**Rationale**: Cleanly distinguishes the three cases the spec requires without a long-blocking call or a new async job. The bounded loop keeps wake within SC-003's 30 s envelope. Reuses `ReachabilityService` for both probes.

**Alternatives considered**: Return immediately as `relayed` and let the client poll `/devices/:id/test` — simpler but pushes the "did it wake?" judgment entirely to the UI; we do a short server-side verification and still allow the client to keep polling for slow boots.

## R6 — Wake safety: self-relay and duplicate MAC (FR-016)

**Decision**: In `WakeService.wake`: (a) if the resolved wake controller device id equals the target device id, refuse with a clear "a device cannot wake itself" precondition; (b) if more than one device in the target's segment carries the same `mac_address` as the target, refuse with a `409`-style conflict ("ambiguous MAC in segment") rather than sending a packet that cannot be uniquely attributed. Also guard segment update so a segment's wake controller cannot be set to a device that is itself the only member it would need to wake (self-reference is allowed for the controller generally, but the per-wake self-relay check is the hard gate).

**Rationale**: These are cheap invariant checks that prevent silently misdirected packets; they belong in the service where the controller/target/segment are already resolved.

**Alternatives considered**: Enforcing MAC uniqueness at insert time via a DB constraint — rejected; imported/host devices legitimately may lack or repeat MACs, and a hard constraint would block adoption flows from 002. A per-wake check is targeted and reversible.

## R7 — Interactive session (US3) — verify, don't rebuild

**Decision**: Treat US3 as already delivered by feature 001 (`session/ssh-ws.ts`, `session/sftp-ws.ts`, `http/routes/sftp.ts`, `http/routes/sessions.ts`, host-key trust via `remote/runner.ts` + `HostKeyMismatchError`, session registry with force-close). 003 adds **verification tests only** against the spec's acceptance scenarios (jump-host routing, no-SSH-target message, host-key-untrusted refusal, teardown on close) and closes any small gap surfaced, without introducing a new transport.

**Rationale**: Rebuilding an existing, working session stack would be waste and risk regression. The spec's US3 requirements map directly onto shipped behavior.

**Alternatives considered**: A fresh in-browser terminal implementation — rejected as duplicative.

## Summary of new/changed remote commands

| Command | Status | Rendering |
|---------|--------|-----------|
| `probe(host)` | NEW | `ping -c 1 -W <timeout> <ipv4>` |
| `wake(mac, {broadcast, port}?)` | CHANGED | `wakeonlan -i <bcast> -p <port> <mac>` when opts present; else `wakeonlan <mac> || etherwake <mac>` |

All arguments validated (IPv4 / MAC / port range) and shell-escaped, consistent with `remote/commands.ts`.
