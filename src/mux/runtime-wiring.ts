import type { ControlPlaneKeyEvent } from '../control-plane/codex-session-stream.ts';
import type {
  StreamSessionController,
  StreamSessionRuntimeStatus,
  StreamSessionStatusModel,
} from '../control-plane/stream-protocol.ts';

export interface MuxRuntimeConversationState {
  directoryId: string | null;
  status: StreamSessionRuntimeStatus;
  statusModel: StreamSessionStatusModel | null;
  attentionReason: string | null;
  live: boolean;
  controller: StreamSessionController | null;
  lastEventAt: string | null;
  lastKnownWork: string | null;
  lastKnownWorkAt: string | null;
  lastTelemetrySource: string | null;
}

interface EnsureConversationSeed {
  directoryId?: string | null;
}

interface ApplyMuxControlPlaneKeyEventOptions<TConversation extends MuxRuntimeConversationState> {
  readonly removedConversationIds: ReadonlySet<string>;
  ensureConversation: (sessionId: string, seed?: EnsureConversationSeed) => TConversation;
}

interface MuxTelemetrySummaryInput {
  readonly source: string;
  readonly eventName: string | null;
  readonly summary: string | null;
  readonly observedAt: string;
}

interface ProjectedTelemetrySummary {
  readonly text: string | null;
}

function parseIsoMs(value: string | null): number {
  if (value === null) {
    return Number.NaN;
  }
  return Date.parse(value);
}

function normalizeEventName(value: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizeSummary(value: string | null): string {
  return (value ?? '').trim();
}

function projectTelemetrySummary(
  telemetry: Omit<MuxTelemetrySummaryInput, 'observedAt'>,
): ProjectedTelemetrySummary {
  const eventName = normalizeEventName(telemetry.eventName);
  const summary = normalizeSummary(telemetry.summary);
  const summaryLower = summary.toLowerCase();
  if (telemetry.source === 'otlp-metric') {
    if (eventName === 'codex.turn.e2e_duration_ms') {
      return {
        text: 'inactive',
      };
    }
    return {
      text: null,
    };
  }
  if (telemetry.source === 'otlp-log' && eventName === 'codex.sse_event') {
    if (
      summaryLower.includes('response.created') ||
      summaryLower.includes('response.in_progress') ||
      summaryLower.includes('response.output_text.delta') ||
      summaryLower.includes('response.output_item.added') ||
      summaryLower.includes('response.function_call_arguments.delta')
    ) {
      return {
        text: 'active',
      };
    }
  }
  if (eventName === 'codex.user_prompt') {
    return {
      text: 'active',
    };
  }
  if (eventName === 'claude.userpromptsubmit' || eventName === 'claude.pretooluse') {
    return {
      text: 'active',
    };
  }
  if (
    eventName === 'claude.stop' ||
    eventName === 'claude.subagentstop' ||
    eventName === 'claude.sessionend'
  ) {
    return {
      text: 'inactive',
    };
  }
  if (
    eventName === 'cursor.beforesubmitprompt' ||
    eventName === 'cursor.beforeshellexecution' ||
    eventName === 'cursor.beforemcptool'
  ) {
    return {
      text: 'active',
    };
  }
  if (eventName === 'cursor.stop' || eventName === 'cursor.sessionend') {
    return {
      text: 'inactive',
    };
  }
  return {
    text: null,
  };
}

export function telemetrySummaryText(
  summary: Omit<MuxTelemetrySummaryInput, 'observedAt'>,
): string | null {
  const projected = projectTelemetrySummary(summary);
  return projected.text;
}

export function applyTelemetrySummaryToConversation<
  TConversation extends MuxRuntimeConversationState,
>(target: TConversation, telemetry: MuxTelemetrySummaryInput | null): void {
  if (telemetry === null) {
    return;
  }
  const observedAtMs = parseIsoMs(telemetry.observedAt);
  const currentAtMs = parseIsoMs(target.lastKnownWorkAt);
  if (Number.isFinite(currentAtMs) && Number.isFinite(observedAtMs) && observedAtMs < currentAtMs) {
    return;
  }
  const projected = projectTelemetrySummary(telemetry);
  if (projected.text !== null) {
    target.lastKnownWork = projected.text;
    target.lastKnownWorkAt = telemetry.observedAt;
    target.lastTelemetrySource = telemetry.source;
  }
}

export function applyMuxControlPlaneKeyEvent<TConversation extends MuxRuntimeConversationState>(
  event: ControlPlaneKeyEvent,
  options: ApplyMuxControlPlaneKeyEventOptions<TConversation>,
): TConversation | null {
  if (options.removedConversationIds.has(event.sessionId)) {
    return null;
  }
  const conversation = options.ensureConversation(event.sessionId, {
    directoryId: event.directoryId,
  });
  if (event.directoryId !== null) {
    conversation.directoryId = event.directoryId;
  }

  if (event.type === 'session-status') {
    conversation.status = event.status;
    conversation.statusModel = event.statusModel;
    conversation.attentionReason = event.attentionReason;
    conversation.live = event.live;
    conversation.controller = event.controller;
    conversation.lastEventAt = event.ts;
    conversation.lastKnownWork = event.statusModel?.lastKnownWork ?? null;
    conversation.lastKnownWorkAt = event.statusModel?.lastKnownWorkAt ?? null;
    conversation.lastTelemetrySource = event.telemetry?.source ?? null;
    return conversation;
  }

  if (event.type === 'session-control') {
    conversation.controller = event.controller;
    conversation.lastEventAt = event.ts;
    return conversation;
  }

  conversation.lastEventAt = event.keyEvent.observedAt;
  conversation.lastTelemetrySource = event.keyEvent.source;
  return conversation;
}
