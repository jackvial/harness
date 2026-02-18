import { renderSnapshotAnsiRow, type TerminalSnapshotFrameCore } from '../../terminal/snapshot-oracle.ts';

interface ConversationPaneLayout {
  readonly rightCols: number;
  readonly paneRows: number;
}

export class ConversationPane {
  constructor(
    private readonly renderRow: typeof renderSnapshotAnsiRow = renderSnapshotAnsiRow,
  ) {}

  render(frame: TerminalSnapshotFrameCore, layout: ConversationPaneLayout): readonly string[] {
    return Array.from({ length: layout.paneRows }, (_value, row) =>
      this.renderRow(frame, row, layout.rightCols),
    );
  }
}
