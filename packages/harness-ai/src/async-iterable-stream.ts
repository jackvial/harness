import type { AsyncIterableStream } from './types.ts';

export function toAsyncIterableStream<T>(stream: ReadableStream<T>): AsyncIterableStream<T> {
  const candidate = stream as AsyncIterableStream<T>;
  if (typeof candidate[Symbol.asyncIterator] === 'function') {
    return candidate;
  }

  Object.defineProperty(candidate, Symbol.asyncIterator, {
    configurable: true,
    enumerable: false,
    writable: false,
    value: async function* iterator(): AsyncGenerator<T, void, unknown> {
      const reader = stream.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          if (value !== undefined) {
            yield value;
          }
        }
      } finally {
        reader.releaseLock();
      }
    },
  });

  return candidate;
}

export async function consumeReadableStream<T>(stream: ReadableStream<T>): Promise<void> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done } = await reader.read();
      if (done) {
        break;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export async function collectReadableStream<T>(stream: ReadableStream<T>): Promise<T[]> {
  const output: T[] = [];
  const reader = stream.getReader();
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
