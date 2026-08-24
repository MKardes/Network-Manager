import { Client, type ClientChannel, type SFTPWrapper, type ConnectConfig } from 'ssh2';
import { evaluateHostKey, type HostKeyDecision } from './host-keys.js';
import { vetted, type VettedCommandName, VettedCommandError } from './commands.js';

/**
 * SSH runner abstraction over `ssh2` (FR-001c/009/010/011).
 *
 * Provides: key-based connect with host-key TOFU/verify, a fixed vetted-command
 * executor, and interactive shell + SFTP factories. This is the single seam
 * through which remote/local execution flows, so it can be faked in tests.
 */

export interface SshConnectionInfo {
  host: string;
  port: number;
  username: string;
  privateKey: string; // decrypted PEM
  knownHostKey: string | null; // recorded SHA256 fingerprint (null = TOFU)
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export class HostKeyMismatchError extends Error {
  constructor(
    public readonly expected: string,
    public readonly presented: string,
  ) {
    super('Host key mismatch');
    this.name = 'HostKeyMismatchError';
  }
}

export class SshAuthError extends Error {
  constructor(message = 'Authentication failed') {
    super(message);
    this.name = 'SshAuthError';
  }
}

export interface Runner {
  exec(command: string, stdin?: string): Promise<ExecResult>;
  runVetted<K extends VettedCommandName>(
    name: K,
    args: Parameters<(typeof vetted)[K]>,
    stdin?: string,
  ): Promise<ExecResult>;
  shell(opts: { cols?: number; rows?: number }): Promise<ClientChannel>;
  sftp(): Promise<SFTPWrapper>;
  end(): void;
}

/**
 * Connect over SSH. Enforces host-key verification before `ready`; on a
 * mismatch the connection is torn down and HostKeyMismatchError is thrown. On
 * first use the presented fingerprint is surfaced via `onFirstUse` so the caller
 * can record it (TOFU with operator confirmation).
 */
export function connect(
  info: SshConnectionInfo,
  hooks: { onFirstUse?: (fingerprint: string) => void } = {},
): Promise<Runner> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    let decided: HostKeyDecision | null = null;

    const config: ConnectConfig = {
      host: info.host,
      port: info.port,
      username: info.username,
      privateKey: info.privateKey,
      readyTimeout: 15_000,
      // Verify the host key ourselves before the handshake completes (FR-011).
      hostVerifier: (key: Buffer) => {
        decided = evaluateHostKey(key, info.knownHostKey);
        if (decided.kind === 'trusted') return true;
        if (decided.kind === 'first-use') {
          hooks.onFirstUse?.(decided.fingerprint);
          return true; // TOFU: accept and record; caller persists the fingerprint
        }
        return false; // mismatch: reject the handshake
      },
    };

    client
      .on('ready', () => {
        resolve(makeRunner(client));
      })
      .on('error', (err: Error & { level?: string }) => {
        if (decided && decided.kind === 'mismatch') {
          reject(new HostKeyMismatchError(decided.expected, decided.presented));
          return;
        }
        if (err.level === 'client-authentication') {
          reject(new SshAuthError());
          return;
        }
        reject(err);
      })
      .connect(config);
  });
}

function makeRunner(client: Client): Runner {
  const exec = (command: string, stdin?: string): Promise<ExecResult> =>
    new Promise((resolve, reject) => {
      client.exec(command, (err, stream: ClientChannel) => {
        if (err) return reject(err);
        let stdout = '';
        let stderr = '';
        let code: number | null = null;
        stream
          .on('close', (exitCode: number | null) => {
            code = exitCode;
            resolve({ code, stdout, stderr });
          })
          .on('data', (d: Buffer) => (stdout += d.toString('utf8')))
          .stderr.on('data', (d: Buffer) => (stderr += d.toString('utf8')));
        if (stdin !== undefined) {
          stream.end(stdin);
        }
      });
    });

  return {
    exec,
    runVetted(name, args, stdin) {
      const builder = vetted[name] as (...a: unknown[]) => string;
      let command: string;
      try {
        command = builder(...(args as unknown[]));
      } catch (e) {
        if (e instanceof VettedCommandError) return Promise.reject(e);
        throw e;
      }
      return exec(command, stdin);
    },
    shell(opts) {
      return new Promise((resolve, reject) => {
        client.shell(
          { term: 'xterm-256color', cols: opts.cols ?? 80, rows: opts.rows ?? 24 },
          (err, stream) => (err ? reject(err) : resolve(stream)),
        );
      });
    },
    sftp() {
      return new Promise((resolve, reject) => {
        client.sftp((err, sftp) => (err ? reject(err) : resolve(sftp)));
      });
    },
    end() {
      client.end();
    },
  };
}
