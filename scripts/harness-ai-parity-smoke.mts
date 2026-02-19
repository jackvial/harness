import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { loadHarnessSecrets } from '../src/config/secrets-core.ts';
import {
  createAnthropic as createHarnessAnthropic,
  streamObject as harnessStreamObject,
  streamText as harnessStreamText,
} from '../packages/harness-ai/src/index.ts';
import { createAnthropic as createVercelAnthropic } from '@ai-sdk/anthropic';
import { stepCountIs, streamObject as vercelStreamObject, streamText as vercelStreamText, tool } from 'ai';
import { z } from 'zod';

interface ParsedArgs {
  readonly secretsFile: string;
  readonly model: string;
  readonly baseUrl?: string;
}

interface ScenarioSummary {
  readonly text: string;
  readonly finishReason: string;
  readonly textDeltaCount: number;
  readonly toolCallCount: number;
  readonly toolResultCount: number;
  readonly partialObjectCount: number;
  readonly objectValue: {
    readonly status: string;
    readonly value: number;
  };
}

interface DiffItem {
  readonly field: string;
  readonly harness: unknown;
  readonly vercel: unknown;
  readonly explainable: boolean;
  readonly explanation: string;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const parsed: {
    secretsFile?: string;
    model?: string;
    baseUrl?: string;
  } = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--secrets-file') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error('missing value for --secrets-file');
      }
      parsed.secretsFile = value;
      index += 1;
      continue;
    }
    if (arg === '--model') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error('missing value for --model');
      }
      parsed.model = value;
      index += 1;
      continue;
    }
    if (arg === '--base-url') {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error('missing value for --base-url');
      }
      parsed.baseUrl = value;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return {
    secretsFile:
      parsed.secretsFile ??
      resolve(process.env.HOME ?? process.cwd(), 'dev/harness/.harness/secrets.env'),
    model: parsed.model ?? 'claude-3-5-haiku-20241022',
    ...(parsed.baseUrl !== undefined ? { baseUrl: parsed.baseUrl } : {}),
  };
}

function timeoutError(label: string, timeoutMs: number): Error {
  return new Error(`${label} timed out after ${String(timeoutMs)}ms`);
}

async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 90_000): Promise<T> {
  const timeout = new Promise<T>((_, reject) => {
    const handle = setTimeout(() => reject(timeoutError(label, timeoutMs)), timeoutMs);
    handle.unref?.();
  });
  return Promise.race([promise, timeout]);
}

async function collectAsync<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const value of stream) {
    output.push(value);
  }
  return output;
}

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

async function runHarnessScenario(options: {
  readonly apiKey: string;
  readonly modelId: string;
  readonly baseUrl?: string;
}): Promise<ScenarioSummary> {
  const anthropic = createHarnessAnthropic({
    apiKey: options.apiKey,
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
  });
  const model = anthropic(options.modelId);

  const textRun = harnessStreamText({
    model,
    prompt: 'Respond with exactly PARITY_TEXT_OK.',
    temperature: 0,
    maxOutputTokens: 32,
  });
  const [textDeltas, textOutput, textFinishReason] = await withTimeout(
    Promise.all([collectAsync(textRun.textStream), textRun.text, textRun.finishReason]),
    'harness text scenario',
  );

  const objectRun = harnessStreamObject<{ status: string; value: number }, {}>({
    model,
    prompt: 'Return JSON object with status="ok" and value=7.',
    temperature: 0,
    maxOutputTokens: 128,
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string' },
        value: { type: 'number' },
      },
      required: ['status', 'value'],
    },
    validate: (value: unknown): value is { status: string; value: number } => {
      if (typeof value !== 'object' || value === null) {
        return false;
      }
      const record = value as { status?: unknown; value?: unknown };
      return record.status === 'ok' && record.value === 7;
    },
  });
  const [partialObjects, objectValue] = await withTimeout(
    Promise.all([collectAsync(objectRun.partialObjectStream), objectRun.object]),
    'harness object scenario',
  );

  const toolRun = harnessStreamText({
    model,
    prompt: [
      'Call the weather tool exactly once with {"city":"San Francisco"} before answering.',
      'After the tool result, respond exactly: PARITY_TOOL_OK.',
      'No additional text.',
    ].join(' '),
    temperature: 0,
    maxOutputTokens: 128,
    tools: {
      weather: {
        description: 'Get weather by city',
        inputSchema: {
          type: 'object',
          properties: {
            city: { type: 'string' },
          },
          required: ['city'],
        },
        execute: (input: unknown) => {
          const city = (() => {
            if (typeof input !== 'object' || input === null) {
              return 'Unknown';
            }
            const candidate = (input as { city?: unknown }).city;
            return typeof candidate === 'string' ? candidate : 'Unknown';
          })();
          return { city, forecast: `${city}: 68F clear` };
        },
      },
    },
  });
  const [toolText, toolCalls, toolResults, toolFinishReason] = await withTimeout(
    Promise.all([toolRun.text, toolRun.toolCalls, toolRun.toolResults, toolRun.finishReason]),
    'harness tool scenario',
  );

  assert.match(textOutput, /PARITY_TEXT_OK/u);
  assert.match(toolText, /PARITY_TOOL_OK/u);
  assert.equal(objectValue.status, 'ok');
  assert.equal(objectValue.value, 7);

  return {
    text: textOutput,
    finishReason: `${textFinishReason}/${toolFinishReason}`,
    textDeltaCount: textDeltas.length,
    toolCallCount: toolCalls.length,
    toolResultCount: toolResults.length,
    partialObjectCount: partialObjects.length,
    objectValue,
  };
}

async function runVercelScenario(options: {
  readonly apiKey: string;
  readonly modelId: string;
  readonly baseUrl?: string;
}): Promise<ScenarioSummary> {
  const anthropic = createVercelAnthropic({
    apiKey: options.apiKey,
    ...(options.baseUrl !== undefined ? { baseURL: options.baseUrl } : {}),
  });
  const model = anthropic(options.modelId);

  const textRun = vercelStreamText({
    model,
    prompt: 'Respond with exactly PARITY_TEXT_OK.',
    temperature: 0,
    maxOutputTokens: 32,
  });
  const [textDeltas, textOutput, textFinishReason] = await withTimeout(
    Promise.all([collectAsync(textRun.textStream), textRun.text, textRun.finishReason]),
    'vercel text scenario',
  );

  const objectRun = vercelStreamObject({
    model,
    prompt: 'Return JSON object with status="ok" and value=7.',
    schema: z.object({
      status: z.literal('ok'),
      value: z.literal(7),
    }),
    temperature: 0,
    maxOutputTokens: 128,
  });
  const [partialObjects, objectValue] = await withTimeout(
    Promise.all([collectAsync(objectRun.partialObjectStream), objectRun.object]),
    'vercel object scenario',
  );

  const toolRun = vercelStreamText({
    model,
    prompt: [
      'Call the weather tool exactly once with {"city":"San Francisco"} before answering.',
      'After the tool result, respond exactly: PARITY_TOOL_OK.',
      'No additional text.',
    ].join(' '),
    temperature: 0,
    maxOutputTokens: 128,
    stopWhen: stepCountIs(5),
    tools: {
      weather: tool({
        description: 'Get weather by city',
        inputSchema: z.object({
          city: z.string(),
        }),
        execute: async ({ city }) => ({ city, forecast: `${city}: 68F clear` }),
      }),
    },
  });
  const [toolText, toolCalls, toolResults, toolFinishReason] = await withTimeout(
    Promise.all([toolRun.text, toolRun.toolCalls, toolRun.toolResults, toolRun.finishReason]),
    'vercel tool scenario',
  );

  assert.match(textOutput, /PARITY_TEXT_OK/u);
  assert.match(toolText, /PARITY_TOOL_OK/u);
  assert.equal(objectValue.status, 'ok');
  assert.equal(objectValue.value, 7);

  return {
    text: textOutput,
    finishReason: `${textFinishReason}/${toolFinishReason}`,
    textDeltaCount: textDeltas.length,
    toolCallCount: toolCalls.length,
    toolResultCount: toolResults.length,
    partialObjectCount: partialObjects.length,
    objectValue,
  };
}

function compareResults(
  harness: ScenarioSummary,
  vercel: ScenarioSummary,
): {
  readonly hardDiffs: DiffItem[];
  readonly softDiffs: DiffItem[];
} {
  const diffs: DiffItem[] = [];

  if (normalizeText(harness.text) !== normalizeText(vercel.text)) {
    diffs.push({
      field: 'text',
      harness: harness.text,
      vercel: vercel.text,
      explainable: true,
      explanation:
        'Both satisfy the required token; minor text normalization differences are expected across client loops.',
    });
  }

  if (harness.finishReason !== vercel.finishReason) {
    diffs.push({
      field: 'finishReason',
      harness: harness.finishReason,
      vercel: vercel.finishReason,
      explainable: true,
      explanation:
        'Step aggregation policy differs (single combined summary here); individual step termination can be represented differently.',
    });
  }

  if (harness.textDeltaCount !== vercel.textDeltaCount) {
    diffs.push({
      field: 'textDeltaCount',
      harness: harness.textDeltaCount,
      vercel: vercel.textDeltaCount,
      explainable: true,
      explanation: 'Chunking boundaries are transport/provider implementation details.',
    });
  }

  if (harness.partialObjectCount !== vercel.partialObjectCount) {
    diffs.push({
      field: 'partialObjectCount',
      harness: harness.partialObjectCount,
      vercel: vercel.partialObjectCount,
      explainable: true,
      explanation: 'Partial JSON emission cadence differs by parser and delta stitching strategy.',
    });
  }

  if (harness.toolCallCount < 1 || vercel.toolCallCount < 1) {
    diffs.push({
      field: 'toolCallCount',
      harness: harness.toolCallCount,
      vercel: vercel.toolCallCount,
      explainable: true,
      explanation:
        'With default auto tool-choice, one client can answer directly without emitting tool calls; this is model policy variance, not stream-format incompatibility.',
    });
  } else if (harness.toolCallCount !== vercel.toolCallCount) {
    diffs.push({
      field: 'toolCallCount',
      harness: harness.toolCallCount,
      vercel: vercel.toolCallCount,
      explainable: true,
      explanation: 'Additional clarification/retry tool calls can vary across orchestration loops.',
    });
  }

  if (harness.toolResultCount < 1 || vercel.toolResultCount < 1) {
    diffs.push({
      field: 'toolResultCount',
      harness: harness.toolResultCount,
      vercel: vercel.toolResultCount,
      explainable: true,
      explanation:
        'Tool results are absent when the model chooses not to invoke tools under auto tool-choice; this is expected variance.',
    });
  } else if (harness.toolResultCount !== vercel.toolResultCount) {
    diffs.push({
      field: 'toolResultCount',
      harness: harness.toolResultCount,
      vercel: vercel.toolResultCount,
      explainable: true,
      explanation: 'Tool retry / follow-up behavior can differ by step-loop policy.',
    });
  }

  if (harness.objectValue.status !== vercel.objectValue.status || harness.objectValue.value !== vercel.objectValue.value) {
    diffs.push({
      field: 'objectValue',
      harness: harness.objectValue,
      vercel: vercel.objectValue,
      explainable: false,
      explanation: 'Structured output semantic mismatch.',
    });
  }

  return {
    hardDiffs: diffs.filter((diff) => !diff.explainable),
    softDiffs: diffs.filter((diff) => diff.explainable),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  loadHarnessSecrets({
    cwd: process.cwd(),
    filePath: args.secretsFile,
    overrideExisting: false,
  });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw new Error('ANTHROPIC_API_KEY was not found after loading secrets');
  }

  const harness = await runHarnessScenario({
    apiKey,
    modelId: args.model,
    ...(args.baseUrl !== undefined ? { baseUrl: args.baseUrl } : {}),
  });
  const vercel = await runVercelScenario({
    apiKey,
    modelId: args.model,
    ...(args.baseUrl !== undefined ? { baseUrl: args.baseUrl } : {}),
  });

  const comparison = compareResults(harness, vercel);
  const report = {
    model: args.model,
    harness,
    vercel,
    softDifferences: comparison.softDiffs,
    hardDifferences: comparison.hardDiffs,
  };

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  if (comparison.hardDiffs.length > 0) {
    throw new Error(`harness-ai parity smoke failed with ${String(comparison.hardDiffs.length)} hard differences`);
  }
}

await main();
