import type { StreamSessionPromptRecord, StreamTelemetrySource } from '../stream-protocol.ts';
import type { AgentPromptExtractor } from './agent-prompt-extractor.ts';
import { claudePromptExtractor } from './extractors/claude-prompt-extractor.ts';
import { codexPromptExtractor } from './extractors/codex-prompt-extractor.ts';
import { cursorPromptExtractor } from './extractors/cursor-prompt-extractor.ts';

type SupportedAgentType = 'codex' | 'claude' | 'cursor';

const DEFAULT_EXTRACTORS: Record<SupportedAgentType, AgentPromptExtractor> = {
  codex: codexPromptExtractor,
  claude: claudePromptExtractor,
  cursor: cursorPromptExtractor,
};

function normalizeAgentType(value: string): SupportedAgentType | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'codex' || normalized === 'claude' || normalized === 'cursor') {
    return normalized;
  }
  return null;
}

interface PromptFromNotifyInput {
  readonly agentType: string;
  readonly payload: Record<string, unknown>;
  readonly observedAt: string;
}

interface PromptFromTelemetryInput {
  readonly agentType: string;
  readonly source: StreamTelemetrySource;
  readonly eventName: string | null;
  readonly summary: string | null;
  readonly payload: Record<string, unknown>;
  readonly observedAt: string;
}

export class SessionPromptEngine {
  private readonly extractors: Record<SupportedAgentType, AgentPromptExtractor>;

  constructor(extractors: Record<SupportedAgentType, AgentPromptExtractor> = DEFAULT_EXTRACTORS) {
    this.extractors = extractors;
  }

  extractFromNotify(input: PromptFromNotifyInput): StreamSessionPromptRecord | null {
    const agentType = normalizeAgentType(input.agentType);
    if (agentType === null) {
      return null;
    }
    return this.extractors[agentType].fromNotify({
      payload: input.payload,
      observedAt: input.observedAt,
    });
  }

  extractFromTelemetry(input: PromptFromTelemetryInput): StreamSessionPromptRecord | null {
    const agentType = normalizeAgentType(input.agentType);
    if (agentType === null) {
      return null;
    }
    return this.extractors[agentType].fromTelemetry({
      source: input.source,
      eventName: input.eventName,
      summary: input.summary,
      payload: input.payload,
      observedAt: input.observedAt,
    });
  }
}
