import {
  createNormalizedEvent,
  type EventScope,
  type NormalizedEventEnvelope
} from '../events/normalized-events.ts';

interface RawEventObject {
  [key: string]: unknown;
}

export interface CodexNotification {
  method: string;
  params?: unknown;
}

function asObject(value: unknown): RawEventObject {
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  return value as RawEventObject;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function requiredTurnId(params: RawEventObject, fallback: string): string {
  const turnId = asString(params.turnId);
  if (turnId.length > 0) {
    return turnId;
  }
  return fallback;
}

function scopeWithTurn(scope: EventScope, turnId: string): EventScope {
  return {
    ...scope,
    turnId
  };
}

export function mapCodexNotificationToEvents(
  notification: CodexNotification,
  scope: EventScope,
  clock?: () => Date,
  idFactory?: () => string
): NormalizedEventEnvelope[] {
  const params = asObject(notification.params);
  const threadId = asString(params.threadId, scope.conversationId);
  const turnId = requiredTurnId(params, scope.turnId ?? 'turn-unknown');

  if (notification.method === 'thread/started') {
    return [
      createNormalizedEvent(
        'provider',
        'provider-thread-started',
        scope,
        {
          kind: 'thread',
          threadId
        },
        clock,
        idFactory
      )
    ];
  }

  if (notification.method === 'turn/started') {
    return [
      createNormalizedEvent(
        'provider',
        'provider-turn-started',
        scopeWithTurn(scope, turnId),
        {
          kind: 'turn',
          threadId,
          turnId,
          status: 'in-progress'
        },
        clock,
        idFactory
      )
    ];
  }

  if (notification.method === 'turn/completed') {
    return [
      createNormalizedEvent(
        'provider',
        'provider-turn-completed',
        scopeWithTurn(scope, turnId),
        {
          kind: 'turn',
          threadId,
          turnId,
          status: 'completed'
        },
        clock,
        idFactory
      ),
      createNormalizedEvent(
        'meta',
        'meta-attention-cleared',
        scopeWithTurn(scope, turnId),
        {
          kind: 'attention',
          threadId,
          turnId,
          reason: 'stalled',
          detail: 'turn-completed'
        },
        clock,
        idFactory
      )
    ];
  }

  if (notification.method === 'turn/interrupted') {
    return [
      createNormalizedEvent(
        'provider',
        'provider-turn-interrupted',
        scopeWithTurn(scope, turnId),
        {
          kind: 'turn',
          threadId,
          turnId,
          status: 'interrupted'
        },
        clock,
        idFactory
      )
    ];
  }

  if (notification.method === 'turn/failed') {
    return [
      createNormalizedEvent(
        'provider',
        'provider-turn-failed',
        scopeWithTurn(scope, turnId),
        {
          kind: 'turn',
          threadId,
          turnId,
          status: 'failed'
        },
        clock,
        idFactory
      )
    ];
  }

  if (notification.method === 'turn/diff/updated') {
    return [
      createNormalizedEvent(
        'provider',
        'provider-diff-updated',
        scopeWithTurn(scope, turnId),
        {
          kind: 'diff-updated',
          threadId,
          turnId,
          summary: asString(params.summary, 'diff-updated')
        },
        clock,
        idFactory
      )
    ];
  }

  if (notification.method === 'item/agentMessage/delta') {
    return [
      createNormalizedEvent(
        'provider',
        'provider-text-delta',
        scopeWithTurn(scope, turnId),
        {
          kind: 'text-delta',
          threadId,
          turnId,
          delta: asString(params.delta)
        },
        clock,
        idFactory
      )
    ];
  }

  if (
    notification.method === 'item/commandExecution/requestApproval' ||
    notification.method === 'item/fileChange/requestApproval' ||
    notification.method === 'item/tool/requestUserInput'
  ) {
    const reason = notification.method === 'item/tool/requestUserInput' ? 'user-input' : 'approval';
    return [
      createNormalizedEvent(
        'meta',
        'meta-attention-raised',
        scopeWithTurn(scope, turnId),
        {
          kind: 'attention',
          threadId,
          turnId,
          reason,
          detail: notification.method
        },
        clock,
        idFactory
      )
    ];
  }

  return [];
}
