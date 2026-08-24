# Network Manager

A WireGuard network management application with a Node.js/TypeScript backend and
a React (Vite) frontend.

```
.
├── backend/    Fastify + TypeScript API (WireGuard, SSH, crypto vault)
├── frontend/   React + Vite web UI
├── deploy/     docker-compose and deployment notes
└── specs/      feature specifications
```

## Development Environment Setup

### Prerequisites

| Requirement | Version / Notes |
| --- | --- |
| Node.js | **Use v22** (the LTS the project targets — see below) |
| npm | v10+ (ships with Node 22) |
| C/C++ toolchain | Only needed if you are *not* on Node 22 |
| Python 3 | Only needed when compiling native addons from source |

**Use Node.js 22.** This is the version the project is built and shipped on
(`node:22-slim` in the Dockerfile) and the one the native addons
(`better-sqlite3`, `argon2`, `cpu-features`, `ssh2`) publish **prebuilt
binaries** for. On Node 22 these download ready-made — **no C/C++ compiler is
required**. On other majors (e.g. Node 24) no prebuilt binary exists yet, so
`npm` falls back to compiling from source and the backend will crash on startup
with `Could not locate the bindings file ... better_sqlite3.node` unless a full
toolchain is installed.

The repo pins the version in [`.nvmrc`](.nvmrc). With
[nvm](https://github.com/nvm-sh/nvm):

```bash
nvm install 22   # first time only
nvm use          # reads .nvmrc → Node 22
```

<details>
<summary>Alternative: staying on Node 24 (or any major without prebuilds)</summary>

You must install a C/C++ toolchain so the native addons can compile from source
*before* installing dependencies:

Fedora / RHEL:

```bash
sudo dnf install -y gcc-c++ make python3
```

Debian / Ubuntu:

```bash
sudo apt-get install -y build-essential python3
```

macOS:

```bash
xcode-select --install
```

</details>

### Backend

```bash
nvm use          # ensure Node 22 (see Prerequisites)
cd backend
npm install
```

npm may block package install scripts (the `allow-scripts` policy). If you see
warnings like `N packages have install scripts not yet covered by allowScripts`,
approve the native builds and rebuild them (on Node 22 these fetch prebuilt
binaries; on other majors they compile from source and need the toolchain):

```bash
npm approve-scripts argon2
npm approve-scripts better-sqlite3
npm approve-scripts cpu-features
npm approve-scripts esbuild
npm approve-scripts ssh2
npm rebuild better-sqlite3 argon2 cpu-features ssh2
```

Verify the native binding is loadable:

```bash
node -e "require('better-sqlite3'); console.log('better-sqlite3 OK')"
```

> **Switched Node versions?** Native addons are compiled per Node ABI. After any
> `nvm use` / Node upgrade, re-run `npm rebuild better-sqlite3 argon2 cpu-features ssh2`.

Create the environment file and adjust as needed (no secrets are stored here —
the master passphrase is entered at runtime via the UI and is never persisted):

```bash
cp .env.example .env   # if present; otherwise create .env (see backend/.env)
```

Run the dev server (watch mode):

```bash
npm run dev
```

Other backend scripts:

```bash
npm run build     # tsc + copy SQL migrations to dist/
npm start         # run the compiled build
npm test          # vitest run
npm run lint      # eslint
npm run format    # prettier --write
```

### Frontend

```bash
cd frontend
npm install
npm run dev       # Vite dev server on http://localhost:5173
```

Other frontend scripts:

```bash
npm run build     # tsc -b + vite build
npm run preview   # preview production build
npm test          # vitest run
npm run lint
npm run format
```

### Running the app (both servers)

The frontend and backend run as two processes. Start them in **separate
terminals** (both on Node 22):

```bash
# Terminal 1 — backend API on http://127.0.0.1:8080
cd backend && nvm use && npm run dev

# Terminal 2 — web UI on http://localhost:5173
cd frontend && nvm use && npm run dev
```

Open http://localhost:5173. Vite proxies `/api` and `/api/v1/ws` to the backend
on port `8080` (see `frontend/vite.config.ts`), so **the backend must be running**
or the browser/console will show proxy errors.

## Troubleshooting

**`ERR_MODULE_NOT_FOUND` for `libsodium-wrappers/dist/modules-esm/libsodium.mjs`**
— The 0.7.15/0.7.16 ESM build has a broken self-import. Pin to the last known
good version:

```bash
npm install libsodium-wrappers@0.7.13 libsodium@0.7.13
```

**`[vite] http proxy error: /api/... ECONNREFUSED`** — Vite can't reach the
backend on port 8080. The backend isn't running (start it — see *Running the
app*) or it crashed on startup. Check its terminal; the most common cause is a
missing native binding (next entry).

**`Could not locate the bindings file ... better_sqlite3.node`** — the native
addon isn't built for your current Node ABI. Easiest fix: switch to Node 22
(`nvm use`) and run `npm rebuild better-sqlite3 argon2 cpu-features ssh2`, which
fetches prebuilt binaries. On other Node majors you must install the C/C++
toolchain (see Prerequisites) so it can compile.

**`Unable to detect compiler type` / `not found: make`** during `npm rebuild` —
you're on a Node version without prebuilt binaries and have no C/C++ compiler.
Switch to Node 22 (recommended) or install the toolchain. See Prerequisites.

## Deployment

See [`deploy/README.md`](deploy/README.md) for the docker-compose based
deployment. The web UI must bind to loopback or the WireGuard address only
(`BIND_ADDR`); a public bind is refused unless `ALLOW_PUBLIC_BIND=1` is set
deliberately.
