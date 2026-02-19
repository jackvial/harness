import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { loadHarnessSecrets } from '../src/config/secrets-core.ts';
import { createAnthropic, streamObject, streamText } from '../packages/harness-ai/src/index.ts';

interface ParsedArgs {
  readonly secretsFile: string;
  readonly model?: string;
  readonly baseUrl?: string;
}

const DEFAULT_MODEL_CANDIDATES = [
  'claude-sonnet-4-6',
  'claude-sonnet-4-5-20250929',
  'claude-3-5-haiku-20241022',
] as const;

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

  const defaultSecretsFile = resolve(
    process.env.HOME ?? process.cwd(),
    'dev/harness/.harness/secrets.env',
  );

  return {
    secretsFile: parsed.secretsFile ?? defaultSecretsFile,
    ...(parsed.model !== undefined ? { model: parsed.model } : {}),
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
  for await (const part of stream) {
    output.push(part);
  }
  return output;
}

async function runSmokeForModel(options: {
  readonly apiKey: string;
  readonly modelId: string;
  readonly baseUrl?: string;
}): Promise<{
  readonly modelId: string;
  readonly textDeltaCount: number;
  readonly toolCallCount: number;
  readonly toolResultCount: number;
  readonly partialObjectCount: number;
}> {
  const anthropic = createAnthropic({
    apiKey: options.apiKey,
    ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
  });
  const model = anthropic(options.modelId);

  const textResult = streamText({
    model,
    prompt: 'Respond with exactly HARNESS_SMOKE_OK.',
    maxOutputTokens: 32,
    temperature: 0,
  });

  const [textDeltas, textOutput, textFinishReason] = await withTimeout(
    Promise.all([
      collectAsync(textResult.textStream),
      textResult.text,
      textResult.finishReason,
    ]),
    `text stream smoke (${options.modelId})`,
  );

  assert.match(textOutput, /HARNESS_SMOKE_OK/u);
  assert.equal(textFinishReason, 'stop');

  const objectResult = streamObject<{ status: string; value: number }, {}>({
    model,
    prompt:
      'Return a JSON object with exactly two keys: status and value. status must be "ok" and value must be 7.',
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

  const [partialObjects, finalObject, objectFinishReason] = await withTimeout(
    Promise.all([
      collectAsync(objectResult.partialObjectStream),
      objectResult.object,
      objectResult.finishReason,
    ]),
    `streamObject smoke (${options.modelId})`,
  );

  assert.equal(finalObject.status, 'ok');
  assert.equal(finalObject.value, 7);
  assert.equal(objectFinishReason, 'stop');

  const toolResult = streamText({
    model,
    prompt: [
      'You must call the weather tool exactly once with {"city":"San Francisco"} before answering.',
      'After receiving tool output, respond exactly with TOOL_SMOKE_OK.',
      'Do not include any additional text.',
    ].join(' '),
    maxOutputTokens: 128,
    temperature: 0,
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
          return {
            city,
            forecast: `${city}: 68F clear`,
          };
        },
      },
    },
  });

  const [toolText, toolCalls, toolOutputs, toolFinishReason] = await withTimeout(
    Promise.all([
      toolResult.text,
      toolResult.toolCalls,
      toolResult.toolResults,
      toolResult.finishReason,
    ]),
    `tool streaming smoke (${options.modelId})`,
  );

  assert.equal(toolCalls.length >= 1, true);
  assert.equal(toolOutputs.length >= 1, true);
  assert.match(toolText, /TOOL_SMOKE_OK/u);
  assert.equal(toolFinishReason, 'stop');

  return {
    modelId: options.modelId,
    textDeltaCount: textDeltas.length,
    toolCallCount: toolCalls.length,
    toolResultCount: toolOutputs.length,
    partialObjectCount: partialObjects.length,
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

  const candidates =
    args.model !== undefined
      ? [args.model]
      : [...DEFAULT_MODEL_CANDIDATES];

  const failures: string[] = [];
  for (const candidate of candidates) {
    try {
      const summary = await runSmokeForModel({
        apiKey,
        modelId: candidate,
        ...(args.baseUrl !== undefined ? { baseUrl: args.baseUrl } : {}),
      });

      process.stdout.write('harness-ai smoke test passed\n');
      process.stdout.write(`model=${summary.modelId}\n`);
      process.stdout.write(`text_deltas=${String(summary.textDeltaCount)}\n`);
      process.stdout.write(`tool_calls=${String(summary.toolCallCount)}\n`);
      process.stdout.write(`tool_results=${String(summary.toolResultCount)}\n`);
      process.stdout.write(`partial_objects=${String(summary.partialObjectCount)}\n`);
      return;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.push(`${candidate}: ${reason}`);
    }
  }

  throw new Error(`harness-ai smoke test failed for all models\n${failures.join('\n')}`);
}

await main();
