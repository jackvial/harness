import { connectControlPlaneStreamClient, type ControlPlaneStreamClient } from './stream-client.ts';
import {
  type StreamCommand,
  type StreamObservedEvent,
  type StreamSessionController,
  type StreamSessionControllerType,
  type StreamSignal
} from './stream-protocol.ts';
import {
  parseSessionSummaryList,
  parseSessionSummaryRecord
} from './session-summary.ts';

export interface AgentRealtimeSubscriptionFilter {
  tenantId?: string;
  userId?: string;
  workspaceId?: string;
  directoryId?: string;
  conversationId?: string;
  includeOutput?: boolean;
  afterCursor?: number;
}

export interface AgentRealtimeConnectOptions {
  host: string;
  port: number;
  authToken?: string;
  connectRetryWindowMs?: number;
  connectRetryDelayMs?: number;
  subscription?: AgentRealtimeSubscriptionFilter;
  onHandlerError?: (error: unknown, event: AgentRealtimeEventEnvelope) => void;
}

interface AgentEventTypeMap {
  'directory.upserted': Extract<StreamObservedEvent, { type: 'directory-upserted' }>;
  'directory.archived': Extract<StreamObservedEvent, { type: 'directory-archived' }>;
  'conversation.created': Extract<StreamObservedEvent, { type: 'conversation-created' }>;
  'conversation.updated': Extract<StreamObservedEvent, { type: 'conversation-updated' }>;
  'conversation.archived': Extract<StreamObservedEvent, { type: 'conversation-archived' }>;
  'conversation.deleted': Extract<StreamObservedEvent, { type: 'conversation-deleted' }>;
  'session.status': Extract<StreamObservedEvent, { type: 'session-status' }>;
  'session.event': Extract<StreamObservedEvent, { type: 'session-event' }>;
  'session.telemetry': Extract<StreamObservedEvent, { type: 'session-key-event' }>;
  'session.control': Extract<StreamObservedEvent, { type: 'session-control' }>;
  'session.output': Extract<StreamObservedEvent, { type: 'session-output' }>;
}

export type AgentRealtimeEventType = keyof AgentEventTypeMap;

export interface AgentRealtimeEventEnvelope<TEventType extends AgentRealtimeEventType = AgentRealtimeEventType> {
  readonly type: TEventType;
  readonly cursor: number;
  readonly observed: AgentEventTypeMap[TEventType];
}

type AgentRealtimeListener<TEventType extends AgentRealtimeEventType> = (
  event: AgentRealtimeEventEnvelope<TEventType>
) => void | Promise<void>;

type AnyRealtimeListener = (event: AgentRealtimeEventEnvelope) => void | Promise<void>;

export interface AgentClaimSessionInput {
  sessionId: string;
  controllerId: string;
  controllerType: StreamSessionControllerType;
  controllerLabel?: string;
  reason?: string;
  takeover?: boolean;
}

export interface AgentReleaseSessionInput {
  sessionId: string;
  reason?: string;
}

export interface AgentSessionClaimResult {
  sessionId: string;
  action: 'claimed' | 'taken-over';
  controller: StreamSessionController;
}

export interface AgentSessionReleaseResult {
  sessionId: string;
  released: boolean;
}

export type AgentSessionSummary = NonNullable<ReturnType<typeof parseSessionSummaryRecord>>;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function parseSessionController(value: unknown): StreamSessionController | null {
  const record = asRecord(value);
  if (record === null) {
    return null;
  }
  const controllerId = record['controllerId'];
  const controllerType = record['controllerType'];
  const controllerLabel = record['controllerLabel'];
  const claimedAt = record['claimedAt'];
  if (
    typeof controllerId !== 'string' ||
    (controllerType !== 'human' && controllerType !== 'agent' && controllerType !== 'automation') ||
    (controllerLabel !== null && typeof controllerLabel !== 'string') ||
    typeof claimedAt !== 'string'
  ) {
    return null;
  }
  return {
    controllerId,
    controllerType,
    controllerLabel,
    claimedAt
  };
}

function mapObservedEventType(observed: StreamObservedEvent): AgentRealtimeEventType {
  if (observed.type === 'directory-upserted') {
    return 'directory.upserted';
  }
  if (observed.type === 'directory-archived') {
    return 'directory.archived';
  }
  if (observed.type === 'conversation-created') {
    return 'conversation.created';
  }
  if (observed.type === 'conversation-updated') {
    return 'conversation.updated';
  }
  if (observed.type === 'conversation-archived') {
    return 'conversation.archived';
  }
  if (observed.type === 'conversation-deleted') {
    return 'conversation.deleted';
  }
  if (observed.type === 'session-status') {
    return 'session.status';
  }
  if (observed.type === 'session-event') {
    return 'session.event';
  }
  if (observed.type === 'session-key-event') {
    return 'session.telemetry';
  }
  if (observed.type === 'session-control') {
    return 'session.control';
  }
  return 'session.output';
}

function parseClaimResult(result: Record<string, unknown>): AgentSessionClaimResult {
  const sessionId = result['sessionId'];
  const action = result['action'];
  const controller = parseSessionController(result['controller']);
  if (
    typeof sessionId !== 'string' ||
    (action !== 'claimed' && action !== 'taken-over') ||
    controller === null
  ) {
    throw new Error('control-plane session.claim returned malformed response');
  }
  return {
    sessionId,
    action,
    controller
  };
}

function parseReleaseResult(result: Record<string, unknown>): AgentSessionReleaseResult {
  const sessionId = result['sessionId'];
  const released = result['released'];
  if (typeof sessionId !== 'string' || typeof released !== 'boolean') {
    throw new Error('control-plane session.release returned malformed response');
  }
  return {
    sessionId,
    released
  };
}

export class HarnessAgentRealtimeClient {
  readonly client: ControlPlaneStreamClient;
  private readonly listenersByType = new Map<
    AgentRealtimeEventType | '*',
    Set<AnyRealtimeListener>
  >();

  private readonly onHandlerError:
    | ((error: unknown, event: AgentRealtimeEventEnvelope) => void)
    | undefined;
  private readonly removeEnvelopeListener: () => void;
  private readonly subscriptionId: string;
  private closed = false;

  private constructor(
    client: ControlPlaneStreamClient,
    subscriptionId: string,
    removeEnvelopeListener: () => void,
    onHandlerError: ((error: unknown, event: AgentRealtimeEventEnvelope) => void) | undefined
  ) {
    this.client = client;
    this.subscriptionId = subscriptionId;
    this.removeEnvelopeListener = removeEnvelopeListener;
    this.onHandlerError = onHandlerError;
  }

  static async connect(options: AgentRealtimeConnectOptions): Promise<HarnessAgentRealtimeClient> {
    const connectOptions: {
      host: string;
      port: number;
      authToken?: string;
      connectRetryWindowMs?: number;
      connectRetryDelayMs?: number;
    } = {
      host: options.host,
      port: options.port
    };
    if (options.authToken !== undefined) {
      connectOptions.authToken = options.authToken;
    }
    if (options.connectRetryWindowMs !== undefined) {
      connectOptions.connectRetryWindowMs = options.connectRetryWindowMs;
    }
    if (options.connectRetryDelayMs !== undefined) {
      connectOptions.connectRetryDelayMs = options.connectRetryDelayMs;
    }
    const client = await connectControlPlaneStreamClient(connectOptions);

    let subscriptionId: string | null = null;
    const buffered: Array<{ subscriptionId: string; cursor: number; observed: StreamObservedEvent }> = [];
    let instance: HarnessAgentRealtimeClient | null = null;

    const removeEnvelopeListener = client.onEnvelope((envelope) => {
      if (envelope.kind !== 'stream.event') {
        return;
      }
      const payload = {
        subscriptionId: envelope.subscriptionId,
        cursor: envelope.cursor,
        observed: envelope.event
      };
      if (subscriptionId === null || instance === null) {
        buffered.push(payload);
        return;
      }
      if (payload.subscriptionId !== subscriptionId) {
        return;
      }
      instance.dispatch(payload.cursor, payload.observed);
    });

    const command: {
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
      includeOutput: options.subscription?.includeOutput ?? false
    };
    if (options.subscription?.tenantId !== undefined) {
      command.tenantId = options.subscription.tenantId;
    }
    if (options.subscription?.userId !== undefined) {
      command.userId = options.subscription.userId;
    }
    if (options.subscription?.workspaceId !== undefined) {
      command.workspaceId = options.subscription.workspaceId;
    }
    if (options.subscription?.directoryId !== undefined) {
      command.directoryId = options.subscription.directoryId;
    }
    if (options.subscription?.conversationId !== undefined) {
      command.conversationId = options.subscription.conversationId;
    }
    if (options.subscription?.afterCursor !== undefined) {
      command.afterCursor = options.subscription.afterCursor;
    }

    try {
      const subscribed = await client.sendCommand(command);
      const parsedSubscriptionId = subscribed['subscriptionId'];
      if (typeof parsedSubscriptionId !== 'string' || parsedSubscriptionId.length === 0) {
        throw new Error('control-plane stream.subscribe returned malformed subscription id');
      }
      subscriptionId = parsedSubscriptionId;
      instance = new HarnessAgentRealtimeClient(
        client,
        parsedSubscriptionId,
        removeEnvelopeListener,
        options.onHandlerError
      );
      for (const payload of buffered) {
        if (payload.subscriptionId !== parsedSubscriptionId) {
          continue;
        }
        instance.dispatch(payload.cursor, payload.observed);
      }
      buffered.length = 0;
      return instance;
    } catch (error: unknown) {
      removeEnvelopeListener();
      client.close();
      throw error;
    }
  }

  on<TEventType extends AgentRealtimeEventType>(
    type: TEventType,
    listener: AgentRealtimeListener<TEventType>
  ): () => void;
  on(type: '*', listener: AnyRealtimeListener): () => void;
  on(type: AgentRealtimeEventType | '*', listener: AnyRealtimeListener): () => void {
    const existing = this.listenersByType.get(type);
    if (existing === undefined) {
      this.listenersByType.set(type, new Set([listener]));
    } else {
      existing.add(listener);
    }
    return () => {
      const current = this.listenersByType.get(type);
      current?.delete(listener);
      if (current !== undefined && current.size === 0) {
        this.listenersByType.delete(type);
      }
    };
  }

  async sendCommand(command: StreamCommand): Promise<Record<string, unknown>> {
    return await this.client.sendCommand(command);
  }

  async listSessions(command: {
    tenantId?: string;
    userId?: string;
    workspaceId?: string;
    worktreeId?: string;
    status?: 'running' | 'needs-input' | 'completed' | 'exited';
    live?: boolean;
    sort?: 'attention-first' | 'started-desc' | 'started-asc';
    limit?: number;
  } = {}): Promise<readonly AgentSessionSummary[]> {
    const result = await this.client.sendCommand({
      type: 'session.list',
      ...command
    });
    const parsed = parseSessionSummaryList(result['sessions']);
    return parsed;
  }

  async sessionStatus(sessionId: string): Promise<AgentSessionSummary> {
    const result = await this.client.sendCommand({
      type: 'session.status',
      sessionId
    });
    const parsed = parseSessionSummaryRecord(result);
    if (parsed === null) {
      throw new Error('control-plane session.status returned malformed summary');
    }
    return parsed;
  }

  async claimSession(input: AgentClaimSessionInput): Promise<AgentSessionClaimResult> {
    const command: {
      type: 'session.claim';
      sessionId: string;
      controllerId: string;
      controllerType: StreamSessionControllerType;
      controllerLabel?: string;
      reason?: string;
      takeover?: boolean;
    } = {
      type: 'session.claim',
      sessionId: input.sessionId,
      controllerId: input.controllerId,
      controllerType: input.controllerType
    };
    if (input.controllerLabel !== undefined) {
      command.controllerLabel = input.controllerLabel;
    }
    if (input.reason !== undefined) {
      command.reason = input.reason;
    }
    if (input.takeover !== undefined) {
      command.takeover = input.takeover;
    }
    const result = await this.client.sendCommand(command);
    return parseClaimResult(result);
  }

  async takeoverSession(
    input: Omit<AgentClaimSessionInput, 'takeover'>
  ): Promise<AgentSessionClaimResult> {
    return await this.claimSession({
      ...input,
      takeover: true
    });
  }

  async releaseSession(input: AgentReleaseSessionInput): Promise<AgentSessionReleaseResult> {
    const command: {
      type: 'session.release';
      sessionId: string;
      reason?: string;
    } = {
      type: 'session.release',
      sessionId: input.sessionId
    };
    if (input.reason !== undefined) {
      command.reason = input.reason;
    }
    const result = await this.client.sendCommand(command);
    return parseReleaseResult(result);
  }

  async respond(sessionId: string, text: string): Promise<{ responded: boolean; sentBytes: number }> {
    const result = await this.client.sendCommand({
      type: 'session.respond',
      sessionId,
      text
    });
    const responded = result['responded'];
    const sentBytes = result['sentBytes'];
    if (typeof responded !== 'boolean' || typeof sentBytes !== 'number') {
      throw new Error('control-plane session.respond returned malformed response');
    }
    return {
      responded,
      sentBytes
    };
  }

  async interrupt(sessionId: string): Promise<{ interrupted: boolean }> {
    const result = await this.client.sendCommand({
      type: 'session.interrupt',
      sessionId
    });
    const interrupted = result['interrupted'];
    if (typeof interrupted !== 'boolean') {
      throw new Error('control-plane session.interrupt returned malformed response');
    }
    return {
      interrupted
    };
  }

  async removeSession(sessionId: string): Promise<{ removed: boolean }> {
    const result = await this.client.sendCommand({
      type: 'session.remove',
      sessionId
    });
    const removed = result['removed'];
    if (typeof removed !== 'boolean') {
      throw new Error('control-plane session.remove returned malformed response');
    }
    return {
      removed
    };
  }

  async startSession(input: {
    sessionId: string;
    args: string[];
    env?: Record<string, string>;
    cwd?: string;
    initialCols: number;
    initialRows: number;
    terminalForegroundHex?: string;
    terminalBackgroundHex?: string;
    tenantId?: string;
    userId?: string;
    workspaceId?: string;
    worktreeId?: string;
  }): Promise<{ sessionId: string }> {
    const result = await this.client.sendCommand({
      type: 'pty.start',
      ...input
    });
    const sessionId = result['sessionId'];
    if (typeof sessionId !== 'string') {
      throw new Error('control-plane pty.start returned malformed response');
    }
    return {
      sessionId
    };
  }

  async attachSession(sessionId: string, sinceCursor = 0): Promise<{ latestCursor: number }> {
    const result = await this.client.sendCommand({
      type: 'pty.attach',
      sessionId,
      sinceCursor
    });
    const latestCursor = result['latestCursor'];
    if (typeof latestCursor !== 'number') {
      throw new Error('control-plane pty.attach returned malformed response');
    }
    return {
      latestCursor
    };
  }

  async detachSession(sessionId: string): Promise<{ detached: boolean }> {
    const result = await this.client.sendCommand({
      type: 'pty.detach',
      sessionId
    });
    const detached = result['detached'];
    if (typeof detached !== 'boolean') {
      throw new Error('control-plane pty.detach returned malformed response');
    }
    return {
      detached
    };
  }

  async closeSession(sessionId: string): Promise<{ closed: boolean }> {
    const result = await this.client.sendCommand({
      type: 'pty.close',
      sessionId
    });
    const closed = result['closed'];
    if (typeof closed !== 'boolean') {
      throw new Error('control-plane pty.close returned malformed response');
    }
    return {
      closed
    };
  }

  sendInput(sessionId: string, data: string | Buffer): void {
    const chunk = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    this.client.sendInput(sessionId, chunk);
  }

  sendResize(sessionId: string, cols: number, rows: number): void {
    this.client.sendResize(sessionId, cols, rows);
  }

  sendSignal(sessionId: string, signal: StreamSignal): void {
    this.client.sendSignal(sessionId, signal);
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.removeEnvelopeListener();
    try {
      await this.client.sendCommand({
        type: 'stream.unsubscribe',
        subscriptionId: this.subscriptionId
      });
    } catch {
      // Best-effort unsubscribe only.
    }
    this.client.close();
  }

  private dispatch(cursor: number, observed: StreamObservedEvent): void {
    const type = mapObservedEventType(observed);
    const envelope = {
      type,
      cursor,
      observed
    } as AgentRealtimeEventEnvelope;
    const specific = this.listenersByType.get(type);
    if (specific !== undefined) {
      for (const handler of specific) {
        this.invokeHandler(handler, envelope);
      }
    }
    const wildcard = this.listenersByType.get('*');
    if (wildcard !== undefined) {
      for (const handler of wildcard) {
        this.invokeHandler(handler, envelope);
      }
    }
  }

  private invokeHandler(handler: AnyRealtimeListener, event: AgentRealtimeEventEnvelope): void {
    void Promise.resolve(handler(event)).catch((error: unknown) => {
      if (this.onHandlerError !== undefined) {
        this.onHandlerError(error, event);
      }
    });
  }
}

export async function connectHarnessAgentRealtimeClient(
  options: AgentRealtimeConnectOptions
): Promise<HarnessAgentRealtimeClient> {
  return await HarnessAgentRealtimeClient.connect(options);
}
