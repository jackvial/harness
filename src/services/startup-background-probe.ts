type PerfAttrs = Record<string, boolean | number | string>;

type UsageRefreshReason = 'startup' | 'interval';

type IntervalHandle = ReturnType<typeof setInterval>;
type TimeoutHandle = ReturnType<typeof setTimeout>;

interface StartupBackgroundProbeOptions {
  readonly enabled: boolean;
  readonly maxWaitMs: number;
  readonly isShuttingDown: () => boolean;
  readonly waitForSettled: () => Promise<void>;
  readonly settledObserved: () => boolean;
  readonly refreshProcessUsage: (reason: UsageRefreshReason) => void | Promise<void>;
  readonly recordPerfEvent: (name: string, attrs: PerfAttrs) => void;
  readonly setIntervalFn?: (handler: () => void, ms: number) => IntervalHandle;
  readonly clearIntervalFn?: (handle: IntervalHandle) => void;
  readonly setTimeoutFn?: (handler: () => void, ms: number) => TimeoutHandle;
  readonly clearTimeoutFn?: (handle: TimeoutHandle) => void;
}

export class StartupBackgroundProbeService {
  private readonly setIntervalFn: (handler: () => void, ms: number) => IntervalHandle;
  private readonly clearIntervalFn: (handle: IntervalHandle) => void;
  private readonly setTimeoutFn: (handler: () => void, ms: number) => TimeoutHandle;
  private readonly clearTimeoutFn: (handle: TimeoutHandle) => void;
  private started = false;
  private intervalHandle: IntervalHandle | null = null;

  constructor(private readonly options: StartupBackgroundProbeOptions) {
    this.setIntervalFn = options.setIntervalFn ?? setInterval;
    this.clearIntervalFn = options.clearIntervalFn ?? clearInterval;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  }

  recordWaitPhase(): void {
    this.options.recordPerfEvent('mux.startup.background-probes.wait', {
      maxWaitMs: this.options.maxWaitMs,
      enabled: this.options.enabled ? 1 : 0,
    });
    if (!this.options.enabled) {
      this.options.recordPerfEvent('mux.startup.background-probes.skipped', {
        reason: 'disabled',
      });
    }
  }

  async startWhenSettled(): Promise<void> {
    if (!this.options.enabled) {
      return;
    }
    let timedOut = false;
    let timeoutHandle: TimeoutHandle | null = null;
    await Promise.race([
      this.options.waitForSettled(),
      new Promise<void>((resolve) => {
        timeoutHandle = this.setTimeoutFn(() => {
          timedOut = true;
          resolve();
        }, this.options.maxWaitMs);
      }),
    ]);
    if (timeoutHandle !== null) {
      this.clearTimeoutFn(timeoutHandle);
    }
    this.maybeStart(timedOut);
  }

  stop(): void {
    if (this.intervalHandle !== null) {
      this.clearIntervalFn(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private maybeStart(timedOut: boolean): void {
    if (this.options.isShuttingDown() || this.started || !this.options.enabled) {
      return;
    }
    this.started = true;
    this.options.recordPerfEvent('mux.startup.background-probes.begin', {
      timedOut,
      settledObserved: this.options.settledObserved(),
    });
    void this.options.refreshProcessUsage('startup');
    this.intervalHandle = this.setIntervalFn(() => {
      void this.options.refreshProcessUsage('interval');
    }, 1000);
  }
}
