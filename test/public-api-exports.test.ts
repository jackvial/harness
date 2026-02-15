import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCodexTelemetryConfigArgs } from '../src/control-plane/codex-telemetry.ts';
import { HarnessAgentRealtimeClient } from '../src/control-plane/agent-realtime-api.ts';
import type {
  AgentClaimSessionInput,
  AgentRealtimeConnectOptions,
  AgentRealtimeEventEnvelope,
  AgentRealtimeEventType,
  AgentRealtimeSubscriptionFilter,
  AgentReleaseSessionInput,
  AgentSessionClaimResult,
  AgentSessionReleaseResult,
  AgentSessionSummary
} from '../src/control-plane/agent-realtime-api.ts';
import type { ControlPlaneKeyEvent } from '../src/control-plane/codex-session-stream.ts';
import type { CodexStatusHint, CodexTelemetryConfigArgsInput } from '../src/control-plane/codex-telemetry.ts';
import type { StreamTelemetrySource, StreamTelemetryStatusHint } from '../src/control-plane/stream-protocol.ts';
import type { ControlPlaneTelemetryRecord } from '../src/store/control-plane-store.ts';

void test('public api exports stay importable and structurally typed', () => {
  const subscription: AgentRealtimeSubscriptionFilter = {
    includeOutput: false
  };
  const connectOptions: AgentRealtimeConnectOptions = {
    host: '127.0.0.1',
    port: 9000,
    subscription
  };
  const claimInput: AgentClaimSessionInput = {
    sessionId: 'conversation-1',
    controllerId: 'agent-1',
    controllerType: 'agent'
  };
  const releaseInput: AgentReleaseSessionInput = {
    sessionId: 'conversation-1'
  };
  const claimResult: AgentSessionClaimResult = {
    sessionId: 'conversation-1',
    action: 'claimed',
    controller: {
      controllerId: 'agent-1',
      controllerType: 'agent',
      controllerLabel: null,
      claimedAt: new Date(0).toISOString()
    }
  };
  const releaseResult: AgentSessionReleaseResult = {
    sessionId: 'conversation-1',
    released: true
  };
  const eventType: AgentRealtimeEventType = 'session.status';
  const eventEnvelope: AgentRealtimeEventEnvelope<'session.status'> = {
    type: 'session.status',
    cursor: 1,
    observed: {
      type: 'session-status',
      sessionId: 'conversation-1',
      status: 'running',
      attentionReason: null,
      live: true,
      ts: new Date(0).toISOString(),
      directoryId: null,
      conversationId: 'conversation-1',
      telemetry: null,
      controller: null
    }
  };
  const keyEvent: ControlPlaneKeyEvent = {
    type: 'session-status',
    sessionId: 'conversation-1',
    status: 'running',
    attentionReason: null,
    live: true,
    ts: new Date(0).toISOString(),
    directoryId: null,
    conversationId: 'conversation-1',
    telemetry: null,
    controller: null,
    cursor: 1
  };
  const telemetryRecord: ControlPlaneTelemetryRecord = {
    telemetryId: 1,
    source: 'otlp-log',
    sessionId: 'conversation-1',
    providerThreadId: null,
    eventName: 'codex.api_request',
    severity: 'INFO',
    summary: 'ok',
    observedAt: new Date(0).toISOString(),
    ingestedAt: new Date(0).toISOString(),
    payload: {},
    fingerprint: 'fingerprint-1'
  };
  const source: StreamTelemetrySource = 'otlp-log';
  const statusHint: StreamTelemetryStatusHint = 'running';
  const codexStatus: CodexStatusHint = 'running';
  const codexConfig: CodexTelemetryConfigArgsInput = {
    endpointBaseUrl: 'http://127.0.0.1:4318',
    token: 'token',
    logUserPrompt: true,
    captureLogs: true,
    captureMetrics: true,
    captureTraces: true,
    historyPersistence: 'save-all'
  };
  const codexArgs = buildCodexTelemetryConfigArgs(codexConfig);

  const summary = null as unknown as AgentSessionSummary;

  assert.equal(connectOptions.host, '127.0.0.1');
  assert.equal(claimInput.sessionId, 'conversation-1');
  assert.equal(releaseInput.sessionId, 'conversation-1');
  assert.equal(claimResult.action, 'claimed');
  assert.equal(releaseResult.released, true);
  assert.equal(eventType, 'session.status');
  assert.equal(eventEnvelope.type, 'session.status');
  assert.equal(keyEvent.type, 'session-status');
  assert.equal(telemetryRecord.telemetryId, 1);
  assert.equal(source, 'otlp-log');
  assert.equal(statusHint, 'running');
  assert.equal(codexStatus, 'running');
  assert.equal(codexArgs.length > 0, true);
  assert.equal(summary as unknown, null as unknown);
  assert.equal(typeof HarnessAgentRealtimeClient.connect, 'function');
});
