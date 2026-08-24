import type { WebSocket } from 'ws';
import { connect, HostKeyMismatchError, type SshConnectionInfo, type Runner } from '../remote/runner.js';
import type { SessionRegistry } from './registry.js';
import type { AuditService } from '../audit/audit.js';
import type { SFTPWrapper, FileEntry } from 'ssh2';

/**
 * Streaming SFTP over WebSocket (FR-010) with progress and cancel. Crucially, a
 * failed or interrupted transfer is reported as `error`, never as `done` (US3
 * scenario 4).
 */

interface ClientMsg {
  type: 'list' | 'get' | 'put' | 'cancel';
  path?: string;
  size?: number;
  id?: string;
}

export async function handleSftpWs(
  ws: WebSocket,
  deviceId: string,
  connInfo: SshConnectionInfo,
  registry: SessionRegistry,
  audit: AuditService,
): Promise<void> {
  const send = (obj: unknown) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
  };
  const sendBinary = (buf: Buffer) => {
    if (ws.readyState === ws.OPEN) ws.send(buf);
  };

  let runner: Runner | null = null;
  let sftp: SFTPWrapper | null = null;

  const session = registry.open('sftp', deviceId, () => ws.close(4408));

  try {
    runner = await connect(connInfo);
    sftp = await runner.sftp();
  } catch (e) {
    const code = e instanceof HostKeyMismatchError ? 'host_key_mismatch' : 'unreachable';
    send({ type: 'error', code, message: 'Could not open SFTP session.' });
    registry.remove(session.id);
    ws.close(e instanceof HostKeyMismatchError ? 4403 : 4503);
    return;
  }

  audit.record({
    actor: 'operator',
    action: 'sftp_open',
    targetType: 'device',
    targetId: deviceId,
    outcome: 'success',
  });

  // Track in-progress uploads awaiting binary frames.
  let pendingPut: { id: string; path: string; size: number; received: number; chunks: Buffer[] } | null =
    null;
  let cancelled = false;

  ws.on('message', (raw: Buffer, isBinary: boolean) => {
    registry.touch(session.id);
    if (isBinary) {
      // Binary frame → part of the active upload.
      if (!pendingPut || !sftp) return;
      pendingPut.chunks.push(raw);
      pendingPut.received += raw.length;
      send({ type: 'progress', id: pendingPut.id, transferred: pendingPut.received, total: pendingPut.size });
      if (pendingPut.received >= pendingPut.size) {
        const put = pendingPut;
        pendingPut = null;
        const stream = sftp.createWriteStream(put.path);
        stream.on('error', () =>
          send({ type: 'error', id: put.id, code: 'write_failed', message: 'Upload failed.' }),
        );
        stream.on('close', () => {
          audit.record({
            actor: 'operator',
            action: 'sftp_transfer',
            targetType: 'device',
            targetId: deviceId,
            outcome: 'success',
            detail: `put ${put.path} (${put.received} bytes)`,
          });
          send({ type: 'done', id: put.id, path: put.path, bytes: put.received });
        });
        stream.end(Buffer.concat(put.chunks));
      }
      return;
    }

    let msg: ClientMsg;
    try {
      msg = JSON.parse(raw.toString('utf8')) as ClientMsg;
    } catch {
      return;
    }
    if (!sftp) return;

    if (msg.type === 'cancel') {
      cancelled = true;
      if (pendingPut) {
        send({ type: 'error', id: pendingPut.id, code: 'cancelled', message: 'Transfer cancelled.' });
        pendingPut = null;
      }
      return;
    }

    if (msg.type === 'list' && msg.path) {
      sftp.readdir(msg.path, (err, list: FileEntry[]) => {
        if (err) return send({ type: 'error', code: 'list_failed', message: 'Could not list directory.' });
        send({
          type: 'listing',
          path: msg.path,
          entries: list.map((e) => ({
            name: e.filename,
            size: e.attrs.size,
            mode: e.attrs.mode,
            modified: e.attrs.mtime,
            isDir: (e.attrs.mode & 0o170000) === 0o040000,
          })),
        });
      });
    } else if (msg.type === 'get' && msg.path) {
      const id = msg.id ?? msg.path;
      const stream = sftp.createReadStream(msg.path);
      let transferred = 0;
      cancelled = false;
      stream.on('data', (c: Buffer) => {
        if (cancelled) {
          stream.destroy();
          return;
        }
        transferred += c.length;
        sendBinary(c);
        send({ type: 'progress', id, transferred, total: 0 });
      });
      // A partial/failed download is reported as error, never done (US3 sc.4).
      stream.on('error', () =>
        send({ type: 'error', id, code: 'read_failed', message: 'Download failed (partial).' }),
      );
      stream.on('end', () => {
        if (cancelled) {
          send({ type: 'error', id, code: 'cancelled', message: 'Transfer cancelled.' });
          return;
        }
        audit.record({
          actor: 'operator',
          action: 'sftp_transfer',
          targetType: 'device',
          targetId: deviceId,
          outcome: 'success',
          detail: `get ${msg.path} (${transferred} bytes)`,
        });
        send({ type: 'done', id, path: msg.path, bytes: transferred });
      });
    } else if (msg.type === 'put' && msg.path && typeof msg.size === 'number') {
      pendingPut = { id: msg.id ?? msg.path, path: msg.path, size: msg.size, received: 0, chunks: [] };
      if (msg.size === 0) {
        // Empty file: nothing to stream.
        const stream = sftp.createWriteStream(msg.path);
        stream.on('close', () => send({ type: 'done', id: pendingPut?.id, path: msg.path, bytes: 0 }));
        stream.end();
        pendingPut = null;
      }
    }
  });

  const cleanup = () => {
    try {
      runner?.end();
    } catch {
      /* ignore */
    }
    runner = null;
    sftp = null;
    registry.remove(session.id);
    audit.record({
      actor: 'operator',
      action: 'sftp_close',
      targetType: 'device',
      targetId: deviceId,
      outcome: 'success',
    });
  };
  ws.on('close', cleanup);
}
