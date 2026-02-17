import { basename, dirname, resolve } from 'node:path';
import { mkdirSync } from 'node:fs';
import {
  openCodexControlPlaneClient,
} from '../src/control-plane/codex-session-stream.ts';
import { startCodexLiveSession } from '../src/codex/live-session.ts';
import { startControlPlaneStreamServer } from '../src/control-plane/stream-server.ts';
import { parseMuxArgs } from '../src/mux/live-mux/args.ts';
import { parseMuxInputChunk } from '../src/mux/dual-pane-core.ts';
import {
  parseConversationRecord,
  parseDirectoryGitStatusRecord,
  parseDirectoryRecord,
  parseRepositoryRecord,
} from '../src/mux/live-mux/control-plane-records.ts';
import { formatErrorMessage } from '../src/mux/live-mux/startup-utils.ts';
import { formatUiButton } from '../src/ui/kit.ts';

interface DirectoryRecord {
  directoryId: string;
  tenantId: string;
  userId: string;
  workspaceId: string;
  path: string;
}

interface ConversationRecord {
  conversationId: string;
  directoryId: string;
  tenantId: string;
  userId: string;
  workspaceId: string;
  title: string;
  runtimeStatus: 'running' | 'needs-input' | 'completed' | 'exited';
}

interface RepositoryRecord {
  repositoryId: string;
  tenantId: string;
  userId: string;
  workspaceId: string;
  name: string;
}

interface GitStatusRecord {
  directoryId: string;
  repositoryId: string | null;
}

type RowAction = 'home.open' | 'shortcuts.toggle' | 'new-thread.open';

interface RenderResult {
  rows: readonly string[];
  rowActions: ReadonlyMap<number, RowAction>;
}

interface RepoGroup {
  id: string;
  name: string;
  directories: DirectoryRecord[];
  activeProjects: number;
}

const ADD_PROJECT_LABEL = formatUiButton({
  label: 'add project',
  prefixIcon: '>',
});
const NEW_THREAD_LABEL = formatUiButton({
  label: 'new thread',
  prefixIcon: '+',
});

const DEFAULT_SCOPE = {
  tenantId: 'tenant-local',
  userId: 'user-local',
  workspaceId: 'workspace-local',
};
const CTRL_C_BYTE = 0x03;

function lineAt(rows: readonly string[], rowOneBased: number): string | null {
  const index = rowOneBased - 1;
  if (index < 0 || index >= rows.length) {
    return null;
  }
  return rows[index] ?? null;
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function buildRepoGroups(
  directories: ReadonlyMap<string, DirectoryRecord>,
  repositories: ReadonlyMap<string, RepositoryRecord>,
  conversations: ReadonlyMap<string, ConversationRecord>,
  gitStatuses: ReadonlyMap<string, GitStatusRecord>,
): readonly RepoGroup[] {
  const groupById = new Map<string, RepoGroup>();

  for (const directory of directories.values()) {
    const status = gitStatuses.get(directory.directoryId);
    const repositoryId = status?.repositoryId ?? null;
    const groupId = repositoryId ?? 'untracked';
    const repositoryName = repositoryId === null ? 'untracked' : repositories.get(repositoryId)?.name ?? 'repository';
    const existing = groupById.get(groupId);
    if (existing !== undefined) {
      existing.directories.push(directory);
      continue;
    }
    groupById.set(groupId, {
      id: groupId,
      name: repositoryName,
      directories: [directory],
      activeProjects: 0,
    });
  }

  for (const group of groupById.values()) {
    let active = 0;
    for (const directory of group.directories) {
      const hasActive = [...conversations.values()].some(
        (conversation) =>
          conversation.directoryId === directory.directoryId &&
          (conversation.runtimeStatus === 'running' || conversation.runtimeStatus === 'needs-input'),
      );
      if (hasActive) {
        active += 1;
      }
    }
    group.activeProjects = active;
  }

  const groups = [...groupById.values()];
  groups.sort((left, right) => {
    if (left.id === 'untracked') {
      return 1;
    }
    if (right.id === 'untracked') {
      return -1;
    }
    return left.name.localeCompare(right.name);
  });
  return groups;
}

function buildRows(
  groups: readonly RepoGroup[],
  conversations: ReadonlyMap<string, ConversationRecord>,
  shortcutsCollapsed: boolean,
  newThreadModalOpen: boolean,
): RenderResult {
  const rows: string[] = [];
  const rowActions = new Map<number, RowAction>();

  rows.push('🏠 home');
  rowActions.set(rows.length, 'home.open');
  rows.push('');

  if (groups.length === 0) {
    rows.push('[+ thread]');
    rowActions.set(rows.length, 'new-thread.open');
    rows.push('no projects');
    rows.push('create one with ctrl+o');
  } else {
    for (const group of groups) {
      rows.push(`${group.name} (${String(group.directories.length)} projects, ${String(group.activeProjects)} ac)`);
      for (const directory of group.directories) {
        rows.push(`  ${basename(directory.path)} [+ thread]`);
        rowActions.set(rows.length, 'new-thread.open');
        const byDirectory = [...conversations.values()].filter(
          (conversation) => conversation.directoryId === directory.directoryId,
        );
        for (const conversation of byDirectory) {
          const title = conversation.title.trim().length > 0 ? conversation.title : 'untitled';
          rows.push(`    ${title}`);
        }
      }
      rows.push('');
    }
  }

  rows.push(ADD_PROJECT_LABEL);
  rows.push(NEW_THREAD_LABEL);
  rows.push(`shortcuts [${shortcutsCollapsed ? '+' : '-'}]`);
  rowActions.set(rows.length, 'shortcuts.toggle');

  if (!shortcutsCollapsed) {
    rows.push('ctrl+t new thread');
    rows.push('ctrl+o add project');
    rows.push('ctrl+c quit mux');
  }

  if (newThreadModalOpen) {
    rows.push('');
    rows.push('New Thread');
  }

  return {
    rows,
    rowActions,
  };
}

async function queryState(client: Awaited<ReturnType<typeof openCodexControlPlaneClient>>['client'], scope: {
  tenantId: string;
  userId: string;
  workspaceId: string;
}): Promise<{
  directories: Map<string, DirectoryRecord>;
  repositories: Map<string, RepositoryRecord>;
  conversations: Map<string, ConversationRecord>;
  gitStatuses: Map<string, GitStatusRecord>;
}> {
  const [directoryResult, repositoryResult, conversationResult, gitStatusResult] = await Promise.all([
    client.sendCommand({
      type: 'directory.list',
      tenantId: scope.tenantId,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
    }),
    client.sendCommand({
      type: 'repository.list',
      tenantId: scope.tenantId,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
    }),
    client.sendCommand({
      type: 'conversation.list',
      tenantId: scope.tenantId,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
    }),
    client.sendCommand({
      type: 'directory.git-status',
      tenantId: scope.tenantId,
      userId: scope.userId,
      workspaceId: scope.workspaceId,
    }),
  ]);

  const directories = new Map<string, DirectoryRecord>();
  for (const raw of asArray(directoryResult['directories'])) {
    const parsed = parseDirectoryRecord(raw);
    if (parsed === null || parsed.archivedAt !== null) {
      continue;
    }
    directories.set(parsed.directoryId, {
      directoryId: parsed.directoryId,
      tenantId: parsed.tenantId,
      userId: parsed.userId,
      workspaceId: parsed.workspaceId,
      path: parsed.path,
    });
  }

  const repositories = new Map<string, RepositoryRecord>();
  for (const raw of asArray(repositoryResult['repositories'])) {
    const parsed = parseRepositoryRecord(raw);
    if (parsed === null || parsed.archivedAt !== null) {
      continue;
    }
    repositories.set(parsed.repositoryId, {
      repositoryId: parsed.repositoryId,
      tenantId: parsed.tenantId,
      userId: parsed.userId,
      workspaceId: parsed.workspaceId,
      name: parsed.name,
    });
  }

  const conversations = new Map<string, ConversationRecord>();
  for (const raw of asArray(conversationResult['conversations'])) {
    const parsed = parseConversationRecord(raw);
    if (parsed === null) {
      continue;
    }
    conversations.set(parsed.conversationId, {
      conversationId: parsed.conversationId,
      directoryId: parsed.directoryId,
      tenantId: parsed.tenantId,
      userId: parsed.userId,
      workspaceId: parsed.workspaceId,
      title: parsed.title,
      runtimeStatus: parsed.runtimeStatus,
    });
  }

  const gitStatuses = new Map<string, GitStatusRecord>();
  for (const raw of asArray(gitStatusResult['gitStatuses'])) {
    const parsed = parseDirectoryGitStatusRecord(raw);
    if (parsed === null) {
      continue;
    }
    gitStatuses.set(parsed.directoryId, {
      directoryId: parsed.directoryId,
      repositoryId: parsed.repositoryId,
    });
  }

  return {
    directories,
    repositories,
    conversations,
    gitStatuses,
  };
}

function renderToTerminal(rows: readonly string[], terminalRows: number): void {
  const normalizedRows = Math.max(1, terminalRows);
  const visible = rows.slice(0, normalizedRows);
  while (visible.length < normalizedRows) {
    visible.push('');
  }
  process.stdout.write('\u001b[H\u001b[2J');
  process.stdout.write(visible.join('\n'));
}

async function main(): Promise<number> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    process.stderr.write('codex:live:mux requires a TTY stdin/stdout\n');
    return 2;
  }

  const options = parseMuxArgs(process.argv.slice(2));
  const scope = {
    tenantId: options.scope.tenantId ?? DEFAULT_SCOPE.tenantId,
    userId: options.scope.userId ?? DEFAULT_SCOPE.userId,
    workspaceId: options.scope.workspaceId ?? DEFAULT_SCOPE.workspaceId,
  };

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdout.write('\u001b[?25l');

  const controlPlane =
    options.controlPlaneHost !== null && options.controlPlanePort !== null
      ? {
          mode: 'remote' as const,
          host: options.controlPlaneHost,
          port: options.controlPlanePort,
          ...(options.controlPlaneAuthToken !== null
            ? {
                authToken: options.controlPlaneAuthToken,
              }
            : {}),
        }
      : {
          mode: 'embedded' as const,
        };

  const controlPlaneClient = await openCodexControlPlaneClient(controlPlane, {
    startEmbeddedServer: async () => {
      const stateStorePath = resolve(
        options.invocationDirectory,
        process.env.HARNESS_CONTROL_PLANE_DB_PATH ?? '.harness/control-plane.sqlite',
      );
      mkdirSync(dirname(stateStorePath), { recursive: true });
      return await startControlPlaneStreamServer({
        stateStorePath,
        startSession: (input) => startCodexLiveSession(input),
      });
    },
  });

  let shortcutsCollapsed = false;
  let newThreadModalOpen = false;
  let lastRows: readonly string[] = [];
  let rowActions: ReadonlyMap<number, RowAction> = new Map();
  let inputRemainder = '';
  let closed = false;
  let refreshTimer: NodeJS.Timeout | null = null;
  let stopPromise: Promise<void> | null = null;

  const renderSnapshot = async (): Promise<void> => {
    const state = await queryState(controlPlaneClient.client, scope);
    const groups = buildRepoGroups(
      state.directories,
      state.repositories,
      state.conversations,
      state.gitStatuses,
    );
    const rendered = buildRows(groups, state.conversations, shortcutsCollapsed, newThreadModalOpen);
    lastRows = rendered.rows;
    rowActions = rendered.rowActions;
    renderToTerminal(rendered.rows, Math.max(24, process.stdout.rows ?? 0));
  };

  const requestStop = (): Promise<void> => {
    if (stopPromise !== null) {
      return stopPromise;
    }
    stopPromise = (async () => {
      if (closed) {
        return;
      }
      closed = true;
      if (refreshTimer !== null) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
      process.stdin.off('data', onInput);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\u001b[?25h\u001b[0m');
      try {
        await controlPlaneClient.close();
      } catch {
        // Best-effort close on shutdown.
      }
    })();
    return stopPromise;
  };

  const onInput = (chunk: Buffer): void => {
    if (chunk.includes(CTRL_C_BYTE)) {
      void requestStop();
      return;
    }
    const parsed = parseMuxInputChunk(inputRemainder, chunk);
    inputRemainder = parsed.remainder;
    for (const token of parsed.tokens) {
      if (token.kind === 'passthrough') {
        if (token.text.includes('\u0003')) {
          void requestStop();
          return;
        }
        continue;
      }
      const { event } = token;
      if (event.final !== 'M' || event.code !== 0) {
        continue;
      }
      const clickedLine = lineAt(lastRows, event.row);
      if (clickedLine === null) {
        continue;
      }
      const action = rowActions.get(event.row);
      if (action === 'shortcuts.toggle' || clickedLine.includes('shortcuts [')) {
        shortcutsCollapsed = !shortcutsCollapsed;
        void renderSnapshot();
        continue;
      }
      if (action === 'new-thread.open' || clickedLine.includes('[+ thread]')) {
        newThreadModalOpen = true;
        void renderSnapshot();
        continue;
      }
      if (action === 'home.open' || clickedLine.includes('🏠 home')) {
        newThreadModalOpen = false;
        void renderSnapshot();
      }
    }
  };

  process.stdin.on('data', onInput);
  process.once('SIGINT', () => {
    void requestStop();
  });
  process.once('SIGTERM', () => {
    void requestStop();
  });

  await renderSnapshot();
  refreshTimer = setInterval(() => {
    void renderSnapshot();
  }, 250);
  refreshTimer.unref();

  while (!closed) {
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  if (stopPromise !== null) {
    await stopPromise;
  }
  return 0;
}

try {
  const code = await main();
  process.exitCode = code;
} catch (error) {
  process.stderr.write(`codex:live:mux fatal error: ${formatErrorMessage(error)}\n`);
  process.exitCode = 1;
}
