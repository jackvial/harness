import { randomUUID } from 'node:crypto';
import type { StreamCommand } from '../../control-plane/stream-protocol.ts';

interface ControlPlaneCommandClient {
  sendCommand(command: StreamCommand): Promise<Record<string, unknown>>;
}

interface StreamScope {
  readonly tenantId: string;
  readonly userId: string;
  readonly workspaceId: string;
}

export async function readObservedStreamCursorBaseline(
  streamClient: ControlPlaneCommandClient,
  scope: StreamScope,
): Promise<number | null> {
  const subscribed = await streamClient.sendCommand({
    type: 'stream.subscribe',
    tenantId: scope.tenantId,
    userId: scope.userId,
    workspaceId: scope.workspaceId,
    conversationId: `cursor-probe-${randomUUID()}`,
  });
  const subscriptionId = subscribed['subscriptionId'];
  if (typeof subscriptionId !== 'string' || subscriptionId.length === 0) {
    throw new Error('control-plane stream.subscribe returned malformed subscription id');
  }
  try {
    const cursor = subscribed['cursor'];
    if (typeof cursor !== 'number' || !Number.isInteger(cursor) || cursor < 0) {
      return null;
    }
    return cursor;
  } finally {
    try {
      await streamClient.sendCommand({
        type: 'stream.unsubscribe',
        subscriptionId,
      });
    } catch {
      // Best-effort unsubscribe only.
    }
  }
}

export async function subscribeObservedStream(
  streamClient: ControlPlaneCommandClient,
  scope: StreamScope,
  afterCursor: number | null,
): Promise<string> {
  const command: {
    type: 'stream.subscribe';
    tenantId: string;
    userId: string;
    workspaceId: string;
    afterCursor?: number;
  } = {
    type: 'stream.subscribe',
    tenantId: scope.tenantId,
    userId: scope.userId,
    workspaceId: scope.workspaceId,
  };
  if (afterCursor !== null) {
    command.afterCursor = afterCursor;
  }
  const subscribed = await streamClient.sendCommand(command);
  const subscriptionId = subscribed['subscriptionId'];
  if (typeof subscriptionId !== 'string') {
    throw new Error('control-plane stream.subscribe returned malformed subscription id');
  }
  return subscriptionId;
}

export async function unsubscribeObservedStream(
  streamClient: ControlPlaneCommandClient,
  subscriptionId: string,
): Promise<void> {
  try {
    await streamClient.sendCommand({
      type: 'stream.unsubscribe',
      subscriptionId,
    });
  } catch {
    // Best-effort unsubscribe only.
  }
}
