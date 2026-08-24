# Phase 0 Research: WireGuard Network Manager

All Technical Context unknowns are resolved below. No `NEEDS CLARIFICATION` remain.

## 1. Backend language & runtime

- **Decision**: Node.js 22 LTS + TypeScript, Fastify framework. Delivered as a slim Node container in a two-service Docker Compose deployment (backend + nginx frontend). *(Operator directive, 2026-08-23.)*
- **Rationale**: The operator chose a TypeScript/Node.js frontend + backend on Docker Compose. Node has a strong async WebSocket story for streaming terminals, a mature SSH library (`ssh2`) covering both shell and SFTP, and lets frontend and backend share one language/toolchain. Fastify gives fast, schema-validated HTTP with first-class WS support.
- **Alternatives considered**: Go single binary (smallest/most-hardened image, but the operator wants Node/TS and a shared-language stack); Python + FastAPI + Paramiko (heavier image, GIL under many concurrent streams).

## 2. Local WireGuard management from a container

- **Decision**: Manage the local server by invoking `wg`/`wg-quick` from the **backend** container in the host network namespace; grant that container `cap_add: [NET_ADMIN]`, `/dev/net/tun`, and host (or macvlan) networking in Compose. Configuration is rendered to a WG config file on the durable volume and applied via `wg syncconf`/`wg-quick` (spawned as child processes from Node).
- **Rationale**: Directly satisfies FR-001b (operate the real local server, not a separate tunnel app) while keeping the app as the control plane. `wg syncconf` applies peer changes without dropping the interface.
- **Alternatives considered**: Using the kernel WG netlink API via a Go library (more code, marginal benefit over shelling to the vetted `wg` tool); running WG in a sidecar (adds orchestration for no gain at this scale).

## 3. Remote server management & SSH execution

- **Decision**: A single **SSH runner** abstraction (built on the `ssh2` library) executes a **fixed, vetted command set** (`wg`, `wg-quick`/`wg syncconf`, service control, `wakeonlan`/`etherwake`) on remote hosts. Interactive shells are a separate, explicitly-opened path (FR-009). Auth is key-based using app-managed SSH keys (FR-010a).
- **Rationale**: FR-001c/FR-001d require automated management via a bounded command set, distinct from arbitrary interactive shells. A runner seam makes commands auditable and fakeable in tests.
- **Alternatives considered**: Installing an agent on remote servers (heavier, more to secure/deploy); allowing arbitrary command templates (rejected by clarification — security).

## 4. In-browser SSH terminal & SFTP

- **Decision**: `xterm.js` in the SPA over a WebSocket (`@fastify/websocket`) that bridges to `ssh2` shell sessions; SFTP via `ssh2`'s SFTP subsystem exposed as a file-browser API (list/upload/download) plus a streaming WS channel for large transfers.
- **Rationale**: Single pane of glass (clarified), reuses the same SSH stack, no external client. Host-key verification enforced before the channel opens (FR-011).
- **Alternatives considered**: Guacamole/ttyd sidecars (extra services, larger surface); handing off to native clients (rejected by clarification).

## 5. Secrets at rest & master passphrase

- **Decision**: Envelope encryption using `libsodium-wrappers` (XChaCha20-Poly1305) and the `argon2` package. A random 256-bit **data-encryption key (DEK)** encrypts secret fields. The DEK is wrapped by a **key-encryption key (KEK)** derived from the operator master passphrase via Argon2id (tuned params, per-install salt). Only the wrapped DEK + salt are stored; the passphrase/KEK/plaintext DEK live in memory only (in the backend process), held after unlock and zeroized on lock/exit.
- **Rationale**: Satisfies FR-018/FR-018a — disk or backup theft alone cannot decrypt; supports passphrase change (re-wrap DEK) without re-encrypting every field; unlock required each start.
- **Alternatives considered**: OS keyring (not portable in containers); host-provided key (rejected by clarification in favor of passphrase); SQLCipher whole-DB encryption (cgo, and still needs a key source — envelope model is cleaner and field-granular).

## 6. Authentication, TOTP, sessions, lockout, recovery

- **Decision**: Password hashed with `argon2` (Argon2id); optional TOTP (`otplib`, RFC 6238) the operator can enable; server-side sessions via HttpOnly+Secure+SameSite=Strict cookies with a 30-minute idle timeout (FR-024); exponential backoff + temporary lockout on repeated failures (FR-021). Recovery: one-time codes (hashed, single-use) generated at 2FA setup, **and** a `recovery` CLI entrypoint in the backend image (`node dist/recovery.js`, run via `docker compose run`) to reset password / disable 2FA (FR-024a).
- **Rationale**: Directly maps to FR-017/021/024/024a with standard, well-reviewed primitives.
- **Alternatives considered**: JWT stateless sessions (harder to revoke on idle/lockout); WebAuthn (valuable later; TOTP is the clarified baseline).

## 7. Wake-on-LAN via segment controller

- **Decision**: Model **LAN Segments**; each has a designated always-on **wake controller** device. A wake action runs `wakeonlan <MAC>` (or `etherwake`) on that controller via the SSH runner. UI groups devices by segment and labels the controller (FR-014a/014b/015).
- **Rationale**: Magic packets require same-L2 origin; the controller is the only reliable local emitter for remote segments (clarified). Reuses the SSH runner and vetted command set.
- **Alternatives considered**: App-host direct broadcast (only works on the app's own LAN — rejected by clarification); UDP-directed broadcast across the tunnel (unreliable, blocked by most routers).

## 8. Device model: peers vs non-peer hosts

- **Decision**: One `Device` concept with an optional WireGuard identity. Peer devices carry tunnel address + keys + connection profile; non-peer hosts carry only reachability metadata (MAC, segment, SSH settings). Validation applies WG rules only to peers (FR-002/002a).
- **Rationale**: Matches the clarified reality (wake controller wakes plain PCs; some targets are SSH-only). Avoids two parallel entities and duplicated UI.
- **Alternatives considered**: Separate `Peer` and `Host` entities (more code, awkward for a host that later becomes a peer).

## 9. Management interface exposure

- **Decision**: Bind the HTTP server only to loopback and/or the WireGuard interface address; refuse to start bound to a public/`0.0.0.0` interface unless an explicit, documented override is set (which the docs discourage). Serve over TLS (self-signed acceptable within the private network). (FR-022)
- **Rationale**: Enforces the clarified private-only posture in code, not just docs.
- **Alternatives considered**: Reverse proxy + public exposure (rejected by clarification).

## 10. Storage engine

- **Decision**: SQLite via `better-sqlite3`, single file on a durable volume (mounted into the backend service), WAL mode, schema migrations at startup.
- **Rationale**: Zero external services, fits single-admin scale (~20 servers / ~500 devices), simplest durable persistence (FR-008/026); `better-sqlite3` is synchronous and fast, avoiding a separate DB container in the Compose stack.
- **Alternatives considered**: PostgreSQL as a third Compose service (operational overhead unjustified at this scale); flat files (no query/consistency guarantees).

## 11. Packaging & container hardening

- **Decision**: **Docker Compose with two services.** (1) **backend** — multi-stage Dockerfile on a slim Node base, `npm ci && tsc` build, runtime image containing the compiled JS plus `wireguard-tools` and `wakeonlan`; runs with `cap_add: [NET_ADMIN]`, `/dev/net/tun`, the SQLite data volume mounted writable, and the rest of the FS read-only. (2) **frontend** — multi-stage Dockerfile: Vite build → `nginx-alpine` serving static assets and reverse-proxying `/api` + `/ws` to the backend; no special privileges. Published ports bound to loopback/WG address only; secrets/config injected at deploy time via `.env`/Compose secrets (FR-022/025/027).
- **Rationale**: Matches the operator's frontend + backend Compose directive while preserving the security posture (single private origin, least-privilege frontend, capability confined to the backend).
- **Alternatives considered**: Single embedded-SPA container (rejected — operator wants separate frontend/backend services); full distro base (larger surface).

## Resolved open item from spec

- **Scale**: set to homelab targets — up to ~20 servers, ~500 devices, ~50 peers/server, a few concurrent interactive sessions. Recorded in Technical Context.
