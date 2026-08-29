const PLANNER_LEAF_INLINE_CHROME = 23;

export function constrainedPlannerContentWidth(
  requestedContentWidth: number,
  availableInlineSize: number,
): number {
  if (!Number.isFinite(requestedContentWidth) || requestedContentWidth < 0) {
    throw new RangeError("Requested planner width must be a finite nonnegative number");
  }
  if (!Number.isFinite(availableInlineSize) || availableInlineSize < 0) {
    throw new RangeError("Available harness width must be a finite nonnegative number");
  }
  return Math.min(
    requestedContentWidth,
    Math.max(0, Math.floor(availableInlineSize - PLANNER_LEAF_INLINE_CHROME)),
  );
}
