import { basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CodexAdapter } from '../src/adapters/codex-adapter.ts';
import { CodexStdioTransport } from '../src/adapters/codex-stdio-transport.ts';
import type { NormalizedEventEnvelope } from '../src/events/normalized-events.ts';
import { SqliteEventStore } from '../src/store/event-store.ts';

function asPositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

function writeEvent(event: NormalizedEventEnvelope): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

function completionType(type: string): boolean {
  return (
    type === 'provider-turn-completed' ||
    type === 'provider-turn-failed' ||
    type === 'provider-turn-interrupted' ||
    type === 'meta-attention-raised'
  );
}

async function main(): Promise<number> {
  const prompt = process.argv.slice(2).join(' ').trim();
  if (prompt.length === 0) {
    process.stderr.write('usage: npm run codex:events -- "<prompt>"\n');
    return 2;
  }

  const timeoutMs = asPositiveInteger(process.env.HARNESS_CODEX_TIMEOUT_MS, 120_000);
  const storePath = process.env.HARNESS_EVENTS_DB_PATH ?? '.harness/events.sqlite';
  const conversationId = process.env.HARNESS_CONVERSATION_ID ?? `conversation-${randomUUID()}`;
  const turnId = process.env.HARNESS_TURN_ID ?? `turn-${randomUUID()}`;

  const transport = new CodexStdioTransport({
    onStderr: (chunk: Buffer) => {
      process.stderr.write(chunk);
    }
  });
  const adapter = new CodexAdapter(transport, {
    scopeBase: {
      tenantId: process.env.HARNESS_TENANT_ID ?? 'tenant-local',
      userId: process.env.HARNESS_USER_ID ?? 'user-local',
      workspaceId: process.env.HARNESS_WORKSPACE_ID ?? basename(process.cwd()),
      worktreeId: process.env.HARNESS_WORKTREE_ID ?? 'worktree-local'
    }
  });
  const store = new SqliteEventStore(storePath);

  let settled = false;
  const completionPromise = new Promise<void>((resolve) => {
    const unsubscribe = adapter.onEvent((event) => {
      store.appendEvents([event]);
      writeEvent(event);
      if (completionType(event.type) && !settled) {
        settled = true;
        unsubscribe();
        resolve();
      }
    });
  });

  try {
    const ref = await adapter.startConversation({
      conversationId,
      prompt
    });
    await adapter.sendTurn(ref, {
      turnId,
      message: prompt
    });

    await Promise.race([
      completionPromise,
      new Promise<void>((_, reject) => {
        setTimeout(() => {
          reject(new Error(`timed out waiting for codex events after ${timeoutMs}ms`));
        }, timeoutMs);
      })
    ]);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'codex event stream failed';
    process.stderr.write(`${message}\n`);
    return 1;
  } finally {
    adapter.close();
    store.close();
  }
}

const code = await main();
process.exitCode = code;
