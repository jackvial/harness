import { monitorEventLoopDelay } from 'node:perf_hooks';

type PerfAttrs = Record<string, boolean | number | string>;

interface EventLoopDelayMonitorLike {
  enable(): void;
  disable(): void;
  reset(): void;
  percentile(percentile: number): number;
  readonly max: number;
}

interface ControlPlaneQueueMetrics {
  readonly interactiveQueued: number;
  readonly backgroundQueued: number;
  readonly running: boolean;
}

interface OutputLoadPerfStatusRow {
  readonly fps: number;
  readonly kbPerSecond: number;
  readonly renderAvgMs: number;
  readonly renderMaxMs: number;
  readonly outputHandleAvgMs: number;
  readonly outputHandleMaxMs: number;
  readonly eventLoopP95Ms: number;
}

interface OutputLoadSamplerOptions {
  readonly recordPerfEvent: (name: string, attrs: PerfAttrs) => void;
  readonly getControlPlaneQueueMetrics: () => ControlPlaneQueueMetrics;
  readonly getActiveConversationId: () => string | null;
  readonly getPendingPersistedEvents: () => number;
  readonly onStatusRowChanged: () => void;
  readonly nowMs?: () => number;
  readonly sampleIntervalMs?: number;
  readonly setIntervalFn?: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setInterval>;
  readonly clearIntervalFn?: (timer: ReturnType<typeof setInterval>) => void;
  readonly createEventLoopDelayMonitor?: () => EventLoopDelayMonitorLike;
}

const DEFAULT_SAMPLE_INTERVAL_MS = 1000;

function defaultEventLoopDelayMonitor(): EventLoopDelayMonitorLike {
  return monitorEventLoopDelay({
    resolution: 20,
  });
}

export class OutputLoadSampler {
  private readonly nowMs: () => number;
  private readonly sampleIntervalMs: number;
  private readonly setIntervalFn: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setInterval>;
  private readonly clearIntervalFn: (timer: ReturnType<typeof setInterval>) => void;
  private readonly eventLoopDelayMonitor: EventLoopDelayMonitorLike;
  private sampleTimer: ReturnType<typeof setInterval> | null = null;
  private windowStartedAtMs: number;
  private outputActiveBytes = 0;
  private outputInactiveBytes = 0;
  private outputActiveChunks = 0;
  private outputInactiveChunks = 0;
  private outputHandleSampleCount = 0;
  private outputHandleSampleTotalMs = 0;
  private outputHandleSampleMaxMs = 0;
  private renderSampleCount = 0;
  private renderSampleTotalMs = 0;
  private renderSampleMaxMs = 0;
  private renderSampleChangedRows = 0;
  private readonly outputSessionIds = new Set<string>();
  private statusRow: OutputLoadPerfStatusRow = {
    fps: 0,
    kbPerSecond: 0,
    renderAvgMs: 0,
    renderMaxMs: 0,
    outputHandleAvgMs: 0,
    outputHandleMaxMs: 0,
    eventLoopP95Ms: 0,
  };

  constructor(private readonly options: OutputLoadSamplerOptions) {
    this.nowMs = options.nowMs ?? Date.now;
    this.sampleIntervalMs = options.sampleIntervalMs ?? DEFAULT_SAMPLE_INTERVAL_MS;
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
    this.eventLoopDelayMonitor =
      options.createEventLoopDelayMonitor?.() ?? defaultEventLoopDelayMonitor();
    this.windowStartedAtMs = this.nowMs();
  }

  currentStatusRow(): OutputLoadPerfStatusRow {
    return this.statusRow;
  }

  start(): void {
    if (this.sampleTimer !== null) {
      return;
    }
    this.eventLoopDelayMonitor.enable();
    this.sampleTimer = this.setIntervalFn(() => {
      this.sampleNow();
    }, this.sampleIntervalMs);
  }

  stop(): void {
    if (this.sampleTimer === null) {
      return;
    }
    this.clearIntervalFn(this.sampleTimer);
    this.sampleTimer = null;
    this.eventLoopDelayMonitor.disable();
  }

  recordOutputChunk(sessionId: string, bytes: number, activeConversation: boolean): void {
    this.outputSessionIds.add(sessionId);
    if (activeConversation) {
      this.outputActiveBytes += bytes;
      this.outputActiveChunks += 1;
      return;
    }
    this.outputInactiveBytes += bytes;
    this.outputInactiveChunks += 1;
  }

  recordOutputHandled(durationMs: number): void {
    this.outputHandleSampleCount += 1;
    this.outputHandleSampleTotalMs += durationMs;
    if (durationMs > this.outputHandleSampleMaxMs) {
      this.outputHandleSampleMaxMs = durationMs;
    }
  }

  recordRenderSample(durationMs: number, changedRows: number): void {
    this.renderSampleCount += 1;
    this.renderSampleTotalMs += durationMs;
    if (durationMs > this.renderSampleMaxMs) {
      this.renderSampleMaxMs = durationMs;
    }
    this.renderSampleChangedRows += changedRows;
  }

  sampleNow(): void {
    const totalChunks = this.outputActiveChunks + this.outputInactiveChunks;
    const hasRenderSamples = this.renderSampleCount > 0;
    const nowMs = this.nowMs();
    const windowMs = Math.max(1, nowMs - this.windowStartedAtMs);
    const eventLoopP95Ms = Number(this.eventLoopDelayMonitor.percentile(95)) / 1e6;
    const eventLoopMaxMs = Number(this.eventLoopDelayMonitor.max) / 1e6;
    const outputHandleAvgMs =
      this.outputHandleSampleCount === 0
        ? 0
        : this.outputHandleSampleTotalMs / this.outputHandleSampleCount;
    const renderAvgMs =
      this.renderSampleCount === 0 ? 0 : this.renderSampleTotalMs / this.renderSampleCount;
    const nextStatusRow: OutputLoadPerfStatusRow = {
      fps: Number(((this.renderSampleCount * 1000) / windowMs).toFixed(1)),
      kbPerSecond: Number(
        (((this.outputActiveBytes + this.outputInactiveBytes) * 1000) / windowMs / 1024).toFixed(1),
      ),
      renderAvgMs: Number(renderAvgMs.toFixed(2)),
      renderMaxMs: Number(this.renderSampleMaxMs.toFixed(2)),
      outputHandleAvgMs: Number(outputHandleAvgMs.toFixed(2)),
      outputHandleMaxMs: Number(this.outputHandleSampleMaxMs.toFixed(2)),
      eventLoopP95Ms: Number(eventLoopP95Ms.toFixed(1)),
    };
    if (!this.statusRowEqual(this.statusRow, nextStatusRow)) {
      this.statusRow = nextStatusRow;
      this.options.onStatusRowChanged();
    }
    if (totalChunks > 0 || hasRenderSamples) {
      const controlPlaneQueueMetrics = this.options.getControlPlaneQueueMetrics();
      this.options.recordPerfEvent('mux.output-load.sample', {
        windowMs,
        activeChunks: this.outputActiveChunks,
        inactiveChunks: this.outputInactiveChunks,
        activeBytes: this.outputActiveBytes,
        inactiveBytes: this.outputInactiveBytes,
        outputHandleCount: this.outputHandleSampleCount,
        outputHandleAvgMs: Number(outputHandleAvgMs.toFixed(3)),
        outputHandleMaxMs: Number(this.outputHandleSampleMaxMs.toFixed(3)),
        renderCount: this.renderSampleCount,
        renderAvgMs: Number(renderAvgMs.toFixed(3)),
        renderMaxMs: Number(this.renderSampleMaxMs.toFixed(3)),
        renderChangedRows: this.renderSampleChangedRows,
        eventLoopP95Ms: Number(eventLoopP95Ms.toFixed(3)),
        eventLoopMaxMs: Number(eventLoopMaxMs.toFixed(3)),
        activeConversationId: this.options.getActiveConversationId() ?? 'none',
        sessionsWithOutput: this.outputSessionIds.size,
        pendingPersistedEvents: this.options.getPendingPersistedEvents(),
        interactiveQueued: controlPlaneQueueMetrics.interactiveQueued,
        backgroundQueued: controlPlaneQueueMetrics.backgroundQueued,
        controlPlaneOpRunning: controlPlaneQueueMetrics.running ? 1 : 0,
      });
    }
    this.resetWindow(nowMs);
  }

  private resetWindow(nowMs: number): void {
    this.windowStartedAtMs = nowMs;
    this.outputActiveBytes = 0;
    this.outputInactiveBytes = 0;
    this.outputActiveChunks = 0;
    this.outputInactiveChunks = 0;
    this.outputHandleSampleCount = 0;
    this.outputHandleSampleTotalMs = 0;
    this.outputHandleSampleMaxMs = 0;
    this.renderSampleCount = 0;
    this.renderSampleTotalMs = 0;
    this.renderSampleMaxMs = 0;
    this.renderSampleChangedRows = 0;
    this.outputSessionIds.clear();
    this.eventLoopDelayMonitor.reset();
  }

  private statusRowEqual(left: OutputLoadPerfStatusRow, right: OutputLoadPerfStatusRow): boolean {
    return (
      left.fps === right.fps &&
      left.kbPerSecond === right.kbPerSecond &&
      left.renderAvgMs === right.renderAvgMs &&
      left.renderMaxMs === right.renderMaxMs &&
      left.outputHandleAvgMs === right.outputHandleAvgMs &&
      left.outputHandleMaxMs === right.outputHandleMaxMs &&
      left.eventLoopP95Ms === right.eventLoopP95Ms
    );
  }
}
