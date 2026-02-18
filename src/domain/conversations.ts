import type { ConversationState } from '../mux/live-mux/conversation-state.ts';

export class ConversationManager {
  readonly conversations = new Map<string, ConversationState>();
  readonly startInFlightBySessionId = new Map<string, Promise<ConversationState>>();
  readonly removedConversationIds = new Set<string>();

  activeConversationId: string | null = null;

  get(sessionId: string): ConversationState | undefined {
    return this.conversations.get(sessionId);
  }

  has(sessionId: string): boolean {
    return this.conversations.has(sessionId);
  }

  set(state: ConversationState): void {
    this.conversations.set(state.sessionId, state);
  }

  clearRemoved(sessionId: string): void {
    this.removedConversationIds.delete(sessionId);
  }

  isRemoved(sessionId: string): boolean {
    return this.removedConversationIds.has(sessionId);
  }

  getStartInFlight(sessionId: string): Promise<ConversationState> | undefined {
    return this.startInFlightBySessionId.get(sessionId);
  }

  setStartInFlight(sessionId: string, task: Promise<ConversationState>): void {
    this.startInFlightBySessionId.set(sessionId, task);
  }

  clearStartInFlight(sessionId: string): void {
    this.startInFlightBySessionId.delete(sessionId);
  }

  remove(sessionId: string): void {
    this.removedConversationIds.add(sessionId);
    this.conversations.delete(sessionId);
    this.startInFlightBySessionId.delete(sessionId);
    if (this.activeConversationId === sessionId) {
      this.activeConversationId = null;
    }
  }

  orderedIds(): readonly string[] {
    return [...this.conversations.keys()];
  }
}
