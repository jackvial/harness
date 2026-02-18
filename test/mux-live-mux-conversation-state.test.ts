import assert from 'node:assert/strict';
import { test } from 'bun:test';
import {
  debugFooterForConversation,
  formatCommandForDebugBar,
  launchCommandForAgent,
  type ConversationState,
} from '../src/mux/live-mux/conversation-state.ts';

void test('conversation-state launchCommandForAgent covers critique and debug footer rendering', () => {
  assert.equal(launchCommandForAgent('critique'), 'critique');
  assert.equal(launchCommandForAgent('claude'), 'claude');
  assert.equal(launchCommandForAgent('terminal').length > 0, true);
  assert.equal(launchCommandForAgent('unknown'), 'codex');

  const formatted = formatCommandForDebugBar('bunx', ['critique@latest', '--watch']);
  assert.equal(formatted, 'bunx critique@latest --watch');

  const conversation = {
    launchCommand: formatted,
  } as ConversationState;
  assert.equal(debugFooterForConversation(conversation), '[dbg] bunx critique@latest --watch');
});
