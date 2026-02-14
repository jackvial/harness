import {
  mapCodexNotificationToEvents,
  type CodexNotification
} from './codex-event-mapper.ts';
import type { EventScope, NormalizedEventEnvelope } from '../events/normalized-events.ts';

interface StringMap {
  [key: string]: unknown;
}

export interface ConversationRef {
  conversationId: string;
  threadId: string;
}

interface StartConversationInput {
  conversationId: string;
  prompt: string;
}

interface SendTurnInput {
  message: string;
  turnId: string;
}

export interface CodexTransport {
  request(method: string, params: StringMap): Promise<unknown>;
  subscribe(handler: (notification: CodexNotification) => void): () => void;
  close?(): void;
}

interface CodexAdapterOptions {
  scopeBase: Omit<EventScope, 'conversationId' | 'turnId'>;
  clock?: () => Date;
  idFactory?: () => string;
}

function asObject(value: unknown): StringMap {
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  return value as StringMap;
}

function readString(response: unknown, key: string, fallback: string): string {
  const objectValue = asObject(response);
  const candidate = objectValue[key];
  if (typeof candidate === 'string' && candidate.length > 0) {
    return candidate;
  }
  return fallback;
}

function readNestedString(
  response: unknown,
  parentKey: string,
  nestedKey: string,
  fallback: string
): string {
  const objectValue = asObject(response);
  const parentValue = objectValue[parentKey];
  if (typeof parentValue !== 'object' || parentValue === null) {
    return fallback;
  }
  const nestedValue = parentValue as StringMap;
  const candidate = nestedValue[nestedKey];
  if (typeof candidate === 'string' && candidate.length > 0) {
    return candidate;
  }
  return fallback;
}

export class CodexAdapter {
  private readonly listeners = new Set<(event: NormalizedEventEnvelope) => void>();
  private readonly unsubscribeTransport: () => void;
  private readonly scopeBase: Omit<EventScope, 'conversationId' | 'turnId'>;
  private readonly clock: (() => Date) | undefined;
  private readonly idFactory: (() => string) | undefined;
  private conversationId: string | null = null;
  private threadId: string | null = null;
  private activeTurnId: string | null = null;

  constructor(transport: CodexTransport, options: CodexAdapterOptions) {
    this.scopeBase = options.scopeBase;
    this.clock = options.clock;
    this.idFactory = options.idFactory;
    this.unsubscribeTransport = transport.subscribe((notification) => {
      this.handleNotification(notification);
    });
    this.transport = transport;
  }

  private readonly transport: CodexTransport;

  close(): void {
    this.unsubscribeTransport();
    this.transport.close?.();
  }

  onEvent(listener: (event: NormalizedEventEnvelope) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async startConversation(input: StartConversationInput): Promise<ConversationRef> {
    const response = await this.transport.request('thread/start', {
      experimentalRawEvents: false
    });
    const threadId = readString(
      response,
      'threadId',
      readNestedString(response, 'thread', 'id', input.conversationId)
    );
    this.conversationId = input.conversationId;
    this.threadId = threadId;

    return {
      conversationId: input.conversationId,
      threadId
    };
  }

  async resumeConversation(ref: ConversationRef): Promise<void> {
    await this.transport.request('thread/resume', {
      threadId: ref.threadId
    });
    this.conversationId = ref.conversationId;
    this.threadId = ref.threadId;
  }

  async sendTurn(ref: ConversationRef, input: SendTurnInput): Promise<void> {
    const response = await this.transport.request('turn/start', {
      threadId: ref.threadId,
      input: [
        {
          type: 'text',
          text: input.message,
          text_elements: []
        }
      ]
    });
    this.activeTurnId = readNestedString(response, 'turn', 'id', input.turnId);
  }

  async interrupt(ref: ConversationRef): Promise<void> {
    await this.transport.request('turn/interrupt', {
      threadId: ref.threadId,
      turnId: this.activeTurnId ?? ''
    });
  }

  private emit(event: NormalizedEventEnvelope): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  private handleNotification(notification: CodexNotification): void {
    const params = asObject(notification.params);
    const turnIdFromNotification = readString(
      params,
      'turnId',
      readNestedString(params, 'turn', 'id', '')
    );
    if (turnIdFromNotification.length > 0) {
      this.activeTurnId = turnIdFromNotification;
    }

    const baseScope: Omit<EventScope, 'conversationId' | 'turnId'> & {
      conversationId: string;
    } = {
      ...this.scopeBase,
      conversationId: this.conversationId ?? this.threadId ?? 'conversation-unknown'
    };
    const scope: EventScope = this.activeTurnId === null
      ? baseScope
      : {
          ...baseScope,
          turnId: this.activeTurnId
        };

    const events = mapCodexNotificationToEvents(
      notification,
      scope,
      this.clock,
      this.idFactory
    );
    for (const event of events) {
      this.emit(event);
    }
  }
}
