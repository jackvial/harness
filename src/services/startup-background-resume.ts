type PerfAttrs = Record<string, boolean | number | string>;
type TimeoutHandle = ReturnType<typeof setTimeout>;

interface StartupBackgroundResumeOptions {
  readonly enabled: boolean;
  readonly maxWaitMs: number;
  readonly waitForSettled: () => Promise<void>;
  readonly settledObserved: () => boolean;
  readonly queuePersistedConversationsInBackground: (initialActiveId: string | null) => number;
  readonly recordPerfEvent: (name: string, attrs: PerfAttrs) => void;
  readonly setTimeoutFn?: (handler: () => void, ms: number) => TimeoutHandle;
  readonly clearTimeoutFn?: (handle: TimeoutHandle) => void;
}

export class StartupBackgroundResumeService {
  private readonly setTimeoutFn: (handler: () => void, ms: number) => TimeoutHandle;
  private readonly clearTimeoutFn: (handle: TimeoutHandle) => void;

  constructor(private readonly options: StartupBackgroundResumeOptions) {
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  }

  async run(initialActiveId: string | null): Promise<void> {
    const sessionId = initialActiveId ?? 'none';
    this.options.recordPerfEvent('mux.startup.background-start.wait', {
      sessionId,
      maxWaitMs: this.options.maxWaitMs,
      enabled: this.options.enabled ? 1 : 0,
    });
    if (!this.options.enabled) {
      this.options.recordPerfEvent('mux.startup.background-start.skipped', {
        sessionId,
        reason: 'disabled',
      });
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

    this.options.recordPerfEvent('mux.startup.background-start.begin', {
      sessionId,
      timedOut,
      settledObserved: this.options.settledObserved(),
    });
    const queued = this.options.queuePersistedConversationsInBackground(initialActiveId);
    this.options.recordPerfEvent('mux.startup.background-start.queued', {
      sessionId,
      queued,
    });
  }
}
