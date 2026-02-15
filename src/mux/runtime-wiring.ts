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
  readonly heartbeat: boolean;
}

const RUNNING_STATUS_HINT_EVENT_NAMES = new Set([
  'codex.user_prompt',
  'codex.conversation_starts',
  'codex.api_request',
  'codex.tool_decision',
  'codex.tool_result',
  'codex.websocket_request',
  'codex.websocket_event'
]);

function normalizeInlineSummaryText(value: string): string {
  const compact = value.replace(/\s+/gu, ' ').trim();
  if (compact.length <= 96) {
    return compact;
  }
  return `${compact.slice(0, 95)}…`;
}

function normalizeLower(value: string | null): string {
  if (value === null) {
    return '';
  }
  return value.toLowerCase();
}

function includesAny(haystack: string, needles: readonly string[]): boolean {
  for (const needle of needles) {
    if (haystack.includes(needle)) {
      return true;
    }
  }
  return false;
}

function statusFromTelemetryText(value: string | null): StreamSessionRuntimeStatus | null {
  const normalized = normalizeLower(value);
  if (normalized.length === 0) {
    return null;
  }
  if (
    includesAny(normalized, ['needs-input', 'needs input', 'approval denied', 'attention-required', 'denied'])
  ) {
    return 'needs-input';
  }
  if (includesAny(normalized, ['turn complete', 'response complete', 'response.completed', 'completed'])) {
    return 'completed';
  }
  if (
    includesAny(normalized, [
      'prompt',
      'model request',
      'writing response',
      'streaming response',
      'drafting response',
      'reasoning',
      'tool ',
      'realtime'
    ])
  ) {
    return 'running';
  }
  return null;
}

function isCurrentWorkHeartbeatEligible(currentText: string | null): boolean {
  return statusFromTelemetryText(currentText) === 'running';
}

function normalizeEventName(value: string | null): string {
  return (value ?? '').trim().toLowerCase();
}

function normalizeSummary(value: string | null): string {
  return (value ?? '').trim();
}

function projectSseSummary(summary: string): string {
  const normalized = summary.toLowerCase();
  if (normalized.includes('response.completed')) {
    return 'response complete';
  }
  if (includesAny(normalized, ['response.failed', 'response.error', 'error'])) {
    return 'response error';
  }
  if (
    includesAny(normalized, [
      'response.output_text.delta',
      'response.reasoning_summary_text.delta',
      'response.content_part.added'
    ])
  ) {
    return 'writing response…';
  }
  if (
    includesAny(normalized, [
      'response.reasoning_summary_part.added',
      'response.reasoning_summary_part.done',
      'response.reasoning_summary_text.done'
    ])
  ) {
    return 'reasoning…';
  }
  if (normalized.includes('response.created')) {
    return 'response started';
  }
  if (normalized.includes('response.in_progress')) {
    return 'model working…';
  }
  if (
    includesAny(normalized, [
      'response.output_item.added',
      'response.output_item.done',
      'response.content_part.done'
    ])
  ) {
    return 'drafting response…';
  }
  return 'streaming response…';
}

function projectTelemetrySummary(telemetry: Omit<MuxTelemetrySummaryInput, 'observedAt'>): ProjectedTelemetrySummary {
  const eventName = normalizeEventName(telemetry.eventName);
  const summary = normalizeSummary(telemetry.summary);
  if (telemetry.source === 'otlp-trace') {
    return {
      text: null,
      heartbeat: true
    };
  }
  if (telemetry.source === 'otlp-metric') {
    if (eventName === 'codex.turn.e2e_duration_ms') {
      return {
        text: summary.length > 0 ? normalizeInlineSummaryText(summary) : 'turn complete',
        heartbeat: false
      };
    }
    return {
      text: null,
      heartbeat: false
    };
  }
  if (eventName === 'history.entry') {
    if (summary.length === 0) {
      return { text: null, heartbeat: false };
    }
    return {
      text: normalizeInlineSummaryText(`prompt: ${summary}`),
      heartbeat: false
    };
  }
  if (eventName === 'codex.user_prompt') {
    const normalizedSummary = summary.toLowerCase();
    if (
      summary.length === 0 ||
      normalizedSummary === 'prompt submitted' ||
      normalizedSummary.endsWith('prompt submitted')
    ) {
      return {
        text: 'prompt submitted',
        heartbeat: false
      };
    }
    return {
      text: normalizeInlineSummaryText(summary.startsWith('prompt:') ? summary : `prompt: ${summary}`),
      heartbeat: false
    };
  }
  if (eventName === 'codex.api_request') {
    return {
      text: normalizeInlineSummaryText(summary.length > 0 ? summary : 'model request'),
      heartbeat: false
    };
  }
  if (eventName === 'codex.sse_event') {
    return {
      text: projectSseSummary(summary.length > 0 ? summary : 'stream event'),
      heartbeat: true
    };
  }
  if (eventName === 'codex.tool_decision' || eventName === 'codex.tool_result') {
    return {
      text: normalizeInlineSummaryText(summary.length > 0 ? summary : eventName === 'codex.tool_decision' ? 'approval decision' : 'tool result'),
      heartbeat: false
    };
  }
  if (eventName === 'codex.websocket_request' || eventName === 'codex.websocket_event') {
    return {
      text: normalizeInlineSummaryText(summary.length > 0 ? summary : eventName.replace(/^codex\./u, '').replace(/_/gu, ' ')),
      heartbeat: true
    };
  }
  if (eventName === 'codex.conversation_starts') {
    return {
      text: normalizeInlineSummaryText(summary.length > 0 ? summary : 'conversation started'),
      heartbeat: false
    };
  }
  if (eventName.startsWith('codex.') && summary.length > 0) {
    return {
      text: normalizeInlineSummaryText(summary),
      heartbeat: false
    };
  }
  return {
    text: null,
    heartbeat: false
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
  const projected = projectTelemetrySummary(telemetry);
  if (projected.text !== null) {
    target.lastKnownWork = projected.text;
    target.lastKnownWorkAt = telemetry.observedAt;
    target.lastTelemetrySource = telemetry.source;
    return;
  }
  if (projected.heartbeat && isCurrentWorkHeartbeatEligible(target.lastKnownWork)) {
    target.lastKnownWorkAt = telemetry.observedAt;
  }
}

function isSseRunningSummary(summary: string | null): boolean {
  const normalized = normalizeLower(summary);
  if (normalized.length === 0) {
    return false;
  }
  return includesAny(normalized, [
    'response.created',
    'response.in_progress',
    'response.output_item.added',
    'response.output_item.done',
    'response.content_part.added',
    'response.content_part.done',
    'response.output_text.delta',
    'response.reasoning_summary'
  ]);
}

function isSseCompletedSummary(summary: string | null): boolean {
  return normalizeLower(summary).includes('response.completed');
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
    if (keyEvent.source === 'otlp-metric') {
      return eventName === 'codex.turn.e2e_duration_ms' || eventName === 'codex.conversation.turn.count';
    }
    if (eventName === 'codex.sse_event') {
      return isSseCompletedSummary(keyEvent.summary);
    }
    return statusFromTelemetryText(keyEvent.summary) === 'completed';
  }
  if (eventName === 'codex.sse_event') {
    return isSseRunningSummary(keyEvent.summary);
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
  if (event.keyEvent.statusHint === 'completed' && conversation.status !== 'exited') {
    conversation.status = 'completed';
    conversation.attentionReason = null;
  }
  return conversation;
}
