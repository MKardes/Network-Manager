# Feature Specification: Existing Peer Visibility & Manual Client IP Assignment

**Feature Branch**: `002-peer-import-manual-ip`

**Created**: 2026-08-27

**Status**: Draft

**Input**: User description: "It is currently only creates it's own wireguard clients only. I want it to be able to see the current pairs and add spesific ip addresses for new clients."

## Clarifications

### Session 2026-08-27

- Q: When the app applies configuration to a server, what happens to peers that exist on the server but aren't managed by the app? → A: Preserve them — applying config is non-destructive; the app includes existing server peers in the config it applies so a sync never removes them. On first connection to a server the app imports/shows all existing peers and does not overwrite them, and the operator can manage them from the app.
- Q: On first connection, should the app auto-record every discovered peer as managed, or list them as external until explicitly adopted? → A: Hybrid — on first connection the app imports all discovered peers into a visible, preserved "imported / needs review" state; the operator confirms/renames to fully adopt, and key-dependent actions (e.g. producing a client profile) require adoption plus key reissue.
- Q: How should imported peers advertising a subnet or an out-of-range address affect address "in use" calculation and manual-IP validation? → A: Enforce full coverage — reject any new client address that falls within any imported peer's advertised subnet (not just single-host equality), and flag imported peers whose address is outside the server's configured range as configuration problems.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See every peer already on the server, not just app-created ones (Priority: P1)

As the operator, I want to see all peers that are actually configured on the selected WireGuard server — including peers that were added outside this application (by hand or another tool) — alongside the ones this app created, so that I have a truthful, complete picture of who is on the network and which addresses are already taken.

**Why this priority**: Today the app can only show and reason about the clients it created itself. Any peer added directly on the server is invisible, which means the address list is incomplete, "free" addresses may already be in use, and the operator cannot trust the app as the source of truth. Seeing the real, current set of peers is the prerequisite for safely assigning addresses (Story 2) and for bringing stray peers under management (Story 3).

**Independent Test**: On a server that has at least one peer configured directly (not through this app), open the server's peer list and confirm that peer appears with its tunnel address and public key, is clearly labeled as not managed by this app, and shows its live connection state — without having to first recreate it in the app.

**Acceptance Scenarios**:

1. **Given** a selected server with peers that were added outside the app, **When** the operator views the server's peers, **Then** those peers are listed with their tunnel address(es), public key, and current connection state (connected / last-seen), even though the app did not create them.
2. **Given** a mix of app-created and externally-added peers, **When** the operator views the peer list, **Then** each entry clearly indicates whether it is **managed** (adopted in the app) or **imported / needs review** (found on the server and imported, not yet adopted).
3. **Given** a peer that this app created but which has been removed directly on the server, **When** the operator views the peer list, **Then** the discrepancy is surfaced (the app-known peer is shown as no longer present on the server) rather than being silently reported as active.
4. **Given** the server is unreachable or its peer information cannot be read, **When** the operator opens the peer list, **Then** the app reports that live peer data is unavailable and still shows the last-known app-managed peers, clearly marked as not live.

---

### User Story 2 - Assign a specific tunnel IP when adding a new client (Priority: P2)

As the operator, I want to choose the exact tunnel IP address for a new client instead of always accepting an automatically assigned one, so that I can align addresses with my own numbering scheme, reserve memorable addresses, or match pre-existing configuration.

**Why this priority**: Manual address control is the second half of the user's request and depends on Story 1 — the app must know which addresses are truly in use (including externally-added peers) before it can safely accept or reject an operator-chosen address. Automatic assignment already works, so this extends rather than replaces existing behavior.

**Independent Test**: Add a new client to a server while specifying a particular in-range, currently-unused tunnel address, and confirm the client is created with exactly that address and its generated connection profile reflects it; then attempt to add another client with the same address and confirm the app rejects it with a clear reason.

**Acceptance Scenarios**:

1. **Given** the operator is adding a new client, **When** they supply a specific tunnel address that is within the server's range and not already in use, **Then** the client is created with that exact address and its connection profile uses it.
2. **Given** the operator is adding a new client, **When** they do not supply an address, **Then** the app automatically assigns the next available address as it does today.
3. **Given** the operator supplies an address that is already used by any peer on the server (app-managed or externally-added), or is the server's own/reserved address, **When** they try to create the client, **Then** the app rejects the request and explains that the address is taken or reserved.
4. **Given** the operator supplies an address outside the server's configured range or that is not a valid address, **When** they try to create the client, **Then** the app rejects the request and explains the valid range/format.

---

### User Story 3 - Bring an externally-added peer under management (Priority: P3)

As the operator, I want to adopt a peer that was found on the server but not created by this app, giving it a friendly name and recording it as a managed device, so that the peer becomes a first-class device I can administer (status, wake, SSH/SFTP association) like any other.

**Why this priority**: Visibility (Story 1) already delivers value on its own; adoption is the natural follow-on that lets the operator consolidate everything under the app over time, but it is not required to satisfy the core request and can ship after the first two stories.

**Independent Test**: From the peer list, select a peer that the app discovered but does not manage, adopt it by giving it a name, and confirm it then appears as a managed device retaining its existing tunnel address and public key, without disrupting that peer's existing connection.

**Acceptance Scenarios**:

1. **Given** an externally-added peer shown in the peer list, **When** the operator adopts it and provides a friendly name, **Then** it becomes a managed device that keeps its existing tunnel address and public key.
2. **Given** an adopted peer, **When** the operator views the managed device list, **Then** the peer is no longer labeled as "imported / needs review" and its recorded address is treated as "in use" for future address assignment.
3. **Given** an externally-added peer for which the app holds no private key, **When** the operator adopts it, **Then** the app records the peer without fabricating a private key and clearly indicates that a downloadable client profile is unavailable unless keys are rotated/reissued.

---

### Edge Cases

- An imported peer whose address falls outside the server's currently configured range (e.g., the range was changed later) is flagged to the operator as a configuration problem (FR-009a) rather than silently accepted.
- A peer that advertises a subnet (rather than a single host) has its full host coverage treated as "in use", so no new client can be assigned an address inside that subnet (FR-008/FR-009).
- What happens when an operator-specified address is valid and free at the time of entry but is taken by a concurrent change before the client is saved?
- How are two discovered peers that share the same tunnel address (a pre-existing conflict on the server) presented to the operator?
- What happens when the operator specifies the exact address of an imported peer that the app has discovered but the operator has not yet adopted — is that treated as "in use"? (Yes — imported peers count as "in use" per FR-009.)
- How does the peer list behave when live peer data can be read for some selected servers but not others?
- What happens if an adopted peer is later removed directly on the server again?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST present, for the selected server, the complete set of peers currently configured on that server, including peers that were not created by this application.
- **FR-002**: System MUST reconcile the live/current peers against the peers the application already tracks and label each peer by management state: **managed** (created or adopted in the app), or **imported / needs review** (present on the server and imported by the app on first connection but not yet confirmed/named by the operator).
- **FR-002a**: On first connection to a server, System MUST import every discovered peer into a persisted "imported / needs review" state that is visible in the peer list and preserved on apply (FR-016), without overwriting the peer on the server.
- **FR-002b**: System MUST let the operator confirm/rename an "imported / needs review" peer to fully adopt it (FR-011), after which it is labeled **managed**.
- **FR-003**: System MUST show, for each listed peer, its tunnel address(es), public key, and current connection state (connected / last-seen), using live data from the server when available.
- **FR-004**: System MUST surface discrepancies between what the app tracks and what the server reports — specifically an app-managed peer that is no longer present on the server, and a peer newly present on the server that the app has not yet imported (which it then imports as "imported / needs review").
- **FR-005**: System MUST, when live peer data cannot be retrieved for a server, clearly indicate that the shown information is not live and still display the last-known managed peers.
- **FR-006**: System MUST allow the operator to specify an exact tunnel address when adding a new client peer.
- **FR-007**: System MUST continue to automatically assign the next available tunnel address when the operator does not specify one (preserving current behavior).
- **FR-008**: System MUST validate an operator-specified address before creating the client and MUST reject it when the address is outside the server's configured range, malformed, the server's own/reserved (network, server, broadcast) address, or already covered by any peer known to be on that server (managed or imported) — including when the address falls within a subnet that an imported peer advertises, not only single-host equality.
- **FR-009**: System MUST treat addresses covered by imported peers as "in use" for both automatic assignment and manual-address validation, expanding a peer's advertised subnet (e.g. `/24`) to the full set of host addresses it covers, so it never hands out or accepts an address that is already taken on the server.
- **FR-009a**: System MUST flag imported peers whose advertised address falls outside the selected server's configured address range as configuration problems, surfacing them to the operator rather than silently accepting them.
- **FR-010**: System MUST reflect the operator-specified address in the new client's generated connection profile.
- **FR-011**: System MUST allow the operator to adopt an "imported / needs review" peer into the managed device registry, preserving that peer's existing tunnel address and public key and letting the operator assign a friendly name.
- **FR-012**: System MUST NOT fabricate a private key for an imported/adopted peer for which no private key is available, and MUST clearly indicate that a downloadable client profile is unavailable for such a peer until the operator adopts it and reissues/rotates its keys.
- **FR-013**: System MUST reject an attempt to adopt or record a peer whose address conflicts with another peer already managed by the app, and MUST explain the conflict.
- **FR-014**: System MUST record an audit entry for adopting an imported peer and for creating a client with a manually specified address, consistent with existing device-management auditing.
- **FR-015**: System MUST scope peer visibility, address assignment, and adoption to the currently selected server, consistent with existing per-server scoping.
- **FR-016**: Applying/synchronizing configuration to a server MUST be non-destructive to peers the app does not manage: the app MUST include peers currently present on the server (including externally-added ones) in the configuration it applies, so that a sync never removes a peer the operator has not explicitly chosen to remove.
- **FR-017**: On the first connection to a server, the app MUST import and display the peers already present on that server without altering or overwriting them, and MUST make those peers manageable from the app.
- **FR-018**: The app MUST NOT remove a peer from the server as a side effect of any action other than the operator explicitly removing/revoking that peer.

### Key Entities *(include if feature involves data)*

- **Peer (current view)**: A WireGuard peer as it exists on the selected server right now — identified by public key, with one or more allowed/tunnel addresses and a live connection state. Its management state is either **managed** (correlated to a device the app tracks and the operator has confirmed) or **imported / needs review** (imported from the server on first connection, preserved and visible, but not yet confirmed/named by the operator).
- **Client / Peer Device**: An app-tracked device that is a WireGuard peer (existing entity), extended with: a tunnel address that may be **operator-specified** or **auto-assigned**; an **origin** of in-app creation vs. import from the server; and a management state of **managed** vs. **imported / needs review**. An imported peer becomes managed when the operator confirms/names (adopts) it.
- **Address Allocation State**: The set of tunnel addresses considered "in use" for a server, now spanning app-managed peers **and** imported peers discovered on the server (expanding any advertised subnet to its full host coverage), used to drive both automatic assignment and manual-address validation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a server that has peers added outside the app, 100% of those peers appear in the app's peer list with their address and connection state, without the operator recreating them first.
- **SC-002**: Every peer in the list is unambiguously identifiable as managed or imported / needs review (0% shown without a management status).
- **SC-003**: An operator can add a new client with a chosen, valid address and obtain its connection profile in under 2 minutes, matching the speed of the existing automatic-assignment flow.
- **SC-004**: 100% of attempts to assign an address that is out of range, malformed, reserved, or already in use (including addresses within any imported peer's advertised subnet) are rejected with a clear reason, and no two peers on a server are ever created with the same address through the app.
- **SC-005**: An operator can adopt an imported peer into managed devices in under 1 minute, and the adopted peer retains its original address and public key and does not lose its existing connection.
- **SC-006**: When live peer data is unavailable, the operator is always told the view is not live (0% of stale views presented as current).

## Assumptions

- "Pairs" in the request refers to the WireGuard peers configured on the server (each a public-key ↔ address association); "clients" refers to WireGuard peer devices the app manages.
- The current set of peers on a server is obtained from the server's live WireGuard state, using the same server-management path (local host or remote-over-SSH) the app already uses to read server status; no new access mechanism is required.
- Manual address assignment applies to WireGuard peer devices; non-peer hosts (which have no tunnel address) are unaffected.
- Automatic address assignment remains the default so existing workflows are unchanged when no address is specified.
- New client addresses are single-host IPv4 tunnel addresses within the server's configured range, consistent with the app's existing address handling; however, when computing which addresses are already "in use", a peer advertising a broader subnet has its full host coverage enforced, and imported peers with out-of-range addresses are flagged as configuration problems.
- Adoption records an imported peer's existing public key and address; because the private key of an externally-created peer is generally not recoverable, a full downloadable client profile for an adopted peer is only available after the operator reissues/rotates its keys.
- This feature builds on the existing single-administrator, per-selected-server model and its existing auditing, encryption-at-rest, and status-reading capabilities; those cross-cutting behaviors are unchanged.
- Reconciliation correlates peers by public key (the stable identifier WireGuard uses), with tunnel address used as a secondary signal.
