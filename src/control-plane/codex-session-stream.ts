import { connectControlPlaneStreamClient, type ControlPlaneStreamClient } from './stream-client.ts';
import type { ControlPlaneStreamServer } from './stream-server.ts';
import type {
  StreamObservedEvent,
  StreamSessionController,
  StreamSessionKeyEventRecord,
  StreamSessionRuntimeStatus,
  StreamSessionStatusModel,
  StreamTelemetrySummary,
} from './stream-protocol.ts';

interface BaseControlPlaneAddress {
  host: string;
  port: number;
  authToken?: string;
  connectRetryWindowMs?: number;
  connectRetryDelayMs?: number;
}

interface EmbeddedControlPlaneOptions {
  mode: 'embedded';
}

interface RemoteControlPlaneOptions extends BaseControlPlaneAddress {
  mode: 'remote';
}

type CodexControlPlaneMode = EmbeddedControlPlaneOptions | RemoteControlPlaneOptions;

interface OpenCodexControlPlaneSessionOptions {
  controlPlane: CodexControlPlaneMode;
  sessionId: string;
  args: string[];
  env: Record<string, string>;
  cwd?: string;
  initialCols: number;
  initialRows: number;
  terminalForegroundHex?: string;
  terminalBackgroundHex?: string;
}

interface OpenCodexControlPlaneSessionResult {
  client: ControlPlaneStreamClient;
  close: () => Promise<void>;
}

interface OpenCodexControlPlaneClientResult {
  client: ControlPlaneStreamClient;
  close: () => Promise<void>;
}

export type ControlPlaneKeyEvent =
  | {
      type: 'session-status';
      sessionId: string;
      status: StreamSessionRuntimeStatus;
      attentionReason: string | null;
      statusModel: StreamSessionStatusModel | null;
      live: boolean;
      ts: string;
      directoryId: string | null;
      conversationId: string | null;
      telemetry: StreamTelemetrySummary | null;
      controller: StreamSessionController | null;
      cursor: number;
    }
  | {
      type: 'session-telemetry';
      sessionId: string;
      keyEvent: StreamSessionKeyEventRecord;
      ts: string;
      directoryId: string | null;
      conversationId: string | null;
      cursor: number;
    }
  | {
      type: 'session-control';
      sessionId: string;
      action: 'claimed' | 'released' | 'taken-over';
      controller: StreamSessionController | null;
      previousController: StreamSessionController | null;
      reason: string | null;
      ts: string;
      directoryId: string | null;
      conversationId: string | null;
      cursor: number;
    };

interface SubscribeControlPlaneKeyEventsOptions {
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  directoryId?: string;
  conversationId?: string;
  afterCursor?: number;
  includeOutput?: boolean;
  onEvent: (event: ControlPlaneKeyEvent) => void;
}

interface ControlPlaneKeyEventSubscription {
  subscriptionId: string;
  close: () => Promise<void>;
}

interface OpenCodexControlPlaneSessionDependencies {
  startEmbeddedServer?: () => Promise<ControlPlaneStreamServer>;
}

function mapObservedEventToKeyEvent(
  event: StreamObservedEvent,
  cursor: number,
): ControlPlaneKeyEvent | null {
  if (event.type === 'session-status') {
    return {
      type: 'session-status',
      sessionId: event.sessionId,
      status: event.status,
      attentionReason: event.attentionReason,
      statusModel: event.statusModel,
      live: event.live,
      ts: event.ts,
      directoryId: event.directoryId,
      conversationId: event.conversationId,
      telemetry: event.telemetry,
      controller: event.controller,
      cursor,
    };
  }
  if (event.type === 'session-key-event') {
    return {
      type: 'session-telemetry',
      sessionId: event.sessionId,
      keyEvent: event.keyEvent,
      ts: event.ts,
      directoryId: event.directoryId,
      conversationId: event.conversationId,
      cursor,
    };
  }
  if (event.type === 'session-control') {
    return {
      type: 'session-control',
      sessionId: event.sessionId,
      action: event.action,
      controller: event.controller,
      previousController: event.previousController,
      reason: event.reason,
      ts: event.ts,
      directoryId: event.directoryId,
      conversationId: event.conversationId,
      cursor,
    };
  }
  return null;
}

export async function subscribeControlPlaneKeyEvents(
  client: ControlPlaneStreamClient,
  options: SubscribeControlPlaneKeyEventsOptions,
): Promise<ControlPlaneKeyEventSubscription> {
  let subscriptionId: string | null = null;
  const bufferedEnvelopes: Array<{
    subscriptionId: string;
    cursor: number;
    event: StreamObservedEvent;
  }> = [];

  const emitIfRelevant = (payload: {
    subscriptionId: string;
    cursor: number;
    event: StreamObservedEvent;
  }): void => {
    if (subscriptionId === null || payload.subscriptionId !== subscriptionId) {
      return;
    }
    const mapped = mapObservedEventToKeyEvent(payload.event, payload.cursor);
    if (mapped === null) {
      return;
    }
    options.onEvent(mapped);
  };

  const removeListener = client.onEnvelope((envelope) => {
    if (envelope.kind !== 'stream.event') {
      return;
    }
    const payload = {
      subscriptionId: envelope.subscriptionId,
      cursor: envelope.cursor,
      event: envelope.event,
    };
    if (subscriptionId === null) {
      bufferedEnvelopes.push(payload);
      return;
    }
    emitIfRelevant(payload);
  });

  const subscribeCommand: {
    type: 'stream.subscribe';
    tenantId?: string;
    userId?: string;
    workspaceId?: string;
    directoryId?: string;
    conversationId?: string;
    includeOutput?: boolean;
    afterCursor?: number;
  } = {
    type: 'stream.subscribe',
    includeOutput: options.includeOutput ?? false,
  };
  if (options.tenantId !== undefined) {
    subscribeCommand.tenantId = options.tenantId;
  }
  if (options.userId !== undefined) {
    subscribeCommand.userId = options.userId;
  }
  if (options.workspaceId !== undefined) {
    subscribeCommand.workspaceId = options.workspaceId;
  }
  if (options.directoryId !== undefined) {
    subscribeCommand.directoryId = options.directoryId;
  }
  if (options.conversationId !== undefined) {
    subscribeCommand.conversationId = options.conversationId;
  }
  if (options.afterCursor !== undefined) {
    subscribeCommand.afterCursor = options.afterCursor;
  }

  let subscribed: Record<string, unknown>;
  try {
    subscribed = await client.sendCommand(subscribeCommand);
  } catch (error: unknown) {
    removeListener();
    throw error;
  }
  const parsedSubscriptionId = subscribed['subscriptionId'];
  if (typeof parsedSubscriptionId !== 'string' || parsedSubscriptionId.length === 0) {
    removeListener();
    throw new Error('control-plane stream.subscribe returned malformed subscription id');
  }
  subscriptionId = parsedSubscriptionId;
  for (const payload of bufferedEnvelopes) {
    emitIfRelevant(payload);
  }
  bufferedEnvelopes.length = 0;

  let closed = false;
  return {
    subscriptionId: parsedSubscriptionId,
    close: async () => {
      if (closed) {
        return;
      }
      closed = true;
      removeListener();
      try {
        await client.sendCommand({
          type: 'stream.unsubscribe',
          subscriptionId: parsedSubscriptionId,
        });
      } catch {
        // Best-effort unsubscribe on shutdown.
      }
    },
  };
}

export async function openCodexControlPlaneClient(
  controlPlane: CodexControlPlaneMode,
  dependencies: OpenCodexControlPlaneSessionDependencies = {},
): Promise<OpenCodexControlPlaneClientResult> {
  let controlPlaneAddress: BaseControlPlaneAddress;
  let embeddedServer: ControlPlaneStreamServer | null = null;
  if (controlPlane.mode === 'embedded') {
    const startEmbeddedServer = dependencies.startEmbeddedServer;
    if (startEmbeddedServer === undefined) {
      throw new Error('embedded mode requires a startEmbeddedServer dependency');
    }
    embeddedServer = await startEmbeddedServer();
    const embeddedAddress = embeddedServer.address();
    controlPlaneAddress = {
      host: '127.0.0.1',
      port: embeddedAddress.port,
    };
  } else {
    controlPlaneAddress = controlPlane;
  }

  const clientConnectOptions: {
    host: string;
    port: number;
    authToken?: string;
    connectRetryWindowMs?: number;
    connectRetryDelayMs?: number;
  } = {
    host: controlPlaneAddress.host,
    port: controlPlaneAddress.port,
  };
  if (controlPlaneAddress.authToken !== undefined) {
    clientConnectOptions.authToken = controlPlaneAddress.authToken;
  }
  if (controlPlaneAddress.connectRetryWindowMs !== undefined) {
    clientConnectOptions.connectRetryWindowMs = controlPlaneAddress.connectRetryWindowMs;
  }
  if (controlPlaneAddress.connectRetryDelayMs !== undefined) {
    clientConnectOptions.connectRetryDelayMs = controlPlaneAddress.connectRetryDelayMs;
  }
  const client = await connectControlPlaneStreamClient(clientConnectOptions);

  return {
    client,
    close: async () => {
      client.close();
      if (embeddedServer !== null) {
        await embeddedServer.close();
      }
    },
  };
}

export async function openCodexControlPlaneSession(
  options: OpenCodexControlPlaneSessionOptions,
  dependencies: OpenCodexControlPlaneSessionDependencies = {},
): Promise<OpenCodexControlPlaneSessionResult> {
  const opened = await openCodexControlPlaneClient(options.controlPlane, dependencies);
  const client = opened.client;

  try {
    const startCommand: {
      type: 'pty.start';
      sessionId: string;
      args: string[];
      env: Record<string, string>;
      cwd?: string;
      initialCols: number;
      initialRows: number;
      terminalForegroundHex?: string;
      terminalBackgroundHex?: string;
    } = {
      type: 'pty.start',
      sessionId: options.sessionId,
      args: options.args,
      env: options.env,
      initialCols: options.initialCols,
      initialRows: options.initialRows,
    };
    if (options.cwd !== undefined) {
      startCommand.cwd = options.cwd;
    }
    if (options.terminalForegroundHex !== undefined) {
      startCommand.terminalForegroundHex = options.terminalForegroundHex;
    }
    if (options.terminalBackgroundHex !== undefined) {
      startCommand.terminalBackgroundHex = options.terminalBackgroundHex;
    }

    const startResult = await client.sendCommand(startCommand);
    if (startResult['sessionId'] !== options.sessionId) {
      throw new Error('control-plane pty.start returned unexpected session id');
    }

    await client.sendCommand({
      type: 'pty.subscribe-events',
      sessionId: options.sessionId,
    });
    await client.sendCommand({
      type: 'pty.attach',
      sessionId: options.sessionId,
      sinceCursor: 0,
    });
  } catch (error: unknown) {
    await opened.close();
    throw error;
  }

  return {
    client,
    close: async () => {
      try {
        await client.sendCommand({
          type: 'pty.close',
          sessionId: options.sessionId,
        });
      } catch {
        // Best-effort close only.
      }
      await opened.close();
    },
  };
}
