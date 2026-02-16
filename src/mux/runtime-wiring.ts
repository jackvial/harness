import type { ControlPlaneKeyEvent } from '../control-plane/codex-session-stream.ts';
import type {
  StreamSessionKeyEventRecord,
  StreamSessionController,
  StreamSessionRuntimeStatus
} from '../control-plane/stream-protocol.ts';

interface MuxTelemetrySummaryInput {
  readonly source: string;
  readonly eventName: string | null;
  readonly summary: string | null;
  readonly observedAt: string;
}

export interface MuxRuntimeConversationState {
  directoryId: string | null;
  status: StreamSessionRuntimeStatus;
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

interface ProjectedTelemetrySummary {
  readonly text: string | null;
}

const RUNNING_STATUS_HINT_EVENT_NAMES = new Set(['codex.user_prompt']);

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

function projectTelemetrySummary(telemetry: Omit<MuxTelemetrySummaryInput, 'observedAt'>): ProjectedTelemetrySummary {
  const eventName = normalizeEventName(telemetry.eventName);
  const summary = normalizeSummary(telemetry.summary);
  if (telemetry.source === 'otlp-metric') {
    if (eventName === 'codex.turn.e2e_duration_ms') {
      return {
        text: summary.length > 0 ? summary : 'idle'
      };
    }
    return {
      text: null
    };
  }
  if (eventName === 'codex.user_prompt') {
    return {
      text: 'working: thinking'
    };
  }
  return {
    text: null
  };
}

export function telemetrySummaryText(summary: Omit<MuxTelemetrySummaryInput, 'observedAt'>): string | null {
  const projected = projectTelemetrySummary(summary);
  return projected.text;
}

export function applyTelemetrySummaryToConversation<TConversation extends MuxRuntimeConversationState>(
  target: TConversation,
  telemetry: MuxTelemetrySummaryInput | null
): void {
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

function shouldApplyTelemetryStatusHint(keyEvent: StreamSessionKeyEventRecord): boolean {
  if (keyEvent.statusHint === null) {
    return false;
  }
  if (keyEvent.source === 'otlp-trace' || keyEvent.source === 'history') {
    return false;
  }
  const eventName = normalizeEventName(keyEvent.eventName);
  if (keyEvent.statusHint === 'needs-input') {
    return true;
  }
  if (keyEvent.statusHint === 'completed') {
    return false;
  }
  return RUNNING_STATUS_HINT_EVENT_NAMES.has(eventName);
}

export function applyMuxControlPlaneKeyEvent<TConversation extends MuxRuntimeConversationState>(
  event: ControlPlaneKeyEvent,
  options: ApplyMuxControlPlaneKeyEventOptions<TConversation>
): TConversation | null {
  if (options.removedConversationIds.has(event.sessionId)) {
    return null;
  }
  const conversation = options.ensureConversation(event.sessionId, {
    directoryId: event.directoryId
  });
  if (event.directoryId !== null) {
    conversation.directoryId = event.directoryId;
  }

  if (event.type === 'session-status') {
    conversation.status = event.status;
    conversation.attentionReason = event.attentionReason;
    conversation.live = event.live;
    conversation.controller = event.controller;
    conversation.lastEventAt = event.ts;
    if (
      event.status === 'running' &&
      (conversation.lastKnownWork === null || conversation.lastKnownWork.trim().length === 0)
    ) {
      conversation.lastKnownWork = 'starting';
      conversation.lastKnownWorkAt = event.ts;
      conversation.lastTelemetrySource = 'control-plane';
    }
    applyTelemetrySummaryToConversation(conversation, event.telemetry);
    return conversation;
  }

  if (event.type === 'session-control') {
    conversation.controller = event.controller;
    conversation.lastEventAt = event.ts;
    return conversation;
  }

  applyTelemetrySummaryToConversation(conversation, {
    source: event.keyEvent.source,
    eventName: event.keyEvent.eventName,
    summary: event.keyEvent.summary,
    observedAt: event.keyEvent.observedAt
  });
  conversation.lastEventAt = event.keyEvent.observedAt;
  if (!shouldApplyTelemetryStatusHint(event.keyEvent)) {
    return conversation;
  }
  if (event.keyEvent.statusHint === 'needs-input') {
    conversation.status = 'needs-input';
    conversation.attentionReason = 'telemetry';
    return conversation;
  }
  if (event.keyEvent.statusHint === 'running' && conversation.status !== 'exited') {
    conversation.status = 'running';
    conversation.attentionReason = null;
    return conversation;
  }
  return conversation;
}
