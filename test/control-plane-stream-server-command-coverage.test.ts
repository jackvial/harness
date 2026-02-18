import assert from 'node:assert/strict';
import { test } from 'bun:test';
import { connectControlPlaneStreamClient } from '../src/control-plane/stream-client.ts';
import { startControlPlaneStreamServer } from '../src/control-plane/stream-server.ts';
import { FakeLiveSession } from './control-plane-stream-server-test-helpers.ts';

void test('command module coverage: repository/task query branches and claim conflict paths are exercised', async () => {
  const server = await startControlPlaneStreamServer({
    startSession: (input) => new FakeLiveSession(input),
  });
  const address = server.address();
  const clientA = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });
  const clientB = await connectControlPlaneStreamClient({
    host: address.address,
    port: address.port,
  });

  try {
    const directoryId = 'directory-command-coverage';
    const conversationId = 'conversation-command-coverage';

    await clientA.sendCommand({
      type: 'directory.upsert',
      directoryId,
      tenantId: 'tenant-command-coverage',
      userId: 'user-command-coverage',
      workspaceId: 'workspace-command-coverage',
      path: '/tmp',
    });
    await clientA.sendCommand({
      type: 'conversation.create',
      conversationId,
      directoryId,
      title: 'coverage',
      agentType: 'codex',
      adapterState: {},
    });
    await clientA.sendCommand({
      type: 'pty.start',
      sessionId: conversationId,
      args: ['resume', 'thread-command-coverage'],
      env: { TERM: 'xterm-256color' },
      initialCols: 80,
      initialRows: 24,
    });

    await clientA.sendCommand({
      type: 'session.claim',
      sessionId: conversationId,
      controllerId: 'controller-a',
      controllerType: 'human',
      controllerLabel: 'operator-a',
    });
    await assert.rejects(
      () =>
        clientB.sendCommand({
          type: 'session.claim',
          sessionId: conversationId,
          controllerId: 'controller-b',
          controllerType: 'agent',
        }),
      /session is already claimed by operator-a/,
    );

    const repositoryA = (
      await clientA.sendCommand({
        type: 'repository.upsert',
        repositoryId: 'repository-a',
        tenantId: 'tenant-command-coverage',
        userId: 'user-command-coverage',
        workspaceId: 'workspace-command-coverage',
        name: 'repo-a',
        remoteUrl: 'https://github.com/example/repo-a',
        defaultBranch: 'main',
      })
    )['repository'] as Record<string, unknown>;
    const repositoryB = (
      await clientA.sendCommand({
        type: 'repository.upsert',
        repositoryId: 'repository-b',
        tenantId: 'tenant-command-coverage',
        userId: 'user-command-coverage',
        workspaceId: 'workspace-command-coverage',
        name: 'repo-b',
        remoteUrl: 'https://github.com/example/repo-b',
        defaultBranch: 'main',
      })
    )['repository'] as Record<string, unknown>;
    const repositoryAId = repositoryA['repositoryId'] as string;
    const repositoryBId = repositoryB['repositoryId'] as string;

    const listedRepositories = await clientA.sendCommand({
      type: 'repository.list',
      tenantId: 'tenant-command-coverage',
      userId: 'user-command-coverage',
      workspaceId: 'workspace-command-coverage',
      limit: 1,
    });
    const repositoryRows = listedRepositories['repositories'] as readonly unknown[];
    assert.equal(repositoryRows.length, 1);

    const updatedRepository = await clientA.sendCommand({
      type: 'repository.update',
      repositoryId: repositoryAId,
      metadata: {
        source: 'coverage-test',
      },
    });
    const metadata = (updatedRepository['repository'] as Record<string, unknown>)[
      'metadata'
    ] as Record<string, unknown>;
    assert.equal(metadata['source'], 'coverage-test');

    await assert.rejects(
      () =>
        clientA.sendCommand({
          type: 'repository.update',
          repositoryId: 'repository-missing',
          metadata: {
            source: 'missing',
          },
        }),
      /repository not found/,
    );

    const taskA = (
      await clientA.sendCommand({
        type: 'task.create',
        taskId: 'task-coverage-a',
        tenantId: 'tenant-command-coverage',
        userId: 'user-command-coverage',
        workspaceId: 'workspace-command-coverage',
        repositoryId: repositoryAId,
        title: 'task-a',
        description: '',
      })
    )['task'] as Record<string, unknown>;
    const taskB = (
      await clientA.sendCommand({
        type: 'task.create',
        taskId: 'task-coverage-b',
        tenantId: 'tenant-command-coverage',
        userId: 'user-command-coverage',
        workspaceId: 'workspace-command-coverage',
        repositoryId: repositoryBId,
        title: 'task-b',
        description: '',
      })
    )['task'] as Record<string, unknown>;
    await clientA.sendCommand({
      type: 'task.ready',
      taskId: taskB['taskId'] as string,
    });

    const listedTasks = await clientA.sendCommand({
      type: 'task.list',
      tenantId: 'tenant-command-coverage',
      userId: 'user-command-coverage',
      workspaceId: 'workspace-command-coverage',
      repositoryId: repositoryBId,
      status: 'ready',
      limit: 1,
    });
    const taskRows = listedTasks['tasks'] as readonly Record<string, unknown>[];
    assert.equal(taskRows.length, 1);
    assert.equal(taskRows[0]?.['taskId'], taskB['taskId']);
    assert.notEqual(taskA['taskId'], taskB['taskId']);

    await clientA.sendCommand({
      type: 'repository.archive',
      repositoryId: repositoryAId,
    });
    const internals = server as unknown as {
      gitStatusByDirectoryId: Map<string, unknown>;
    };
    internals.gitStatusByDirectoryId.set(directoryId, {
      summary: {
        branch: 'main',
        changedFiles: 1,
        additions: 1,
        deletions: 0,
      },
      repositorySnapshot: {
        normalizedRemoteUrl: 'https://github.com/example/repo-a',
        commitCount: 10,
        lastCommitAt: '2026-02-17T00:00:00.000Z',
        shortCommitHash: 'abcdef1',
        inferredName: 'repo-a',
        defaultBranch: 'main',
      },
      repositoryId: repositoryAId,
      lastRefreshedAtMs: Date.now(),
      lastRefreshDurationMs: 1,
    });
    const gitStatusResult = await clientA.sendCommand({
      type: 'directory.git-status',
      directoryId,
    });
    const gitStatuses = gitStatusResult['gitStatuses'] as readonly Record<string, unknown>[];
    assert.equal(gitStatuses.length, 1);
    assert.equal(gitStatuses[0]?.['repositoryId'], repositoryAId);
    assert.equal(gitStatuses[0]?.['repository'], null);
  } finally {
    clientA.close();
    clientB.close();
    await server.close();
  }
});
