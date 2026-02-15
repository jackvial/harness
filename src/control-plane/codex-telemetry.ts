import { createHash } from 'node:crypto';

export type CodexTelemetrySource = 'otlp-log' | 'otlp-metric' | 'otlp-trace' | 'history';
export type CodexStatusHint = 'running' | 'completed' | 'needs-input';

export interface ParsedCodexTelemetryEvent {
  readonly source: CodexTelemetrySource;
  readonly observedAt: string;
  readonly eventName: string | null;
  readonly severity: string | null;
  readonly summary: string | null;
  readonly providerThreadId: string | null;
  readonly statusHint: CodexStatusHint | null;
  readonly payload: Record<string, unknown>;
}

export interface CodexTelemetryConfigArgsInput {
  readonly endpointBaseUrl: string;
  readonly token: string;
  readonly logUserPrompt: boolean;
  readonly captureLogs: boolean;
  readonly captureMetrics: boolean;
  readonly captureTraces: boolean;
  readonly historyPersistence: 'save-all' | 'none';
}

interface OtlpAttribute {
  key: string;
  value: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  return value;
}

function readStringTrimmed(value: unknown): string | null {
  const parsed = readString(value);
  if (parsed === null) {
    return null;
  }
  const trimmed = parsed.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return trimmed;
}

function normalizeIso(ts: unknown, fallback: string): string {
  if (typeof ts === 'string') {
    const parsed = Date.parse(ts);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    return new Date(ts).toISOString();
  }
  return fallback;
}

function normalizeNanoTimestamp(nanoValue: unknown, fallback: string): string {
  if (typeof nanoValue === 'number' && Number.isFinite(nanoValue)) {
    return new Date(Math.floor(nanoValue / 1_000_000)).toISOString();
  }
  if (typeof nanoValue === 'string') {
    const numeric = Number.parseInt(nanoValue, 10);
    if (Number.isFinite(numeric)) {
      return new Date(Math.floor(numeric / 1_000_000)).toISOString();
    }
  }
  return fallback;
}

function parseAnyValue(value: unknown): unknown {
  const record = asRecord(value);
  if (record === null) {
    return value;
  }
  if (record['stringValue'] !== undefined) {
    return record['stringValue'];
  }
  if (record['boolValue'] !== undefined) {
    return record['boolValue'];
  }
  if (record['intValue'] !== undefined) {
    const intValue = record['intValue'];
    if (typeof intValue === 'number') {
      return intValue;
    }
    if (typeof intValue === 'string') {
      const parsed = Number.parseInt(intValue, 10);
      return Number.isFinite(parsed) ? parsed : intValue;
    }
  }
  if (record['doubleValue'] !== undefined) {
    return record['doubleValue'];
  }
  if (record['bytesValue'] !== undefined) {
    return record['bytesValue'];
  }
  const arrayValue = asRecord(record['arrayValue']);
  if (arrayValue !== null && Array.isArray(arrayValue['values'])) {
    return arrayValue['values'].map((entry) => parseAnyValue(entry));
  }
  const kvlistValue = asRecord(record['kvlistValue']);
  if (kvlistValue !== null && Array.isArray(kvlistValue['values'])) {
    const out: Record<string, unknown> = {};
    for (const kvEntry of kvlistValue['values']) {
      const kvRecord = asRecord(kvEntry);
      if (kvRecord === null) {
        continue;
      }
      const key = readString(kvRecord['key']);
      if (key === null) {
        continue;
      }
      out[key] = parseAnyValue(kvRecord['value']);
    }
    return out;
  }
  return record;
}

function parseOtlpAttributes(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) {
    return {};
  }
  const out: Record<string, unknown> = {};
  for (const entry of value) {
    const item = asRecord(entry) as OtlpAttribute | null;
    if (item === null || typeof item.key !== 'string') {
      continue;
    }
    out[item.key] = parseAnyValue(item.value);
  }
  return out;
}

function asSummaryText(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
    return null;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return null;
}

function pickEventName(
  explicit: unknown,
  attributes: Record<string, unknown>,
  body: unknown
): string | null {
  const candidates = [
    explicit,
    attributes['event.name'],
    attributes['name'],
    attributes['codex.event'],
    attributes['event'],
    asRecord(body)?.['event'],
    asRecord(body)?.['name'],
    asRecord(body)?.['type'],
    body
  ];
  for (const candidate of candidates) {
    const value = asSummaryText(candidate);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function collectThreadIdCandidates(
  value: unknown,
  output: string[],
  directMatch: boolean,
  depth: number,
  maxDepth: number,
  maxValues: number
): void {
  if (depth > maxDepth) {
    return;
  }
  if (typeof value === 'string') {
    if (directMatch && value.trim().length > 0) {
      output.push(value.trim());
    }
    return;
  }
  if (typeof value !== 'object' || value === null) {
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectThreadIdCandidates(entry, output, directMatch, depth + 1, maxDepth, maxValues);
      if (output.length >= maxValues) {
        return;
      }
    }
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    if (
      normalizedKey === 'threadid' ||
      normalizedKey === 'thread_id' ||
      normalizedKey === 'thread-id' ||
      normalizedKey === 'sessionid' ||
      normalizedKey === 'session_id' ||
      normalizedKey === 'session-id' ||
      normalizedKey === 'conversationid' ||
      normalizedKey === 'conversation_id' ||
      normalizedKey === 'conversation-id'
    ) {
      collectThreadIdCandidates(nested, output, true, depth + 1, maxDepth, maxValues);
    } else if (
      normalizedKey === 'attributes' ||
      normalizedKey === 'payload' ||
      normalizedKey === 'body' ||
      normalizedKey === 'metadata' ||
      normalizedKey === 'context' ||
      normalizedKey === 'data' ||
      normalizedKey === 'resource' ||
      normalizedKey === 'metric' ||
      normalizedKey === 'span' ||
      normalizedKey === 'entry'
    ) {
      collectThreadIdCandidates(nested, output, directMatch, depth + 1, maxDepth, maxValues);
    }
    if (output.length >= maxValues) {
      return;
    }
  }
}

export function extractCodexThreadId(payload: unknown): string | null {
  const candidates: string[] = [];
  collectThreadIdCandidates(payload, candidates, false, 0, 4, 16);
  if (candidates.length === 0) {
    return null;
  }
  return candidates[0] as string;
}

function statusHintFromText(input: string): CodexStatusHint | null {
  const normalized = input.toLowerCase();
  if (
    normalized.includes('response.completed') ||
    normalized.includes('turn-complete') ||
    normalized.includes('turn completed')
  ) {
    return 'completed';
  }
  if (normalized.includes('attention-required') || normalized.includes('needs-input')) {
    return 'needs-input';
  }
  if (
    normalized.includes('codex.user_prompt') ||
    normalized.includes('user_prompt') ||
    normalized.includes('conversation_starts') ||
    normalized.includes('api_request') ||
    normalized.includes('response.created')
  ) {
    return 'running';
  }
  return null;
}

function deriveStatusHint(
  eventName: string | null,
  summary: string | null,
  payload: Record<string, unknown>
): CodexStatusHint | null {
  if (eventName !== null) {
    const fromEvent = statusHintFromText(eventName);
    if (fromEvent !== null) {
      return fromEvent;
    }
  }
  if (summary !== null) {
    const fromSummary = statusHintFromText(summary);
    if (fromSummary !== null) {
      return fromSummary;
    }
  }
  const compactPayload = JSON.stringify(payload).toLowerCase();
  return statusHintFromText(compactPayload);
}

function buildLogSummary(
  eventName: string | null,
  body: unknown,
  attributes: Record<string, unknown>
): string | null {
  const bodyText = asSummaryText(body);
  const eventText = eventName ?? null;
  const statusText = asSummaryText(attributes['status']) ?? asSummaryText(attributes['result']);
  if (eventText !== null && statusText !== null) {
    return `${eventText} (${statusText})`;
  }
  if (eventText !== null && bodyText !== null && bodyText !== eventText) {
    return `${eventText}: ${bodyText}`;
  }
  return eventText ?? bodyText;
}

export function parseOtlpLogEvents(payload: unknown, observedAtFallback: string): readonly ParsedCodexTelemetryEvent[] {
  const root = asRecord(payload);
  if (root === null || !Array.isArray(root['resourceLogs'])) {
    return [];
  }
  const events: ParsedCodexTelemetryEvent[] = [];

  for (const resourceLog of root['resourceLogs']) {
    const resourceLogRecord = asRecord(resourceLog);
    if (resourceLogRecord === null) {
      continue;
    }
    const resourceRecord = asRecord(resourceLogRecord['resource']);
    const resourceAttributes = parseOtlpAttributes(resourceRecord?.['attributes']);
    const scopeLogs = resourceLogRecord['scopeLogs'];
    if (!Array.isArray(scopeLogs)) {
      continue;
    }
    for (const scopeLog of scopeLogs) {
      const scopeLogRecord = asRecord(scopeLog);
      if (scopeLogRecord === null || !Array.isArray(scopeLogRecord['logRecords'])) {
        continue;
      }
      const scopeRecord = asRecord(scopeLogRecord['scope']);
      const scopeAttributes = parseOtlpAttributes(scopeRecord?.['attributes']);

      for (const logRecord of scopeLogRecord['logRecords']) {
        const item = asRecord(logRecord);
        if (item === null) {
          continue;
        }
        const attributes = parseOtlpAttributes(item['attributes']);
        const body = parseAnyValue(item['body']);
        const observedAt = normalizeNanoTimestamp(item['timeUnixNano'], observedAtFallback);
        const eventName = pickEventName(attributes['event.name'], attributes, body);
        const severity = readStringTrimmed(item['severityText']);
        const payloadRecord: Record<string, unknown> = {
          resource: resourceAttributes,
          scope: scopeAttributes,
          attributes,
          body
        };
        const summary = buildLogSummary(eventName, body, attributes);
        events.push({
          source: 'otlp-log',
          observedAt,
          eventName,
          severity,
          summary,
          providerThreadId: extractCodexThreadId(payloadRecord),
          statusHint: deriveStatusHint(eventName, summary, payloadRecord),
          payload: payloadRecord
        });
      }
    }
  }

  return events;
}

function metricDatapointCount(metric: Record<string, unknown>): number {
  const candidates = [
    asRecord(metric['sum'])?.['dataPoints'],
    asRecord(metric['gauge'])?.['dataPoints'],
    asRecord(metric['histogram'])?.['dataPoints'],
    asRecord(metric['exponentialHistogram'])?.['dataPoints'],
    asRecord(metric['summary'])?.['dataPoints']
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate.length;
    }
  }
  return 0;
}

export function parseOtlpMetricEvents(
  payload: unknown,
  observedAtFallback: string
): readonly ParsedCodexTelemetryEvent[] {
  const root = asRecord(payload);
  if (root === null || !Array.isArray(root['resourceMetrics'])) {
    return [];
  }
  const events: ParsedCodexTelemetryEvent[] = [];
  for (const resourceMetric of root['resourceMetrics']) {
    const resourceMetricRecord = asRecord(resourceMetric);
    if (resourceMetricRecord === null || !Array.isArray(resourceMetricRecord['scopeMetrics'])) {
      continue;
    }
    const resourceRecord = asRecord(resourceMetricRecord['resource']);
    const resourceAttributes = parseOtlpAttributes(resourceRecord?.['attributes']);
    for (const scopeMetric of resourceMetricRecord['scopeMetrics']) {
      const scopeMetricRecord = asRecord(scopeMetric);
      if (scopeMetricRecord === null || !Array.isArray(scopeMetricRecord['metrics'])) {
        continue;
      }
      for (const metricValue of scopeMetricRecord['metrics']) {
        const metric = asRecord(metricValue);
        if (metric === null) {
          continue;
        }
        const metricName = readStringTrimmed(metric['name']);
        const pointCount = metricDatapointCount(metric);
        const payloadRecord: Record<string, unknown> = {
          resource: resourceAttributes,
          metric
        };
        const summary =
          metricName === null
            ? `metric points=${String(pointCount)}`
            : `${metricName} points=${String(pointCount)}`;
        events.push({
          source: 'otlp-metric',
          observedAt: observedAtFallback,
          eventName: metricName,
          severity: null,
          summary,
          providerThreadId: extractCodexThreadId(payloadRecord),
          statusHint: deriveStatusHint(metricName, summary, payloadRecord),
          payload: payloadRecord
        });
      }
    }
  }
  return events;
}

export function parseOtlpTraceEvents(
  payload: unknown,
  observedAtFallback: string
): readonly ParsedCodexTelemetryEvent[] {
  const root = asRecord(payload);
  if (root === null || !Array.isArray(root['resourceSpans'])) {
    return [];
  }
  const events: ParsedCodexTelemetryEvent[] = [];
  for (const resourceSpan of root['resourceSpans']) {
    const resourceSpanRecord = asRecord(resourceSpan);
    if (resourceSpanRecord === null || !Array.isArray(resourceSpanRecord['scopeSpans'])) {
      continue;
    }
    const resourceRecord = asRecord(resourceSpanRecord['resource']);
    const resourceAttributes = parseOtlpAttributes(resourceRecord?.['attributes']);
    for (const scopeSpan of resourceSpanRecord['scopeSpans']) {
      const scopeSpanRecord = asRecord(scopeSpan);
      if (scopeSpanRecord === null || !Array.isArray(scopeSpanRecord['spans'])) {
        continue;
      }
      for (const spanValue of scopeSpanRecord['spans']) {
        const span = asRecord(spanValue);
        if (span === null) {
          continue;
        }
        const attributes = parseOtlpAttributes(span['attributes']);
        const spanName = readStringTrimmed(span['name']);
        const observedAt = normalizeNanoTimestamp(span['endTimeUnixNano'], observedAtFallback);
        const payloadRecord: Record<string, unknown> = {
          resource: resourceAttributes,
          attributes,
          span
        };
        events.push({
          source: 'otlp-trace',
          observedAt,
          eventName: spanName,
          severity: null,
          summary: spanName,
          providerThreadId: extractCodexThreadId(payloadRecord),
          statusHint: deriveStatusHint(spanName, spanName, payloadRecord),
          payload: payloadRecord
        });
      }
    }
  }
  return events;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function tomlString(value: string): string {
  const escaped = value.replace(/\\/gu, '\\\\').replace(/"/gu, '\\"');
  return `"${escaped}"`;
}

export function buildCodexTelemetryConfigArgs(input: CodexTelemetryConfigArgsInput): readonly string[] {
  const baseEndpoint = trimTrailingSlash(input.endpointBaseUrl);
  const args: string[] = ['-c', `otel.log_user_prompt=${input.logUserPrompt ? 'true' : 'false'}`];
  if (input.captureLogs) {
    const endpoint = `${baseEndpoint}/v1/logs/${encodeURIComponent(input.token)}`;
    args.push('-c', `otel.exporter={otlp-http={endpoint=${tomlString(endpoint)},protocol="json"}}`);
  }
  if (input.captureMetrics) {
    const endpoint = `${baseEndpoint}/v1/metrics/${encodeURIComponent(input.token)}`;
    args.push(
      '-c',
      `otel.metrics_exporter={otlp-http={endpoint=${tomlString(endpoint)},protocol="json"}}`
    );
  }
  if (input.captureTraces) {
    const endpoint = `${baseEndpoint}/v1/traces/${encodeURIComponent(input.token)}`;
    args.push('-c', `otel.trace_exporter={otlp-http={endpoint=${tomlString(endpoint)},protocol="json"}}`);
  }
  args.push('-c', `history.persistence=${tomlString(input.historyPersistence)}`);
  return args;
}

function pickHistoryEventName(record: Record<string, unknown>): string | null {
  const candidates = [record['type'], record['event'], record['name'], record['kind']];
  for (const candidate of candidates) {
    const parsed = readStringTrimmed(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }
  return 'history.entry';
}

function pickHistoryObservedAt(record: Record<string, unknown>, fallback: string): string {
  const candidates = [record['timestamp'], record['ts'], record['time'], record['created_at']];
  for (const candidate of candidates) {
    if (candidate === undefined) {
      continue;
    }
    const normalized = normalizeIso(candidate, fallback);
    if (normalized !== fallback) {
      return normalized;
    }
  }
  return fallback;
}

function pickHistorySummary(record: Record<string, unknown>): string | null {
  const candidates = [
    record['summary'],
    record['message'],
    record['text'],
    asRecord(record['entry'])?.['text']
  ];
  for (const candidate of candidates) {
    const parsed = asSummaryText(candidate);
    if (parsed !== null) {
      return parsed;
    }
  }
  return null;
}

export function parseCodexHistoryLine(
  line: string,
  observedAtFallback: string
): ParsedCodexTelemetryEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }
  const record = asRecord(parsed);
  if (record === null) {
    return null;
  }
  const observedAt = pickHistoryObservedAt(record, observedAtFallback);
  const eventName = pickHistoryEventName(record);
  const summary = pickHistorySummary(record);
  return {
    source: 'history',
    observedAt,
    eventName,
    severity: null,
    summary,
    providerThreadId: extractCodexThreadId(record),
    statusHint: deriveStatusHint(eventName, summary, record),
    payload: record
  };
}

export function telemetryFingerprint(event: {
  source: CodexTelemetrySource;
  sessionId: string | null;
  providerThreadId: string | null;
  eventName: string | null;
  observedAt: string;
  payload: Record<string, unknown>;
}): string {
  const hash = createHash('sha1');
  hash.update(event.source);
  hash.update('\n');
  hash.update(event.sessionId ?? '');
  hash.update('\n');
  hash.update(event.providerThreadId ?? '');
  hash.update('\n');
  hash.update(event.eventName ?? '');
  hash.update('\n');
  hash.update(event.observedAt);
  hash.update('\n');
  hash.update(JSON.stringify(event.payload));
  return hash.digest('hex');
}
