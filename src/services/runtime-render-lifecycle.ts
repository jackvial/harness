interface ScreenLike {
  clearDirty(): void;
  isDirty(): boolean;
  markDirty(): void;
}

interface RuntimeRenderLifecycleOptions {
  readonly screen: ScreenLike;
  readonly render: () => void;
  readonly isShuttingDown: () => boolean;
  readonly setShuttingDown: (next: boolean) => void;
  readonly setStop: (next: boolean) => void;
  readonly restoreTerminalState: () => void;
  readonly formatErrorMessage: (error: unknown) => string;
  readonly writeStderr: (text: string) => void;
  readonly exitProcess: (code: number) => void;
  readonly setImmediateFn?: (callback: () => void) => void;
  readonly setTimeoutFn?: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  readonly clearTimeoutFn?: (timer: ReturnType<typeof setTimeout>) => void;
}

const FATAL_EXIT_DELAY_MS = 1200;

export class RuntimeRenderLifecycle {
  private readonly setImmediateFn: (callback: () => void) => void;
  private readonly setTimeoutFn: (
    callback: () => void,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  private readonly clearTimeoutFn: (timer: ReturnType<typeof setTimeout>) => void;
  private renderScheduled = false;
  private runtimeFatal: { origin: string; error: unknown } | null = null;
  private runtimeFatalExitTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: RuntimeRenderLifecycleOptions) {
    this.setImmediateFn = options.setImmediateFn ?? setImmediate;
    this.setTimeoutFn = options.setTimeoutFn ?? setTimeout;
    this.clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;
  }

  hasFatal(): boolean {
    return this.runtimeFatal !== null;
  }

  clearRenderScheduled(): void {
    this.renderScheduled = false;
  }

  clearRuntimeFatalExitTimer(): void {
    if (this.runtimeFatalExitTimer === null) {
      return;
    }
    this.clearTimeoutFn(this.runtimeFatalExitTimer);
    this.runtimeFatalExitTimer = null;
  }

  markDirty(): void {
    if (this.options.isShuttingDown()) {
      return;
    }
    this.options.screen.markDirty();
    this.scheduleRender();
  }

  scheduleRender(): void {
    if (this.options.isShuttingDown() || this.renderScheduled) {
      return;
    }
    this.renderScheduled = true;
    this.setImmediateFn(() => {
      this.renderScheduled = false;
      try {
        this.options.render();
        if (this.options.screen.isDirty()) {
          this.scheduleRender();
        }
      } catch (error: unknown) {
        this.handleRuntimeFatal('render', error);
      }
    });
  }

  handleRuntimeFatal(origin: string, error: unknown): void {
    if (this.runtimeFatal !== null) {
      return;
    }
    this.runtimeFatal = {
      origin,
      error,
    };
    this.options.setShuttingDown(true);
    this.options.setStop(true);
    this.options.screen.clearDirty();
    this.options.writeStderr(
      `[mux] fatal runtime error (${origin}): ${this.options.formatErrorMessage(error)}\n`,
    );
    this.options.restoreTerminalState();
    this.runtimeFatalExitTimer = this.setTimeoutFn(() => {
      this.options.writeStderr('[mux] fatal runtime error forced exit\n');
      this.options.exitProcess(1);
    }, FATAL_EXIT_DELAY_MS);
    this.runtimeFatalExitTimer.unref?.();
  }
}
