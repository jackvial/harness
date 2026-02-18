import type { WorkspaceModel } from '../domain/workspace.ts';

interface TaskRecordShape {
  readonly taskId: string;
}

interface RuntimeTaskEditorActionService<TTaskRecord extends TaskRecordShape> {
  createTask(input: {
    repositoryId: string;
    title: string;
    description: string;
  }): Promise<TTaskRecord>;
  updateTask(input: {
    taskId: string;
    repositoryId: string;
    title: string;
    description: string;
  }): Promise<TTaskRecord>;
}

export interface RuntimeTaskEditorSubmitPayload {
  readonly mode: 'create' | 'edit';
  readonly taskId: string | null;
  readonly repositoryId: string;
  readonly title: string;
  readonly description: string;
  readonly commandLabel: string;
}

interface RuntimeTaskEditorActionsOptions<TTaskRecord extends TaskRecordShape> {
  readonly workspace: WorkspaceModel;
  readonly controlPlaneService: RuntimeTaskEditorActionService<TTaskRecord>;
  readonly applyTaskRecord: (task: TTaskRecord) => void;
  readonly queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  readonly markDirty: () => void;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class RuntimeTaskEditorActions<TTaskRecord extends TaskRecordShape> {
  constructor(private readonly options: RuntimeTaskEditorActionsOptions<TTaskRecord>) {}

  submitTaskEditorPayload(payload: RuntimeTaskEditorSubmitPayload): void {
    this.options.queueControlPlaneOp(async () => {
      try {
        if (payload.mode === 'create') {
          this.options.applyTaskRecord(
            await this.options.controlPlaneService.createTask({
              repositoryId: payload.repositoryId,
              title: payload.title,
              description: payload.description,
            }),
          );
        } else {
          if (payload.taskId === null) {
            throw new Error('task edit state missing task id');
          }
          this.options.applyTaskRecord(
            await this.options.controlPlaneService.updateTask({
              taskId: payload.taskId,
              repositoryId: payload.repositoryId,
              title: payload.title,
              description: payload.description,
            }),
          );
        }
        this.options.workspace.taskEditorPrompt = null;
        this.options.workspace.taskPaneNotice = null;
      } catch (error: unknown) {
        const message = formatErrorMessage(error);
        if (this.options.workspace.taskEditorPrompt !== null) {
          this.options.workspace.taskEditorPrompt.error = message;
        } else {
          this.options.workspace.taskPaneNotice = message;
        }
      } finally {
        this.options.markDirty();
      }
    }, payload.commandLabel);
  }
}
