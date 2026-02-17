type RoutedInputToken =
  | {
      kind: 'passthrough';
      text: string;
    }
  | {
      kind: 'mouse';
      event: {
        col: number;
        row: number;
        code: number;
      };
    };

interface RouteInputTokensForConversationOptions {
  tokens: readonly RoutedInputToken[];
  mainPaneMode: 'conversation' | 'project' | 'home';
  normalizeMuxKeyboardInputForPty: (input: Buffer) => Buffer;
  classifyPaneAt: (col: number, row: number) => string;
  wheelDeltaRowsFromCode: (code: number) => number | null;
}

interface RouteInputTokensForConversationResult {
  readonly mainPaneScrollRows: number;
  readonly forwardToSession: readonly Buffer[];
}

export function routeInputTokensForConversation(
  options: RouteInputTokensForConversationOptions,
): RouteInputTokensForConversationResult {
  let mainPaneScrollRows = 0;
  const forwardToSession: Buffer[] = [];
  for (const token of options.tokens) {
    if (token.kind === 'passthrough') {
      if (options.mainPaneMode === 'conversation' && token.text.length > 0) {
        forwardToSession.push(
          options.normalizeMuxKeyboardInputForPty(Buffer.from(token.text, 'utf8')),
        );
      }
      continue;
    }
    if (options.classifyPaneAt(token.event.col, token.event.row) !== 'right') {
      continue;
    }
    if (options.mainPaneMode !== 'conversation') {
      continue;
    }
    const wheelDelta = options.wheelDeltaRowsFromCode(token.event.code);
    if (wheelDelta !== null) {
      mainPaneScrollRows += wheelDelta;
      continue;
    }
    // The mux owns mouse interactions. Forwarding raw SGR mouse sequences to shell-style
    // threads produces visible control garbage (for example on initial click-to-focus).
    continue;
  }
  return {
    mainPaneScrollRows,
    forwardToSession,
  };
}
