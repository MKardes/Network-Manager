# Feature Specification: Reach & Wake Machines Behind WireGuard Servers

**Feature Branch**: `003-device-access-wake`

**Created**: 2026-08-28

**Status**: Draft

**Input**: User description: "We need to be able to use this panel to reach my machines on those wireguard servers and be able to send to some of them magic packet (This will be defined as region etc. with the actual LAN info on those pcs)"

## Clarifications

### Session 2026-08-28

- Q: When the operator "reaches" a machine from the panel, what should the panel let them do? → A: Both — (1) show each machine's live reachability through the tunnel and let the operator run an on-demand connectivity test (probe) to confirm it is reachable right now, and (2) open an interactive SSH/SFTP session to the machine from the panel, routed through the machine's WireGuard server as a jump host, using the machine's SSH target association.
- Q: A sleeping machine cannot receive a WireGuard packet directly (it is powered off). How should the panel deliver the Wake-on-LAN magic packet? → A: Relay via an on-LAN wake controller — the operator designates an always-on device (or the server) on the same LAN/region as the target, and the panel instructs that controller to broadcast the magic packet on the local segment. (Matches the existing per-device "wake controller" concept.)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See and verify that a machine is reachable through the tunnel (Priority: P1)

As the operator, I want the panel to show me, for each machine associated with a WireGuard server, whether it is currently reachable over the tunnel, and to let me run an on-demand connectivity test against a chosen machine, so that I can trust the status shown and confirm at any moment that a specific machine is actually reachable before I try to work with it.

**Why this priority**: "Reaching" a machine starts with knowing, truthfully, whether it can be reached. Live status plus an explicit test is the foundation the interactive session (Story 3) and the wake flow (Story 2) both build on — there is no value in offering an SSH button or a wake button for a machine whose reachability the operator cannot trust. It is independently useful on its own: an operator can open the panel and immediately see which of their machines are up.

**Independent Test**: For a server with at least one associated machine, open the machine list and confirm each machine shows a current reachability state (reachable / offline / unknown) attributed to that server; then trigger a connectivity test against a machine that is known to be up and confirm the panel reports success with a round-trip result, and against a machine that is down and confirm the panel reports it as not reachable — without opening any external tool.

**Acceptance Scenarios**:

1. **Given** a server with associated machines, **When** the operator views the machine list, **Then** each machine shows its current reachability state (reachable / offline / unknown) and when that state was last determined.
2. **Given** a machine the operator wants to confirm, **When** the operator runs an on-demand connectivity test, **Then** the panel probes the machine through its server and reports success (with a round-trip indication) or failure (with the reason) within a bounded time.
3. **Given** a server whose live state cannot be read, **When** the operator views its machines, **Then** the panel marks their reachability as not live / unknown rather than presenting stale data as current, consistent with existing peer-visibility behavior.
4. **Given** a connectivity test that does not complete within the bounded time, **When** the timeout elapses, **Then** the panel reports the machine as not reachable (timed out) rather than hanging indefinitely.

---

### User Story 2 - Wake a sleeping machine with a magic packet (Priority: P2)

As the operator, I want to send a Wake-on-LAN magic packet to a specific machine that is powered off or asleep, delivered by an always-on wake controller on the same local network (region) as that machine, so that I can bring a machine online remotely before I try to reach it — even though the machine itself is not on the tunnel while it is asleep.

**Why this priority**: This is the second capability the operator explicitly asked for. It depends on the machine being organized into a region carrying the LAN details needed to address the packet (MAC, broadcast, wake controller). It is the natural precondition for reaching a machine that is currently off, and it is independently testable: designate a controller, target a sleeping machine, send the packet, and observe the machine come online.

**Independent Test**: Define a region with an online wake controller, add a machine to that region with its MAC address, power the machine off, send a wake command from the panel, and confirm the panel reports the magic packet was relayed by the controller and that the machine subsequently becomes reachable (Story 1) — without the operator being on that physical LAN.

**Acceptance Scenarios**:

1. **Given** a machine that has a MAC address and belongs to a region whose wake controller is online, **When** the operator sends a wake command, **Then** the panel instructs that region's wake controller to broadcast a correctly formed magic packet addressed to the machine's MAC on the region's broadcast address, and reports that the packet was sent.
2. **Given** a machine whose region has no wake controller, or whose wake controller is offline/unreachable, **When** the operator attempts to wake it, **Then** the panel refuses the request and explains that no online controller is available to relay the packet on that machine's network.
3. **Given** a machine that has no recorded MAC address, **When** the operator attempts to wake it, **Then** the panel refuses and explains that a MAC address is required to wake the machine.
4. **Given** a machine that is already reachable, **When** the operator sends a wake command, **Then** the panel still allows sending the packet (a wake of an already-on machine is harmless) and clearly indicates the machine was already reachable.
5. **Given** a wake command was relayed successfully, **When** the machine does not become reachable within a reasonable window, **Then** the panel indicates the packet was sent but the machine did not come online, distinguishing "packet not sent" from "sent but machine still down".

---

### User Story 3 - Open an interactive session to a machine through the server (Priority: P3)

As the operator, I want to open an interactive SSH/SFTP session to a reachable machine from within the panel, routed through that machine's WireGuard server as a jump host, so that I can administer the machine or move files without separately configuring and launching an external SSH client, reusing the SSH target association the machine already has.

**Why this priority**: Interactive access is the richest form of "reaching" a machine, but it delivers value only after the operator can trust reachability (Story 1) and, for machines that were asleep, wake them (Story 2). It is a larger, self-contained slice that can ship after the first two and be tested on its own.

**Independent Test**: For a reachable machine that has an SSH target association, open an interactive session from the panel and confirm a working shell (and/or file browse) is established through the machine's server as a jump host, and that closing the panel session ends the connection; then confirm a machine with no SSH association offers no session and explains why.

**Acceptance Scenarios**:

1. **Given** a reachable machine with an SSH target association, **When** the operator opens a session from the panel, **Then** an interactive SSH/SFTP session is established to the machine, routed through its server as a jump host, using the app's managed SSH credentials.
2. **Given** a machine with no SSH target association, **When** the operator looks for a session action, **Then** the panel indicates a session is unavailable and what must be configured to enable it (an SSH target and a trusted host key).
3. **Given** an open session, **When** the operator closes it or navigates away, **Then** the underlying connection is terminated and no session is left running.
4. **Given** a machine whose host key is not yet trusted, **When** the operator attempts a session, **Then** the panel refuses to connect and surfaces the untrusted-host-key condition rather than connecting insecurely, consistent with existing SSH-target trust handling.

---

### Edge Cases

- A machine belongs to no region (no LAN info recorded): reachability (Story 1) may still work over the tunnel, but wake (Story 2) is unavailable and the panel explains that region/LAN details are required to wake it.
- A region's broadcast address or wake UDP port is misconfigured or missing: the panel cannot form a deliverable packet and reports the region as not wake-capable rather than silently failing.
- The designated wake controller is itself the target machine (a machine cannot wake itself): the panel prevents selecting a target as its own relay.
- Two machines in the same region share the same MAC address: surfaced as a configuration conflict, since a magic packet cannot be uniquely targeted.
- The server / wake controller can be reached for some regions but not others: reachability and wake availability are shown per machine/region, not all-or-nothing.
- A connectivity test or wake is requested for a machine on a server that is currently unreachable: the action is refused with the server-unreachable reason, not attempted blindly.
- An interactive session drops mid-use (network loss): the panel reports the disconnect and does not present the dead session as live.
- The same machine is targeted by rapid repeated wake commands: repeated packets are harmless, but the panel should not misreport an already-in-flight result.

## Requirements *(mandatory)*

### Functional Requirements

**Reachability & connectivity (Story 1)**

- **FR-001**: System MUST display, for each machine associated with a selected server, its current reachability state (reachable / offline / unknown) and the time that state was last determined.
- **FR-002**: System MUST let the operator run an on-demand connectivity test against a chosen machine, probing the machine through its server, and MUST report success (with a round-trip indication) or failure (with a reason) within a bounded time.
- **FR-003**: System MUST bound every connectivity test with a timeout and report a machine as not reachable (timed out) when the probe does not complete, rather than blocking indefinitely.
- **FR-004**: System MUST, when a server's live state cannot be read, mark the reachability of its machines as not live / unknown instead of presenting stale data as current, consistent with existing peer-visibility behavior.
- **FR-005**: System MUST scope reachability display and connectivity tests to the machine's associated server, consistent with existing per-server scoping.

**Regions & LAN information (data foundation for Story 2)**

- **FR-006**: System MUST allow the operator to organize machines into regions (local network groups), where a region represents a single physical LAN / broadcast domain that its member machines share.
- **FR-007**: System MUST let the operator record, per region, the LAN information required to deliver a wake packet: the broadcast address for the segment and the UDP port to use for Wake-on-LAN.
- **FR-008**: System MUST let the operator record, per machine, the LAN information required to wake it: its hardware (MAC) address and its region membership.
- **FR-009**: System MUST let the operator designate a wake controller for a region — an always-on device (or the server) that resides on that region's LAN and can broadcast magic packets on it.
- **FR-010**: System MUST validate recorded LAN information (MAC address format, broadcast address format, port range) and reject malformed values with a clear reason.

**Wake-on-LAN (Story 2)**

- **FR-011**: System MUST let the operator send a Wake-on-LAN command to a specific machine.
- **FR-012**: System MUST deliver the wake by instructing the target machine's region wake controller to broadcast a correctly formed magic packet addressed to the machine's MAC on the region's broadcast address and port; the app MUST NOT rely on sending the packet directly to a powered-off machine.
- **FR-013**: System MUST refuse a wake request and explain the reason when the target has no recorded MAC address, when its region has no designated wake controller, or when that controller is offline/unreachable.
- **FR-014**: System MUST allow waking a machine that is already reachable (a redundant wake is harmless) and MUST indicate that the machine was already reachable.
- **FR-015**: System MUST report the outcome of a wake command distinguishing at least three cases: the packet could not be sent (with reason), the packet was relayed successfully, and the packet was relayed but the machine did not become reachable within a reasonable window.
- **FR-016**: System MUST prevent a machine from being selected as its own wake relay and MUST surface region configuration conflicts (e.g., two machines sharing a MAC address) rather than allowing an ambiguous wake.
- **FR-017**: System MUST record an audit entry for each wake command (target machine, region/controller used, and outcome), consistent with existing device-management auditing.

**Interactive session (Story 3)**

- **FR-018**: System MUST let the operator open an interactive SSH/SFTP session to a reachable machine that has an SSH target association, routed through the machine's server as a jump host, using the app's managed SSH credentials.
- **FR-019**: System MUST indicate when an interactive session is unavailable for a machine (no SSH target association) and state what must be configured to enable it.
- **FR-020**: System MUST refuse to open a session to a machine whose host key is not trusted and surface the untrusted-host-key condition, consistent with existing SSH-target trust handling, rather than connecting insecurely.
- **FR-021**: System MUST terminate the underlying connection when the operator ends the session or navigates away, leaving no orphaned session running.
- **FR-022**: System MUST record an audit entry for opening an interactive session (target machine, server used as jump host), consistent with existing device-management auditing.

**Cross-cutting**

- **FR-023**: All reach, wake, and session actions MUST honor the existing single-administrator authentication and per-server scoping; no action may target a machine on a server the operator is not authorized for.
- **FR-024**: System MUST refuse reach/wake/session actions that depend on a server which is currently unreachable, reporting the server-unreachable reason instead of attempting the action blindly.

### Key Entities *(include if feature involves data)*

- **Region (LAN segment)**: A named group representing one physical LAN / broadcast domain shared by its member machines. Carries the LAN information needed to deliver wake packets — a broadcast address, a Wake-on-LAN UDP port — and a designated wake controller. Corresponds to the existing device "segment" grouping, extended with wake-delivery details.
- **Machine (Device)**: An app-tracked device (existing entity — a WireGuard peer or a non-peer host on a server), extended for this feature with: a hardware (MAC) address used for wake targeting, region membership, a current reachability state with a last-determined timestamp, and an optional SSH target association used for interactive sessions.
- **Wake Controller**: A machine (or the server) designated for a region that is always on, sits on that region's LAN, and can broadcast a magic packet on the local segment on behalf of the app. Corresponds to the existing per-device "wake controller" designation.
- **Connectivity Test**: An on-demand, time-bounded probe of a machine through its server, producing a reachable/not-reachable result with a round-trip or failure reason; it updates the machine's displayed reachability.
- **Wake Command**: An operator-initiated request to wake a machine, resolved to a region + controller + MAC + broadcast target, producing an auditable outcome (not sent / relayed / relayed-but-still-down).
- **Interactive Session**: A transient SSH/SFTP connection to a machine, established through its server as a jump host using the app's managed credentials, that exists only while open and is torn down when the operator ends it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a server with associated machines, 100% of those machines show a reachability state attributed to that server, and none are shown without a reachability state or last-determined time.
- **SC-002**: An operator can run a connectivity test and receive a definitive reachable / not-reachable result within a bounded time (e.g., under 10 seconds) in 100% of attempts, with no test able to hang indefinitely.
- **SC-003**: For a machine with valid LAN information and an online region wake controller, an operator can send a wake command and have the magic packet relayed in under 30 seconds, and a machine that is powered off and supports Wake-on-LAN becomes reachable without the operator being on its physical LAN.
- **SC-004**: 100% of wake attempts that cannot succeed for structural reasons (no MAC, no/offline controller, unreachable server) are refused with a clear, specific reason before any packet is attempted — the operator is never left guessing why a wake failed.
- **SC-005**: Every wake command and every interactive session is recorded in the audit log with its target, the server/controller used, and its outcome (100% coverage).
- **SC-006**: An operator can open an interactive session to a reachable, SSH-associated machine and reach a working shell in under 30 seconds without configuring or launching a separate SSH client, and closing the session leaves no connection running.

## Assumptions

- "Reach my machines" is interpreted as (1) trustworthy live reachability plus an on-demand connectivity test, and (2) interactive SSH/SFTP access through the machine's server as a jump host — per the clarification session.
- "Region etc. with the actual LAN info on those pcs" is interpreted as organizing machines into LAN segments (regions) that carry the LAN details (broadcast address, Wake-on-LAN port, designated wake controller) and per-machine LAN details (MAC address) needed to address a magic packet. This maps onto the existing device "segment" and "wake controller" concepts rather than introducing an unrelated notion of region.
- Wake-on-LAN is a layer-2 broadcast that cannot traverse the WireGuard tunnel to a powered-off host; therefore delivery requires an always-on relay on the target's own LAN. The wake controller is that relay, reached over the existing server/SSH management path.
- The magic packet uses the standard Wake-on-LAN format (a broadcast frame carrying the target MAC repeated the standard number of times); the default UDP port is a conventional Wake-on-LAN port (e.g., 9) unless the region overrides it. Whether the target actually wakes depends on the machine's own BIOS/OS Wake-on-LAN support, which is outside the app's control (the app is responsible only for correctly relaying the packet).
- Connectivity tests and wake relaying reuse the app's existing server-management access path (local host or remote-over-SSH) and its existing SSH target trust model; no new inbound access mechanism to the machines is introduced.
- Interactive sessions reuse the app's managed SSH keypairs and trusted host keys (SSH targets) already used elsewhere; a machine with no SSH target association simply has no session action until one is configured.
- This feature builds on the existing single-administrator, per-selected-server model, its auditing, and its encryption-at-rest; those cross-cutting behaviors are unchanged.
- Machines may be WireGuard peers (with a tunnel address) or non-peer hosts on a server; reachability and wake apply to both, while interactive sessions apply to any machine that has an SSH target association regardless of peer status.
