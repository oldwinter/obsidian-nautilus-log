export interface ExecutionTriggerRect {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface ExecutionPopoverPlacementInput {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly trigger: ExecutionTriggerRect;
  readonly contentHeight: number;
}

export interface ExecutionPopoverPlacement {
  readonly width: number;
  readonly left: number;
  readonly top: number;
}

const HORIZONTAL_INSET = 12;
const VERTICAL_INSET = 12;
const TRIGGER_GAP = 8;
const MAX_WIDTH = 420;

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function executionPopoverPlacement(
  input: ExecutionPopoverPlacementInput,
): ExecutionPopoverPlacement {
  const viewportWidth = Math.max(0, finiteOrZero(input.viewportWidth));
  const viewportHeight = Math.max(0, finiteOrZero(input.viewportHeight));
  const width = Math.min(MAX_WIDTH, Math.max(0, viewportWidth - HORIZONTAL_INSET * 2));
  const triggerRight = finiteOrZero(input.trigger.right);
  const triggerTop = finiteOrZero(input.trigger.top);
  const contentHeight = Math.max(0, finiteOrZero(input.contentHeight));
  const maxLeft = Math.max(HORIZONTAL_INSET, viewportWidth - HORIZONTAL_INSET - width);
  const preferredLeft = triggerRight - width;
  const left = Math.min(maxLeft, Math.max(HORIZONTAL_INSET, preferredLeft));
  const maxTop = viewportHeight - VERTICAL_INSET - contentHeight;
  const preferredTop = finiteOrZero(input.trigger.bottom) + TRIGGER_GAP;
  const aboveTop = triggerTop - TRIGGER_GAP - contentHeight;
  const top = preferredTop <= maxTop
    ? Math.max(VERTICAL_INSET, preferredTop)
    : aboveTop >= VERTICAL_INSET
      ? aboveTop
      : Math.max(VERTICAL_INSET, maxTop);
  return Object.freeze({ width, left, top });
}
