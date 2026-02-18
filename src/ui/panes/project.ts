import { buildProjectPaneRows, type ProjectPaneSnapshot } from '../../mux/harness-core-ui.ts';

interface ProjectPaneLayout {
  readonly rightCols: number;
  readonly paneRows: number;
}

interface ProjectPaneRenderInput {
  readonly layout: ProjectPaneLayout;
  readonly snapshot: ProjectPaneSnapshot | null;
  readonly scrollTop: number;
}

interface ProjectPaneRenderResult {
  readonly rows: readonly string[];
  readonly scrollTop: number;
}

export class ProjectPane {
  constructor(
    private readonly renderProjectRows: typeof buildProjectPaneRows = buildProjectPaneRows,
  ) {}

  render(input: ProjectPaneRenderInput): ProjectPaneRenderResult {
    if (input.snapshot === null) {
      return {
        rows: Array.from({ length: input.layout.paneRows }, () => ' '.repeat(input.layout.rightCols)),
        scrollTop: input.scrollTop,
      };
    }
    const view = this.renderProjectRows(
      input.snapshot,
      input.layout.rightCols,
      input.layout.paneRows,
      input.scrollTop,
    );
    return {
      rows: view.rows,
      scrollTop: view.top,
    };
  }
}
