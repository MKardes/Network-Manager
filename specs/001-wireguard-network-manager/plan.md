# Implementation Plan: WireGuard Network Manager

**Branch**: `001-wireguard-network-manager` | **Date**: 2026-08-23 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-wireguard-network-manager/spec.md`

## Summary

A self-hosted, single-administrator web application that manages one or more WireGuard servers (the local host's server plus remote servers reached over SSH), the devices attached to them (WireGuard peers and non-peer LAN hosts), and provides in-browser SSH terminals, SFTP file transfer, and Wake-on-LAN via per-segment wake controllers. Security is the primary driver: the management UI is reachable only over the WireGuard network or localhost, all secrets are encrypted at rest with a key derived from an operator master passphrase (never persisted), authentication is password + optional TOTP with brute-force lockout, and every security-relevant action is audited. Delivered as Docker container image(s).

**Technical approach**: A **Node.js + TypeScript backend service** exposes a REST API for management plus WebSocket channels for interactive SSH/SFTP, persists state in a SQLite database with application-layer encryption of secret fields, operates the local WireGuard server through `wg`/`wg-quick`, and manages remote servers and wake controllers by executing a fixed, vetted set of commands over SSH (key-based auth). A **separate React + TypeScript frontend service** (built with Vite, served by nginx) provides the UI, including the in-browser terminal. The two services plus their shared data volume are orchestrated by **Docker Compose**; a backend `recovery` CLI entrypoint covers host-level lockout recovery.

## Technical Context

**Language/Version**: Node.js 22 LTS + TypeScript 5.x (backend and frontend)

**Primary Dependencies**:
- Backend (Node/TS): **Fastify** (HTTP/REST) + `@fastify/websocket` (WS terminal/transfer channels); `ssh2` (SSH client + SFTP); `better-sqlite3` (embedded SQLite); `argon2` (passphrase KDF + password hashing) and Node `crypto`/`libsodium-wrappers` (XChaCha20-Poly1305 secret encryption); `otplib` (TOTP); `zod` (request validation); `pino` (structured logging with secret redaction).
- Frontend (React/TS): **Vite** build, React 18, `xterm.js` (terminal), a typed fetch/query client; served as static assets by an **nginx** container.
- System tools invoked (present in backend image / on remote hosts): `wg`, `wg-quick` (WireGuard); `wakeonlan`/`etherwake` (WOL, run on the wake controller).

**Storage**: SQLite database file (`better-sqlite3`) on a durable Docker volume shared with the backend service. Secret-bearing columns (WireGuard private keys, app-managed SSH private keys, TOTP secret, recovery codes) are encrypted at the application layer with XChaCha20-Poly1305; the data-encryption key is unwrapped at unlock time from the operator master passphrase (Argon2id). Non-secret metadata stored in plaintext columns.

**Testing**: Backend — **Vitest** (unit) + **Supertest**/Fastify `inject` for REST/WS contract tests; SSH/WOL interactions tested against a containerized OpenSSH fixture. Frontend — Vitest + React Testing Library; Playwright optional for a smoke e2e of login → terminal.

**Target Platform**: Linux x86_64/arm64 server via Docker Compose. The **backend** container runs with `NET_ADMIN` capability and `/dev/net/tun` for local WireGuard, and host or macvlan networking as required to originate WireGuard traffic; the **frontend** (nginx) container has no special privileges.

**Project Type**: Web application — two-service Docker Compose deployment (Node/TS backend + React/TS frontend served by nginx).

**Performance Goals**: Homelab scale — interactive UI actions feel instant (<300 ms server processing for management calls); SSH keystroke round-trip dominated by network, added app latency <50 ms; wake action dispatched in <5 s (SC-008). Not a high-throughput service.

**Constraints**: Management interface never bound to a public interface (WG/localhost only — the Compose port publish binds to loopback/WG address); no secret ever written to logs or persisted in plaintext; master passphrase required after each restart before secret-dependent actions; low-memory footprint (backend + nginx typically <300 MB combined); minimal hardened images (slim Node base for backend, nginx-alpine for frontend; non-root where the WG capability allows).

**Scale/Scope**: Single administrator. Target capacity: up to ~20 WireGuard servers, ~500 devices total, ~50 concurrent WireGuard peers per server, a handful of concurrent SSH/SFTP sessions. (Resolves the spec's open scale item.)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution (`.specify/memory/constitution.md`) is the unmodified template with placeholder principles — it defines no ratified, binding gates. No constitutional violations are possible to evaluate against it.

Applied engineering guardrails in lieu of ratified principles (self-imposed, consistent with the spec's security emphasis):
- **Security-first**: secrets encrypted at rest, private-only exposure, least-privilege container, audit trail — all traceable to FR-017…FR-024a.
- **Simplicity/YAGNI**: two Compose services (Node/TS backend + nginx frontend) + embedded SQLite; no external DB, message broker, or microservices for a single-admin homelab tool.
- **Testability**: management logic behind interfaces; SSH/WG execution abstracted behind a "runner" seam so it can be faked in tests.
- **Observability**: structured logs (secrets redacted) + the required audit log.

**Result**: PASS (no binding constitution; guardrails recorded). Re-checked after Phase 1 — still PASS (no new complexity introduced).

## Project Structure

### Documentation (this feature)

```text
specs/001-wireguard-network-manager/
├── plan.md              # This file (/speckit-plan command output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (REST + WebSocket contracts)
│   ├── rest-api.md
│   └── websocket.md
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks — NOT created here)
```

### Source Code (repository root)

```text
backend/                 # Node.js + TypeScript service
├── src/
│   ├── index.ts         # Fastify server bootstrap (REST + WS), bind-address enforcement
│   ├── recovery.ts      # host-level recovery CLI entrypoint (reset password / disable 2FA) — FR-024a
│   ├── config/          # env parsing, WG/localhost bind enforcement
│   ├── auth/            # password (argon2), TOTP (otplib), sessions, lockout, recovery codes
│   ├── crypto/          # master-passphrase KDF, secret envelope (XChaCha20-Poly1305), unlock/lock state
│   ├── store/           # better-sqlite3 access, migrations, encrypted-field repositories
│   ├── servers/         # WireGuard server management (local via wg/wg-quick; remote via SSH runner)
│   ├── devices/         # peers + non-peer hosts, LAN segments, wake controllers
│   ├── remote/          # SSH runner abstraction (ssh2; exec vetted commands, key mgmt, host-key trust)
│   ├── session/         # interactive SSH terminal + SFTP over WebSocket
│   ├── wol/             # wake orchestration via segment controller
│   ├── audit/           # audit event recording + retention
│   └── http/            # routes, WS handlers, middleware (authz, zod validation, pino redaction)
├── tests/
│   ├── contract/        # REST/WS contract tests (Fastify inject / Supertest)
│   ├── integration/     # against OpenSSH/WireGuard fixtures
│   └── unit/
├── Dockerfile           # slim Node base + wireguard-tools + wakeonlan
├── package.json
└── tsconfig.json

frontend/                # React + TypeScript SPA (Vite)
├── src/
│   ├── pages/           # Unlock, Login, Servers, Devices (grouped by LAN), Terminal, Files, Audit, Settings
│   ├── components/      # terminal (xterm), file browser, server/device forms, wake controls
│   ├── api/             # typed REST/WS client
│   └── app/             # routing, auth/unlock guards
├── tests/
├── Dockerfile           # multi-stage: Vite build → nginx-alpine serving static assets + API/WS proxy
├── nginx.conf           # reverse-proxy /api and /ws to the backend service
├── package.json
└── tsconfig.json

deploy/
├── docker-compose.yml   # backend (NET_ADMIN, /dev/net/tun, data volume) + frontend (nginx); ports bound to WG/localhost
├── .env.example         # deploy-time config/secrets (no secrets baked into images)
└── README.md            # deployment + first-run (set passphrase) instructions
```

**Structure Decision**: Two-service web application orchestrated by Docker Compose. A **Node.js + TypeScript** backend (Fastify) exposes the REST API and WebSocket channels, organized by capability (servers, devices, remote, session, wol, auth, crypto, audit) with an SSH "runner" seam so remote/local execution is fakeable in tests. A **React + TypeScript** frontend (Vite) is served by an **nginx** container that reverse-proxies `/api` and `/ws` to the backend, keeping a single published origin bound to the WireGuard/localhost interface only. The backend also exposes a `recovery` CLI entrypoint (`node dist/recovery.js`, run via `docker compose run`) for the host-level lockout recovery required by FR-024a.

## Complexity Tracking

> No constitution violations to justify (constitution is an unratified template). Table intentionally empty.
