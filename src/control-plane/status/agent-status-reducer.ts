import type {
  StreamSessionRuntimeStatus,
  StreamSessionStatusModel,
  StreamTelemetrySummary,
} from '../stream-protocol.ts';

export interface AgentStatusProjectionInput {
  readonly runtimeStatus: StreamSessionRuntimeStatus;
  readonly attentionReason: string | null;
  readonly telemetry: StreamTelemetrySummary | null;
  readonly observedAt: string;
  readonly previous: StreamSessionStatusModel | null;
}

export interface AgentStatusReducer {
  readonly agentType: string;
  project(input: AgentStatusProjectionInput): StreamSessionStatusModel | null;
}

// Runtime token so coverage/deadcode tooling can account for this module.
export const AGENT_STATUS_REDUCER_RUNTIME_TOKEN = 'agent-status-reducer';
