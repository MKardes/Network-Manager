import type { WebSocket } from 'ws';
import { connect, HostKeyMismatchError, SshAuthError, type SshConnectionInfo } from '../remote/runner.js';
import type { SessionRegistry } from './registry.js';
import type { AuditService } from '../audit/audit.js';

/**
 * Bridge a browser terminal (xterm.js) to an SSH shell/PTY over a WebSocket
 * (FR-009). Host-key verification happens inside `connect` BEFORE the shell is
 * opened; a mismatch sends an error and closes without ever opening a channel
 * (FR-011). Credentials are discarded when the socket closes (FR-013).
 */

interface ClientMsg {
  type: 'input' | 'resize';
  data?: string;
  cols?: number;
  rows?: number;
}

// WS close codes (websocket.md).
const CLOSE_HOSTKEY = 4403;
const CLOSE_UNREACHABLE = 4503;

export async function handleSshWs(
  ws: WebSocket,
  deviceId: string,
  connInfo: SshConnectionInfo,
  registry: SessionRegistry,
  audit: AuditService,
  onFirstUse?: (fingerprint: string) => void,
): Promise<void> {
  const send = (obj: unknown) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };

  let runner: Awaited<ReturnType<typeof connect>> | null = null;
  let closed = false;

  const cleanup = (reason: string) => {
    if (closed) return;
    closed = true;
    try {
      runner?.end();
    } catch {
      /* ignore */
    }
    runner = null; // drop credential-bearing closure
    if (ws.readyState === ws.OPEN) {
      send({ type: 'closed', reason });
      ws.close(1000);
    }
  };

  const session = registry.open('ssh', deviceId, (reason) => {
    if (reason === 'idle') ws.close(4408);
    cleanup(reason);
  });

  try {
    runner = await connect(connInfo, { onFirstUse });
  } catch (e) {
    if (e instanceof HostKeyMismatchError) {
      send({
        type: 'error',
        code: 'host_key_mismatch',
        message: 'Host key does not match the recorded key; session blocked.',
      });
      audit.record({
        actor: 'operator',
        action: 'ssh_session_open',
        targetType: 'device',
        targetId: deviceId,
        outcome: 'failure',
        detail: 'host_key_mismatch',
      });
      registry.remove(session.id);
      ws.close(CLOSE_HOSTKEY);
      return;
    }
    const code = e instanceof SshAuthError ? 'auth_failed' : 'unreachable';
    send({ type: 'error', code, message: code === 'auth_failed' ? 'Authentication failed.' : 'Target unreachable.' });
    audit.record({
      actor: 'operator',
      action: 'ssh_session_open',
      targetType: 'device',
      targetId: deviceId,
      outcome: 'failure',
      detail: code,
    });
    registry.remove(session.id);
    ws.close(CLOSE_UNREACHABLE);
    return;
  }

  let stream;
  try {
    stream = await runner.shell({ cols: 80, rows: 24 });
  } catch {
    send({ type: 'error', code: 'unreachable', message: 'Could not open a shell.' });
    cleanup('remote_closed');
    registry.remove(session.id);
    return;
  }

  audit.record({
    actor: 'operator',
    action: 'ssh_session_open',
    targetType: 'device',
    targetId: deviceId,
    outcome: 'success',
  });
  send({ type: 'ready' });

  stream.on('data', (d: Buffer) => {
    registry.touch(session.id);
    send({ type: 'output', data: d.toString('utf8') });
  });
  stream.stderr.on('data', (d: Buffer) => send({ type: 'output', data: d.toString('utf8') }));
  stream.on('close', () => {
    cleanup('remote_closed');
    registry.remove(session.id);
    audit.record({
      actor: 'operator',
      action: 'ssh_session_close',
      targetType: 'device',
      targetId: deviceId,
      outcome: 'success',
    });
  });

  ws.on('message', (raw: Buffer) => {
    registry.touch(session.id);
    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString('utf8')) as ClientMsg;
    } catch {
      return;
    }
    if (msg.type === 'input' && typeof msg.data === 'string') {
      stream.write(msg.data);
    } else if (msg.type === 'resize' && msg.cols && msg.rows) {
      stream.setWindow(msg.rows, msg.cols, 0, 0);
    }
  });

  ws.on('close', () => {
    cleanup('user');
    registry.remove(session.id);
  });
}
