import { basename } from 'node:path';
import { padOrTrimDisplay } from './dual-pane-core.ts';
import { buildProjectTreeLines } from './project-tree.ts';
import { wrapTextForColumns } from '../terminal/snapshot-oracle.ts';
import { formatUiButton } from '../ui/kit.ts';

export type ProjectPaneAction = 'conversation.new' | 'project.close';
export type TaskStatus = 'draft' | 'ready' | 'in-progress' | 'completed';
export type TaskPaneAction =
  | 'task.create'
  | 'repository.create'
  | 'repository.edit'
  | 'repository.archive'
  | 'task.edit'
  | 'task.delete'
  | 'task.ready'
  | 'task.draft'
  | 'task.complete'
  | 'task.reorder-up'
  | 'task.reorder-down';

export interface ProjectPaneSnapshot {
  readonly directoryId: string;
  readonly path: string;
  readonly lines: readonly string[];
  readonly actionLineIndexByKind: {
    readonly conversationNew: number;
    readonly projectClose: number;
  };
}

interface ProjectPaneWrappedLine {
  readonly text: string;
  readonly sourceLineIndex: number;
}

export interface TaskPaneRepositoryRecord {
  readonly repositoryId: string;
  readonly name: string;
  readonly remoteUrl?: string;
  readonly defaultBranch?: string;
  readonly archivedAt: string | null;
}

export interface TaskPaneTaskRecord {
  readonly taskId: string;
  readonly repositoryId: string | null;
  readonly title: string;
  readonly description: string;
  readonly status: TaskStatus;
  readonly orderIndex: number;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TaskPaneSnapshotLine {
  readonly text: string;
  readonly taskId: string | null;
  readonly repositoryId: string | null;
  readonly action: TaskPaneAction | null;
}

export interface TaskPaneSnapshot {
  readonly lines: readonly TaskPaneSnapshotLine[];
}

interface TaskPaneWrappedLine {
  readonly text: string;
  readonly taskId: string | null;
  readonly repositoryId: string | null;
  readonly action: TaskPaneAction | null;
}

export interface TaskPaneView {
  readonly rows: readonly string[];
  readonly taskIds: readonly (string | null)[];
  readonly repositoryIds: readonly (string | null)[];
  readonly actions: readonly (TaskPaneAction | null)[];
  readonly top: number;
}

export const PROJECT_PANE_NEW_CONVERSATION_BUTTON_LABEL = formatUiButton({
  label: 'new thread',
  prefixIcon: '+'
});
export const PROJECT_PANE_CLOSE_PROJECT_BUTTON_LABEL = formatUiButton({
  label: 'close project',
  prefixIcon: '<'
});
export const TASKS_PANE_ADD_TASK_BUTTON_LABEL = formatUiButton({
  label: 'add task',
  prefixIcon: '+'
});
export const TASKS_PANE_ADD_REPOSITORY_BUTTON_LABEL = formatUiButton({
  label: 'add repository',
  prefixIcon: '+'
});
export const TASKS_PANE_EDIT_REPOSITORY_BUTTON_LABEL = formatUiButton({
  label: 'edit repository',
  prefixIcon: 'e'
});
export const TASKS_PANE_ARCHIVE_REPOSITORY_BUTTON_LABEL = formatUiButton({
  label: 'archive repository',
  prefixIcon: 'x'
});
export const TASKS_PANE_EDIT_TASK_BUTTON_LABEL = formatUiButton({
  label: 'edit task',
  prefixIcon: 'e'
});
export const TASKS_PANE_DELETE_TASK_BUTTON_LABEL = formatUiButton({
  label: 'delete task',
  prefixIcon: 'x'
});
export const TASKS_PANE_READY_TASK_BUTTON_LABEL = formatUiButton({
  label: 'mark ready',
  prefixIcon: 'r'
});
export const TASKS_PANE_DRAFT_TASK_BUTTON_LABEL = formatUiButton({
  label: 'mark draft',
  prefixIcon: 'd'
});
export const TASKS_PANE_COMPLETE_TASK_BUTTON_LABEL = formatUiButton({
  label: 'mark complete',
  prefixIcon: 'c'
});
export const TASKS_PANE_REORDER_UP_BUTTON_LABEL = formatUiButton({
  label: 'move up',
  prefixIcon: '^'
});
export const TASKS_PANE_REORDER_DOWN_BUTTON_LABEL = formatUiButton({
  label: 'move down',
  prefixIcon: 'v'
});
export const CONVERSATION_EDIT_ARCHIVE_BUTTON_LABEL = formatUiButton({
  label: 'archive thread',
  prefixIcon: 'x'
});
export const NEW_THREAD_MODAL_CODEX_BUTTON = formatUiButton({
  label: 'codex',
  prefixIcon: '◆'
});
export const NEW_THREAD_MODAL_TERMINAL_BUTTON = formatUiButton({
  label: 'terminal',
  prefixIcon: '▣'
});

const GOLDEN_RATIO = (1 + Math.sqrt(5)) / 2;

function parseIsoTimestampMs(value: string | null | undefined): number {
  if (value === null || value === undefined) {
    return Number.NaN;
  }
  return Date.parse(value);
}

function formatRelativeIsoTime(nowMs: number, value: string | null | undefined): string {
  const ts = parseIsoTimestampMs(value);
  if (!Number.isFinite(ts)) {
    return 'unknown';
  }
  const deltaSeconds = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (deltaSeconds < 60) {
    return `${String(deltaSeconds)}s ago`;
  }
  const deltaMinutes = Math.floor(deltaSeconds / 60);
  if (deltaMinutes < 60) {
    return `${String(deltaMinutes)}m ago`;
  }
  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) {
    return `${String(deltaHours)}h ago`;
  }
  const deltaDays = Math.floor(deltaHours / 24);
  return `${String(deltaDays)}d ago`;
}

export function sortedRepositoryList<T extends TaskPaneRepositoryRecord>(
  repositories: ReadonlyMap<string, T>
): readonly T[] {
  return [...repositories.values()]
    .filter((repository) => repository.archivedAt === null)
    .sort((left, right) => {
      const nameCompare = left.name.localeCompare(right.name);
      if (nameCompare !== 0) {
        return nameCompare;
      }
      return left.repositoryId.localeCompare(right.repositoryId);
    });
}

export function sortTasksByOrder<T extends TaskPaneTaskRecord>(tasks: readonly T[]): readonly T[] {
  return [...tasks].sort((left, right) => {
    if (left.orderIndex !== right.orderIndex) {
      return left.orderIndex - right.orderIndex;
    }
    const leftCreatedAt = parseIsoTimestampMs(left.createdAt);
    const rightCreatedAt = parseIsoTimestampMs(right.createdAt);
    if (Number.isFinite(leftCreatedAt) && Number.isFinite(rightCreatedAt) && leftCreatedAt !== rightCreatedAt) {
      return leftCreatedAt - rightCreatedAt;
    }
    return left.taskId.localeCompare(right.taskId);
  });
}

function taskStatusSortRank(status: TaskStatus): number {
  if (status === 'in-progress') {
    return 0;
  }
  if (status === 'ready') {
    return 1;
  }
  if (status === 'draft') {
    return 2;
  }
  return 3;
}

function taskStatusGlyph(status: TaskStatus): string {
  if (status === 'in-progress') {
    return '▶';
  }
  if (status === 'ready') {
    return '◆';
  }
  if (status === 'draft') {
    return '◇';
  }
  return '✓';
}

function repositoryRemoteLabel(remoteUrl: string | undefined): string {
  const normalized = (remoteUrl ?? '').trim();
  if (normalized.length === 0) {
    return '(no remote)';
  }
  const match = /github\.com[/:]([^/\s]+\/[^/\s]+?)(?:\.git)?(?:\/)?$/iu.exec(normalized);
  if (match !== null) {
    return `github.com/${match[1] as string}`;
  }
  return normalized
    .replace(/^https?:\/\//iu, '')
    .replace(/\.git$/iu, '');
}

export function sortTasksForHomePane<T extends TaskPaneTaskRecord>(tasks: readonly T[]): readonly T[] {
  return [...tasks].sort((left, right) => {
    const statusCompare = taskStatusSortRank(left.status) - taskStatusSortRank(right.status);
    if (statusCompare !== 0) {
      return statusCompare;
    }
    if (left.orderIndex !== right.orderIndex) {
      return left.orderIndex - right.orderIndex;
    }
    const leftCreatedAt = parseIsoTimestampMs(left.createdAt);
    const rightCreatedAt = parseIsoTimestampMs(right.createdAt);
    if (Number.isFinite(leftCreatedAt) && Number.isFinite(rightCreatedAt) && leftCreatedAt !== rightCreatedAt) {
      return leftCreatedAt - rightCreatedAt;
    }
    return left.taskId.localeCompare(right.taskId);
  });
}

function buildProjectPaneWrappedLines(snapshot: ProjectPaneSnapshot, cols: number): readonly ProjectPaneWrappedLine[] {
  const safeCols = Math.max(1, cols);
  const wrapped: ProjectPaneWrappedLine[] = [];
  for (let lineIndex = 0; lineIndex < snapshot.lines.length; lineIndex += 1) {
    const line = snapshot.lines[lineIndex]!;
    const segments = wrapTextForColumns(line, safeCols);
    for (const segment of segments) {
      wrapped.push({
        text: segment,
        sourceLineIndex: lineIndex
      });
    }
  }
  if (wrapped.length === 0) {
    wrapped.push({
      text: '',
      sourceLineIndex: -1
    });
  }
  return wrapped;
}

function buildTaskPaneWrappedLines(snapshot: TaskPaneSnapshot, cols: number): readonly TaskPaneWrappedLine[] {
  const safeCols = Math.max(1, cols);
  const wrapped: TaskPaneWrappedLine[] = [];
  for (const line of snapshot.lines) {
    const segments = wrapTextForColumns(line.text, safeCols);
    for (const segment of segments) {
      wrapped.push({
        text: segment,
        taskId: line.taskId,
        repositoryId: line.repositoryId,
        action: line.action
      });
    }
  }
  if (wrapped.length === 0) {
    wrapped.push({
      text: '',
      taskId: null,
      repositoryId: null,
      action: null
    });
  }
  return wrapped;
}

export function resolveGoldenModalSize(
  viewportCols: number,
  viewportRows: number,
  options: {
    readonly preferredHeight: number;
    readonly minWidth: number;
    readonly maxWidth: number;
  }
): { width: number; height: number } {
  const safeViewportCols = Math.max(1, Math.floor(viewportCols));
  const safeViewportRows = Math.max(1, Math.floor(viewportRows));
  const maxHeight = Math.max(1, safeViewportRows - 2);
  const height = Math.max(1, Math.min(Math.floor(options.preferredHeight), maxHeight));
  const maxWidth = Math.max(
    options.minWidth,
    Math.min(Math.floor(options.maxWidth), Math.max(1, safeViewportCols - 2))
  );
  const targetWidth = Math.round(height * GOLDEN_RATIO);
  const width = Math.max(
    Math.floor(options.minWidth),
    Math.min(targetWidth, maxWidth)
  );
  return {
    width,
    height
  };
}

export function buildProjectPaneSnapshot(directoryId: string, path: string): ProjectPaneSnapshot {
  const projectName = basename(path) || path;
  const actionLineIndexByKind = {
    conversationNew: 3,
    projectClose: 4
  } as const;
  return {
    directoryId,
    path,
    lines: [
      `project ${projectName}`,
      `path ${path}`,
      '',
      PROJECT_PANE_NEW_CONVERSATION_BUTTON_LABEL,
      PROJECT_PANE_CLOSE_PROJECT_BUTTON_LABEL,
      '',
      ...buildProjectTreeLines(path)
    ],
    actionLineIndexByKind
  };
}

export function buildProjectPaneRows(
  snapshot: ProjectPaneSnapshot,
  cols: number,
  paneRows: number,
  scrollTop: number
): { rows: readonly string[]; top: number } {
  const safeCols = Math.max(1, cols);
  const safeRows = Math.max(1, paneRows);
  const wrappedLines = buildProjectPaneWrappedLines(snapshot, safeCols);
  const maxTop = Math.max(0, wrappedLines.length - safeRows);
  const nextTop = Math.max(0, Math.min(maxTop, scrollTop));
  const viewport = wrappedLines.slice(nextTop, nextTop + safeRows);
  while (viewport.length < safeRows) {
    viewport.push({
      text: '',
      sourceLineIndex: -1
    });
  }
  return {
    rows: viewport.map((row) => padOrTrimDisplay(row.text, safeCols)),
    top: nextTop
  };
}

export function projectPaneActionAtRow(
  snapshot: ProjectPaneSnapshot,
  cols: number,
  paneRows: number,
  scrollTop: number,
  rowIndex: number
): ProjectPaneAction | null {
  const safeRows = Math.max(1, paneRows);
  const wrappedLines = buildProjectPaneWrappedLines(snapshot, cols);
  const maxTop = Math.max(0, wrappedLines.length - safeRows);
  const nextTop = Math.max(0, Math.min(maxTop, scrollTop));
  const normalizedRow = Math.max(0, Math.min(safeRows - 1, rowIndex));
  const line = wrappedLines[nextTop + normalizedRow]!;
  if (line.sourceLineIndex === snapshot.actionLineIndexByKind.conversationNew) {
    return 'conversation.new';
  }
  if (line.sourceLineIndex === snapshot.actionLineIndexByKind.projectClose) {
    return 'project.close';
  }
  return null;
}

export function buildTaskPaneSnapshot(
  repositories: ReadonlyMap<string, TaskPaneRepositoryRecord>,
  tasks: ReadonlyMap<string, TaskPaneTaskRecord>,
  selectedTaskId: string | null,
  selectedRepositoryId: string | null,
  nowMs: number,
  notice: string | null
): TaskPaneSnapshot {
  const activeRepositories = sortedRepositoryList(repositories);
  const repositoryNameById = new Map<string, string>(
    activeRepositories.map((repository) => [repository.repositoryId, repository.name] as const)
  );
  const orderedTasks = sortTasksForHomePane([...tasks.values()]);
  const activeTasks = orderedTasks.filter((task) => task.status !== 'completed');
  const completedTasks = orderedTasks.filter((task) => task.status === 'completed');
  const effectiveSelectedTaskId =
    (selectedTaskId !== null && tasks.has(selectedTaskId) ? selectedTaskId : null) ??
    activeTasks[0]?.taskId ??
    orderedTasks[0]?.taskId ??
    null;
  const effectiveSelectedRepositoryId =
    (selectedRepositoryId !== null && repositories.has(selectedRepositoryId) ? selectedRepositoryId : null) ??
    activeRepositories[0]?.repositoryId ??
    null;
  const lines: TaskPaneSnapshotLine[] = [];
  const push = (
    text: string,
    taskId: string | null = null,
    repositoryId: string | null = null,
    action: TaskPaneAction | null = null
  ): void => {
    lines.push({
      text,
      taskId,
      repositoryId,
      action
    });
  };

  push('home');
  push(
    `repositories ${String(activeRepositories.length)} · in-progress ${String(
      orderedTasks.filter((task) => task.status === 'in-progress').length
    )} · ready ${String(orderedTasks.filter((task) => task.status === 'ready').length)} · draft ${String(
      orderedTasks.filter((task) => task.status === 'draft').length
    )} · completed ${String(completedTasks.length)}`
  );
  if (notice !== null) {
    push(`notice: ${notice}`);
  }
  push('');
  push('repositories');
  if (activeRepositories.length === 0) {
    push('  no repositories');
  } else {
    for (const repository of activeRepositories) {
      const selected = repository.repositoryId === effectiveSelectedRepositoryId ? '▸' : ' ';
      const repositoryName = repository.name.trim().length === 0 ? '(unnamed repository)' : repository.name.trim();
      const branch = repository.defaultBranch?.trim() ?? '';
      const branchLabel = branch.length === 0 ? 'main' : branch;
      push(
        `${selected} ⎇ ${repositoryName} · ${repositoryRemoteLabel(repository.remoteUrl)} · ${branchLabel}`,
        null,
        repository.repositoryId
      );
    }
  }
  push(TASKS_PANE_ADD_REPOSITORY_BUTTON_LABEL, null, null, 'repository.create');
  push(TASKS_PANE_EDIT_REPOSITORY_BUTTON_LABEL, null, null, 'repository.edit');
  push(TASKS_PANE_ARCHIVE_REPOSITORY_BUTTON_LABEL, null, null, 'repository.archive');
  push('');
  push('tasks');
  if (orderedTasks.length === 0) {
    push('  no tasks');
  } else {
    for (let index = 0; index < orderedTasks.length; index += 1) {
      const task = orderedTasks[index]!;
      const selected = task.taskId === effectiveSelectedTaskId ? '▸' : ' ';
      const repositoryName =
        (task.repositoryId !== null ? repositoryNameById.get(task.repositoryId) : null) ??
        '(missing repository)';
      push(
        `${selected} ${taskStatusGlyph(task.status)} ${task.title}`,
        task.taskId,
        task.repositoryId
      );
      push(
        `    ${repositoryName} · ${task.status} · updated ${formatRelativeIsoTime(nowMs, task.updatedAt)}`,
        task.taskId,
        task.repositoryId
      );
      const description = task.description.trim();
      if (description.length > 0) {
        push(`    ${description}`, task.taskId, task.repositoryId);
      }
      if (index + 1 < orderedTasks.length) {
        push('');
      }
    }
  }
  push('');
  push(TASKS_PANE_ADD_TASK_BUTTON_LABEL, null, null, 'task.create');
  push(TASKS_PANE_EDIT_TASK_BUTTON_LABEL, null, null, 'task.edit');
  push(TASKS_PANE_DELETE_TASK_BUTTON_LABEL, null, null, 'task.delete');
  push(TASKS_PANE_READY_TASK_BUTTON_LABEL, null, null, 'task.ready');
  push(TASKS_PANE_DRAFT_TASK_BUTTON_LABEL, null, null, 'task.draft');
  push(TASKS_PANE_COMPLETE_TASK_BUTTON_LABEL, null, null, 'task.complete');
  push(TASKS_PANE_REORDER_UP_BUTTON_LABEL, null, null, 'task.reorder-up');
  push(TASKS_PANE_REORDER_DOWN_BUTTON_LABEL, null, null, 'task.reorder-down');
  push('');
  push('keys: j/k move  enter edit  n new task  r ready  d draft  c complete');
  push('keys: [ ] reorder  click rows to select and run actions');
  return {
    lines
  };
}

export function buildTaskPaneRows(
  snapshot: TaskPaneSnapshot,
  cols: number,
  paneRows: number,
  scrollTop: number
): TaskPaneView {
  const safeCols = Math.max(1, cols);
  const safeRows = Math.max(1, paneRows);
  const wrappedLines = buildTaskPaneWrappedLines(snapshot, safeCols);
  const maxTop = Math.max(0, wrappedLines.length - safeRows);
  const nextTop = Math.max(0, Math.min(maxTop, scrollTop));
  const viewport = wrappedLines.slice(nextTop, nextTop + safeRows);
  while (viewport.length < safeRows) {
    viewport.push({
      text: '',
      taskId: null,
      repositoryId: null,
      action: null
    });
  }
  return {
    rows: viewport.map((row) => padOrTrimDisplay(row.text, safeCols)),
    taskIds: viewport.map((row) => row.taskId),
    repositoryIds: viewport.map((row) => row.repositoryId),
    actions: viewport.map((row) => row.action),
    top: nextTop
  };
}

export function taskPaneActionAtRow(view: TaskPaneView, rowIndex: number): TaskPaneAction | null {
  const normalizedRow = Math.max(0, Math.min(view.actions.length - 1, rowIndex));
  return view.actions[normalizedRow] ?? null;
}

export function taskPaneTaskIdAtRow(view: TaskPaneView, rowIndex: number): string | null {
  const normalizedRow = Math.max(0, Math.min(view.taskIds.length - 1, rowIndex));
  return view.taskIds[normalizedRow] ?? null;
}

export function taskPaneRepositoryIdAtRow(view: TaskPaneView, rowIndex: number): string | null {
  const normalizedRow = Math.max(0, Math.min(view.repositoryIds.length - 1, rowIndex));
  return view.repositoryIds[normalizedRow] ?? null;
}
