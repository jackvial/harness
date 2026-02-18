import type { TaskPaneAction } from '../harness-core-ui.ts';

interface TaskRecordActionState {
  readonly taskId: string;
  readonly status: string;
}

interface RunTaskPaneActionOptions {
  action: TaskPaneAction;
  openTaskCreatePrompt: () => void;
  openRepositoryPromptForCreate: () => void;
  selectedRepositoryId: string | null;
  repositoryExists: (repositoryId: string) => boolean;
  setTaskPaneNotice: (notice: string | null) => void;
  markDirty: () => void;
  setTaskPaneSelectionFocus: (focus: 'task' | 'repository') => void;
  openRepositoryPromptForEdit: (repositoryId: string) => void;
  queueArchiveRepository: (repositoryId: string) => void;
  selectedTask: TaskRecordActionState | null;
  openTaskEditPrompt: (taskId: string) => void;
  queueDeleteTask: (taskId: string) => void;
  queueTaskReady: (taskId: string) => void;
  queueTaskDraft: (taskId: string) => void;
  queueTaskComplete: (taskId: string) => void;
  orderedTaskRecords: () => readonly TaskRecordActionState[];
  queueTaskReorderByIds: (orderedTaskIds: readonly string[], label: string) => void;
}

export function runTaskPaneAction(options: RunTaskPaneActionOptions): void {
  if (options.action === 'task.create') {
    options.openTaskCreatePrompt();
    return;
  }
  if (options.action === 'repository.create') {
    options.setTaskPaneNotice(null);
    options.openRepositoryPromptForCreate();
    return;
  }
  if (options.action === 'repository.edit') {
    const selectedRepositoryId = options.selectedRepositoryId;
    if (selectedRepositoryId === null || !options.repositoryExists(selectedRepositoryId)) {
      options.setTaskPaneNotice('select a repository first');
      options.markDirty();
      return;
    }
    options.setTaskPaneSelectionFocus('repository');
    options.setTaskPaneNotice(null);
    options.openRepositoryPromptForEdit(selectedRepositoryId);
    return;
  }
  if (options.action === 'repository.archive') {
    const selectedRepositoryId = options.selectedRepositoryId;
    if (selectedRepositoryId === null || !options.repositoryExists(selectedRepositoryId)) {
      options.setTaskPaneNotice('select a repository first');
      options.markDirty();
      return;
    }
    options.setTaskPaneSelectionFocus('repository');
    options.queueArchiveRepository(selectedRepositoryId);
    return;
  }
  const selected = options.selectedTask;
  if (selected === null) {
    options.setTaskPaneNotice('select a task first');
    options.markDirty();
    return;
  }
  if (options.action === 'task.edit') {
    options.setTaskPaneSelectionFocus('task');
    options.openTaskEditPrompt(selected.taskId);
    return;
  }
  if (options.action === 'task.delete') {
    options.setTaskPaneSelectionFocus('task');
    options.queueDeleteTask(selected.taskId);
    return;
  }
  if (options.action === 'task.ready') {
    options.setTaskPaneSelectionFocus('task');
    options.queueTaskReady(selected.taskId);
    return;
  }
  if (options.action === 'task.draft') {
    options.setTaskPaneSelectionFocus('task');
    options.queueTaskDraft(selected.taskId);
    return;
  }
  if (options.action === 'task.complete') {
    options.setTaskPaneSelectionFocus('task');
    options.queueTaskComplete(selected.taskId);
    return;
  }
  if (options.action === 'task.reorder-up' || options.action === 'task.reorder-down') {
    const activeTasks = options.orderedTaskRecords().filter((task) => task.status !== 'completed');
    const selectedIndex = activeTasks.findIndex((task) => task.taskId === selected.taskId);
    if (selectedIndex < 0) {
      options.setTaskPaneNotice('cannot reorder completed tasks');
      options.markDirty();
      return;
    }
    const swapIndex = options.action === 'task.reorder-up' ? selectedIndex - 1 : selectedIndex + 1;
    if (swapIndex < 0 || swapIndex >= activeTasks.length) {
      return;
    }
    const reordered = [...activeTasks];
    const currentTask = reordered[selectedIndex]!;
    reordered[selectedIndex] = reordered[swapIndex]!;
    reordered[swapIndex] = currentTask;
    options.setTaskPaneSelectionFocus('task');
    options.queueTaskReorderByIds(
      reordered.map((task) => task.taskId),
      options.action === 'task.reorder-up' ? 'tasks-reorder-up' : 'tasks-reorder-down',
    );
  }
}
