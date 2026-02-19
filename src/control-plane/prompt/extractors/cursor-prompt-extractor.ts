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
    readTrimmedString(input.payload['hookEventName']) ??
    readTrimmedString(input.payload['event_name']) ??
    readTrimmedString(input.payload['eventName']) ??
    readTrimmedString(input.payload['event']);
  if (hookEventName === null) {
    return null;
  }
  const hookToken = normalizeEventToken(hookEventName);
  if (hookToken !== 'beforesubmitprompt') {
    return null;
  }
  const directPrompt =
    readTrimmedString(input.payload['prompt']) ??
    readTrimmedString(input.payload['user_prompt']) ??
    readTrimmedString(input.payload['userPrompt']);
  const promptText =
    directPrompt ??
    findPromptText(input.payload, {
      keys: ['prompt', 'user_prompt', 'userPrompt', 'text', 'input', 'query', 'message'],
      maxDepth: 3,
    });
  return createPromptRecord({
    text: promptText,
    confidence: directPrompt !== null ? 'high' : promptText !== null ? 'medium' : 'low',
    captureSource: 'hook-notify',
    providerEventName: `cursor.${hookToken}`,
    payload: input.payload,
    observedAt: input.observedAt,
  });
}

function fromTelemetry(_input: PromptFromTelemetryInput): StreamSessionPromptRecord | null {
  return null;
}

export const cursorPromptExtractor: AgentPromptExtractor = {
  agentType: 'cursor',
  fromNotify,
  fromTelemetry,
};
