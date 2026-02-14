import assert from 'node:assert/strict';
import test from 'node:test';
import {
  mapCodexNotificationToEvents,
  type CodexNotification
} from '../src/adapters/codex-event-mapper.ts';
import type { EventScope } from '../src/events/normalized-events.ts';

const scope: EventScope = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  workspaceId: 'workspace-1',
  worktreeId: 'worktree-1',
  conversationId: 'conversation-1',
  turnId: 'turn-scope'
};

function mapOne(notification: CodexNotification) {
  let idCounter = 0;
  return mapCodexNotificationToEvents(
    notification,
    scope,
    () => new Date('2026-02-14T01:00:00.000Z'),
    () => {
      idCounter += 1;
      return `event-${idCounter}`;
    }
  );
}

void test('maps thread and turn lifecycle notifications', () => {
  const threadEvents = mapOne({
    method: 'thread/started',
    params: { thread: { id: 'thread-1' } }
  });
  assert.equal(threadEvents.length, 1);
  assert.equal(threadEvents[0]?.type, 'provider-thread-started');

  const startedEvents = mapOne({
    method: 'turn/started',
    params: { threadId: 'thread-1', turn: { id: 'turn-1' } }
  });
  assert.equal(startedEvents[0]?.type, 'provider-turn-started');
  assert.equal(startedEvents[0]?.scope.turnId, 'turn-1');

  const completedEvents = mapOne({
    method: 'turn/completed',
    params: { threadId: 'thread-1', turnId: 'turn-1' }
  });
  assert.equal(completedEvents.length, 2);
  assert.equal(completedEvents[0]?.type, 'provider-turn-completed');
  assert.equal(completedEvents[1]?.type, 'meta-attention-cleared');

  const interruptedEvents = mapOne({
    method: 'turn/interrupted',
    params: { threadId: 'thread-1', turnId: 'turn-1' }
  });
  assert.equal(interruptedEvents[0]?.type, 'provider-turn-interrupted');

  const failedEvents = mapOne({
    method: 'turn/failed',
    params: { thread: { id: 'thread-1' }, turn: { id: 'turn-1' } }
  });
  assert.equal(failedEvents[0]?.type, 'provider-turn-failed');
});

void test('maps diff, delta, and attention notifications', () => {
  const diffEvents = mapOne({
    method: 'turn/diff/updated',
    params: {
      threadId: 'thread-1',
      turnId: 'turn-1',
      summary: '2 files changed'
    }
  });
  assert.equal(diffEvents[0]?.type, 'provider-diff-updated');
  assert.equal(diffEvents[0]?.payload.kind, 'diff-updated');

  const deltaEvents = mapOne({
    method: 'item/agentMessage/delta',
    params: { threadId: 'thread-1', turnId: 'turn-1', delta: 'hello' }
  });
  assert.equal(deltaEvents[0]?.type, 'provider-text-delta');
  assert.equal(deltaEvents[0]?.payload.kind, 'text-delta');

  const approvalEvents = mapOne({
    method: 'item/fileChange/requestApproval',
    params: { threadId: 'thread-1', turnId: 'turn-1' }
  });
  assert.equal(approvalEvents[0]?.type, 'meta-attention-raised');
  assert.equal(approvalEvents[0]?.payload.kind, 'attention');
  assert.equal(approvalEvents[0]?.payload.reason, 'approval');

  const inputEvents = mapOne({
    method: 'item/tool/requestUserInput',
    params: { threadId: 'thread-1', turnId: 'turn-1' }
  });
  assert.equal(inputEvents[0]?.type, 'meta-attention-raised');
  assert.equal(inputEvents[0]?.payload.kind, 'attention');
  assert.equal(inputEvents[0]?.payload.reason, 'user-input');
});

void test('returns empty list for unknown notifications and falls back to scope ids', () => {
  const unknownEvents = mapOne({
    method: 'item/unknown',
    params: {}
  });
  assert.equal(unknownEvents.length, 0);

  const fallbackEvents = mapOne({
    method: 'turn/started',
    params: null
  });
  assert.equal(fallbackEvents[0]?.payload.kind, 'turn');
  assert.equal(fallbackEvents[0]?.scope.turnId, 'turn-scope');
});
