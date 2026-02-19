import type { StreamSessionPromptRecord } from '../../stream-protocol.ts';
import type { AgentPromptExtractor, PromptFromNotifyInput, PromptFromTelemetryInput } from '../agent-prompt-extractor.ts';
import {
  createPromptRecord,
  findPromptText,
  normalizeEventToken,
  readTrimmedString,
} from '../agent-prompt-extractor.ts';

function fromNotify(input: PromptFromNotifyInput): StreamSessionPromptRecord | null {
  const hookEventName =
    readTrimmedString(input.payload['hook_event_name']) ??
    readTrimmedString(input.payload['hookEventName']);
  if (hookEventName === null) {
    return null;
  }
  const hookToken = normalizeEventToken(hookEventName);
  if (hookToken !== 'userpromptsubmit') {
    return null;
  }
  const directPrompt =
    readTrimmedString(input.payload['prompt']) ??
    readTrimmedString(input.payload['user_prompt']) ??
    readTrimmedString(input.payload['userPrompt']);
  const fallbackPrompt =
    directPrompt ??
    findPromptText(input.payload, {
      keys: ['prompt', 'user_prompt', 'userPrompt', 'text', 'input', 'query', 'message'],
      maxDepth: 3,
    });
  return createPromptRecord({
    text: fallbackPrompt,
    confidence: directPrompt !== null ? 'high' : fallbackPrompt !== null ? 'medium' : 'low',
    captureSource: 'hook-notify',
    providerEventName: `claude.${hookToken}`,
    payload: input.payload,
    observedAt: input.observedAt,
  });
}

function fromTelemetry(_input: PromptFromTelemetryInput): StreamSessionPromptRecord | null {
  return null;
}

export const claudePromptExtractor: AgentPromptExtractor = {
  agentType: 'claude',
  fromNotify,
  fromTelemetry,
};
