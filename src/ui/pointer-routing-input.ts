import { wheelDeltaRowsFromCode } from '../mux/dual-pane-core.ts';
import { handleHomePaneDragRelease as handleHomePaneDragReleaseFrame } from '../mux/live-mux/home-pane-drop.ts';
import {
  handleHomePaneDragMove as handleHomePaneDragMoveFrame,
  handleMainPaneWheelInput as handleMainPaneWheelInputFrame,
  handlePaneDividerDragInput as handlePaneDividerDragInputFrame,
  handleSeparatorPointerPress as handleSeparatorPointerPressFrame,
} from '../mux/live-mux/pointer-routing.ts';
import {
  hasAltModifier,
  isLeftButtonPress,
  isMouseRelease,
  isSelectionDrag,
  isWheelMouseCode,
} from '../mux/live-mux/selection.ts';

type MainPaneMode = 'conversation' | 'project' | 'home';
type PointerTarget = 'left' | 'right' | 'separator' | 'status' | 'outside';

interface HomePaneDragState {
  readonly kind: 'task' | 'repository';
  readonly itemId: string;
  readonly startedRowIndex: number;
  readonly latestRowIndex: number;
  readonly hasDragged: boolean;
}

interface PointerRoutingInputOptions {
  readonly getPaneDividerDragActive: () => boolean;
  readonly setPaneDividerDragActive: (active: boolean) => void;
  readonly applyPaneDividerAtCol: (col: number) => void;
  readonly getHomePaneDragState: () => HomePaneDragState | null;
  readonly setHomePaneDragState: (next: HomePaneDragState | null) => void;
  readonly getMainPaneMode: () => MainPaneMode;
  readonly taskIdAtRow: (index: number) => string | null;
  readonly repositoryIdAtRow: (index: number) => string | null;
  readonly reorderTaskByDrop: (draggedTaskId: string, targetTaskId: string) => void;
  readonly reorderRepositoryByDrop: (
    draggedRepositoryId: string,
    targetRepositoryId: string,
  ) => void;
  readonly onProjectWheel: (delta: number) => void;
  readonly onHomeWheel: (delta: number) => void;
  readonly markDirty: () => void;
}

interface PointerRoutingInputDependencies {
  readonly handlePaneDividerDragInput?: typeof handlePaneDividerDragInputFrame;
  readonly handleHomePaneDragRelease?: typeof handleHomePaneDragReleaseFrame;
  readonly handleSeparatorPointerPress?: typeof handleSeparatorPointerPressFrame;
  readonly handleMainPaneWheelInput?: typeof handleMainPaneWheelInputFrame;
  readonly handleHomePaneDragMove?: typeof handleHomePaneDragMoveFrame;
}

interface PointerEventInput {
  readonly code: number;
  readonly final: 'M' | 'm';
  readonly col: number;
  readonly target: PointerTarget;
  readonly rowIndex: number;
}

export class PointerRoutingInput {
  private readonly handlePaneDividerDragInput: typeof handlePaneDividerDragInputFrame;
  private readonly handleHomePaneDragReleaseInput: typeof handleHomePaneDragReleaseFrame;
  private readonly handleSeparatorPointerPressInput: typeof handleSeparatorPointerPressFrame;
  private readonly handleMainPaneWheelInput: typeof handleMainPaneWheelInputFrame;
  private readonly handleHomePaneDragMoveInput: typeof handleHomePaneDragMoveFrame;

  constructor(
    private readonly options: PointerRoutingInputOptions,
    dependencies: PointerRoutingInputDependencies = {},
  ) {
    this.handlePaneDividerDragInput =
      dependencies.handlePaneDividerDragInput ?? handlePaneDividerDragInputFrame;
    this.handleHomePaneDragReleaseInput =
      dependencies.handleHomePaneDragRelease ?? handleHomePaneDragReleaseFrame;
    this.handleSeparatorPointerPressInput =
      dependencies.handleSeparatorPointerPress ?? handleSeparatorPointerPressFrame;
    this.handleMainPaneWheelInput =
      dependencies.handleMainPaneWheelInput ?? handleMainPaneWheelInputFrame;
    this.handleHomePaneDragMoveInput =
      dependencies.handleHomePaneDragMove ?? handleHomePaneDragMoveFrame;
  }

  handlePaneDividerDrag(event: Pick<PointerEventInput, 'code' | 'final' | 'col'>): boolean {
    return this.handlePaneDividerDragInput({
      paneDividerDragActive: this.options.getPaneDividerDragActive(),
      isMouseRelease: isMouseRelease(event.final),
      isWheelMouseCode: isWheelMouseCode(event.code),
      mouseCol: event.col,
      setPaneDividerDragActive: this.options.setPaneDividerDragActive,
      applyPaneDividerAtCol: this.options.applyPaneDividerAtCol,
      markDirty: this.options.markDirty,
    });
  }

  handleHomePaneDragRelease(event: Pick<PointerEventInput, 'final' | 'target' | 'rowIndex'>): boolean {
    return this.handleHomePaneDragReleaseInput({
      homePaneDragState: this.options.getHomePaneDragState(),
      isMouseRelease: isMouseRelease(event.final),
      mainPaneMode: this.options.getMainPaneMode(),
      target: event.target,
      rowIndex: event.rowIndex,
      taskIdAtRow: this.options.taskIdAtRow,
      repositoryIdAtRow: this.options.repositoryIdAtRow,
      reorderTaskByDrop: this.options.reorderTaskByDrop,
      reorderRepositoryByDrop: this.options.reorderRepositoryByDrop,
      setHomePaneDragState: this.options.setHomePaneDragState,
      markDirty: this.options.markDirty,
    });
  }

  handleSeparatorPointerPress(
    event: Pick<PointerEventInput, 'target' | 'code' | 'final' | 'col'>,
  ): boolean {
    return this.handleSeparatorPointerPressInput({
      target: event.target,
      isLeftButtonPress: isLeftButtonPress(event.code, event.final),
      hasAltModifier: hasAltModifier(event.code),
      mouseCol: event.col,
      setPaneDividerDragActive: this.options.setPaneDividerDragActive,
      applyPaneDividerAtCol: this.options.applyPaneDividerAtCol,
    });
  }

  handleMainPaneWheel(
    event: Pick<PointerEventInput, 'target' | 'code'>,
    onConversationWheel: (delta: number) => void,
  ): boolean {
    return this.handleMainPaneWheelInput({
      target: event.target,
      wheelDelta: wheelDeltaRowsFromCode(event.code),
      mainPaneMode: this.options.getMainPaneMode(),
      onProjectWheel: this.options.onProjectWheel,
      onHomeWheel: this.options.onHomeWheel,
      onConversationWheel,
      markDirty: this.options.markDirty,
    });
  }

  handleHomePaneDragMove(
    event: Pick<PointerEventInput, 'target' | 'code' | 'final' | 'rowIndex'>,
  ): boolean {
    return this.handleHomePaneDragMoveInput({
      homePaneDragState: this.options.getHomePaneDragState(),
      mainPaneMode: this.options.getMainPaneMode(),
      target: event.target,
      isSelectionDrag: isSelectionDrag(event.code, event.final),
      hasAltModifier: hasAltModifier(event.code),
      rowIndex: event.rowIndex,
      setHomePaneDragState: this.options.setHomePaneDragState,
      markDirty: this.options.markDirty,
    });
  }
}
