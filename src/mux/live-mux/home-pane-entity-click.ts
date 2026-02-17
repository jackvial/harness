import { detectEntityDoubleClick } from '../double-click.ts';

interface EntityDoubleClickState {
  readonly entityId: string;
  readonly atMs: number;
}

interface HomePaneDragState {
  readonly kind: 'task' | 'repository';
  readonly itemId: string;
  readonly startedRowIndex: number;
  readonly latestRowIndex: number;
  readonly hasDragged: boolean;
}

interface HandleHomePaneEntityClickOptions {
  rowIndex: number;
  nowMs: number;
  homePaneEditDoubleClickWindowMs: number;
  taskEditClickState: EntityDoubleClickState | null;
  repositoryEditClickState: EntityDoubleClickState | null;
  taskIdAtRow: (rowIndex: number) => string | null;
  repositoryIdAtRow: (rowIndex: number) => string | null;
  selectTaskById: (taskId: string) => void;
  selectRepositoryById: (repositoryId: string) => void;
  clearTaskPaneNotice: () => void;
  setTaskEditClickState: (next: EntityDoubleClickState | null) => void;
  setRepositoryEditClickState: (next: EntityDoubleClickState | null) => void;
  setHomePaneDragState: (next: HomePaneDragState | null) => void;
  openTaskEditPrompt: (taskId: string) => void;
  openRepositoryPromptForEdit: (repositoryId: string) => void;
  markDirty: () => void;
}

export function handleHomePaneEntityClick(options: HandleHomePaneEntityClickOptions): boolean {
  const taskId = options.taskIdAtRow(options.rowIndex);
  if (taskId !== null) {
    const click = detectEntityDoubleClick(
      options.taskEditClickState,
      taskId,
      options.nowMs,
      options.homePaneEditDoubleClickWindowMs,
    );
    options.selectTaskById(taskId);
    options.clearTaskPaneNotice();
    options.setTaskEditClickState(click.nextState);
    options.setRepositoryEditClickState(null);
    if (click.doubleClick) {
      options.setHomePaneDragState(null);
      options.openTaskEditPrompt(taskId);
    } else {
      options.setHomePaneDragState({
        kind: 'task',
        itemId: taskId,
        startedRowIndex: options.rowIndex,
        latestRowIndex: options.rowIndex,
        hasDragged: false,
      });
    }
    options.markDirty();
    return true;
  }

  const repositoryId = options.repositoryIdAtRow(options.rowIndex);
  if (repositoryId !== null) {
    const click = detectEntityDoubleClick(
      options.repositoryEditClickState,
      repositoryId,
      options.nowMs,
      options.homePaneEditDoubleClickWindowMs,
    );
    options.selectRepositoryById(repositoryId);
    options.clearTaskPaneNotice();
    options.setRepositoryEditClickState(click.nextState);
    options.setTaskEditClickState(null);
    if (click.doubleClick) {
      options.setHomePaneDragState(null);
      options.openRepositoryPromptForEdit(repositoryId);
    } else {
      options.setHomePaneDragState({
        kind: 'repository',
        itemId: repositoryId,
        startedRowIndex: options.rowIndex,
        latestRowIndex: options.rowIndex,
        hasDragged: false,
      });
    }
    options.markDirty();
    return true;
  }

  options.setTaskEditClickState(null);
  options.setRepositoryEditClickState(null);
  options.setHomePaneDragState(null);
  return false;
}
