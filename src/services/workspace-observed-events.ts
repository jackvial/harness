import type { StreamObservedEvent } from '../control-plane/stream-protocol.ts';

interface DirectoryRecordLike {
  readonly directoryId: string;
}

interface ConversationRecordLike {
  readonly conversationId: string;
  readonly directoryId: string;
}

interface WorkspaceObservedApplyResult {
  readonly changed: boolean;
  readonly removedConversationIds: readonly string[];
  readonly removedDirectoryIds: readonly string[];
}

interface WorkspaceObservedEventsOptions<
  TDirectoryRecord extends DirectoryRecordLike,
  TConversationRecord extends ConversationRecordLike,
> {
  readonly parseDirectoryRecord: (value: unknown) => TDirectoryRecord | null;
  readonly parseConversationRecord: (value: unknown) => TConversationRecord | null;
  readonly setDirectory: (directoryId: string, directory: TDirectoryRecord) => void;
  readonly deleteDirectory: (directoryId: string) => boolean;
  readonly deleteDirectoryGitState: (directoryId: string) => void;
  readonly syncGitStateWithDirectories: () => void;
  readonly upsertConversationFromPersistedRecord: (record: TConversationRecord) => void;
  readonly removeConversation: (sessionId: string) => boolean;
  readonly orderedConversationIds: () => readonly string[];
  readonly conversationDirectoryId: (sessionId: string) => string | null;
}

export class WorkspaceObservedEvents<
  TDirectoryRecord extends DirectoryRecordLike,
  TConversationRecord extends ConversationRecordLike,
> {
  constructor(
    private readonly options: WorkspaceObservedEventsOptions<TDirectoryRecord, TConversationRecord>,
  ) {}

  apply(observed: StreamObservedEvent): WorkspaceObservedApplyResult {
    if (observed.type === 'directory-upserted') {
      const directory = this.options.parseDirectoryRecord(observed.directory);
      if (directory === null) {
        return {
          changed: false,
          removedConversationIds: [],
          removedDirectoryIds: [],
        };
      }
      this.options.setDirectory(directory.directoryId, directory);
      this.options.syncGitStateWithDirectories();
      return {
        changed: true,
        removedConversationIds: [],
        removedDirectoryIds: [],
      };
    }

    if (observed.type === 'directory-archived') {
      const removedConversationIds: string[] = [];
      for (const sessionId of this.options.orderedConversationIds()) {
        if (this.options.conversationDirectoryId(sessionId) !== observed.directoryId) {
          continue;
        }
        if (this.options.removeConversation(sessionId)) {
          removedConversationIds.push(sessionId);
        }
      }
      const removedDirectory = this.options.deleteDirectory(observed.directoryId);
      this.options.deleteDirectoryGitState(observed.directoryId);
      this.options.syncGitStateWithDirectories();
      return {
        changed: removedDirectory || removedConversationIds.length > 0,
        removedConversationIds,
        removedDirectoryIds: removedDirectory ? [observed.directoryId] : [],
      };
    }

    if (observed.type === 'conversation-created' || observed.type === 'conversation-updated') {
      const conversation = this.options.parseConversationRecord(observed.conversation);
      if (conversation === null) {
        return {
          changed: false,
          removedConversationIds: [],
          removedDirectoryIds: [],
        };
      }
      this.options.upsertConversationFromPersistedRecord(conversation);
      return {
        changed: true,
        removedConversationIds: [],
        removedDirectoryIds: [],
      };
    }

    if (observed.type === 'conversation-archived' || observed.type === 'conversation-deleted') {
      const removed = this.options.removeConversation(observed.conversationId);
      return {
        changed: removed,
        removedConversationIds: removed ? [observed.conversationId] : [],
        removedDirectoryIds: [],
      };
    }

    return {
      changed: false,
      removedConversationIds: [],
      removedDirectoryIds: [],
    };
  }
}
