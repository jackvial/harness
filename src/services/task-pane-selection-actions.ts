import type { WorkspaceModel } from '../domain/workspace.ts';

interface TaskRecordLike {
  readonly taskId: string;
  readonly repositoryId: string | null;
}

interface RepositoryRecordLike {
  readonly archivedAt: string | null;
}

interface TaskPaneSelectionActionsOptions<TTaskRecord extends TaskRecordLike> {
  readonly workspace: WorkspaceModel;
  readonly taskRecordById: (taskId: string) => TTaskRecord | undefined;
  readonly hasTask: (taskId: string) => boolean;
  readonly hasRepository: (repositoryId: string) => boolean;
  readonly repositoryById: (repositoryId: string) => RepositoryRecordLike | undefined;
  readonly selectedRepositoryTasks: () => readonly TTaskRecord[];
  readonly activeRepositoryIds: () => readonly string[];
  readonly flushTaskComposerPersist: (taskId: string) => void;
  readonly markDirty: () => void;
}

export class TaskPaneSelectionActions<TTaskRecord extends TaskRecordLike> {
  constructor(private readonly options: TaskPaneSelectionActionsOptions<TTaskRecord>) {}

  syncTaskPaneSelectionFocus(): void {
    const hasTaskSelection =
      this.options.workspace.taskPaneSelectedTaskId !== null &&
      this.options.hasTask(this.options.workspace.taskPaneSelectedTaskId);
    const hasRepositorySelection =
      this.options.workspace.taskPaneSelectedRepositoryId !== null &&
      this.options.hasRepository(this.options.workspace.taskPaneSelectedRepositoryId);
    if (this.options.workspace.taskPaneSelectionFocus === 'task' && hasTaskSelection) {
      return;
    }
    if (this.options.workspace.taskPaneSelectionFocus === 'repository' && hasRepositorySelection) {
      return;
    }
    if (hasTaskSelection) {
      this.options.workspace.taskPaneSelectionFocus = 'task';
      return;
    }
    if (hasRepositorySelection) {
      this.options.workspace.taskPaneSelectionFocus = 'repository';
      return;
    }
    this.options.workspace.taskPaneSelectionFocus = 'task';
  }

  syncTaskPaneSelection(): void {
    const scopedTaskIds = new Set(this.options.selectedRepositoryTasks().map((task) => task.taskId));
    if (
      this.options.workspace.taskPaneSelectedTaskId !== null &&
      !scopedTaskIds.has(this.options.workspace.taskPaneSelectedTaskId)
    ) {
      this.options.workspace.taskPaneSelectedTaskId = null;
    }
    if (this.options.workspace.taskPaneSelectedTaskId === null) {
      const scopedTasks = this.options.selectedRepositoryTasks();
      this.options.workspace.taskPaneSelectedTaskId = scopedTasks[0]?.taskId ?? null;
    }
    this.syncTaskPaneSelectionFocus();
    if (
      this.options.workspace.taskEditorTarget.kind === 'task' &&
      !scopedTaskIds.has(this.options.workspace.taskEditorTarget.taskId)
    ) {
      this.focusDraftComposer();
    }
  }

  syncTaskPaneRepositorySelection(): void {
    if (this.options.workspace.taskPaneSelectedRepositoryId !== null) {
      const selectedRepository = this.options.repositoryById(
        this.options.workspace.taskPaneSelectedRepositoryId,
      );
      if (selectedRepository === undefined || selectedRepository.archivedAt !== null) {
        this.options.workspace.taskPaneSelectedRepositoryId = null;
      }
    }
    if (this.options.workspace.taskPaneSelectedRepositoryId === null) {
      this.options.workspace.taskPaneSelectedRepositoryId = this.options.activeRepositoryIds()[0] ?? null;
    }
    this.options.workspace.taskRepositoryDropdownOpen = false;
    this.syncTaskPaneSelectionFocus();
    this.syncTaskPaneSelection();
  }

  focusDraftComposer(): void {
    if (this.options.workspace.taskEditorTarget.kind === 'task') {
      this.options.flushTaskComposerPersist(this.options.workspace.taskEditorTarget.taskId);
    }
    this.options.workspace.taskEditorTarget = {
      kind: 'draft',
    };
    this.options.workspace.taskPaneSelectionFocus = 'task';
    this.options.markDirty();
  }

  focusTaskComposer(taskId: string): void {
    if (!this.options.hasTask(taskId)) {
      return;
    }
    if (
      this.options.workspace.taskEditorTarget.kind === 'task' &&
      this.options.workspace.taskEditorTarget.taskId !== taskId
    ) {
      this.options.flushTaskComposerPersist(this.options.workspace.taskEditorTarget.taskId);
    }
    this.options.workspace.taskEditorTarget = {
      kind: 'task',
      taskId,
    };
    this.options.workspace.taskPaneSelectedTaskId = taskId;
    this.options.workspace.taskPaneSelectionFocus = 'task';
    this.options.workspace.taskPaneNotice = null;
    this.options.markDirty();
  }

  selectTaskById(taskId: string): void {
    const taskRecord = this.options.taskRecordById(taskId);
    if (taskRecord === undefined) {
      return;
    }
    this.options.workspace.taskPaneSelectedTaskId = taskId;
    this.options.workspace.taskPaneSelectionFocus = 'task';
    if (
      taskRecord.repositoryId !== null &&
      this.options.hasRepository(taskRecord.repositoryId)
    ) {
      this.options.workspace.taskPaneSelectedRepositoryId = taskRecord.repositoryId;
    }
    this.focusTaskComposer(taskId);
  }

  selectRepositoryById(repositoryId: string): void {
    if (!this.options.hasRepository(repositoryId)) {
      return;
    }
    if (this.options.workspace.taskEditorTarget.kind === 'task') {
      this.options.flushTaskComposerPersist(this.options.workspace.taskEditorTarget.taskId);
    }
    this.options.workspace.taskPaneSelectedRepositoryId = repositoryId;
    this.options.workspace.taskRepositoryDropdownOpen = false;
    this.options.workspace.taskPaneSelectionFocus = 'repository';
    this.options.workspace.taskEditorTarget = {
      kind: 'draft',
    };
    this.syncTaskPaneSelection();
    this.options.workspace.taskPaneNotice = null;
    this.options.markDirty();
  }
}
