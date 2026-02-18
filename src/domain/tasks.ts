export class TaskManager<
  TTaskRecord extends { taskId: string },
  TTaskComposerBuffer,
  TTaskAutosaveTimer,
> {
  private readonly tasksById = new Map<string, TTaskRecord>();
  private readonly taskComposerByTaskId = new Map<string, TTaskComposerBuffer>();
  private readonly taskAutosaveTimerByTaskId = new Map<string, TTaskAutosaveTimer>();

  constructor() {}

  readonlyTasks(): ReadonlyMap<string, TTaskRecord> {
    return this.tasksById;
  }

  readonlyTaskComposers(): ReadonlyMap<string, TTaskComposerBuffer> {
    return this.taskComposerByTaskId;
  }

  values(): IterableIterator<TTaskRecord> {
    return this.tasksById.values();
  }

  getTask(taskId: string): TTaskRecord | undefined {
    return this.tasksById.get(taskId);
  }

  hasTask(taskId: string): boolean {
    return this.tasksById.has(taskId);
  }

  setTask(task: TTaskRecord): void {
    this.tasksById.set(task.taskId, task);
  }

  deleteTask(taskId: string): boolean {
    return this.tasksById.delete(taskId);
  }

  clearTasks(): void {
    this.tasksById.clear();
  }

  getTaskComposer(taskId: string): TTaskComposerBuffer | undefined {
    return this.taskComposerByTaskId.get(taskId);
  }

  setTaskComposer(taskId: string, buffer: TTaskComposerBuffer): void {
    this.taskComposerByTaskId.set(taskId, buffer);
  }

  deleteTaskComposer(taskId: string): boolean {
    return this.taskComposerByTaskId.delete(taskId);
  }

  clearTaskComposers(): void {
    this.taskComposerByTaskId.clear();
  }

  autosaveTaskIds(): IterableIterator<string> {
    return this.taskAutosaveTimerByTaskId.keys();
  }

  getTaskAutosaveTimer(taskId: string): TTaskAutosaveTimer | undefined {
    return this.taskAutosaveTimerByTaskId.get(taskId);
  }

  setTaskAutosaveTimer(taskId: string, timer: TTaskAutosaveTimer): void {
    this.taskAutosaveTimerByTaskId.set(taskId, timer);
  }

  deleteTaskAutosaveTimer(taskId: string): boolean {
    return this.taskAutosaveTimerByTaskId.delete(taskId);
  }

  clearTaskAutosaveTimers(): void {
    this.taskAutosaveTimerByTaskId.clear();
  }

  orderedTasks(
    sortTasks: (tasks: readonly TTaskRecord[]) => readonly TTaskRecord[],
  ): readonly TTaskRecord[] {
    return sortTasks([...this.tasksById.values()]);
  }

  tasksForRepository(input: {
    repositoryId: string | null;
    sortTasks: (tasks: readonly TTaskRecord[]) => readonly TTaskRecord[];
    taskRepositoryId: (task: TTaskRecord) => string | null;
  }): readonly TTaskRecord[] {
    if (input.repositoryId === null) {
      return [];
    }
    return this.orderedTasks(input.sortTasks).filter(
      (task) => input.taskRepositoryId(task) === input.repositoryId,
    );
  }

  taskReorderPayloadIds(input: {
    orderedActiveTaskIds: readonly string[];
    sortTasks: (tasks: readonly TTaskRecord[]) => readonly TTaskRecord[];
    isCompleted: (task: TTaskRecord) => boolean;
  }): readonly string[] {
    const completedTaskIds = this.orderedTasks(input.sortTasks)
      .filter(input.isCompleted)
      .map((task) => task.taskId);
    return [...input.orderedActiveTaskIds, ...completedTaskIds];
  }

  reorderedActiveTaskIdsForDrop(input: {
    draggedTaskId: string;
    targetTaskId: string;
    sortTasks: (tasks: readonly TTaskRecord[]) => readonly TTaskRecord[];
    isCompleted: (task: TTaskRecord) => boolean;
  }): readonly string[] | 'cannot-reorder-completed' | null {
    const draggedTask = this.tasksById.get(input.draggedTaskId);
    const targetTask = this.tasksById.get(input.targetTaskId);
    if (draggedTask === undefined || targetTask === undefined) {
      return null;
    }
    if (input.isCompleted(draggedTask) || input.isCompleted(targetTask)) {
      return 'cannot-reorder-completed';
    }
    const orderedActiveTaskIds = this.orderedTasks(input.sortTasks)
      .filter((task) => !input.isCompleted(task))
      .map((task) => task.taskId);
    return this.reorderIdsByMove(orderedActiveTaskIds, input.draggedTaskId, input.targetTaskId);
  }

  private reorderIdsByMove(
    orderedIds: readonly string[],
    movedId: string,
    targetId: string,
  ): readonly string[] | null {
    const fromIndex = orderedIds.indexOf(movedId);
    const targetIndex = orderedIds.indexOf(targetId);
    if (fromIndex < 0 || targetIndex < 0 || fromIndex === targetIndex) {
      return null;
    }
    const reordered = [...orderedIds];
    const [moved] = reordered.splice(fromIndex, 1);
    if (moved === undefined) {
      return null;
    }
    reordered.splice(targetIndex, 0, moved);
    return reordered;
  }
}
