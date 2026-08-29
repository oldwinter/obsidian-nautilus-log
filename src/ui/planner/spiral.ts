import { isCurrentMinute } from "../../core/day";
import type { RuntimePlanProjection } from "../../runtime/projection-runtime";
import { formatClockMinute, formatDuration } from "./diagnostics";
import {
  buildHourTicks,
  createSpiralGeometry,
  placeRailLabels,
  spiralBandPath,
  spiralNeedlePath,
  spiralPoint,
  type PlannerTimeBounds,
  type Point,
  type RailLabelPlacement,
  type SpiralGeometry,
  type SpiralTick,
} from "./geometry";
import type { PlannerLayoutMode } from "./responsive-layout";

export type PlannerTimelineItemKind = "event" | "task";
export type PlannerTimelineTone = "event" | "task" | "urgent" | "completed";

export interface PlannerTimelineItem {
  readonly id: string;
  readonly sourceOrder: number;
  readonly kind: PlannerTimelineItemKind;
  readonly tone: PlannerTimelineTone;
  readonly title: string;
  readonly startMinutes: number;
  readonly endMinutes: number;
  readonly durationMinutes: number;
  readonly completed: boolean;
  readonly conflict: boolean;
  readonly current: boolean;
  readonly past: boolean;
  readonly progressPercent: number;
  readonly path: string;
  readonly midpoint: Point;
  readonly ariaLabel: string;
}

export interface PlannerAvailableSlot {
  readonly id: string;
  readonly startMinutes: number;
  readonly endMinutes: number;
  readonly durationMinutes: number;
  readonly path: string;
  readonly midpoint: Point;
  readonly availableNow: boolean;
  readonly ariaLabel: string;
}

export interface PlannerExternalLabel extends RailLabelPlacement {
  readonly timelineItem: PlannerTimelineItem;
  readonly visibleText: string;
}

export interface PlannerSpiralModel {
  readonly geometry: SpiralGeometry;
  readonly title: string;
  readonly centerTime: string | null;
  readonly ticks: readonly SpiralTick[];
  readonly items: readonly PlannerTimelineItem[];
  readonly availableSlots: readonly PlannerAvailableSlot[];
  readonly labels: readonly PlannerExternalLabel[];
  readonly elapsedPath: string;
  readonly needlePath: string;
  readonly mode: PlannerLayoutMode;
}

export interface PlannerSpiralOptions {
  readonly mode: PlannerLayoutMode;
  readonly showCompleted: boolean;
  readonly playbackMinute?: number;
  readonly measureLabel?: (label: string) => number;
  readonly labelMaxWidth?: number;
}

interface MinuteInterval {
  readonly startMinutes: number;
  readonly endMinutes: number;
}

function sourceTitle(path: string): string {
  const pathSegments = path.split("/");
  const leaf = pathSegments[pathSegments.length - 1]?.replace(/\.md$/i, "") ?? "Plan";
  const first = leaf.split(",", 1)[0]!.trim();
  return [...first].slice(0, 16).join("") || "Plan";
}

function toneFor(
  kind: PlannerTimelineItemKind,
  completed: boolean,
  urgent: boolean,
): PlannerTimelineTone {
  if (completed) return "completed";
  if (kind === "event") return "event";
  return urgent ? "urgent" : "task";
}

function itemAriaLabel(item: Omit<PlannerTimelineItem, "ariaLabel">): string {
  const descriptors = [
    item.kind === "event" ? "Fixed event" : item.tone === "urgent" ? "Urgent task" : "Task",
    item.title,
    `${formatClockMinute(item.startMinutes)}-${formatClockMinute(item.endMinutes)}`,
    formatDuration(item.durationMinutes),
  ];
  if (item.completed) descriptors.push("completed");
  if (item.current) descriptors.push("current");
  if (item.conflict) descriptors.push("conflict");
  return descriptors.join(", ");
}

function timelineItems(
  projection: RuntimePlanProjection,
  geometry: SpiralGeometry,
  cursor: number | null,
  showCompleted: boolean,
): readonly PlannerTimelineItem[] {
  const items: PlannerTimelineItem[] = [];
  for (const entry of projection.schedule.fixedEvents) {
    const completed = entry.event.status === "done";
    if (completed && !showCompleted) continue;
    const common = {
      id: `event-${entry.event.sourceOrder}`,
      sourceOrder: entry.event.sourceOrder,
      kind: "event" as const,
      tone: toneFor("event", completed, false),
      title: entry.event.label,
      startMinutes: entry.startMinutes,
      endMinutes: entry.endMinutes,
      durationMinutes: entry.endMinutes - entry.startMinutes,
      completed,
      conflict: entry.conflict,
      current: false,
      past: projection.day.relation === "past"
        || (projection.day.relation === "today" && cursor !== null && entry.endMinutes <= cursor),
      progressPercent: entry.event.progressPercent,
      path: spiralBandPath(entry.startMinutes, entry.endMinutes, geometry),
      midpoint: spiralPoint((entry.startMinutes + entry.endMinutes) / 2, geometry),
    };
    items.push(Object.freeze({ ...common, ariaLabel: itemAriaLabel(common) }));
  }
  for (const entry of projection.schedule.plannedSlots) {
    const completed = entry.task.status === "done";
    if (completed && !showCompleted) continue;
    const current = projection.day.relation === "today"
      && cursor !== null
      && isCurrentMinute(entry, cursor);
    const common = {
      id: `task-${entry.task.sourceOrder}`,
      sourceOrder: entry.task.sourceOrder,
      kind: "task" as const,
      tone: toneFor("task", completed, entry.task.urgent),
      title: entry.task.label,
      startMinutes: entry.startMinutes,
      endMinutes: entry.endMinutes,
      durationMinutes: entry.durationMinutes,
      completed,
      conflict: false,
      current,
      past: projection.day.relation === "past"
        || (projection.day.relation === "today" && cursor !== null && entry.endMinutes <= cursor),
      progressPercent: entry.task.progressPercent,
      path: spiralBandPath(entry.startMinutes, entry.endMinutes, geometry),
      midpoint: spiralPoint((entry.startMinutes + entry.endMinutes) / 2, geometry),
    };
    items.push(Object.freeze({ ...common, ariaLabel: itemAriaLabel(common) }));
  }
  if (showCompleted) {
    for (const task of projection.items) {
      if (task.kind !== "flexible-task" || task.status !== "done"
        || task.completionAnchorMinutes === undefined) continue;
      const duration = Math.max(1, task.durationMinutes);
      const endMinutes = Math.min(geometry.bounds.endMinutes, task.completionAnchorMinutes);
      const startMinutes = Math.max(geometry.bounds.startMinutes, endMinutes - duration);
      if (endMinutes <= startMinutes) continue;
      const common = {
        id: `completed-task-${task.sourceOrder}`,
        sourceOrder: task.sourceOrder,
        kind: "task" as const,
        tone: "completed" as const,
        title: task.label,
        startMinutes,
        endMinutes,
        durationMinutes: endMinutes - startMinutes,
        completed: true,
        conflict: false,
        current: false,
        past: true,
        progressPercent: 100,
        path: spiralBandPath(startMinutes, endMinutes, geometry),
        midpoint: spiralPoint((startMinutes + endMinutes) / 2, geometry),
      };
      items.push(Object.freeze({ ...common, ariaLabel: itemAriaLabel(common) }));
    }
  }
  items.sort((left, right) => left.startMinutes - right.startMinutes
    || left.endMinutes - right.endMinutes
    || left.sourceOrder - right.sourceOrder
    || left.id.localeCompare(right.id));
  return Object.freeze(items);
}

function mergeIntervals(intervals: readonly MinuteInterval[]): readonly MinuteInterval[] {
  const ordered = [...intervals]
    .filter((entry) => entry.endMinutes > entry.startMinutes)
    .sort((left, right) => left.startMinutes - right.startMinutes || left.endMinutes - right.endMinutes);
  const merged: MinuteInterval[] = [];
  for (const interval of ordered) {
    const previous = merged[merged.length - 1];
    if (previous && interval.startMinutes <= previous.endMinutes) {
      merged[merged.length - 1] = Object.freeze({
        startMinutes: previous.startMinutes,
        endMinutes: Math.max(previous.endMinutes, interval.endMinutes),
      });
    } else {
      merged.push(Object.freeze({ ...interval }));
    }
  }
  return Object.freeze(merged);
}

function availableSlots(
  projection: RuntimePlanProjection,
  geometry: SpiralGeometry,
  cursor: number | null,
  items: readonly PlannerTimelineItem[],
  playbackActive: boolean,
): readonly PlannerAvailableSlot[] {
  if (projection.day.relation === "past" && !projection.day.playbackActive && !playbackActive) {
    return Object.freeze([]);
  }
  const start = Math.max(
    geometry.bounds.startMinutes,
    cursor ?? geometry.bounds.startMinutes,
  );
  const occupied = mergeIntervals(items
    .filter((item) => !item.completed)
    .map(({ startMinutes, endMinutes }) => ({ startMinutes, endMinutes })));
  const result: PlannerAvailableSlot[] = [];
  let availableFrom = start;
  for (const interval of occupied) {
    if (interval.endMinutes <= availableFrom) continue;
    if (interval.startMinutes > availableFrom) {
      const endMinutes = Math.min(interval.startMinutes, geometry.bounds.endMinutes);
      if (endMinutes > availableFrom) {
        result.push(availableSlot(result.length, availableFrom, endMinutes, cursor, geometry));
      }
    }
    availableFrom = Math.max(availableFrom, interval.endMinutes);
    if (availableFrom >= geometry.bounds.endMinutes) break;
  }
  if (availableFrom < geometry.bounds.endMinutes) {
    result.push(availableSlot(result.length, availableFrom, geometry.bounds.endMinutes, cursor, geometry));
  }
  return Object.freeze(result);
}

function availableSlot(
  index: number,
  startMinutes: number,
  endMinutes: number,
  cursor: number | null,
  geometry: SpiralGeometry,
): PlannerAvailableSlot {
  const durationMinutes = endMinutes - startMinutes;
  const availableNow = cursor !== null && startMinutes <= cursor && cursor < endMinutes;
  return Object.freeze({
    id: `available-${index}-${startMinutes}-${endMinutes}`,
    startMinutes,
    endMinutes,
    durationMinutes,
    path: spiralBandPath(startMinutes, endMinutes, geometry),
    midpoint: spiralPoint((startMinutes + endMinutes) / 2, geometry),
    availableNow,
    ariaLabel: `${availableNow ? "Available now" : "Available"}, `
      + `${formatClockMinute(startMinutes)}-${formatClockMinute(endMinutes)}, `
      + formatDuration(durationMinutes),
  });
}

function externalLabels(
  items: readonly PlannerTimelineItem[],
  geometry: SpiralGeometry,
  measureLabel: (label: string) => number,
  maximumWidth: number,
): readonly PlannerExternalLabel[] {
  const visibleTextById = new Map<string, string>();
  const labelInputs = items.map((item) => {
    const visibleText = fitPlannerRailLabel(item.title, maximumWidth, measureLabel);
    visibleTextById.set(item.id, visibleText);
    return {
      id: item.id,
      minute: (item.startMinutes + item.endMinutes) / 2,
      anchor: item.midpoint,
      width: Math.max(42, measureLabel(visibleText)),
      height: 16,
    };
  });
  const timelineById = new Map(items.map((item) => [item.id, item]));
  return Object.freeze(placeRailLabels(labelInputs, geometry).map((placement) => Object.freeze({
    ...placement,
    timelineItem: timelineById.get(placement.id)!,
    visibleText: visibleTextById.get(placement.id)!,
  })));
}

export function plannerRailLabelMaxWidth(containerWidth: number): number {
  if (!Number.isFinite(containerWidth) || containerWidth < 0) {
    throw new RangeError("Planner container width must be a finite nonnegative number");
  }
  return Math.min(320, 120 + Math.max(0, containerWidth - 521) / 2);
}

export function fitPlannerRailLabel(
  label: string,
  maximumWidth: number,
  measureLabel: (label: string) => number,
): string {
  if (maximumWidth === Number.POSITIVE_INFINITY) return label;
  if (!Number.isFinite(maximumWidth) || maximumWidth <= 0) {
    throw new RangeError("Planner label width must be positive and finite");
  }
  if (measureLabel(label) <= maximumWidth) return label;
  const characters = [...label];
  const ellipsis = "…";
  let lower = 0;
  let upper = characters.length;
  while (lower < upper) {
    const candidate = Math.ceil((lower + upper) / 2);
    if (measureLabel(`${characters.slice(0, candidate).join("")}${ellipsis}`) <= maximumWidth) {
      lower = candidate;
    } else {
      upper = candidate - 1;
    }
  }
  return `${characters.slice(0, lower).join("")}${ellipsis}`;
}

export function buildPlannerSpiralModel(
  projection: RuntimePlanProjection,
  bounds: PlannerTimeBounds,
  options: PlannerSpiralOptions,
): PlannerSpiralModel {
  const geometry = createSpiralGeometry(bounds, options.mode === "compact");
  const playbackMinute = options.playbackMinute;
  const cursor = playbackMinute ?? (
    projection.day.relation === "today" && projection.day.showNowNeedle
      ? projection.day.scheduleFromMinutes
      : null
  );
  const items = timelineItems(projection, geometry, cursor, options.showCompleted);
  const slots = availableSlots(projection, geometry, cursor, items, playbackMinute !== undefined);
  const elapsedUntil = playbackMinute ?? projection.day.elapsedUntilMinutes;
  const showNeedle = playbackMinute !== undefined || projection.day.showNowNeedle;
  const labels = options.mode === "wide"
    ? externalLabels(
        items,
        geometry,
        options.measureLabel ?? ((label) => [...label].length * 7.2),
        options.labelMaxWidth ?? Number.POSITIVE_INFINITY,
      )
    : Object.freeze([]);
  return Object.freeze({
    geometry,
    title: sourceTitle(projection.sourcePath),
    centerTime: showNeedle && elapsedUntil !== null ? formatClockMinute(elapsedUntil) : null,
    ticks: buildHourTicks(geometry),
    items,
    availableSlots: slots,
    labels,
    elapsedPath: elapsedUntil === null
      ? ""
      : spiralBandPath(geometry.bounds.startMinutes, elapsedUntil, geometry),
    needlePath: showNeedle && elapsedUntil !== null
      ? spiralNeedlePath(elapsedUntil, geometry)
      : "",
    mode: options.mode,
  });
}
