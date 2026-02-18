import { refreshProcessUsageSnapshots } from '../mux/live-mux/process-usage.ts';

type PerfAttrs = Record<string, boolean | number | string>;

interface PerfSpanLike {
  end(attrs: PerfAttrs): void;
}

type StartPerfSpanLike = (name: string, attrs: PerfAttrs) => PerfSpanLike;

interface RefreshProcessUsageSnapshotsResult {
  readonly samples: number;
  readonly changed: boolean;
}

interface RefreshProcessUsageSnapshotsFn<TConversation, TSample> {
  (options: {
    conversations: ReadonlyMap<string, TConversation>;
    processUsageBySessionId: Map<string, TSample>;
    readProcessUsageSample: (processId: number | null) => Promise<TSample>;
    processIdForConversation: (conversation: TConversation) => number | null;
    processUsageEqual: (left: TSample, right: TSample) => boolean;
  }): Promise<RefreshProcessUsageSnapshotsResult>;
}

interface ProcessUsageRefreshServiceOptions<TConversation, TSample> {
  readonly readProcessUsageSample: (processId: number | null) => Promise<TSample>;
  readonly processIdForConversation: (conversation: TConversation) => number | null;
  readonly processUsageEqual: (left: TSample, right: TSample) => boolean;
  readonly startPerfSpan: StartPerfSpanLike;
  readonly onChanged: () => void;
  readonly refreshSnapshots?: RefreshProcessUsageSnapshotsFn<TConversation, TSample>;
}

export class ProcessUsageRefreshService<TConversation, TSample> {
  private readonly processUsageBySessionId = new Map<string, TSample>();
  private refreshInFlight = false;
  private readonly refreshSnapshots: RefreshProcessUsageSnapshotsFn<TConversation, TSample>;

  constructor(private readonly options: ProcessUsageRefreshServiceOptions<TConversation, TSample>) {
    this.refreshSnapshots = options.refreshSnapshots ?? refreshProcessUsageSnapshots;
  }

  getSample(sessionId: string): TSample | undefined {
    return this.processUsageBySessionId.get(sessionId);
  }

  deleteSession(sessionId: string): void {
    this.processUsageBySessionId.delete(sessionId);
  }

  readonlyUsage(): ReadonlyMap<string, TSample> {
    return this.processUsageBySessionId;
  }

  async refresh(
    reason: 'startup' | 'interval',
    conversations: ReadonlyMap<string, TConversation>,
  ): Promise<void> {
    if (this.refreshInFlight) {
      return;
    }
    this.refreshInFlight = true;
    const usageSpan = this.options.startPerfSpan('mux.background.process-usage', {
      reason,
      conversations: conversations.size,
    });
    try {
      const refreshed = await this.refreshSnapshots({
        conversations,
        processUsageBySessionId: this.processUsageBySessionId,
        readProcessUsageSample: this.options.readProcessUsageSample,
        processIdForConversation: this.options.processIdForConversation,
        processUsageEqual: this.options.processUsageEqual,
      });
      if (refreshed.changed) {
        this.options.onChanged();
      }
      usageSpan.end({
        reason,
        samples: refreshed.samples,
        changed: refreshed.changed,
      });
    } finally {
      this.refreshInFlight = false;
    }
  }
}
