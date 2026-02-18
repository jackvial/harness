interface DebugFooterNoticeOptions {
  readonly ttlMs: number;
  readonly nowMs?: () => number;
}

export class DebugFooterNotice {
  private readonly nowMs: () => number;
  private currentNotice: {
    text: string;
    expiresAtMs: number;
  } | null = null;

  constructor(private readonly options: DebugFooterNoticeOptions) {
    this.nowMs = options.nowMs ?? Date.now;
  }

  set(text: string): void {
    const normalized = text.trim();
    if (normalized.length === 0) {
      this.currentNotice = null;
      return;
    }
    this.currentNotice = {
      text: normalized,
      expiresAtMs: this.nowMs() + this.options.ttlMs,
    };
  }

  current(): string | null {
    if (this.currentNotice === null) {
      return null;
    }
    if (this.nowMs() > this.currentNotice.expiresAtMs) {
      this.currentNotice = null;
      return null;
    }
    return this.currentNotice.text;
  }
}
