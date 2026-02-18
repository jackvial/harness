import assert from 'node:assert/strict';
import { test } from 'bun:test';
import type { StreamCommand } from '../src/control-plane/stream-protocol.ts';
import { ControlPlaneService } from '../src/services/control-plane.ts';

class MockCommandClient {
  readonly commands: StreamCommand[] = [];
  readonly results: Array<Record<string, unknown>> = [];

  async sendCommand(command: StreamCommand): Promise<Record<string, unknown>> {
    this.commands.push(command);
    const next = this.results.shift();
    if (next === undefined) {
      throw new Error('missing mock result');
    }
    return next;
  }
}

function repositoryRecord(repositoryId = 'repo-1'): Record<string, unknown> {
  return {
    repositoryId,
    tenantId: 'tenant-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
    name: 'Harness',
    remoteUrl: 'https://github.com/acme/harness.git',
    defaultBranch: 'main',
    metadata: {},
    createdAt: '2026-02-18T00:00:00.000Z',
    archivedAt: null,
  };
}

function taskRecord(
  taskId = 'task-1',
  status: 'draft' | 'ready' | 'in-progress' | 'completed' = 'ready',
): Record<string, unknown> {
  return {
    taskId,
    tenantId: 'tenant-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
    repositoryId: 'repo-1',
    title: 'Task',
    description: '',
    status,
    orderIndex: 0,
    claimedByControllerId: null,
    claimedByDirectoryId: null,
    branchName: null,
    baseBranch: null,
    claimedAt: null,
    completedAt: null,
    createdAt: '2026-02-18T00:00:00.000Z',
    updatedAt: '2026-02-18T00:00:00.000Z',
  };
}

void test('control-plane service sends scoped commands and parses repository/task records', async () => {
  const client = new MockCommandClient();
  const service = new ControlPlaneService(client, {
    tenantId: 'tenant-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
  });

  client.results.push(
    { repositories: [repositoryRecord('repo-1')] },
    { tasks: [taskRecord('task-list-default')] },
    { tasks: [taskRecord('task-list-limit')] },
    { task: taskRecord('task-create') },
    { task: taskRecord('task-update') },
    { task: taskRecord('task-ready', 'ready') },
    { task: taskRecord('task-draft', 'draft') },
    { task: taskRecord('task-complete', 'completed') },
    { tasks: [taskRecord('task-reordered')] },
    {},
  );

  assert.equal((await service.listRepositories())[0]?.repositoryId, 'repo-1');
  assert.equal((await service.listTasks())[0]?.taskId, 'task-list-default');
  assert.equal((await service.listTasks(50))[0]?.taskId, 'task-list-limit');
  assert.equal(
    (await service.createTask({
      repositoryId: 'repo-1',
      title: 'Create',
      description: 'desc',
    })).taskId,
    'task-create',
  );
  assert.equal(
    (await service.updateTask({
      taskId: 'task-update',
      repositoryId: 'repo-1',
      title: 'Update',
      description: 'desc',
    })).taskId,
    'task-update',
  );
  assert.equal((await service.taskReady('task-ready')).status, 'ready');
  assert.equal((await service.taskDraft('task-draft')).status, 'draft');
  assert.equal((await service.taskComplete('task-complete')).status, 'completed');
  assert.equal((await service.reorderTasks(['task-a', 'task-b']))[0]?.taskId, 'task-reordered');
  await service.deleteTask('task-delete');

  assert.equal(client.commands[0]?.type, 'repository.list');
  assert.equal(client.commands[1]?.type, 'task.list');
  assert.equal((client.commands[1] as { limit?: number }).limit, 1000);
  assert.equal((client.commands[2] as { limit?: number }).limit, 50);
  assert.equal(client.commands[3]?.type, 'task.create');
  assert.equal(client.commands[4]?.type, 'task.update');
  assert.equal(client.commands[5]?.type, 'task.ready');
  assert.equal(client.commands[6]?.type, 'task.draft');
  assert.equal(client.commands[7]?.type, 'task.complete');
  assert.equal(client.commands[8]?.type, 'task.reorder');
  assert.equal(client.commands[9]?.type, 'task.delete');
});

void test('control-plane service rejects malformed repository and task list payloads', async () => {
  const client = new MockCommandClient();
  const service = new ControlPlaneService(client, {
    tenantId: 'tenant-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
  });

  client.results.push({ repositories: {} });
  await assert.rejects(
    () => service.listRepositories(),
    /control-plane repository\.list returned malformed repositories/,
  );

  client.results.push({ repositories: [{}] });
  await assert.rejects(
    () => service.listRepositories(),
    /control-plane repository\.list returned malformed repository record/,
  );

  client.results.push({ tasks: {} });
  await assert.rejects(
    () => service.listTasks(),
    /control-plane task\.list returned malformed tasks/,
  );

  client.results.push({ tasks: [{}] });
  await assert.rejects(
    () => service.listTasks(),
    /control-plane task\.list returned malformed task record/,
  );
});

void test('control-plane service rejects malformed task record payloads for task actions', async () => {
  const client = new MockCommandClient();
  const service = new ControlPlaneService(client, {
    tenantId: 'tenant-1',
    userId: 'user-1',
    workspaceId: 'workspace-1',
  });

  client.results.push({ task: {} });
  await assert.rejects(
    () =>
      service.createTask({
        repositoryId: 'repo-1',
        title: 'Create',
        description: '',
      }),
    /control-plane task\.create returned malformed task record/,
  );

  client.results.push({ task: {} });
  await assert.rejects(
    () =>
      service.updateTask({
        taskId: 'task-1',
        repositoryId: 'repo-1',
        title: 'Update',
        description: '',
      }),
    /control-plane task\.update returned malformed task record/,
  );

  client.results.push({ task: {} });
  await assert.rejects(
    () => service.taskReady('task-1'),
    /control-plane task\.ready returned malformed task record/,
  );

  client.results.push({ task: {} });
  await assert.rejects(
    () => service.taskDraft('task-1'),
    /control-plane task\.draft returned malformed task record/,
  );

  client.results.push({ task: {} });
  await assert.rejects(
    () => service.taskComplete('task-1'),
    /control-plane task\.complete returned malformed task record/,
  );

  client.results.push({ tasks: {} });
  await assert.rejects(
    () => service.reorderTasks(['task-1']),
    /control-plane task\.reorder returned malformed tasks/,
  );

  client.results.push({ tasks: [{}] });
  await assert.rejects(
    () => service.reorderTasks(['task-1']),
    /control-plane task\.reorder returned malformed task record/,
  );
});
