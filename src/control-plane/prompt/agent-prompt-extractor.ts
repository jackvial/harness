import { createHash } from 'node:crypto';
import type {
  StreamPromptCaptureSource,
  StreamPromptConfidence,
  StreamSessionPromptRecord,
  StreamTelemetrySource,
} from '../stream-protocol.ts';

export interface PromptFromNotifyInput {
  readonly payload: Record<string, unknown>;
  readonly observedAt: string;
}

export interface PromptFromTelemetryInput {
  readonly source: StreamTelemetrySource;
  readonly eventName: string | null;
  readonly summary: string | null;
  readonly payload: Record<string, unknown>;
  readonly observedAt: string;
}

export interface AgentPromptExtractor {
  readonly agentType: string;
  fromNotify(input: PromptFromNotifyInput): StreamSessionPromptRecord | null;
  fromTelemetry(input: PromptFromTelemetryInput): StreamSessionPromptRecord | null;
}

export function readTrimmedString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function normalizeEventToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function stableSerialize(value: unknown, depth = 0): string {
  if (depth > 4) {
    return '[depth-limit]';
  }
  if (value === null) {
    return 'null';
  }
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value
      .slice(0, 24)
      .map((entry) => stableSerialize(entry, depth + 1))
      .join(',')}]`;
  }
  const record = asRecord(value);
  if (record === null) {
    return typeof value;
  }
  const keys = Object.keys(record).sort().slice(0, 24);
  return `{${keys
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(record[key], depth + 1)}`)
    .join(',')}}`;
}

function hashPromptPayload(input: {
  readonly text: string | null;
  readonly providerEventName: string | null;
  readonly payload: Record<string, unknown>;
}): string {
  const hash = createHash('sha256');
  hash.update(input.providerEventName ?? '');
  hash.update('\n');
  hash.update(input.text ?? '');
  hash.update('\n');
  hash.update(stableSerialize(input.payload));
  return hash.digest('hex');
}

function lookupRecordValue(
  record: Record<string, unknown>,
  candidateKeys: readonly string[],
): string | null {
  const normalizedKeys = new Set(candidateKeys.map((key) => key.toLowerCase()));
  for (const [key, value] of Object.entries(record)) {
    if (!normalizedKeys.has(key.toLowerCase())) {
      continue;
    }
    const text = readTrimmedString(value);
    if (text !== null) {
      return text;
    }
  }
  return null;
}

export function findPromptText(
  value: unknown,
  options: {
    readonly keys: readonly string[];
    readonly maxDepth?: number;
  },
): string | null {
  const maxDepth = options.maxDepth ?? 3;
  const visited = new Set<unknown>();
  const queue: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined) {
      continue;
    }
    if (next.depth > maxDepth) {
      continue;
    }
    if (next.value !== null && typeof next.value === 'object') {
      if (visited.has(next.value)) {
        continue;
      }
      visited.add(next.value);
    }
    if (typeof next.value === 'string') {
      if (next.depth === 0) {
        const text = readTrimmedString(next.value);
        if (text !== null) {
          return text;
        }
      }
      continue;
    }
    const record = asRecord(next.value);
    if (record !== null) {
      const match = lookupRecordValue(record, options.keys);
      if (match !== null) {
        return match;
      }
      if (next.depth >= maxDepth) {
        continue;
      }
      for (const nested of Object.values(record)) {
        queue.push({ value: nested, depth: next.depth + 1 });
      }
      continue;
    }
    if (Array.isArray(next.value) && next.depth < maxDepth) {
      for (const nested of next.value.slice(0, 24)) {
        queue.push({ value: nested, depth: next.depth + 1 });
      }
    }
  }
  return null;
}

function providerPayloadKeys(payload: Record<string, unknown>): string[] {
  return Object.keys(payload).sort().slice(0, 12);
}

export function createPromptRecord(input: {
  readonly text: string | null;
  readonly confidence: StreamPromptConfidence;
  readonly captureSource: StreamPromptCaptureSource;
  readonly providerEventName: string | null;
  readonly payload: Record<string, unknown>;
  readonly observedAt: string;
}): StreamSessionPromptRecord {
  return {
    text: input.text,
    hash: hashPromptPayload({
      text: input.text,
      providerEventName: input.providerEventName,
      payload: input.payload,
    }),
    confidence: input.confidence,
    captureSource: input.captureSource,
    providerEventName: input.providerEventName,
    providerPayloadKeys: providerPayloadKeys(input.payload),
    observedAt: input.observedAt,
  };
}
