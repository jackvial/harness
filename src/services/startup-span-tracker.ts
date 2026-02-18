type SpanAttributes = Record<string, boolean | number | string>;

interface PerfSpanLike {
  end(attrs: SpanAttributes): void;
}

type StartPerfSpanLike = (name: string, attrs: SpanAttributes) => PerfSpanLike;

export class StartupSpanTracker {
  private activeStartCommandSpan: PerfSpanLike | null = null;
  private activeFirstOutputSpan: PerfSpanLike | null = null;
  private activeFirstPaintSpan: PerfSpanLike | null = null;
  private activeSettledSpan: PerfSpanLike | null = null;
  private activeFirstPaintTargetSessionId: string | null = null;

  constructor(
    private readonly startPerfSpan: StartPerfSpanLike,
    private readonly startupSettleQuietMs: number,
  ) {}

  get firstPaintTargetSessionId(): string | null {
    return this.activeFirstPaintTargetSessionId;
  }

  beginForSession(sessionId: string): void {
    this.activeFirstPaintTargetSessionId = sessionId;
    this.activeStartCommandSpan = this.startPerfSpan('mux.startup.active-start-command', {
      sessionId,
    });
    this.activeFirstOutputSpan = this.startPerfSpan('mux.startup.active-first-output', {
      sessionId,
    });
    this.activeFirstPaintSpan = this.startPerfSpan('mux.startup.active-first-visible-paint', {
      sessionId,
    });
    this.activeSettledSpan = this.startPerfSpan('mux.startup.active-settled', {
      sessionId,
      quietMs: this.startupSettleQuietMs,
    });
  }

  clearTargetSession(): void {
    this.activeFirstPaintTargetSessionId = null;
  }

  endStartCommandSpan(attrs: SpanAttributes): void {
    if (this.activeStartCommandSpan === null) {
      return;
    }
    this.activeStartCommandSpan.end(attrs);
    this.activeStartCommandSpan = null;
  }

  endFirstOutputSpan(attrs: SpanAttributes): void {
    if (this.activeFirstOutputSpan === null) {
      return;
    }
    this.activeFirstOutputSpan.end(attrs);
    this.activeFirstOutputSpan = null;
  }

  endFirstPaintSpan(attrs: SpanAttributes): void {
    if (this.activeFirstPaintSpan === null) {
      return;
    }
    this.activeFirstPaintSpan.end(attrs);
    this.activeFirstPaintSpan = null;
  }

  endSettledSpan(attrs: SpanAttributes): void {
    if (this.activeSettledSpan === null) {
      return;
    }
    this.activeSettledSpan.end(attrs);
    this.activeSettledSpan = null;
  }
}
