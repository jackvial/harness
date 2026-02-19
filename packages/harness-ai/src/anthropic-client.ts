import { parseAnthropicStreamChunk, type AnthropicStreamChunk } from './anthropic-protocol.ts';
import { createSseEventStream } from './sse.ts';
import type { HarnessAnthropicModel } from './types.ts';

export interface AnthropicMessagesRequestBody {
  readonly model: string;
  readonly max_tokens?: number;
  readonly temperature?: number;
  readonly top_p?: number;
  readonly stop_sequences?: string[];
  readonly system?: string;
  readonly messages: unknown[];
  readonly tools?: unknown[];
  readonly stream: true;
}

interface ParsedAnthropicStreamEvent {
  readonly rawValue: unknown;
  readonly chunk: AnthropicStreamChunk | null;
  readonly parseError?: string;
}

interface AnthropicStreamResponse {
  readonly requestBody: AnthropicMessagesRequestBody;
  readonly responseHeaders: Headers;
  readonly stream: ReadableStream<ParsedAnthropicStreamEvent>;
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

export async function postAnthropicMessagesStream(
  model: HarnessAnthropicModel,
  requestBody: AnthropicMessagesRequestBody,
  abortSignal?: AbortSignal,
): Promise<AnthropicStreamResponse> {
  const url = `${model.baseUrl}/messages`;
  const requestInit: RequestInit = {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': model.apiKey,
      'anthropic-version': '2023-06-01',
      ...model.headers,
    },
    body: JSON.stringify(requestBody),
  };
  if (abortSignal !== undefined) {
    requestInit.signal = abortSignal;
  }

  const response = await model.fetch(url, requestInit);

  if (!response.ok) {
    const errorBody = await readErrorBody(response);
    throw new Error(`anthropic request failed (${response.status}): ${errorBody}`);
  }

  if (response.body === null) {
    throw new Error('anthropic response body was empty');
  }

  const sseStream = createSseEventStream(response.body);
  const parsedStream = sseStream.pipeThrough(
    new TransformStream({
      transform(event, controller) {
        if (event.data === '[DONE]') {
          return;
        }

        try {
          const raw = JSON.parse(event.data) as unknown;
          const parsed = parseAnthropicStreamChunk(raw);
          controller.enqueue({
            rawValue: raw,
            chunk: parsed,
          } satisfies ParsedAnthropicStreamEvent);
        } catch (error) {
          controller.enqueue({
            rawValue: event.data,
            chunk: null,
            parseError: error instanceof Error ? error.message : String(error),
          } satisfies ParsedAnthropicStreamEvent);
        }
      },
    }),
  );

  return {
    requestBody,
    responseHeaders: response.headers,
    stream: parsedStream,
  };
}
