import { connect, type SshConnectionInfo, type Runner } from '../remote/runner.js';
import type { SFTPWrapper, FileEntry } from 'ssh2';

/**
 * SFTP operations over the `ssh2` SFTP subsystem (FR-010): directory listing and
 * simple get/put. Host-key verification is enforced by `connect`. Larger/stream
 * transfers use the WebSocket channel (see sftp-ws.ts).
 */

export interface SftpEntry {
  name: string;
  size: number;
  mode: number;
  modified: number;
  isDir: boolean;
}

export class SftpService {
  constructor(private readonly connInfo: SshConnectionInfo) {}

  private async withSftp<T>(fn: (sftp: SFTPWrapper) => Promise<T>): Promise<T> {
    const runner: Runner = await connect(this.connInfo);
    try {
      const sftp = await runner.sftp();
      return await fn(sftp);
    } finally {
      runner.end();
    }
  }

  list(path: string): Promise<SftpEntry[]> {
    return this.withSftp(
      (sftp) =>
        new Promise<SftpEntry[]>((resolve, reject) => {
          sftp.readdir(path, (err, list: FileEntry[]) => {
            if (err) return reject(err);
            resolve(
              list.map((e) => ({
                name: e.filename,
                size: e.attrs.size,
                mode: e.attrs.mode,
                modified: e.attrs.mtime,
                isDir: (e.attrs.mode & 0o170000) === 0o040000,
              })),
            );
          });
        }),
    );
  }

  download(path: string): Promise<Buffer> {
    return this.withSftp(
      (sftp) =>
        new Promise<Buffer>((resolve, reject) => {
          const chunks: Buffer[] = [];
          const stream = sftp.createReadStream(path);
          stream.on('data', (c: Buffer) => chunks.push(c));
          stream.on('error', reject);
          stream.on('end', () => resolve(Buffer.concat(chunks)));
        }),
    );
  }

  upload(path: string, data: Buffer): Promise<void> {
    return this.withSftp(
      (sftp) =>
        new Promise<void>((resolve, reject) => {
          const stream = sftp.createWriteStream(path);
          stream.on('error', reject);
          stream.on('close', () => resolve());
          stream.end(data);
        }),
    );
  }
}
