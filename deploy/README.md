# Deploying WireGuard Network Manager

A self-hosted, single-administrator web app that manages one or more WireGuard
servers (local + remote-over-SSH), their devices, in-browser SSH/SFTP, and
Wake-on-LAN. Delivered as two Docker Compose services (Node/TS backend + nginx
frontend).

## Prerequisites

- Docker + Docker Compose on a Linux host.
- Kernel WireGuard support: `/dev/net/tun` present and the ability to grant the
  backend container the `NET_ADMIN` capability.
- For remote-server / SSH / SFTP / WOL features: at least one reachable machine
  running OpenSSH.

## First run

```bash
cp deploy/.env.example deploy/.env
# Edit deploy/.env: set BIND_ADDR to loopback or your WireGuard address, and WEB_PORT.
docker compose -f deploy/docker-compose.yml up --build -d
```

Then open the UI at `https://<BIND_ADDR>:<WEB_PORT>` (reachable only over
loopback or the WireGuard network — see **Security posture**).

1. **Setup** — create the single administrator and choose a **master
   passphrase**. The passphrase encrypts every secret at rest and is *never
   stored*; if you lose it, secrets are unrecoverable.
2. **Log in.** Optionally enable **2FA** in Settings and **save the one-time
   recovery codes** — they are shown only once.
3. After any restart you must **unlock the vault** with the master passphrase
   before secret-dependent actions work (servers, devices, SSH, wake).

## Security posture

- **Private-only exposure (FR-022):** the frontend port is published on
  `BIND_ADDR` only (loopback / WireGuard). The backend refuses to bind to a
  public address unless `ALLOW_PUBLIC_BIND=1` (discouraged).
- **Secrets at rest (FR-018):** WireGuard/SSH private keys, the TOTP secret, and
  recovery codes are envelope-encrypted (XChaCha20-Poly1305 DEK wrapped by an
  Argon2id key derived from the master passphrase). Secrets never appear in API
  responses or logs (pino redaction).
- **Least privilege:** the backend drops all Linux capabilities except
  `NET_ADMIN`, runs with a read-only root filesystem (only the data volume and
  `/tmp` are writable), and the frontend has no special privileges.
- **TLS:** serve the private origin over HTTPS (a self-signed cert is acceptable
  within the private network). Terminate TLS at nginx.

## WireGuard capability / `/dev/net/tun`

The backend manages the **local** WireGuard server by running `wg` / `wg-quick`
in the container. This requires:

- `cap_add: [NET_ADMIN]` (already set in `docker-compose.yml`),
- the `/dev/net/tun` device mapped in (already set),
- host or macvlan networking if the container must originate WireGuard traffic
  on the host's LAN.

Remote servers are managed over SSH using a **fixed, vetted command set** only
(`wg`, `wg syncconf`, `wg-quick`, `wakeonlan`). Arbitrary remote commands are
never issued by management flows — only through a deliberately opened SSH
terminal.

## 2FA and recovery codes

Enable TOTP in **Settings → Two-factor authentication**. You are shown a
provisioning URI (add it to an authenticator app) and ten one-time recovery
codes. Each recovery code satisfies the 2FA prompt once.

## Host-level recovery (locked out)

If you lose your password or 2FA device, run the recovery CLI on the host —
this resets the password and/or disables 2FA **without** the master passphrase
and without exposing any secret:

```bash
docker compose -f deploy/docker-compose.yml run --rm backend node dist/recovery.js
```

## Backups

Back up the `wg_data` Docker volume (SQLite database + rendered WG configs). The
database is useless to a thief without the master passphrase, since all secret
fields are encrypted at rest.

## Validation

`specs/001-wireguard-network-manager/quickstart.md` defines end-to-end
validation scenarios A–F mapped to the success criteria.
