import {
  detectMuxGlobalShortcut as detectMuxGlobalShortcutFrame,
  type resolveMuxShortcutBindings,
} from '../mux/input-shortcuts.ts';
import { handleGlobalShortcut as handleGlobalShortcutFrame } from '../mux/live-mux/global-shortcut-handlers.ts';

type ResolvedMuxShortcutBindings = ReturnType<typeof resolveMuxShortcutBindings>;
type ShortcutCycleDirection = 'next' | 'previous';
type MainPaneMode = 'conversation' | 'project' | 'home';
const DEFAULT_INTERRUPT_ALL_DOUBLE_TAP_WINDOW_MS = 350;

interface GlobalShortcutInputOptions {
  readonly shortcutBindings: ResolvedMuxShortcutBindings;
  readonly requestStop: () => void;
  readonly resolveDirectoryForAction: () => string | null;
  readonly openNewThreadPrompt: (directoryId: string) => void;
  readonly toggleCommandMenu: () => void;
  readonly openOrCreateCritiqueConversationInDirectory: (directoryId: string) => Promise<void>;
  readonly toggleGatewayProfile: () => Promise<void>;
  readonly toggleGatewayStatusTimeline: () => Promise<void>;
  readonly toggleGatewayRenderTrace: (conversationId: string | null) => Promise<void>;
  readonly getMainPaneMode: () => MainPaneMode;
  readonly getActiveConversationId: () => string | null;
  readonly conversationsHas: (sessionId: string) => boolean;
  readonly queueControlPlaneOp: (task: () => Promise<void>, label: string) => void;
  readonly archiveConversation: (sessionId: string) => Promise<void>;
  readonly interruptConversation: (sessionId: string) => Promise<void>;
  readonly takeoverConversation: (sessionId: string) => Promise<void>;
  readonly openAddDirectoryPrompt: () => void;
  readonly getActiveDirectoryId: () => string | null;
  readonly directoryExists: (directoryId: string) => boolean;
  readonly closeDirectory: (directoryId: string) => Promise<void>;
  readonly cycleLeftNavSelection: (direction: ShortcutCycleDirection) => void;
  readonly forwardInterruptAllToActiveConversation?: (input: Buffer) => boolean;
  readonly interruptAllDoubleTapWindowMs?: number;
  readonly nowMs?: () => number;
}

interface GlobalShortcutInputDependencies {
  readonly detectMuxGlobalShortcut?: typeof detectMuxGlobalShortcutFrame;
  readonly handleGlobalShortcut?: typeof handleGlobalShortcutFrame;
}

export class GlobalShortcutInput {
  private readonly detectMuxGlobalShortcut: typeof detectMuxGlobalShortcutFrame;
  private readonly handleGlobalShortcut: typeof handleGlobalShortcutFrame;
  private readonly nowMs: () => number;
  private readonly interruptAllDoubleTapWindowMs: number | null;
  private lastInterruptAllAtMs: number | null = null;

  constructor(
    private readonly options: GlobalShortcutInputOptions,
    dependencies: GlobalShortcutInputDependencies = {},
  ) {
    this.detectMuxGlobalShortcut =
      dependencies.detectMuxGlobalShortcut ?? detectMuxGlobalShortcutFrame;
    this.handleGlobalShortcut = dependencies.handleGlobalShortcut ?? handleGlobalShortcutFrame;
    this.nowMs = this.options.nowMs ?? (() => Date.now());
    const customInterruptAllBehaviorEnabled =
      this.options.forwardInterruptAllToActiveConversation !== undefined ||
      this.options.interruptAllDoubleTapWindowMs !== undefined;
    this.interruptAllDoubleTapWindowMs = customInterruptAllBehaviorEnabled
      ? (this.options.interruptAllDoubleTapWindowMs ?? DEFAULT_INTERRUPT_ALL_DOUBLE_TAP_WINDOW_MS)
      : null;
  }

  handleInput(input: Buffer): boolean {
    const shortcut = this.detectMuxGlobalShortcut(input, this.options.shortcutBindings);
    if (shortcut === 'mux.app.interrupt-all' && this.interruptAllDoubleTapWindowMs !== null) {
      return this.handleInterruptAllShortcut(input);
    }
    if (shortcut !== 'mux.app.interrupt-all') {
      this.lastInterruptAllAtMs = null;
    }
    return this.handleGlobalShortcut({
      shortcut,
      requestStop: this.options.requestStop,
      resolveDirectoryForAction: this.options.resolveDirectoryForAction,
      openNewThreadPrompt: this.options.openNewThreadPrompt,
      toggleCommandMenu: this.options.toggleCommandMenu,
      openOrCreateCritiqueConversationInDirectory:
        this.options.openOrCreateCritiqueConversationInDirectory,
      toggleGatewayProfile: this.options.toggleGatewayProfile,
      toggleGatewayStatusTimeline: this.options.toggleGatewayStatusTimeline,
      toggleGatewayRenderTrace: this.options.toggleGatewayRenderTrace,
      resolveConversationForAction: () =>
        this.options.getMainPaneMode() === 'conversation'
          ? this.options.getActiveConversationId()
          : null,
      conversationsHas: this.options.conversationsHas,
      queueControlPlaneOp: this.options.queueControlPlaneOp,
      archiveConversation: this.options.archiveConversation,
      interruptConversation: this.options.interruptConversation,
      takeoverConversation: this.options.takeoverConversation,
      openAddDirectoryPrompt: this.options.openAddDirectoryPrompt,
      resolveClosableDirectoryId: () => {
        const activeDirectoryId = this.options.getActiveDirectoryId();
        if (this.options.getMainPaneMode() !== 'project' || activeDirectoryId === null) {
          return null;
        }
        return this.options.directoryExists(activeDirectoryId) ? activeDirectoryId : null;
      },
      closeDirectory: this.options.closeDirectory,
      cycleLeftNavSelection: this.options.cycleLeftNavSelection,
    });
  }

  private handleInterruptAllShortcut(input: Buffer): boolean {
    const nowMs = this.nowMs();
    const lastInterruptAllAtMs = this.lastInterruptAllAtMs;
    const doubleTapWindowMs = this.interruptAllDoubleTapWindowMs;
    if (
      doubleTapWindowMs !== null &&
      lastInterruptAllAtMs !== null &&
      nowMs >= lastInterruptAllAtMs &&
      nowMs - lastInterruptAllAtMs <= doubleTapWindowMs
    ) {
      this.lastInterruptAllAtMs = null;
      this.options.requestStop();
      return true;
    }
    this.lastInterruptAllAtMs = nowMs;
    this.options.forwardInterruptAllToActiveConversation?.(input);
    return true;
  }
}
