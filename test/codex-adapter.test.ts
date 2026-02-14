import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CodexAdapter,
  type CodexTransport,
  type ConversationRef
} from '../src/adapters/codex-adapter.ts';
import type { CodexNotification } from '../src/adapters/codex-event-mapper.ts';
import type { NormalizedEventEnvelope } from '../src/events/normalized-events.ts';

class FakeCodexTransport implements CodexTransport {
  readonly requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  private readonly responseQueue: unknown[] = [];
  private readonly subscribers = new Set<(notification: CodexNotification) => void>();

  enqueueResponse(response: unknown): void {
    this.responseQueue.push(response);
  }

  request(method: string, params: Record<string, unknown>): Promise<unknown> {
    this.requests.push({ method, params });
    const response = this.responseQueue.shift();
    return Promise.resolve(response ?? {});
  }

  subscribe(handler: (notification: CodexNotification) => void): () => void {
    this.subscribers.add(handler);
    return () => {
      this.subscribers.delete(handler);
    };
  }

  emit(notification: CodexNotification): void {
    for (const subscriber of this.subscribers) {
      subscriber(notification);
    }
  }
}

function createAdapter(transport: FakeCodexTransport): CodexAdapter {
  let idCounter = 0;
  return new CodexAdapter(transport, {
    scopeBase: {
      tenantId: 'tenant-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      worktreeId: 'worktree-1'
    },
    clock: () => new Date('2026-02-14T02:00:00.000Z'),
    idFactory: () => {
      idCounter += 1;
      return `event-${idCounter}`;
    }
  });
}

void test('codex adapter issues lifecycle requests and uses response thread id', async () => {
  const transport = new FakeCodexTransport();
  transport.enqueueResponse({ threadId: 'thread-1' });
  const adapter = createAdapter(transport);

  const ref = await adapter.startConversation({
    conversationId: 'conversation-1',
    prompt: 'hello'
  });
  assert.deepEqual(ref, {
    conversationId: 'conversation-1',
    threadId: 'thread-1'
  });

  await adapter.resumeConversation(ref);
  await adapter.sendTurn(ref, {
    turnId: 'turn-1',
    message: 'run tests'
  });
  await adapter.interrupt(ref);

  assert.deepEqual(transport.requests, [
    {
      method: 'thread/start',
      params: { conversationId: 'conversation-1', prompt: 'hello' }
    },
    {
      method: 'thread/resume',
      params: { threadId: 'thread-1' }
    },
    {
      method: 'turn/start',
      params: { threadId: 'thread-1', turnId: 'turn-1', message: 'run tests' }
    },
    {
      method: 'turn/interrupt',
      params: { threadId: 'thread-1', turnId: 'turn-1' }
    }
  ]);

  adapter.close();
});

void test('codex adapter falls back when thread id is not present in response', async () => {
  const transport = new FakeCodexTransport();
  transport.enqueueResponse('invalid-response');
  const adapter = createAdapter(transport);

  const ref = await adapter.startConversation({
    conversationId: 'conversation-fallback',
    prompt: 'hello'
  });

  assert.deepEqual(ref, {
    conversationId: 'conversation-fallback',
    threadId: 'conversation-fallback'
  });

  adapter.close();
});

void test('codex adapter emits mapped events and supports listener unsubscribe', async () => {
  const transport = new FakeCodexTransport();
  transport.enqueueResponse({ threadId: 'thread-1' });
  const adapter = createAdapter(transport);

  const events: NormalizedEventEnvelope[] = [];
  const unsubscribe = adapter.onEvent((event) => {
    events.push(event);
  });

  const ref: ConversationRef = await adapter.startConversation({
    conversationId: 'conversation-1',
    prompt: 'hello'
  });
  await adapter.sendTurn(ref, {
    turnId: 'turn-1',
    message: 'do work'
  });

  transport.emit({
    method: 'turn/started',
    params: { threadId: 'thread-1', turnId: 'turn-1' }
  });
  transport.emit({
    method: 'item/agentMessage/delta',
    params: { threadId: 'thread-1', turnId: 'turn-1', delta: 'partial' }
  });
  transport.emit({
    method: 'item/tool/requestUserInput',
    params: { threadId: 'thread-1', turnId: 'turn-1' }
  });
  transport.emit({
    method: 'turn/completed',
    params: { threadId: 'thread-1', turnId: 'turn-1' }
  });

  assert.equal(events.length, 5);
  assert.equal(events[0]?.type, 'provider-turn-started');
  assert.equal(events[1]?.type, 'provider-text-delta');
  assert.equal(events[2]?.type, 'meta-attention-raised');
  assert.equal(events[3]?.type, 'provider-turn-completed');
  assert.equal(events[4]?.type, 'meta-attention-cleared');

  unsubscribe();
  transport.emit({
    method: 'turn/failed',
    params: { threadId: 'thread-1', turnId: 'turn-1' }
  });
  assert.equal(events.length, 5);

  adapter.close();
});

void test('codex adapter uses unknown conversation scope before start and stops after close', () => {
  const transport = new FakeCodexTransport();
  const adapter = createAdapter(transport);
  const events: NormalizedEventEnvelope[] = [];
  adapter.onEvent((event) => {
    events.push(event);
  });

  transport.emit({
    method: 'thread/started',
    params: { threadId: 'thread-prior' }
  });

  assert.equal(events.length, 1);
  assert.equal(events[0]?.scope.conversationId, 'conversation-unknown');

  adapter.close();
  transport.emit({
    method: 'turn/started',
    params: { threadId: 'thread-prior', turnId: 'turn-1' }
  });
  assert.equal(events.length, 1);
});

void test('codex adapter interrupt falls back to empty turn id when no turn is active', async () => {
  const transport = new FakeCodexTransport();
  const adapter = createAdapter(transport);
  const ref: ConversationRef = {
    conversationId: 'conversation-1',
    threadId: 'thread-1'
  };

  await adapter.interrupt(ref);

  assert.deepEqual(transport.requests, [
    {
      method: 'turn/interrupt',
      params: { threadId: 'thread-1', turnId: '' }
    }
  ]);

  adapter.close();
});
