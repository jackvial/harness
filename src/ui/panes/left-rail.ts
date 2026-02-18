import { buildRailRows } from '../../mux/live-mux/rail-layout.ts';

type LeftRailRenderInput = Parameters<typeof buildRailRows>[0];
type LeftRailRenderResult = ReturnType<typeof buildRailRows>;

export class LeftRailPane {
  constructor(private readonly renderRailRows: typeof buildRailRows = buildRailRows) {}

  render(input: LeftRailRenderInput): LeftRailRenderResult {
    return this.renderRailRows(input);
  }
}
