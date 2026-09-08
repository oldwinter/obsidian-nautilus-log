export const PLANNER_COMPACT_MAX_WIDTH = 520;
export const PLANNER_WIDE_MIN_WIDTH = 521;
export const PLANNER_NARROW_MAX_WIDTH = 360;

export type PlannerLayoutMode = "compact" | "wide";
export type PlannerHostContext = "main" | "sidebar" | "replica";

export interface PlannerResponsiveLayout {
  readonly containerWidth: number;
  readonly mode: PlannerLayoutMode;
  readonly narrow: boolean;
  readonly hostContext: PlannerHostContext;
  readonly showWideHeader: boolean;
  readonly showExternalLabels: boolean;
  readonly mountHoverSurface: boolean;
  readonly showCompactOverview: boolean;
  readonly showCompactSchedule: boolean;
  readonly scheduleInitiallyOpen: boolean;
  readonly suppressSurface: boolean;
}

export function plannerLayoutForWidth(
  width: number,
  hostContext: PlannerHostContext = "main",
): PlannerResponsiveLayout {
  if (!Number.isFinite(width) || width < 0) {
    throw new RangeError("Planner container width must be a finite nonnegative number");
  }
  const mode: PlannerLayoutMode = width <= PLANNER_COMPACT_MAX_WIDTH ? "compact" : "wide";
  const compact = mode === "compact";
  const suppressSurface = hostContext === "replica";
  return Object.freeze({
    containerWidth: width,
    mode,
    narrow: width <= PLANNER_NARROW_MAX_WIDTH,
    hostContext,
    showWideHeader: !compact && !suppressSurface,
    showExternalLabels: !compact && !suppressSurface,
    mountHoverSurface: !compact && !suppressSurface,
    showCompactOverview: compact && !suppressSurface,
    showCompactSchedule: compact && !suppressSurface,
    scheduleInitiallyOpen: compact && hostContext !== "sidebar",
    suppressSurface,
  });
}

export interface PlannerResizeSubscription {
  measure(): void;
  disconnect(): void;
}

export function plannerContainerWidth(element: HTMLElement): number {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  const paddingLeft = Number.parseFloat(style?.paddingLeft ?? "");
  const paddingRight = Number.parseFloat(style?.paddingRight ?? "");
  const padding = (Number.isFinite(paddingLeft) ? paddingLeft : 0)
    + (Number.isFinite(paddingRight) ? paddingRight : 0);
  return Math.max(0, element.clientWidth - padding);
}

export function observePlannerContainer(
  element: HTMLElement,
  hostContext: PlannerHostContext,
  listener: (layout: PlannerResponsiveLayout) => void,
): PlannerResizeSubscription {
  let disconnected = false;
  let previousKey = "";
  const publish = (width: number): void => {
    if (disconnected) return;
    const layout = plannerLayoutForWidth(width, hostContext);
    const key = `${layout.containerWidth.toFixed(2)}:${layout.mode}:${String(layout.narrow)}:${layout.hostContext}`;
    if (key === previousKey) return;
    previousKey = key;
    listener(layout);
  };
  const measure = (): void => publish(plannerContainerWidth(element));
  const ViewResizeObserver = element.ownerDocument.defaultView?.ResizeObserver;
  const observer = ViewResizeObserver
    ? new ViewResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width;
        if (width !== undefined) publish(width);
      })
    : undefined;
  observer?.observe(element);
  measure();
  return Object.freeze({
    measure,
    disconnect: (): void => {
      if (disconnected) return;
      disconnected = true;
      observer?.disconnect();
    },
  });
}
