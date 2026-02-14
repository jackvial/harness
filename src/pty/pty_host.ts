import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OPCODE_DATA = 0x01;
const OPCODE_RESIZE = 0x02;
const OPCODE_CLOSE = 0x03;

const DEFAULT_COMMAND = '/bin/sh';
const DEFAULT_COMMAND_ARGS = ['-i'];
const DEFAULT_HELPER_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../bin/ptyd'
);

export interface StartPtySessionOptions {
  command?: string;
  commandArgs?: string[];
  env?: NodeJS.ProcessEnv;
  helperPath?: string;
}

export interface PtyExit {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export class PtySession extends EventEmitter {
  private readonly child: ChildProcessWithoutNullStreams;

  constructor(child: ChildProcessWithoutNullStreams) {
    super();
    this.child = child;

    child.stdout.on('data', (chunk: Buffer) => {
      this.emit('data', chunk);
    });

    child.on('error', (error: Error) => {
      this.emit('error', error);
    });

    child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      this.emit('exit', { code, signal } satisfies PtyExit);
    });
  }

  write(data: string | Uint8Array): void {
    const payload = typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
    const frame = Buffer.alloc(1 + 4 + payload.length);
    frame[0] = OPCODE_DATA;
    frame.writeUInt32BE(payload.length, 1);
    payload.copy(frame, 5);
    this.child.stdin.write(frame);
  }

  resize(cols: number, rows: number): void {
    const frame = Buffer.alloc(1 + 2 + 2);
    frame[0] = OPCODE_RESIZE;
    frame.writeUInt16BE(cols, 1);
    frame.writeUInt16BE(rows, 3);
    this.child.stdin.write(frame);
  }

  close(): void {
    const frame = Buffer.from([OPCODE_CLOSE]);
    this.child.stdin.write(frame);
  }
}

export function startPtySession(options: StartPtySessionOptions = {}): PtySession {
  const command = options.command ?? DEFAULT_COMMAND;
  const commandArgs = options.commandArgs ?? DEFAULT_COMMAND_ARGS;
  const env = options.env ?? process.env;
  const helperPath = options.helperPath ?? DEFAULT_HELPER_PATH;

  const child = spawn(
    helperPath,
    [command, ...commandArgs],
    {
      env,
      stdio: ['pipe', 'pipe', 'pipe']
    }
  );

  return new PtySession(child);
}
