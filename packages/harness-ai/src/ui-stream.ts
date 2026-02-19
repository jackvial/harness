import type { AsyncIterableStream, StreamTextPart, ToolSet, UIMessageChunk } from './types.ts';
import { toAsyncIterableStream } from './async-iterable-stream.ts';

export const UI_MESSAGE_STREAM_HEADERS: Readonly<Record<string, string>> = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache',
  connection: 'keep-alive',
  'x-vercel-ai-ui-message-stream': 'v1',
  'x-accel-buffering': 'no',
};

export class JsonToSseTransformStream extends TransformStream<unknown, string> {
  constructor() {
    super({
      transform(part, controller) {
        controller.enqueue(`data: ${JSON.stringify(part)}\n\n`);
      },
      flush(controller) {
        controller.enqueue('data: [DONE]\n\n');
      },
    });
  }
}

function defaultErrorText(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function createUIMessageStream<TOOLS extends ToolSet>(
  stream: ReadableStream<StreamTextPart<TOOLS>>,
  onError: (error: unknown) => string = defaultErrorText,
): AsyncIterableStream<UIMessageChunk> {
  const uiStream = stream.pipeThrough(
    new TransformStream<StreamTextPart<TOOLS>, UIMessageChunk>({
      transform(part, controller) {
        switch (part.type) {
          case 'start':
            controller.enqueue({ type: 'start' });
            break;
          case 'start-step':
            controller.enqueue({ type: 'start-step' });
            break;
          case 'text-start':
            controller.enqueue({
              type: 'text-start',
              id: part.id,
              providerMetadata: part.providerMetadata,
            });
            break;
          case 'text-delta':
            controller.enqueue({
              type: 'text-delta',
              id: part.id,
              delta: part.text,
              providerMetadata: part.providerMetadata,
            });
            break;
          case 'text-end':
            controller.enqueue({
              type: 'text-end',
              id: part.id,
              providerMetadata: part.providerMetadata,
            });
            break;
          case 'reasoning-start':
            controller.enqueue({
              type: 'reasoning-start',
              id: part.id,
              providerMetadata: part.providerMetadata,
            });
            break;
          case 'reasoning-delta':
            controller.enqueue({
              type: 'reasoning-delta',
              id: part.id,
              delta: part.text,
              providerMetadata: part.providerMetadata,
            });
            break;
          case 'reasoning-end':
            controller.enqueue({
              type: 'reasoning-end',
              id: part.id,
              providerMetadata: part.providerMetadata,
            });
            break;
          case 'tool-input-start':
            controller.enqueue({
              type: 'tool-input-start',
              toolCallId: part.id,
              toolName: part.toolName,
              providerExecuted: part.providerExecuted,
              providerMetadata: part.providerMetadata,
              dynamic: part.dynamic,
              title: part.title,
            });
            break;
          case 'tool-input-delta':
            controller.enqueue({
              type: 'tool-input-delta',
              toolCallId: part.id,
              inputTextDelta: part.delta,
            });
            break;
          case 'tool-call':
            if (part.invalid) {
              controller.enqueue({
                type: 'tool-input-error',
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                input: part.input,
                providerExecuted: part.providerExecuted,
                providerMetadata: part.providerMetadata,
                dynamic: part.dynamic,
                title: part.title,
                errorText: part.error ?? 'Invalid tool call',
              });
            } else {
              controller.enqueue({
                type: 'tool-input-available',
                toolCallId: part.toolCallId,
                toolName: part.toolName,
                input: part.input,
                providerExecuted: part.providerExecuted,
                providerMetadata: part.providerMetadata,
                dynamic: part.dynamic,
                title: part.title,
              });
            }
            break;
          case 'tool-result':
            controller.enqueue({
              type: 'tool-output-available',
              toolCallId: part.toolCallId,
              output: part.output,
              providerExecuted: part.providerExecuted,
              dynamic: part.dynamic,
              preliminary: part.preliminary,
            });
            break;
          case 'tool-error':
            controller.enqueue({
              type: 'tool-output-error',
              toolCallId: part.toolCallId,
              providerExecuted: part.providerExecuted,
              dynamic: part.dynamic,
              errorText: onError(part.error),
            });
            break;
          case 'source':
            if (part.sourceType === 'url') {
              controller.enqueue({
                type: 'source-url',
                sourceId: part.id,
                url: part.url,
                title: part.title,
                providerMetadata: part.providerMetadata,
              });
            } else {
              controller.enqueue({
                type: 'source-document',
                sourceId: part.id,
                mediaType: part.mediaType,
                title: part.title,
                filename: part.filename,
                providerMetadata: part.providerMetadata,
              });
            }
            break;
          case 'finish-step':
            controller.enqueue({ type: 'finish-step' });
            break;
          case 'finish':
            controller.enqueue({ type: 'finish', finishReason: part.finishReason });
            break;
          case 'abort':
            controller.enqueue({ type: 'abort', reason: part.reason });
            break;
          case 'error':
            controller.enqueue({ type: 'error', errorText: onError(part.error) });
            break;
          case 'raw':
          case 'tool-input-end':
            break;
          default: {
            const exhaustiveCheck: never = part;
            throw new Error(`unhandled stream part: ${JSON.stringify(exhaustiveCheck)}`);
          }
        }
      },
    }),
  );

  return toAsyncIterableStream(uiStream);
}

export function createUIMessageStreamResponse(
  stream: ReadableStream<UIMessageChunk>,
  init?: ResponseInit,
): Response {
  const sseStream = stream
    .pipeThrough(new JsonToSseTransformStream())
    .pipeThrough(new TextEncoderStream());
  const headers = new Headers(init?.headers ?? {});
  for (const [key, value] of Object.entries(UI_MESSAGE_STREAM_HEADERS)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }
  return new Response(sseStream, {
    ...init,
    headers,
  });
}
