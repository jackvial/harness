import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { streamText } from '../packages/harness-ai/src/stream-text.ts';
import type {
  HarnessAnthropicModel,
  StreamTextPart,
  ToolSet,
} from '../packages/harness-ai/src/types.ts';
import { collectStream, createAnthropicResponse, createByteStream } from './support/harness-ai.ts';

function createQueuedModel(responses: Array<Response | (() => Response | Promise<Response>)>): {
  readonly model: HarnessAnthropicModel;
  readonly requestBodies: Array<Record<string, unknown>>;
} {
  const queue = [...responses];
  const requestBodies: Array<Record<string, unknown>> = [];

  const model: HarnessAnthropicModel = {
    provider: 'harness.anthropic',
    modelId: 'claude-sonnet',
    apiKey: 'test-key',
    baseUrl: 'https://mock.anthropic.local/v1',
    headers: {},
    fetch: async (_input, init) => {
      const bodyText = String(init?.body ?? '{}');
      requestBodies.push(JSON.parse(bodyText) as Record<string, unknown>);
      const next = queue.shift();
      if (next === undefined) {
        throw new Error('no queued response');
      }
      return typeof next === 'function' ? await next() : next;
    },
  };

  return { model, requestBodies };
}

async function collectFullParts<TOOLS extends ToolSet>(
  result: ReturnType<typeof streamText<TOOLS>>,
): Promise<StreamTextPart<TOOLS>[]> {
  return collectStream(result.fullStream);
}

void test('streams simple text response', async () => {
  const { model, requestBodies } = createQueuedModel([
    createAnthropicResponse([
      {
        type: 'message_start',
        message: {
          id: 'msg-1',
          model: 'claude-sonnet',
          usage: { input_tokens: 4, output_tokens: 0 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Hello' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: ' world' },
      },
      {
        type: 'content_block_stop',
        index: 0,
      },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 4, output_tokens: 2 },
      },
      { type: 'message_stop' },
    ]),
  ]);

  const result = streamText({
    model,
    prompt: 'hi',
  });

  const [parts, text, finishReason, usage, response] = await Promise.all([
    collectFullParts(result),
    result.text,
    result.finishReason,
    result.usage,
    result.response,
  ]);

  assert.equal(
    parts.some((part) => part.type === 'text-delta'),
    true,
  );
  assert.equal(text, 'Hello world');
  assert.equal(finishReason, 'stop');
  assert.deepEqual(usage, {
    inputTokens: 4,
    outputTokens: 2,
    totalTokens: 6,
    reasoningTokens: 0,
    cachedInputTokens: 0,
  });
  assert.equal(response.id, 'msg-1');
  assert.equal(requestBodies.length, 1);
  assert.equal(requestBodies[0]?.['model'], 'claude-sonnet');
});

void test('executes local tools across roundtrips and continues after tool-calls finish reason', async () => {
  const { model, requestBodies } = createQueuedModel([
    createAnthropicResponse([
      {
        type: 'message_start',
        message: {
          id: 'step-1',
          model: 'claude-sonnet',
          usage: { input_tokens: 2, output_tokens: 0 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'tool_use',
          id: 'tool-call-1',
          name: 'weather',
          input: {},
        },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'input_json_delta', partial_json: '{"city":"SF"}' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { input_tokens: 2, output_tokens: 1 },
      },
      { type: 'message_stop' },
    ]),
    createAnthropicResponse([
      {
        type: 'message_start',
        message: {
          id: 'step-2',
          model: 'claude-sonnet',
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: '72F and sunny' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 1, output_tokens: 2 },
      },
      { type: 'message_stop' },
    ]),
  ]);

  const tools = {
    weather: {
      description: 'Weather lookup',
      inputSchema: {
        type: 'object',
        properties: {
          city: { type: 'string' },
        },
      },
      execute: async (input: unknown) => {
        const record = input as { city: string };
        return { forecast: `${record.city}: 72F` };
      },
    },
  } as const;

  const result = streamText({
    model,
    prompt: 'weather?',
    tools,
  });

  const parts = await collectFullParts(result);
  const text = await result.text;

  assert.equal(text, '72F and sunny');
  assert.equal(parts.filter((part) => part.type === 'start-step').length, 2);
  assert.equal(
    parts.some((part) => part.type === 'tool-result'),
    true,
  );
  assert.equal(requestBodies.length, 2);

  const secondBody = requestBodies[1];
  assert.equal(Array.isArray(secondBody?.['messages']), true);
});

void test('handles provider-executed web search/web fetch results and sources', async () => {
  const { model } = createQueuedModel([
    createAnthropicResponse([
      {
        type: 'message_start',
        message: {
          id: 'provider-step',
          model: 'claude-sonnet',
          usage: { input_tokens: 5, output_tokens: 0 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: {
          type: 'server_tool_use',
          id: 'server-call-1',
          name: 'web_search',
          input: { query: 'latest' },
        },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'content_block_start',
        index: 1,
        content_block: {
          type: 'web_search_tool_result',
          tool_use_id: 'server-call-1',
          content: [
            {
              type: 'web_search_result',
              url: 'https://example.com/a',
              title: 'A',
              page_age: '1d',
            },
          ],
        },
      },
      {
        type: 'content_block_start',
        index: 2,
        content_block: {
          type: 'web_fetch_tool_result',
          tool_use_id: 'server-call-2',
          content: {
            type: 'web_fetch_result',
            url: 'https://example.com/doc',
            content: {
              type: 'document',
              source: {
                type: 'base64',
                media_type: 'text/plain',
                data: 'aGVsbG8=',
              },
            },
          },
        },
      },
      {
        type: 'content_block_start',
        index: 3,
        content_block: {
          type: 'web_search_tool_result',
          tool_use_id: 'server-call-3',
          content: {
            type: 'web_search_tool_result_error',
            error_code: 'max_uses_exceeded',
          },
        },
      },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 5, output_tokens: 2 },
      },
      { type: 'message_stop' },
    ]),
  ]);

  const tools = {
    web_search: {
      type: 'provider',
      provider: 'anthropic',
      anthropicType: 'web_search_20250305',
      name: 'web_search',
    },
    web_fetch: {
      type: 'provider',
      provider: 'anthropic',
      anthropicType: 'web_fetch_20250910',
      name: 'web_fetch',
    },
  } as const;

  const result = streamText({ model, prompt: 'search', tools });
  const parts = await collectFullParts(result);

  assert.equal(
    parts.some((part) => part.type === 'source'),
    true,
  );
  assert.equal(
    parts.some((part) => part.type === 'tool-result'),
    true,
  );
  assert.equal(
    parts.some((part) => part.type === 'tool-error'),
    true,
  );
});

void test('handles malformed SSE lines and records error part', async () => {
  const malformed = new Response(
    createByteStream([
      'data: {"type":"message_start","message":{"id":"m1","model":"claude-sonnet","usage":{"input_tokens":1,"output_tokens":0}}}\n\n',
      'data: {not-json}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":1,"output_tokens":1}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ]),
    {
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
    },
  );

  const { model } = createQueuedModel([malformed]);
  const result = streamText({ model, prompt: 'x', includeRawChunks: true });
  const parts = await collectFullParts(result);

  assert.equal(
    parts.some((part) => part.type === 'raw'),
    true,
  );
  assert.equal(
    parts.some((part) => part.type === 'error'),
    true,
  );
});

void test('emits abort and finish when signal is already aborted', async () => {
  const { model } = createQueuedModel([]);
  const abort = new AbortController();
  abort.abort();

  const result = streamText({ model, prompt: 'x', abortSignal: abort.signal });
  const parts = await collectFullParts(result);

  assert.equal(
    parts.some((part) => part.type === 'abort'),
    true,
  );
  assert.equal(
    parts.some((part) => part.type === 'finish'),
    true,
  );
});

void test('emits maxToolRoundtrips guard error', async () => {
  const { model } = createQueuedModel([]);
  const result = streamText({ model, prompt: 'x', maxToolRoundtrips: 0 });
  const parts = await collectFullParts(result);

  assert.equal(
    parts.some((part) => part.type === 'error'),
    true,
  );
  assert.equal(
    parts.some((part) => part.type === 'finish' && part.finishReason === 'error'),
    true,
  );
});

void test('handles execute missing and execute failure branches', async () => {
  const { model } = createQueuedModel([
    createAnthropicResponse([
      {
        type: 'message_start',
        message: {
          id: 'tool-step',
          model: 'claude-sonnet',
          usage: { input_tokens: 1, output_tokens: 0 },
          content: [
            {
              type: 'tool_use',
              id: 'missing-1',
              name: 'missingTool',
              input: { a: 1 },
            },
            {
              type: 'tool_use',
              id: 'throws-1',
              name: 'throwsTool',
              input: { b: 2 },
            },
          ],
        },
      },
      {
        type: 'message_delta',
        delta: { stop_reason: 'tool_use' },
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      { type: 'message_stop' },
    ]),
    createAnthropicResponse([
      {
        type: 'message_start',
        message: {
          id: 'done-step',
          model: 'claude-sonnet',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      { type: 'message_stop' },
    ]),
  ]);

  const tools = {
    throwsTool: {
      description: 'throws',
      execute: async () => {
        throw new Error('boom');
      },
    },
  } as const;

  const result = streamText({ model, prompt: 'x', tools });
  const parts = await collectFullParts(result);

  const errors = parts.filter((part) => part.type === 'tool-error');
  assert.equal(errors.length >= 2, true);
});

void test('toUIMessageStream and toUIMessageStreamResponse work for stream results', async () => {
  const { model } = createQueuedModel([
    createAnthropicResponse([
      {
        type: 'message_start',
        message: {
          id: 'ui-step',
          model: 'claude-sonnet',
          usage: { input_tokens: 1, output_tokens: 0 },
        },
      },
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text' },
      },
      {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'UI' },
      },
      { type: 'content_block_stop', index: 0 },
      {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { input_tokens: 1, output_tokens: 1 },
      },
      { type: 'message_stop' },
    ]),
  ]);

  const result = streamText({ model, prompt: 'x' });
  const uiChunks = await collectStream(result.toUIMessageStream());
  assert.equal(
    uiChunks.some((chunk) => chunk.type === 'text-delta'),
    true,
  );

  const response = result.toUIMessageStreamResponse();
  assert.equal(response.headers.get('x-vercel-ai-ui-message-stream'), 'v1');
});
