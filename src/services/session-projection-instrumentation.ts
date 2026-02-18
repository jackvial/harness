import type { ControlPlaneKeyEvent } from '../control-plane/codex-session-stream.ts';
import { buildSelectorIndexEntries } from '../mux/selector-index.ts';
import { compactDebugText, conversationSummary, type ConversationState } from '../mux/live-mux/conversation-state.ts';
import { projectWorkspaceRailConversation } from '../mux/workspace-rail-model.ts';

type PerfAttrs = Record<string, boolean | number | string>;

interface ProcessUsageSample {
  readonly cpuPercent: number | null;
  readonly memoryMb: number | null;
}

interface SelectorIndexDirectory {
  readonly directoryId: string;
}

interface ConversationProjectionSnapshot {
  readonly status: string;
  readonly glyph: string;
  readonly detailText: string;
}

interface SessionProjectionInstrumentationOptions {
  readonly getProcessUsageSample: (sessionId: string) => ProcessUsageSample | undefined;
  readonly recordPerfEvent: (name: string, attrs: PerfAttrs) => void;
  readonly nowMs?: () => number;
}

export class SessionProjectionInstrumentation {
  private readonly selectorIndexBySessionId = new Map<
    string,
    {
      selectorIndex: number;
      directoryIndex: number;
      directoryId: string;
    }
  >();
  private lastSelectorSnapshotHash: string | null = null;
  private selectorSnapshotVersion = 0;
  private readonly nowMs: () => number;

  constructor(private readonly options: SessionProjectionInstrumentationOptions) {
    this.nowMs = options.nowMs ?? Date.now;
  }

  snapshotForConversation(conversation: ConversationState): ConversationProjectionSnapshot {
    const projected = projectWorkspaceRailConversation(
      {
        ...conversationSummary(conversation),
        directoryKey: conversation.directoryId ?? 'directory-missing',
        title: conversation.title,
        agentLabel: conversation.agentType,
        cpuPercent: this.options.getProcessUsageSample(conversation.sessionId)?.cpuPercent ?? null,
        memoryMb: this.options.getProcessUsageSample(conversation.sessionId)?.memoryMb ?? null,
        lastKnownWork: conversation.lastKnownWork,
        lastKnownWorkAt: conversation.lastKnownWorkAt,
        controller: conversation.controller,
      },
      {
        nowMs: this.nowMs(),
      },
    );
    return {
      status: projected.status,
      glyph: projected.glyph,
      detailText: compactDebugText(projected.detailText),
    };
  }

  refreshSelectorSnapshot(
    reason: string,
    directories: ReadonlyMap<string, SelectorIndexDirectory>,
    conversations: ReadonlyMap<string, ConversationState>,
    orderedIds: readonly string[],
  ): void {
    const entries = buildSelectorIndexEntries(directories, conversations, orderedIds);
    const hash = entries
      .map(
        (entry) =>
          `${entry.selectorIndex}:${entry.directoryId}:${entry.sessionId}:${entry.directoryIndex}:${entry.title}:${entry.agentType}`,
      )
      .join('|');
    if (hash === this.lastSelectorSnapshotHash) {
      return;
    }
    this.lastSelectorSnapshotHash = hash;
    this.selectorSnapshotVersion += 1;
    this.selectorIndexBySessionId.clear();
    for (const entry of entries) {
      this.selectorIndexBySessionId.set(entry.sessionId, {
        selectorIndex: entry.selectorIndex,
        directoryIndex: entry.directoryIndex,
        directoryId: entry.directoryId,
      });
    }
    this.options.recordPerfEvent('mux.selector.snapshot', {
      reason: compactDebugText(reason),
      version: this.selectorSnapshotVersion,
      count: entries.length,
    });
    for (const entry of entries) {
      this.options.recordPerfEvent('mux.selector.entry', {
        version: this.selectorSnapshotVersion,
        index: entry.selectorIndex,
        directoryIndex: entry.directoryIndex,
        sessionId: entry.sessionId,
        directoryId: entry.directoryId,
        title: compactDebugText(entry.title),
        agentType: entry.agentType,
      });
    }
  }

  recordTransition(
    event: ControlPlaneKeyEvent,
    before: ConversationProjectionSnapshot | null,
    conversation: ConversationState,
  ): void {
    const after = this.snapshotForConversation(conversation);
    if (this.projectionSnapshotEqual(before, after)) {
      return;
    }
    const selectorEntry = this.selectorIndexBySessionId.get(conversation.sessionId);
    let source = '';
    let eventName = '';
    let summary: string | null = null;
    if (event.type === 'session-telemetry') {
      source = event.keyEvent.source;
      eventName = event.keyEvent.eventName ?? '';
      summary = event.keyEvent.summary;
    } else if (event.type === 'session-status') {
      source = event.telemetry?.source ?? '';
      eventName = event.telemetry?.eventName ?? '';
      summary = event.telemetry?.summary ?? null;
    }
    this.options.recordPerfEvent('mux.session-projection.transition', {
      sessionId: conversation.sessionId,
      eventType: event.type,
      cursor: event.cursor,
      selectorIndex: selectorEntry?.selectorIndex ?? 0,
      directoryIndex: selectorEntry?.directoryIndex ?? 0,
      statusFrom: before?.status ?? '',
      statusTo: after.status,
      glyphFrom: before?.glyph ?? '',
      glyphTo: after.glyph,
      detailFrom: before?.detailText ?? '',
      detailTo: after.detailText,
      source,
      eventName,
      summary: compactDebugText(summary),
    });
  }

  private projectionSnapshotEqual(
    left: ConversationProjectionSnapshot | null,
    right: ConversationProjectionSnapshot,
  ): boolean {
    if (left === null) {
      return false;
    }
    return (
      left.status === right.status &&
      left.glyph === right.glyph &&
      left.detailText === right.detailText
    );
  }
}
