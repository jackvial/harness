import {
  spawn,
  type ChildProcessWithoutNullStreams
} from 'node:child_process';
import type { CodexTransport } from './codex-adapter.ts';
import type { CodexNotification } from './codex-event-mapper.ts';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number;
  method: string;
  params: Record<string, unknown>;
}

interface JsonRpcNotification {
  jsonrpc: '2.0';
  method: string;
}

interface ClientInfo {
  name: string;
  title: string | null;
  version: string;
}

interface InitializeCapabilities {
  experimentalApi: boolean;
  optOutNotificationMethods?: string[] | null;
}

interface InitializeParams {
  clientInfo: ClientInfo;
  capabilities: InitializeCapabilities | null;
}

interface CodexInitializationOptions {
  enabled?: boolean;
  params?: InitializeParams;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface CodexStdioTransportOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onStderr?: (chunk: Buffer) => void;
  initialization?: CodexInitializationOptions;
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export class CodexStdioTransport implements CodexTransport {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly subscribers = new Set<(notification: CodexNotification) => void>();
  private readonly initializationEnabled: boolean;
  private readonly initializationParams: InitializeParams;
  private nextRequestId = 1;
  private closed = false;
  private initialized = false;
  private initializationPromise: Promise<void> | null = null;
  private readBuffer = '';

  constructor(options: CodexStdioTransportOptions = {}) {
    this.initializationEnabled = options.initialization?.enabled ?? true;
    this.initializationParams = options.initialization?.params ?? {
      clientInfo: {
        name: 'harness',
        title: 'Harness',
        version: '0.1.0'
      },
      capabilities: {
        experimentalApi: true
      }
    };

    this.child = spawn(
      options.command ?? 'codex',
      options.args ?? ['app-server', '--listen', 'stdio://'],
      {
        cwd: options.cwd,
        env: options.env ?? process.env,
        stdio: ['pipe', 'pipe', 'pipe']
      }
    );

    this.child.stdout.on('data', (chunk: Buffer) => {
      this.onStdout(chunk);
    });
    this.child.stderr.on('data', (chunk: Buffer) => {
      options.onStderr?.(chunk);
    });
    this.child.on('error', (error: Error) => {
      this.failAll(error);
    });
    this.child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      this.failAll(new Error(`codex app-server exited: code=${String(code)} signal=${String(signal)}`));
    });
  }

  async request(method: string, params: Record<string, unknown>): Promise<unknown> {
    if (this.closed) {
      throw new Error('transport is closed');
    }

    if (method !== 'initialize') {
      await this.ensureInitialized();
    }

    return this.sendRequest(method, params);
  }

  subscribe(handler: (notification: CodexNotification) => void): () => void {
    this.subscribers.add(handler);
    return () => {
      this.subscribers.delete(handler);
    };
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.failAll(new Error('transport closed'));
    this.child.stdin.end();
    this.child.kill('SIGTERM');
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<unknown> {
    const requestId = this.nextRequestId;
    this.nextRequestId += 1;

    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: requestId,
      method,
      params
    };

    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.writeMessage(request, (error) => {
        if (error == null) {
          return;
        }

        const pendingRequest = this.pending.get(requestId);
        if (pendingRequest !== undefined) {
          this.pending.delete(requestId);
          pendingRequest.reject(error);
        }
      });
    });
  }

  private sendNotification(method: string): void {
    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method
    };
    this.writeMessage(notification, () => {
      // Notification write errors surface through process-level failure handlers.
    });
  }

  private writeMessage(
    message: JsonRpcRequest | JsonRpcNotification,
    onWrite: (error: Error | null | undefined) => void
  ): void {
    if (this.closed || this.child.stdin.writableEnded || this.child.stdin.destroyed) {
      onWrite(new Error('transport is closed'));
      return;
    }

    this.child.stdin.write(`${JSON.stringify(message)}\n`, (error: Error | null | undefined) => {
      onWrite(error);
    });
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initializationEnabled === false || this.initialized) {
      return;
    }

    if (this.initializationPromise !== null) {
      await this.initializationPromise;
      return;
    }

    const pendingInitialization = (async () => {
      await this.sendRequest('initialize', {
        clientInfo: this.initializationParams.clientInfo,
        capabilities: this.initializationParams.capabilities
      });
      this.sendNotification('initialized');
      this.initialized = true;
    })();

    this.initializationPromise = pendingInitialization;

    try {
      await pendingInitialization;
    } catch (error) {
      this.initializationPromise = null;
      throw error;
    }
  }

  private onStdout(chunk: Buffer): void {
    this.readBuffer += chunk.toString('utf8');
    for (;;) {
      const newlineIndex = this.readBuffer.indexOf('\n');
      if (newlineIndex < 0) {
        return;
      }

      const line = this.readBuffer.slice(0, newlineIndex).trim();
      this.readBuffer = this.readBuffer.slice(newlineIndex + 1);
      if (line.length === 0) {
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      this.onJsonMessage(parsed);
    }
  }

  private onJsonMessage(message: unknown): void {
    const objectValue = asObject(message);
    if (objectValue === null) {
      return;
    }

    const method = asString(objectValue.method);
    const id = asNumber(objectValue.id);
    if (method !== null && id === null) {
      const notification: CodexNotification = {
        method,
        params: objectValue.params
      };
      for (const subscriber of this.subscribers) {
        subscriber(notification);
      }
      return;
    }

    if (id === null) {
      return;
    }

    const pendingRequest = this.pending.get(id);
    if (pendingRequest === undefined) {
      return;
    }
    this.pending.delete(id);

    const errorObject = asObject(objectValue.error);
    if (errorObject !== null) {
      const errorMessage = asString(errorObject.message) ?? 'json-rpc error';
      pendingRequest.reject(new Error(errorMessage));
      return;
    }
    pendingRequest.resolve(objectValue.result);
  }

  private failAll(error: Error): void {
    if (this.pending.size === 0) {
      return;
    }
    for (const pendingRequest of this.pending.values()) {
      pendingRequest.reject(error);
    }
    this.pending.clear();
  }
}
