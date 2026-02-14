import { connect, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import {
  consumeJsonLines,
  encodeStreamEnvelope,
  parseServerEnvelope,
  type StreamCommand,
  type StreamCommandEnvelope,
  type StreamServerEnvelope,
  type StreamSignal
} from './stream-protocol.ts';

interface ControlPlaneStreamClientOptions {
  host: string;
  port: number;
  authToken?: string;
}

interface PendingCommand {
  resolve: (result: Record<string, unknown>) => void;
  reject: (error: Error) => void;
}

export class ControlPlaneStreamClient {
  private readonly socket: Socket;
  private readonly listeners = new Set<(envelope: StreamServerEnvelope) => void>();
  private readonly pending = new Map<string, PendingCommand>();
  private remainder = '';
  private pendingAuth:
    | {
        resolve: () => void;
        reject: (error: Error) => void;
      }
    | null = null;
  private closed = false;

  constructor(socket: Socket) {
    this.socket = socket;

    socket.on('data', (chunk: Buffer) => {
      this.handleData(chunk);
    });

    socket.on('close', () => {
      this.handleClose(new Error('control-plane stream closed'));
    });

    socket.on('error', (error: Error) => {
      this.handleClose(error);
    });
  }

  onEnvelope(listener: (envelope: StreamServerEnvelope) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  sendCommand(command: StreamCommand): Promise<Record<string, unknown>> {
    const commandId = `command-${randomUUID()}`;

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      if (this.closed) {
        reject(new Error('control-plane stream is closed'));
        return;
      }

      this.pending.set(commandId, {
        resolve,
        reject
      });

      const envelope: StreamCommandEnvelope = {
        kind: 'command',
        commandId,
        command
      };
      this.socket.write(encodeStreamEnvelope(envelope));
    });
  }

  authenticate(token: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (this.closed) {
        reject(new Error('control-plane stream is closed'));
        return;
      }
      if (this.pendingAuth !== null) {
        reject(new Error('auth is already pending'));
        return;
      }

      this.pendingAuth = {
        resolve,
        reject
      };
      this.socket.write(
        encodeStreamEnvelope({
          kind: 'auth',
          token
        })
      );
    });
  }

  sendInput(sessionId: string, data: Buffer): void {
    if (this.closed) {
      return;
    }

    this.socket.write(
      encodeStreamEnvelope({
        kind: 'pty.input',
        sessionId,
        dataBase64: data.toString('base64')
      })
    );
  }

  sendResize(sessionId: string, cols: number, rows: number): void {
    if (this.closed) {
      return;
    }

    this.socket.write(
      encodeStreamEnvelope({
        kind: 'pty.resize',
        sessionId,
        cols,
        rows
      })
    );
  }

  sendSignal(sessionId: string, signal: StreamSignal): void {
    if (this.closed) {
      return;
    }

    this.socket.write(
      encodeStreamEnvelope({
        kind: 'pty.signal',
        sessionId,
        signal
      })
    );
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.socket.end();
    this.rejectPending(new Error('control-plane stream closed'));
  }

  private handleData(chunk: Buffer): void {
    const consumed = consumeJsonLines(`${this.remainder}${chunk.toString('utf8')}`);
    this.remainder = consumed.remainder;

    for (const message of consumed.messages) {
      const envelope = parseServerEnvelope(message);
      if (envelope === null) {
        continue;
      }
      this.handleEnvelope(envelope);
    }
  }

  private handleEnvelope(envelope: StreamServerEnvelope): void {
    if (envelope.kind === 'auth.ok') {
      const pendingAuth = this.pendingAuth;
      if (pendingAuth !== null) {
        this.pendingAuth = null;
        pendingAuth.resolve();
      }
      return;
    }

    if (envelope.kind === 'auth.error') {
      const pendingAuth = this.pendingAuth;
      if (pendingAuth !== null) {
        this.pendingAuth = null;
        pendingAuth.reject(new Error(envelope.error));
      }
      return;
    }

    if (envelope.kind === 'command.accepted') {
      return;
    }

    if (envelope.kind === 'command.completed') {
      const pending = this.pending.get(envelope.commandId);
      if (pending === undefined) {
        return;
      }
      this.pending.delete(envelope.commandId);
      pending.resolve(envelope.result);
      return;
    }

    if (envelope.kind === 'command.failed') {
      const pending = this.pending.get(envelope.commandId);
      if (pending === undefined) {
        return;
      }
      this.pending.delete(envelope.commandId);
      pending.reject(new Error(envelope.error));
      return;
    }

    for (const listener of this.listeners) {
      listener(envelope);
    }
  }

  private handleClose(error: Error): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.rejectPending(error);
  }

  private rejectPending(error: Error): void {
    const pendingAuth = this.pendingAuth;
    if (pendingAuth !== null) {
      this.pendingAuth = null;
      pendingAuth.reject(error);
    }
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export async function connectControlPlaneStreamClient(
  options: ControlPlaneStreamClientOptions
): Promise<ControlPlaneStreamClient> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const client = connect(options.port, options.host);
    const onError = (error: Error): void => {
      client.off('connect', onConnect);
      reject(error);
    };
    const onConnect = (): void => {
      client.off('error', onError);
      resolve(client);
    };

    client.once('error', onError);
    client.once('connect', onConnect);
  });

  const client = new ControlPlaneStreamClient(socket);
  if (typeof options.authToken === 'string') {
    await client.authenticate(options.authToken);
  }
  return client;
}
