interface RuntimeInterruptResult {
  readonly interrupted: boolean;
}

interface RuntimeConversationControlState {
  live: boolean;
  status: string;
  attentionReason: string | null;
  lastEventAt: string | null;
}

interface RuntimeGatewayProfilerResult {
  readonly message: string;
}

interface RuntimeControlActionsOptions<TConversation extends RuntimeConversationControlState> {
  readonly conversationById: (sessionId: string) => TConversation | undefined;
  readonly interruptSession: (sessionId: string) => Promise<RuntimeInterruptResult>;
  readonly nowIso: () => string;
  readonly markDirty: () => void;
  readonly toggleGatewayProfiler: (input: {
    invocationDirectory: string;
    sessionName: string | null;
  }) => Promise<RuntimeGatewayProfilerResult>;
  readonly invocationDirectory: string;
  readonly sessionName: string | null;
  readonly setTaskPaneNotice: (message: string) => void;
  readonly setDebugFooterNotice: (message: string) => void;
}

export class RuntimeControlActions<TConversation extends RuntimeConversationControlState> {
  constructor(private readonly options: RuntimeControlActionsOptions<TConversation>) {}

  async interruptConversation(sessionId: string): Promise<void> {
    const conversation = this.options.conversationById(sessionId);
    if (conversation === undefined || !conversation.live) {
      return;
    }
    const result = await this.options.interruptSession(sessionId);
    if (!result.interrupted) {
      return;
    }
    conversation.status = 'completed';
    conversation.attentionReason = null;
    conversation.lastEventAt = this.options.nowIso();
    this.options.markDirty();
  }

  async toggleGatewayProfiler(): Promise<void> {
    try {
      const result = await this.options.toggleGatewayProfiler({
        invocationDirectory: this.options.invocationDirectory,
        sessionName: this.options.sessionName,
      });
      this.setNotices(this.scopeProfileMessage(result.message));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.setNotices(this.scopeProfileMessage(message));
    } finally {
      this.options.markDirty();
    }
  }

  private scopeProfileMessage(message: string): string {
    if (this.options.sessionName === null) {
      return `[profile] ${message}`;
    }
    return `[profile:${this.options.sessionName}] ${message}`;
  }

  private setNotices(message: string): void {
    this.options.setTaskPaneNotice(message);
    this.options.setDebugFooterNotice(message);
  }
}
