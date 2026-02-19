interface SseEvent {
  readonly event: string;
  readonly data: string;
}

export function parseSseEventBlock(block: string): SseEvent | null {
  const lines = block.split('\n');
  let eventName = 'message';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith(':')) {
      continue;
    }
    if (line.startsWith('event:')) {
      eventName = line.slice('event:'.length).trim() || 'message';
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice('data:'.length).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    event: eventName,
    data: dataLines.join('\n'),
  };
}

export function createSseEventStream(input: ReadableStream<Uint8Array>): ReadableStream<SseEvent> {
  return new ReadableStream<SseEvent>({
    async start(controller) {
      const decoder = new TextDecoder();
      const reader = input.getReader();
      let buffer = '';

      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            break;
          }
          if (value === undefined) {
            continue;
          }

          buffer += decoder.decode(value, { stream: true });
          while (true) {
            const boundary = buffer.indexOf('\n\n');
            if (boundary < 0) {
              break;
            }
            const block = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const parsed = parseSseEventBlock(block);
            if (parsed !== null) {
              controller.enqueue(parsed);
            }
          }
        }

        buffer += decoder.decode();
        const tail = parseSseEventBlock(buffer);
        if (tail !== null) {
          controller.enqueue(tail);
        }

        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock();
      }
    },
  });
}
