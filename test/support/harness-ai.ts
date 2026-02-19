import { TextEncoder } from 'node:util';

const encoder = new TextEncoder();

export function createByteStream(chunks: string[]): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

export function createAnthropicSseStream(events: unknown[]): ReadableStream<Uint8Array> {
  const chunks = events.map((event) => `data: ${JSON.stringify(event)}\n\n`);
  return createByteStream(chunks);
}

export function createAnthropicResponse(events: unknown[]): Response {
  return new Response(createAnthropicSseStream(events), {
    status: 200,
    headers: {
      'content-type': 'text/event-stream',
    },
  });
}

export function createErrorResponse(status: number, body: string): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

export async function collectStream<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader();
  const output: T[] = [];
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (value !== undefined) {
        output.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }
  return output;
}

export async function collectTextStream(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const output: string[] = [];
  const decoder = new TextDecoder();
  const reader = stream.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        break;
      }
      if (value !== undefined) {
        output.push(decoder.decode(value, { stream: true }));
      }
    }
    const remainder = decoder.decode();
    if (remainder.length > 0) {
      output.push(remainder);
    }
  } finally {
    reader.releaseLock();
  }
  return output;
}
