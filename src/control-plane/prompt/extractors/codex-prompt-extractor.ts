import type { StreamSessionPromptRecord } from '../../stream-protocol.ts';
import type { AgentPromptExtractor, PromptFromNotifyInput, PromptFromTelemetryInput } from '../agent-prompt-extractor.ts';
import { createPromptRecord, findPromptText, readTrimmedString } from '../agent-prompt-extractor.ts';

function fromNotify(_input: PromptFromNotifyInput): StreamSessionPromptRecord | null {
  return null;
}

function fromTelemetry(input: PromptFromTelemetryInput): StreamSessionPromptRecord | null {
  const normalizedEventName = (input.eventName ?? '').trim().toLowerCase();
  if (normalizedEventName !== 'codex.user_prompt' && normalizedEventName !== 'user_prompt') {
    return null;
  }
  if (input.source !== 'otlp-log' && input.source !== 'history') {
    return null;
  }
  const textFromPayload = findPromptText(input.payload, {
    keys: ['prompt', 'user_prompt', 'userPrompt', 'message', 'text', 'content', 'input', 'body'],
    maxDepth: 4,
  });
  const normalizedSummary = readTrimmedString(input.summary);
  const textFromSummary =
    normalizedSummary !== null && normalizedSummary.toLowerCase().startsWith('prompt:')
      ? readTrimmedString(normalizedSummary.slice('prompt:'.length))
      : null;
  const promptText = textFromPayload ?? textFromSummary;
  const confidence = promptText === null ? 'low' : textFromPayload !== null ? 'high' : 'medium';
  return createPromptRecord({
    text: promptText,
    confidence,
    captureSource: input.source === 'history' ? 'history' : 'otlp-log',
    providerEventName: input.eventName,
    payload: input.payload,
    observedAt: input.observedAt,
  });
}

export const codexPromptExtractor: AgentPromptExtractor = {
  agentType: 'codex',
  fromNotify,
  fromTelemetry,
};
