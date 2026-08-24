# WebSocket Contract: Interactive SSH Terminal & SFTP

Two WebSocket endpoints provide interactive, streaming remote access in the browser (FR-009/010). Both require an authenticated session and an unlocked vault; both enforce host-key verification before any data flows (FR-011). All open/close events and transfers are audited (FR-020).

## Endpoint: `GET /api/v1/ws/ssh/{deviceId}`

Upgrades to a WebSocket bridging the browser terminal (`xterm.js`) to an SSH shell/PTY on the target device via the app's SSH runner (key-based auth).

**Client → Server messages** (JSON):
- `{ "type": "input", "data": "<utf8 keystrokes>" }`
- `{ "type": "resize", "cols": <int>, "rows": <int> }`

**Server → Client messages** (JSON):
- `{ "type": "output", "data": "<utf8>" }` — terminal output
- `{ "type": "ready" }` — session established
- `{ "type": "error", "code": "<host_key_mismatch|auth_failed|unreachable|...>", "message": "<safe text>" }` — no secret values (FR-012)
- `{ "type": "closed", "reason": "<user|idle|tunnel_down|remote_closed>" }`

**Lifecycle**:
1. On upgrade, the runner connects and verifies the host key against the recorded fingerprint. Mismatch → send `error: host_key_mismatch`, then close; never open the shell (FR-011, SC-006).
2. On success → `ready`; then bidirectional streaming.
3. Close on client disconnect, `DELETE /sessions/{id}`, idle timeout, or tunnel drop; server discards all session credentials afterward (FR-013).

## Endpoint: `GET /api/v1/ws/sftp/{deviceId}`

Streaming channel for SFTP operations, primarily large uploads/downloads and progress.

**Client → Server**:
- `{ "type": "list", "path": "<dir>" }`
- `{ "type": "get", "path": "<file>" }`
- `{ "type": "put", "path": "<file>", "size": <bytes> }` followed by binary frames
- `{ "type": "cancel", "id": "<opId>" }`

**Server → Client**:
- `{ "type": "listing", "path", "entries": [ { "name", "size", "mode", "modified", "isDir" } ] }`
- `{ "type": "progress", "id", "transferred": <bytes>, "total": <bytes> }`
- binary frames (download payload)
- `{ "type": "done", "id", "path", "bytes" }`
- `{ "type": "error", "id?", "code", "message" }` — a failed/partial transfer is reported as `error`, never `done` (US3 scenario 4)

**Rules**: same auth/unlock/host-key gates as the SSH channel; transfers audited; no secret material transmitted in control messages.

## Common close codes

| Code | Meaning |
|------|---------|
| 1000 | Normal close (user ended) |
| 4401 | Not authenticated / vault locked |
| 4403 | Host-key mismatch or authorization failure |
| 4408 | Idle timeout |
| 4503 | Target unreachable / tunnel down |
