interface HandleHomePaneActionClickOptions {
  action: string | null;
  rowIndex: number;
  clearTaskEditClickState: () => void;
  clearRepositoryEditClickState: () => void;
  clearHomePaneDragState: () => void;
  getTaskRepositoryDropdownOpen: () => boolean;
  setTaskRepositoryDropdownOpen: (open: boolean) => void;
  taskIdAtRow: (rowIndex: number) => string | null;
  repositoryIdAtRow: (rowIndex: number) => string | null;
  selectTaskById: (taskId: string) => void;
  selectRepositoryById: (repositoryId: string) => void;
  runTaskPaneAction: (action: 'task.ready' | 'task.draft' | 'task.complete') => void;
  markDirty: () => void;
}

export function handleHomePaneActionClick(options: HandleHomePaneActionClickOptions): boolean {
  if (options.action === null) {
    return false;
  }
  options.clearTaskEditClickState();
  options.clearRepositoryEditClickState();
  options.clearHomePaneDragState();

  if (options.action === 'repository.dropdown.toggle') {
    options.setTaskRepositoryDropdownOpen(!options.getTaskRepositoryDropdownOpen());
  } else if (options.action === 'repository.select') {
    const repositoryId = options.repositoryIdAtRow(options.rowIndex);
    if (repositoryId !== null) {
      options.selectRepositoryById(repositoryId);
    }
  } else if (options.action === 'task.focus') {
    const taskId = options.taskIdAtRow(options.rowIndex);
    if (taskId !== null) {
      options.selectTaskById(taskId);
    }
  } else if (options.action === 'task.status.ready') {
    const taskId = options.taskIdAtRow(options.rowIndex);
    if (taskId !== null) {
      options.selectTaskById(taskId);
      options.runTaskPaneAction('task.ready');
    }
  } else if (options.action === 'task.status.draft') {
    const taskId = options.taskIdAtRow(options.rowIndex);
    if (taskId !== null) {
      options.selectTaskById(taskId);
      options.runTaskPaneAction('task.draft');
    }
  } else if (options.action === 'task.status.complete') {
    const taskId = options.taskIdAtRow(options.rowIndex);
    if (taskId !== null) {
      options.selectTaskById(taskId);
      options.runTaskPaneAction('task.complete');
    }
  }
  options.markDirty();
  return true;
}
