import {
  addDirectoryByPath as addDirectoryByPathFn,
  archiveConversation as archiveConversationFn,
  closeDirectory as closeDirectoryFn,
} from '../mux/live-mux/actions-conversation.ts';

interface RuntimeConversationStateLike {
  readonly directoryId: string | null;
  readonly live: boolean;
}

interface RuntimeDirectoryRecordLike {
  readonly directoryId: string;
}

interface RuntimeDirectoryActionService<TDirectoryRecord extends RuntimeDirectoryRecordLike> {
  closePtySession(sessionId: string): Promise<unknown>;
  removeSession(sessionId: string): Promise<unknown>;
  archiveConversation(sessionId: string): Promise<unknown>;
  upsertDirectory(input: { directoryId: string; path: string }): Promise<TDirectoryRecord | null>;
  archiveDirectory(directoryId: string): Promise<unknown>;
}

interface RuntimeDirectoryActionsOptions<
  TDirectoryRecord extends RuntimeDirectoryRecordLike,
  TConversationState extends RuntimeConversationStateLike,
> {
  readonly controlPlaneService: RuntimeDirectoryActionService<TDirectoryRecord>;
  readonly conversations: () => ReadonlyMap<string, TConversationState>;
  readonly orderedConversationIds: () => readonly string[];
  readonly conversationDirectoryId: (sessionId: string) => string | null;
  readonly conversationLive: (sessionId: string) => boolean;
  readonly removeConversationState: (sessionId: string) => void;
  readonly unsubscribeConversationEvents: (sessionId: string) => Promise<void>;
  readonly activeConversationId: () => string | null;
  readonly setActiveConversationId: (sessionId: string | null) => void;
  readonly activateConversation: (sessionId: string) => Promise<unknown>;
  readonly resolveActiveDirectoryId: () => string | null;
  readonly enterProjectPane: (directoryId: string) => void;
  readonly markDirty: () => void;
  readonly isSessionNotFoundError: (error: unknown) => boolean;
  readonly isConversationNotFoundError: (error: unknown) => boolean;
  readonly createDirectoryId: () => string;
  readonly resolveWorkspacePathForMux: (rawPath: string) => string;
  readonly setDirectory: (directory: TDirectoryRecord) => void;
  readonly directoryIdOf: (directory: TDirectoryRecord) => string;
  readonly setActiveDirectoryId: (directoryId: string | null) => void;
  readonly syncGitStateWithDirectories: () => void;
  readonly noteGitActivity: (directoryId: string) => void;
  readonly hydratePersistedConversationsForDirectory: (directoryId: string) => Promise<unknown>;
  readonly findConversationIdByDirectory: (directoryId: string) => string | null;
  readonly directoriesHas: (directoryId: string) => boolean;
  readonly deleteDirectory: (directoryId: string) => void;
  readonly deleteDirectoryGitState: (directoryId: string) => void;
  readonly projectPaneSnapshotDirectoryId: () => string | null;
  readonly clearProjectPaneSnapshot: () => void;
  readonly directoriesSize: () => number;
  readonly invocationDirectory: string;
  readonly activeDirectoryId: () => string | null;
  readonly firstDirectoryId: () => string | null;
}

export class RuntimeDirectoryActions<
  TDirectoryRecord extends RuntimeDirectoryRecordLike,
  TConversationState extends RuntimeConversationStateLike,
> {
  constructor(
    private readonly options: RuntimeDirectoryActionsOptions<TDirectoryRecord, TConversationState>,
  ) {}

  async archiveConversation(sessionId: string): Promise<void> {
    await archiveConversationFn({
      sessionId,
      conversations: this.options.conversations(),
      closePtySession: async (targetSessionId) => {
        await this.options.controlPlaneService.closePtySession(targetSessionId);
      },
      removeSession: async (targetSessionId) => {
        await this.options.controlPlaneService.removeSession(targetSessionId);
      },
      isSessionNotFoundError: this.options.isSessionNotFoundError,
      archiveConversationRecord: async (targetSessionId) => {
        await this.options.controlPlaneService.archiveConversation(targetSessionId);
      },
      isConversationNotFoundError: this.options.isConversationNotFoundError,
      unsubscribeConversationEvents: this.options.unsubscribeConversationEvents,
      removeConversationState: this.options.removeConversationState,
      activeConversationId: this.options.activeConversationId(),
      setActiveConversationId: this.options.setActiveConversationId,
      orderedConversationIds: this.options.orderedConversationIds,
      conversationDirectoryId: this.options.conversationDirectoryId,
      resolveActiveDirectoryId: this.options.resolveActiveDirectoryId,
      enterProjectPane: this.options.enterProjectPane,
      activateConversation: this.options.activateConversation,
      markDirty: this.options.markDirty,
    });
  }

  async addDirectoryByPath(rawPath: string): Promise<void> {
    await addDirectoryByPathFn({
      rawPath,
      resolveWorkspacePathForMux: this.options.resolveWorkspacePathForMux,
      upsertDirectory: async (path) => {
        return await this.options.controlPlaneService.upsertDirectory({
          directoryId: this.options.createDirectoryId(),
          path,
        });
      },
      setDirectory: this.options.setDirectory,
      directoryIdOf: this.options.directoryIdOf,
      setActiveDirectoryId: (directoryId) => {
        this.options.setActiveDirectoryId(directoryId);
      },
      syncGitStateWithDirectories: this.options.syncGitStateWithDirectories,
      noteGitActivity: this.options.noteGitActivity,
      hydratePersistedConversationsForDirectory:
        this.options.hydratePersistedConversationsForDirectory,
      findConversationIdByDirectory: this.options.findConversationIdByDirectory,
      activateConversation: this.options.activateConversation,
      enterProjectPane: this.options.enterProjectPane,
      markDirty: this.options.markDirty,
    });
  }

  async closeDirectory(directoryId: string): Promise<void> {
    await closeDirectoryFn({
      directoryId,
      directoriesHas: this.options.directoriesHas,
      orderedConversationIds: this.options.orderedConversationIds,
      conversationDirectoryId: this.options.conversationDirectoryId,
      conversationLive: this.options.conversationLive,
      closePtySession: async (sessionId) => {
        await this.options.controlPlaneService.closePtySession(sessionId);
      },
      archiveConversationRecord: async (sessionId) => {
        await this.options.controlPlaneService.archiveConversation(sessionId);
      },
      unsubscribeConversationEvents: this.options.unsubscribeConversationEvents,
      removeConversationState: this.options.removeConversationState,
      activeConversationId: this.options.activeConversationId(),
      setActiveConversationId: this.options.setActiveConversationId,
      archiveDirectory: async (targetDirectoryId) => {
        await this.options.controlPlaneService.archiveDirectory(targetDirectoryId);
      },
      deleteDirectory: this.options.deleteDirectory,
      deleteDirectoryGitState: this.options.deleteDirectoryGitState,
      projectPaneSnapshotDirectoryId: this.options.projectPaneSnapshotDirectoryId(),
      clearProjectPaneSnapshot: this.options.clearProjectPaneSnapshot,
      directoriesSize: this.options.directoriesSize,
      addDirectoryByPath: async (path) => {
        await this.addDirectoryByPath(path);
      },
      invocationDirectory: this.options.invocationDirectory,
      activeDirectoryId: this.options.activeDirectoryId(),
      setActiveDirectoryId: this.options.setActiveDirectoryId,
      firstDirectoryId: this.options.firstDirectoryId,
      noteGitActivity: this.options.noteGitActivity,
      resolveActiveDirectoryId: this.options.resolveActiveDirectoryId,
      activateConversation: this.options.activateConversation,
      enterProjectPane: this.options.enterProjectPane,
      markDirty: this.options.markDirty,
    });
  }
}
