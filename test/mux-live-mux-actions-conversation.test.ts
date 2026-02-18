import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  createAndActivateConversationInDirectory,
  openOrCreateCritiqueConversationInDirectory,
} from '../src/mux/live-mux/actions-conversation.ts';

void test('createAndActivateConversationInDirectory seeds and starts a conversation', async () => {
  const created: Array<{ sessionId: string; directoryId: string; agentType: string }> = [];
  const ensured: Array<{ sessionId: string; agentType: string }> = [];
  const started: string[] = [];
  const activated: string[] = [];

  await createAndActivateConversationInDirectory({
    directoryId: 'directory-1',
    agentType: 'critique',
    createConversationId: () => 'conversation-1',
    createConversationRecord: async (sessionId, directoryId, agentType) => {
      created.push({ sessionId, directoryId, agentType: String(agentType) });
    },
    ensureConversation: (sessionId, seed) => {
      ensured.push({ sessionId, agentType: seed.agentType });
      assert.equal(seed.directoryId, 'directory-1');
      assert.deepEqual(seed.adapterState, {});
    },
    noteGitActivity: (_directoryId) => {
      // covered by no-throw path
    },
    startConversation: async (sessionId) => {
      started.push(sessionId);
    },
    activateConversation: async (sessionId) => {
      activated.push(sessionId);
    },
  });

  assert.deepEqual(created, [
    { sessionId: 'conversation-1', directoryId: 'directory-1', agentType: 'critique' },
  ]);
  assert.deepEqual(ensured, [{ sessionId: 'conversation-1', agentType: 'critique' }]);
  assert.deepEqual(started, ['conversation-1']);
  assert.deepEqual(activated, ['conversation-1']);
});

void test('openOrCreateCritiqueConversationInDirectory activates existing critique session or creates one', async () => {
  const activated: string[] = [];
  const created: string[] = [];

  await openOrCreateCritiqueConversationInDirectory({
    directoryId: 'directory-1',
    orderedConversationIds: () => ['session-a', 'session-b'],
    conversationById: (sessionId) => {
      if (sessionId === 'session-a') {
        return {
          directoryId: 'directory-1',
          agentType: 'codex',
        };
      }
      if (sessionId === 'session-b') {
        return {
          directoryId: 'directory-1',
          agentType: 'Critique',
        };
      }
      return null;
    },
    activateConversation: async (sessionId) => {
      activated.push(sessionId);
    },
    createAndActivateCritiqueConversationInDirectory: async (directoryId) => {
      created.push(directoryId);
    },
  });

  assert.deepEqual(activated, ['session-b']);
  assert.equal(created.length, 0);

  await openOrCreateCritiqueConversationInDirectory({
    directoryId: 'directory-2',
    orderedConversationIds: () => ['session-c'],
    conversationById: () => ({
      directoryId: 'directory-2',
      agentType: 'terminal',
    }),
    activateConversation: async (sessionId) => {
      activated.push(sessionId);
    },
    createAndActivateCritiqueConversationInDirectory: async (directoryId) => {
      created.push(directoryId);
    },
  });

  assert.deepEqual(created, ['directory-2']);
});
