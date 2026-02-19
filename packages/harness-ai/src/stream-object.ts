import { toAsyncIterableStream } from './async-iterable-stream.ts';
import { parseJsonObjectFromText } from './json-parse.ts';
import { streamText } from './stream-text.ts';
import type {
  StreamObjectOptions,
  StreamObjectResult,
  StreamTextOptions,
  ToolSet,
} from './types.ts';

function buildJsonInstruction(schema: Record<string, unknown>): string {
  return [
    'Respond with strict JSON only.',
    'Do not include markdown fences or extra commentary.',
    `JSON schema: ${JSON.stringify(schema)}`,
  ].join(' ');
}

function withObjectInstruction<T, TOOLS extends ToolSet>(
  options: StreamObjectOptions<T, TOOLS>,
): StreamTextOptions<TOOLS> {
  const instruction = buildJsonInstruction(options.schema);

  if (options.prompt !== undefined) {
    return {
      ...options,
      prompt: `${options.prompt}\n\n${instruction}`,
    };
  }

  const messages = options.messages ?? [];
  return {
    ...options,
    messages,
    system: options.system !== undefined ? `${options.system}\n\n${instruction}` : instruction,
  };
}

export function streamObject<T, TOOLS extends ToolSet>(
  options: StreamObjectOptions<T, TOOLS>,
): StreamObjectResult<T> {
  const result = streamText(withObjectInstruction(options));

  let assembledText = '';
  let lastJsonSnapshot = '';

  const partialObjectStream = toAsyncIterableStream(
    result.fullStream.pipeThrough(
      new TransformStream({
        transform(part, controller) {
          if (part.type !== 'text-delta') {
            return;
          }

          assembledText += part.text;
          const maybeObject = parseJsonObjectFromText(assembledText);
          if (
            maybeObject === undefined ||
            typeof maybeObject !== 'object' ||
            maybeObject === null
          ) {
            return;
          }

          const serialized = JSON.stringify(maybeObject);
          if (serialized === lastJsonSnapshot) {
            return;
          }

          lastJsonSnapshot = serialized;
          controller.enqueue(maybeObject as Partial<T>);
        },
      }),
    ),
  );

  const object = result.text.then((text) => {
    const parsed = parseJsonObjectFromText(text);
    if (parsed === undefined) {
      throw new Error('streamObject failed: no JSON object found in model output');
    }

    if (options.validate !== undefined && !options.validate(parsed)) {
      throw new Error('streamObject failed: parsed JSON did not pass validator');
    }

    return parsed as T;
  });

  return {
    partialObjectStream,
    object,
    text: result.text,
    finishReason: result.finishReason,
  };
}
