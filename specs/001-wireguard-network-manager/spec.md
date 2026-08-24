# Feature Specification: WireGuard Network Manager

**Feature Branch**: `001-wireguard-network-manager`

**Created**: 2026-08-23

**Status**: Draft

**Input**: User description: "I want to create an application to manage my wireguard network. Configure networkings, connect to ssh, sftp, and also etherwake things. Please create a basic app that will handle this. Security is very important for this app. Please recognize it. And also it will be shiped by docker images."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Manage WireGuard servers and their devices (Priority: P1)

As the operator of one or more private networks, I want to register multiple WireGuard servers, select which one I am working with, and manage the devices (peers) that belong to the selected server — including generating their keys and connection details — so that my devices can securely reach each other over an encrypted tunnel and I can administer several networks from a single place.

**Why this priority**: This is the foundation of the product. Without managed WireGuard servers and a registry of devices, none of the other capabilities (SSH, SFTP, wake-on-LAN) have targets to act on. It is the minimum viable slice that delivers standalone value: one or more working, documented, encrypted networks that the operator can switch between.

**Independent Test**: Can be fully tested by registering two WireGuard servers, selecting one, adding two devices to it, retrieving each device's connection profile, and confirming the two devices establish an encrypted tunnel and can reach each other — without any SSH/SFTP/wake features present.

**Acceptance Scenarios**:

1. **Given** no server is configured, **When** the operator registers a WireGuard server with an address range and endpoint, **Then** the server is persisted and shown in the server list.
2. **Given** multiple registered servers, **When** the operator selects a server, **Then** the app scopes device management, status, and remote actions to the selected server.
3. **Given** a selected server, **When** the operator adds a device, **Then** the system generates a unique key pair and a client-ready connection profile for that device on that server, keeping the private key protected.
4. **Given** a registered device, **When** the operator revokes/removes it, **Then** that device can no longer connect and it disappears from that server's device list.
5. **Given** connected devices, **When** the operator views the selected server's status, **Then** each device's connection state (connected/last-seen) and assigned address are visible.
6. **Given** an existing device, **When** the operator regenerates (rotates) its keys, **Then** the old credentials stop working and a new profile is issued.

---

### User Story 2 - Open an SSH session to a device over the network (Priority: P2)

As the operator, I want to start an SSH session to a device that is reachable over the WireGuard network so that I can administer it remotely without exposing SSH to the public internet.

**Why this priority**: Remote administration is the most common day-to-day task after the network exists. It is high value but depends on P1 (a reachable device must exist first).

**Independent Test**: With one reachable device registered, initiate an SSH session using stored credentials, run a command, and confirm output is returned and the session can be closed cleanly.

**Acceptance Scenarios**:

1. **Given** a reachable device with SSH access configured, **When** the operator opens an SSH session, **Then** an interactive session is established and commands execute against the device.
2. **Given** an SSH session, **When** the operator ends the session, **Then** the connection is closed and no session credentials remain accessible afterward.
3. **Given** a device with wrong or missing credentials, **When** the operator attempts to connect, **Then** the system reports a clear authentication/connection failure without leaking sensitive details.
4. **Given** an SSH connection attempt, **When** the host key does not match the previously trusted key, **Then** the system blocks the session and warns the operator.

---

### User Story 3 - Transfer files to/from a device via SFTP (Priority: P3)

As the operator, I want to browse, upload, and download files on a device over SFTP through the network so that I can move configuration and data securely.

**Why this priority**: File transfer is a frequent but secondary need compared with establishing the network and shell access. It reuses the same secure connection foundation as SSH.

**Independent Test**: With one reachable device, list a remote directory, upload a file, download it back, and verify the transferred file matches the original.

**Acceptance Scenarios**:

1. **Given** a reachable device, **When** the operator opens an SFTP session and lists a directory, **Then** the directory contents are shown.
2. **Given** an SFTP session, **When** the operator uploads a file, **Then** the file appears on the device with intact contents.
3. **Given** an SFTP session, **When** the operator downloads a file, **Then** the local copy matches the remote file.
4. **Given** a transfer that fails midway, **When** the error occurs, **Then** the operator is notified and no partial file is silently presented as complete.

---

### User Story 4 - Wake a device with Wake-on-LAN / etherwake (Priority: P4)

As the operator, I want to wake a powered-down device by having the always-on wake controller on that device's LAN send it a "magic packet", so that I can bring the device online before connecting to it. I also want to see at a glance which devices share a LAN and which host will send the wake command for that LAN.

**Why this priority**: Convenience capability used occasionally; valuable but not required for the core management workflow. Depends on having devices registered and organized by LAN segment with a designated wake controller (P1).

**Independent Test**: Register a device's MAC address and LAN segment, designate an always-on wake controller for that segment, trigger a wake action, and confirm the controller emits the packet on the correct LAN and the result is reported.

**Acceptance Scenarios**:

1. **Given** a device with a stored MAC address on a segment that has a designated wake controller, **When** the operator triggers "wake", **Then** the app instructs that segment's wake controller to emit the magic packet on that LAN.
2. **Given** a wake action, **When** it completes, **Then** the operator sees confirmation of the send and (if determinable) whether the device came online.
3. **Given** the device list, **When** the operator views it, **Then** devices are grouped by LAN segment and each segment clearly shows which host is its wake controller.
4. **Given** a device with no MAC address, no assigned segment, or a segment with no designated wake controller, **When** the operator attempts to wake it, **Then** the system prevents the action and explains what is missing.

---

### Edge Cases

- What happens when two devices are assigned the same network address, or the address pool is exhausted?
- How does the system behave when a target device is unreachable, powered off, or the tunnel is down at connection time?
- What happens to active SSH/SFTP sessions when the underlying WireGuard tunnel drops mid-session?
- How are secrets (device private keys, SSH credentials) protected at rest, in backups, and in logs?
- What happens when an operator's session/authentication expires during a long-running transfer?
- How does the system handle a device whose SSH host key changes (possible key rotation vs. possible impersonation)?
- What happens on repeated failed login attempts to the application itself?
- How does the containerized deployment behave on restart — are servers, devices, and trust records preserved, and how are secret-dependent/automated actions handled while the app is locked awaiting the master passphrase?
- What happens if the operator forgets the master passphrase (secrets become unrecoverable) — is this acceptable, and is a warning surfaced at setup?
- How is a non-peer host reached for SSH/SFTP/wake when the peer/server it depends on is offline?

## Clarifications

### Session 2026-08-23

- Q: Is this a single-admin app or multi-user with roles? → A: Single administrator (one operator account; multi-user out of scope for v1).
- Q: What is the app's relationship to the WireGuard servers — does it host the tunnel itself (data plane) or manage real servers (control plane)? → A: Control plane. The app manages real WireGuard servers by operating them, not by being a separate tunnel app. It manages the WireGuard server running on its own host machine, and also servers on other machines reachable by IP.
- Q: How are remote WireGuard servers managed? → A: The app runs command-line management tools on the remote server (over SSH) to configure and operate WireGuard and related tooling there.
- Q: How should SSH and SFTP reach the operator? → A: Through an in-app web terminal (SSH) and web file browser (SFTP); the app does not hand off to an external client.
- Q: For automated management of remote WireGuard servers, which commands may the app run? → A: A fixed, vetted set of management commands only (e.g. WireGuard tooling, wake-on-LAN, service control). Arbitrary commands are only available when the operator deliberately opens an interactive in-app SSH terminal.
- Q: How does the single administrator sign in? → A: Password required, with optional (operator-enabled) TOTP two-factor authentication.
- Q: How does the app authenticate to remote servers and devices over SSH? → A: SSH key-based authentication using key pairs the app stores encrypted (preferred over passwords).
- Q: How is access recovered if the sole administrator is locked out or loses their 2FA device? → A: Both mechanisms — one-time recovery codes (issued at 2FA setup) to bypass the second factor, plus a host-level recovery command (requires access to the deployment host) to reset the password / disable 2FA for a full lockout.
- Q: What are the admin session inactivity timeout and audit-log retention defaults? → A: Auto-logout after 30 minutes of inactivity; audit events retained for 12 months.
- Q: Where is the Wake-on-LAN magic packet sent from? → A: From a designated always-on "wake controller" host on the target device's own LAN segment; the app instructs that controller (over SSH) to emit the packet, because magic packets only work within the same LAN. Devices are organized by LAN segment, and the UI MUST clearly show which devices share a LAN and which host is that LAN's wake controller.
- Q: Are all managed devices WireGuard peers, or can the app also manage plain machines that aren't running WireGuard? → A: Both. A managed device may be a WireGuard peer (with its own key and tunnel address) OR a non-peer host on a LAN reached via a peer/server (e.g. a PC the wake controller wakes, or a machine reached only for SSH/SFTP). WireGuard-specific attributes apply only to peer devices.
- Q: Where should the management web interface be reachable from? → A: Private only — reachable over the WireGuard network or localhost, never exposed to the public internet.
- Q: How is the key that encrypts stored secrets protected? → A: Secrets are encrypted at rest with a key derived from an operator master passphrase entered at startup/unlock; the key/passphrase is never persisted to disk.

## Requirements *(mandatory)*

### Functional Requirements

#### Network & Device Management

- **FR-001**: System MUST allow the operator to register and configure multiple WireGuard servers, each with its own address range and listening endpoint. A server may be **local** (the WireGuard server running on the application's own host machine) or **remote** (a WireGuard server on another machine reachable by IP).
- **FR-001a**: System MUST allow the operator to select which registered WireGuard server is active, and MUST scope device management, status, and remote actions to the selected server.
- **FR-001b**: System MUST manage the local WireGuard server by operating it directly on the host (control plane), not by acting as a separate/standalone tunnel application.
- **FR-001c**: System MUST manage remote WireGuard servers by running command-line management tools on those servers over SSH to apply and query their WireGuard configuration and related tooling.
- **FR-001d**: System MUST restrict automated remote/local server management to a fixed, vetted set of management commands (e.g. WireGuard tooling, wake-on-LAN, service control), and MUST NOT run operator-supplied arbitrary commands as part of automated management flows. (Arbitrary commands are available only through a deliberately opened interactive in-app SSH terminal per FR-009.)
- **FR-002**: System MUST allow the operator to add, edit, and remove devices within a selected server. A device MAY be a WireGuard peer (with its own key pair and tunnel address) OR a non-peer host that is not running WireGuard but is reachable via a peer/server on its LAN (a target for SSH/SFTP and/or wake-on-LAN).
- **FR-002a**: System MUST support registering and managing non-peer hosts without requiring them to be WireGuard peers, while applying WireGuard-specific attributes (keys, tunnel address, connection profile) only to peer devices.
- **FR-003**: System MUST generate a unique key pair per peer device and produce a ready-to-use client connection profile for it.
- **FR-004**: System MUST allow rotating/regenerating a device's keys and MUST invalidate the prior credentials when it does.
- **FR-005**: System MUST allow revoking a device so it can no longer connect to its server.
- **FR-006**: System MUST display the status of each server and its devices (assigned address, connected/last-seen state).
- **FR-007**: System MUST prevent address conflicts within a server and reject configurations that would assign duplicate or out-of-range addresses.
- **FR-008**: System MUST persist server, device, and trust configuration so it survives application/container restarts.

#### Remote Access (SSH / SFTP)

- **FR-009**: System MUST allow the operator to open an interactive SSH session to a reachable device through an in-app web terminal.
- **FR-010**: System MUST allow the operator to browse remote directories and upload/download files via SFTP through an in-app web file browser.
- **FR-010a**: System MUST authenticate to remote servers and devices over SSH using SSH key pairs that the app manages and stores encrypted, preferring key-based authentication over passwords.
- **FR-011**: System MUST verify a device's SSH host key against a trusted record and MUST block and warn on a mismatch.
- **FR-012**: System MUST report authentication and connection failures clearly without exposing secret values.
- **FR-013**: System MUST ensure session credentials are not retained or exposed after a session ends.

#### Wake-on-LAN (etherwake)

- **FR-014**: System MUST allow storing a device's hardware (MAC) address and its LAN segment membership.
- **FR-014a**: System MUST allow the operator to organize devices by LAN segment and to designate one always-on host per segment as that segment's "wake controller".
- **FR-014b**: System MUST clearly display, in the UI, which devices share a LAN segment and which host is that segment's designated wake controller.
- **FR-015**: System MUST perform a wake action by instructing the target device's segment wake controller (over SSH) to emit the wake-on-LAN packet on that LAN, and MUST report the outcome.
- **FR-016**: System MUST prevent a wake action when required information is missing (e.g., the device's MAC address, its segment, or a designated wake controller for that segment) and explain what is needed.

#### Security & Access Control (cross-cutting — explicitly prioritized by the user)

- **FR-017**: System MUST require the operator to authenticate with a password before any management, connection, or wake action is available, and MUST support an optional operator-enabled TOTP second factor.
- **FR-018**: System MUST store all secrets (device private keys, SSH keys, application credentials) encrypted at rest using a key derived from an operator-supplied master passphrase, MUST NOT persist that passphrase or derived key to disk, and MUST never write secrets to logs.
- **FR-018a**: System MUST require the operator to supply the master passphrase to unlock secrets after each application/container start before any secret-dependent action (server management, SSH/SFTP, wake) can proceed.
- **FR-019**: System MUST operate as a single-administrator application: exactly one operator account, whose authentication gates all management, remote-access, and wake functions. (Multi-user roles are out of scope for v1.)
- **FR-020**: System MUST record an audit trail of security-relevant actions (logins, device changes, key rotations, SSH/SFTP sessions, wake actions) with timestamp and actor, and MUST retain audit events for at least 12 months.
- **FR-021**: System MUST protect against brute-force authentication (e.g., lockout/backoff after repeated failures).
- **FR-022**: System MUST expose its management interface only over secured/encrypted transport, and MUST make it reachable only over the WireGuard network or localhost — never on the public internet.
- **FR-023**: System MUST allow secure backup and restore of configuration and secrets, keeping secrets protected in the backup.
- **FR-024**: System MUST invalidate an operator's active application session on logout and after 30 minutes of inactivity.
- **FR-024a**: System MUST provide account recovery for the sole administrator via BOTH (a) one-time recovery codes issued at 2FA setup that bypass the second factor, and (b) a host-level recovery action (requiring access to the deployment host) that resets the password and/or disables 2FA for a full lockout.

#### Deployment

- **FR-025**: System MUST be distributable and runnable as Docker container image(s).
- **FR-026**: System MUST persist its state across container restarts and image upgrades via durable storage.
- **FR-027**: System MUST allow required secrets and configuration to be provided at deploy time without hard-coding them into the image.

### Key Entities *(include if feature involves data)*

- **WireGuard Server**: A managed WireGuard network the operator can select — friendly name, address range, listening endpoint, location (**local** = the app's own host, or **remote** = another machine reachable by IP), for remote servers the SSH connection/management credentials used to operate it, and overall status. Multiple servers may be registered.
- **Device**: A machine the operator manages under a server. A device is either a **WireGuard peer** (has an assigned tunnel address and public key, with its private key held securely) or a **non-peer host** (no WireGuard identity; reached via a peer/server on its LAN). Common attributes: friendly name, hardware (MAC) address, LAN segment membership, whether it serves as its segment's wake controller, reachability/last-seen status, and remote-access (SSH/SFTP) settings.
- **LAN Segment**: A local network grouping devices share for wake-on-LAN purposes — a label/identifier and the always-on host designated as its wake controller (the host the app instructs to emit magic packets on that LAN).
- **Credential/Secret**: Sensitive material tied to a server, device, or the application — WireGuard private keys, app-managed SSH key pairs used to reach servers/devices, trusted host keys, the operator's password, optional TOTP secret, one-time account-recovery codes, and other application login secrets.
- **Session**: A remote connection instance (SSH or SFTP) to a device — start/end time, actor, and target device.
- **Operator**: The single administrator authorized to use the application — identity and authentication credentials.
- **Audit Event**: A record of a security-relevant action — timestamp, actor, action type, target, and outcome.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can go from a fresh deployment to a working encrypted network with at least two connected devices in under 15 minutes.
- **SC-002**: Adding a new device and obtaining its ready-to-use connection profile takes under 2 minutes.
- **SC-003**: An operator can start an SSH session to a reachable device and run a command within 10 seconds of initiating the connection.
- **SC-004**: 100% of stored secrets are protected at rest, and no secret value ever appears in application logs (verified by inspection/tests).
- **SC-005**: 100% of security-relevant actions (logins, device changes, key rotations, sessions, wakes) produce an audit record identifying who did what and when.
- **SC-006**: Every SSH connection to a device with a changed/mismatched host key is blocked and surfaced to the operator (0% silent pass-through).
- **SC-007**: After a container restart, the servers, devices, and trust records are fully restored with no manual reconfiguration beyond the operator entering the master passphrase once to unlock secrets.
- **SC-008**: A wake action delivers a wake packet to the correct target and reports its outcome to the operator in under 5 seconds.
- **SC-009**: Repeated failed application logins are throttled/locked out so that automated password guessing is not viable.

## Assumptions

- The application is a self-hosted tool operated by a single trusted administrator, running in the operator's own environment. It can manage multiple WireGuard servers (local and remote), with the operator selecting which one is active at a time.
- The local host and remote target machines have WireGuard and its command-line tooling installed; the app operates that tooling rather than installing it.
- Remote WireGuard servers are reachable over SSH from the deployment, and the operator supplies working SSH management credentials for each remote server.
- The operator has the necessary network privileges/permissions for the container to manage the local WireGuard server, send wake-on-LAN packets, and reach remote servers.
- Devices intended for SSH/SFTP already run SSH services; the application connects to them, it does not install or manage the SSH server software on those devices.
- Each LAN segment with wake targets has an always-on host designated as its wake controller, reachable over SSH; that controller emits the magic packet on its LAN. The system cannot guarantee a target device supports/enables WOL.
- "Basic app" means a functional first version focused on the four capabilities above; advanced features (bandwidth graphs, multi-network federation, alerting) are out of scope for v1.
- Secrets and configuration are supplied at deployment time (e.g., via environment/secret mechanisms) rather than baked into images.
- Standard modern-web performance and availability expectations apply; high-availability/clustering is out of scope for v1.
- The operator reaches the management interface only after connecting to the WireGuard network (or from localhost on the deployment host); it is never published to the public internet.
- The master passphrase is chosen and remembered by the operator; if lost, encrypted secrets are unrecoverable (by design), and the operator would re-establish them.
