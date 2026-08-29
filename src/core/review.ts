import type { CalendarDayBounds } from "./day";
import {
  clipEpochIntervalToDay,
  clipEpochIntervalsToDay,
  sumClippedEpochMilliseconds,
  type EpochInterval,
} from "./history";

const MINUTE_MILLISECONDS = 60_000;

export type ReviewRowState =
  | "not-started"
  | "live"
  | "paused"
  | "not-tracked"
  | "compared";

export interface ReviewTask {
  readonly key: string;
  readonly ownerId?: string;
  readonly sourceOrder: number;
  readonly direct: boolean;
  readonly kind: "flexible-task" | "fixed-event";
  readonly status: "plain" | "open" | "done";
  readonly label: string;
  readonly plannedMinutes: number;
  readonly completionAnchorEpochMilliseconds?: number;
  readonly fixedInterval?: EpochInterval;
}

export type ReviewClock =
  | {
      readonly state: "closed";
      readonly ownerId: string;
      readonly startEpochMilliseconds: number;
      readonly endEpochMilliseconds: number;
      readonly clockId?: string;
    }
  | {
      readonly state: "running";
      readonly ownerId: string;
      readonly startEpochMilliseconds: number;
      readonly clockId?: string;
    }
  | {
      readonly state: "malformed" | "potential-running";
      readonly ownerId?: string;
      readonly clockId?: string;
    };

export interface ReviewRow<TTask extends ReviewTask = ReviewTask> {
  readonly task: TTask;
  readonly state: ReviewRowState;
  readonly plannedMinutes: number;
  readonly actualMinutes: number | null;
  readonly actualMilliseconds: number;
  readonly varianceMinutes?: number;
  readonly malformedClockCount: number;
  readonly potentialRunning: boolean;
}

export interface ReviewSummary {
  readonly total: number;
  readonly completed: number;
  readonly compared: number;
  readonly plannedMinutes: number;
  readonly actualMinutes: number;
  readonly varianceMinutes: number;
}

export interface ReviewProjection<TTask extends ReviewTask = ReviewTask> {
  readonly rows: readonly ReviewRow<TTask>[];
  readonly summary: ReviewSummary;
  readonly diagnostics: Readonly<{
    malformedClocks: number;
    potentialRunningClocks: number;
  }>;
}

export interface ProjectReviewInput<TTask extends ReviewTask = ReviewTask> {
  readonly tasks: readonly TTask[];
  readonly clocks: readonly ReviewClock[];
  readonly day: CalendarDayBounds;
  readonly nowEpochMilliseconds: number;
}

export interface CompletedHistorySlice<TTask extends ReviewTask = ReviewTask>
  extends EpochInterval {
  readonly task: TTask;
  readonly source: "actual" | "planned" | "fixed-event";
  readonly durationMinutes: number;
}

export interface ProjectPastUnplannedInput {
  readonly day: CalendarDayBounds;
  readonly nowEpochMilliseconds: number;
  readonly fixed: readonly EpochInterval[];
  readonly scheduled: readonly EpochInterval[];
  readonly completedHistory: readonly EpochInterval[];
  readonly hourBoundariesEpochMilliseconds?: readonly number[];
}

function finiteNonnegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

function eligibleTask(task: ReviewTask): boolean {
  return task.direct
    && task.kind === "flexible-task"
    && (task.status === "open" || task.status === "done")
    && Number.isSafeInteger(task.sourceOrder)
    && task.sourceOrder >= 0
    && finiteNonnegative(task.plannedMinutes);
}

function clockKey(clock: ReviewClock, index: number): string {
  if (clock.state === "closed") {
    return `closed:${clock.clockId ?? ""}:${clock.ownerId}:${clock.startEpochMilliseconds}:${clock.endEpochMilliseconds}`;
  }
  if (clock.state === "running") {
    return `running:${clock.clockId ?? ""}:${clock.ownerId}:${clock.startEpochMilliseconds}`;
  }
  return `${clock.state}:${clock.ownerId ?? ""}:${index}`;
}

function uniqueClocks(clocks: readonly ReviewClock[]): readonly ReviewClock[] {
  const unique = new Map<string, ReviewClock>();
  clocks.forEach((clock, index) => {
    const key = clockKey(clock, index);
    if (!unique.has(key)) unique.set(key, clock);
  });
  return Object.freeze([...unique.values()]);
}

function clocksForOwner(clocks: readonly ReviewClock[], ownerId: string | undefined): readonly ReviewClock[] {
  if (!ownerId) return Object.freeze([]);
  return Object.freeze(clocks.filter((clock) => clock.ownerId === ownerId));
}

function closedIntervals(clocks: readonly ReviewClock[]): readonly EpochInterval[] {
  return Object.freeze(clocks.flatMap((clock) => {
    if (clock.state !== "closed") return [];
    if (!Number.isFinite(clock.startEpochMilliseconds)
      || !Number.isFinite(clock.endEpochMilliseconds)
      || clock.endEpochMilliseconds <= clock.startEpochMilliseconds) return [];
    return [Object.freeze({
      startEpochMilliseconds: clock.startEpochMilliseconds,
      endEpochMilliseconds: clock.endEpochMilliseconds,
    })];
  }));
}

function runningIntervals(
  clocks: readonly ReviewClock[],
  nowEpochMilliseconds: number,
): readonly EpochInterval[] {
  if (!Number.isFinite(nowEpochMilliseconds)) return Object.freeze([]);
  return Object.freeze(clocks.flatMap((clock) => {
    if (clock.state !== "running"
      || !Number.isFinite(clock.startEpochMilliseconds)
      || nowEpochMilliseconds <= clock.startEpochMilliseconds) return [];
    return [Object.freeze({
      startEpochMilliseconds: clock.startEpochMilliseconds,
      endEpochMilliseconds: nowEpochMilliseconds,
    })];
  }));
}

function reviewRow<TTask extends ReviewTask>(
  task: TTask,
  clocks: readonly ReviewClock[],
  day: CalendarDayBounds,
  nowEpochMilliseconds: number,
): ReviewRow<TTask> {
  const ownerClocks = clocksForOwner(clocks, task.ownerId);
  const closedMilliseconds = sumClippedEpochMilliseconds(closedIntervals(ownerClocks), day);
  const running = runningIntervals(ownerClocks, nowEpochMilliseconds);
  const runningMilliseconds = task.status === "open"
    ? sumClippedEpochMilliseconds(running, day)
    : 0;
  const actualMilliseconds = task.status === "done"
    ? closedMilliseconds
    : closedMilliseconds + runningMilliseconds;
  const actualMinutes = Math.floor(actualMilliseconds / MINUTE_MILLISECONDS);
  const hasRunning = task.status === "open"
    && actualMinutes > 0
    && ownerClocks.some((clock) => clock.state === "running");
  const state: ReviewRowState = task.status === "done"
    ? actualMinutes > 0 ? "compared" : "not-tracked"
    : hasRunning
      ? "live"
      : actualMinutes > 0
        ? "paused"
        : "not-started";
  const malformedClockCount = ownerClocks.filter((clock) => clock.state === "malformed").length;
  const potentialRunning = ownerClocks.some((clock) => clock.state === "potential-running");
  return Object.freeze({
    task,
    state,
    plannedMinutes: task.plannedMinutes,
    actualMinutes: actualMinutes > 0 ? actualMinutes : null,
    actualMilliseconds,
    ...(state === "compared" ? { varianceMinutes: actualMinutes - task.plannedMinutes } : {}),
    malformedClockCount,
    potentialRunning,
  });
}

export function projectReview<TTask extends ReviewTask>(
  input: ProjectReviewInput<TTask>,
): ReviewProjection<TTask> {
  const clocks = uniqueClocks(input.clocks);
  const tasks = input.tasks
    .filter(eligibleTask)
    .sort((left, right) => left.sourceOrder - right.sourceOrder || left.key.localeCompare(right.key));
  const rows = Object.freeze(tasks.map((task) => reviewRow(
    task,
    clocks,
    input.day,
    input.nowEpochMilliseconds,
  )));
  const compared = rows.filter((row) => row.state === "compared");
  const plannedMinutes = compared.reduce((total, row) => total + row.plannedMinutes, 0);
  const actualMinutes = compared.reduce((total, row) => total + (row.actualMinutes ?? 0), 0);
  return Object.freeze({
    rows,
    summary: Object.freeze({
      total: rows.length,
      completed: rows.filter((row) => row.task.status === "done").length,
      compared: compared.length,
      plannedMinutes,
      actualMinutes,
      varianceMinutes: actualMinutes - plannedMinutes,
    }),
    diagnostics: Object.freeze({
      malformedClocks: clocks.filter((clock) => clock.state === "malformed").length,
      potentialRunningClocks: clocks.filter((clock) => clock.state === "potential-running").length,
    }),
  });
}

function boundedHistoryInterval(
  day: CalendarDayBounds,
  endEpochMilliseconds: number,
  durationMinutes: number,
): EpochInterval | undefined {
  if (!Number.isFinite(endEpochMilliseconds)
    || !Number.isSafeInteger(durationMinutes)
    || durationMinutes <= 0
    || endEpochMilliseconds < day.startEpochMilliseconds
    || endEpochMilliseconds > day.endEpochMilliseconds) return undefined;
  const startEpochMilliseconds = endEpochMilliseconds - durationMinutes * MINUTE_MILLISECONDS;
  if (!Number.isFinite(startEpochMilliseconds) || endEpochMilliseconds <= startEpochMilliseconds) {
    return undefined;
  }
  return Object.freeze({ startEpochMilliseconds, endEpochMilliseconds });
}

function acceptedAnchor(task: ReviewTask, day: CalendarDayBounds): number | undefined {
  const anchor = task.completionAnchorEpochMilliseconds;
  return anchor !== undefined
    && Number.isFinite(anchor)
    && anchor >= day.startEpochMilliseconds
    && anchor <= day.endEpochMilliseconds
    ? anchor
    : undefined;
}

export function projectCompletedHistory<TTask extends ReviewTask>(
  tasks: readonly TTask[],
  clocks: readonly ReviewClock[],
  day: CalendarDayBounds,
): readonly CompletedHistorySlice<TTask>[] {
  const unique = uniqueClocks(clocks);
  const slices: CompletedHistorySlice<TTask>[] = [];
  for (const task of tasks) {
    if (!task.direct || task.status !== "done") continue;
    if (task.kind === "fixed-event") {
      const fixed = task.fixedInterval && clipEpochIntervalToDay(task.fixedInterval, day);
      if (fixed) {
        slices.push(Object.freeze({
          ...fixed,
          task,
          source: "fixed-event",
          durationMinutes: Math.floor(
            (fixed.endEpochMilliseconds - fixed.startEpochMilliseconds) / MINUTE_MILLISECONDS,
          ),
        }));
      }
      continue;
    }
    if (!finiteNonnegative(task.plannedMinutes)) continue;
    const clipped = clipEpochIntervalsToDay(
      closedIntervals(clocksForOwner(unique, task.ownerId)),
      day,
    );
    const actualMilliseconds = clipped.reduce(
      (total, interval) => total + interval.endEpochMilliseconds - interval.startEpochMilliseconds,
      0,
    );
    const actualMinutes = Math.floor(actualMilliseconds / MINUTE_MILLISECONDS);
    if (actualMinutes > 0) {
      const latestEnd = clipped.reduce(
        (latest, interval) => Math.max(latest, interval.endEpochMilliseconds),
        day.startEpochMilliseconds,
      );
      const interval = boundedHistoryInterval(
        day,
        acceptedAnchor(task, day) ?? latestEnd,
        actualMinutes,
      );
      if (interval) slices.push(Object.freeze({ ...interval, task, source: "actual", durationMinutes: actualMinutes }));
      continue;
    }
    const anchor = acceptedAnchor(task, day);
    const plannedMinutes = Math.floor(task.plannedMinutes);
    const interval = anchor === undefined
      ? undefined
      : boundedHistoryInterval(day, anchor, plannedMinutes);
    if (interval) slices.push(Object.freeze({ ...interval, task, source: "planned", durationMinutes: plannedMinutes }));
  }
  return Object.freeze(slices.sort((left, right) =>
    left.startEpochMilliseconds - right.startEpochMilliseconds
      || left.task.sourceOrder - right.task.sourceOrder
      || left.task.key.localeCompare(right.task.key)));
}

function mergeIntervals(intervals: readonly EpochInterval[]): readonly EpochInterval[] {
  const ordered = intervals
    .filter((interval) => Number.isFinite(interval.startEpochMilliseconds)
      && Number.isFinite(interval.endEpochMilliseconds)
      && interval.endEpochMilliseconds > interval.startEpochMilliseconds)
    .sort((left, right) => left.startEpochMilliseconds - right.startEpochMilliseconds
      || left.endEpochMilliseconds - right.endEpochMilliseconds);
  const merged: EpochInterval[] = [];
  for (const interval of ordered) {
    const previous = merged[merged.length - 1];
    if (!previous || interval.startEpochMilliseconds > previous.endEpochMilliseconds) {
      merged.push({ ...interval });
    } else {
      merged[merged.length - 1] = {
        startEpochMilliseconds: previous.startEpochMilliseconds,
        endEpochMilliseconds: Math.max(previous.endEpochMilliseconds, interval.endEpochMilliseconds),
      };
    }
  }
  return Object.freeze(merged.map((interval) => Object.freeze(interval)));
}

function subtractIntervals(
  elapsed: EpochInterval,
  occupied: readonly EpochInterval[],
): readonly EpochInterval[] {
  const gaps: EpochInterval[] = [];
  let cursor = elapsed.startEpochMilliseconds;
  for (const interval of occupied) {
    const start = Math.max(interval.startEpochMilliseconds, elapsed.startEpochMilliseconds);
    const end = Math.min(interval.endEpochMilliseconds, elapsed.endEpochMilliseconds);
    if (end <= start) continue;
    if (start > cursor) {
      gaps.push(Object.freeze({
        startEpochMilliseconds: cursor,
        endEpochMilliseconds: start,
      }));
    }
    cursor = Math.max(cursor, end);
  }
  if (cursor < elapsed.endEpochMilliseconds) {
    gaps.push(Object.freeze({
      startEpochMilliseconds: cursor,
      endEpochMilliseconds: elapsed.endEpochMilliseconds,
    }));
  }
  return Object.freeze(gaps);
}

function splitAtBoundaries(
  intervals: readonly EpochInterval[],
  boundaries: readonly number[],
): readonly EpochInterval[] {
  const validBoundaries = [...new Set(boundaries.filter(Number.isFinite))].sort((a, b) => a - b);
  const split: EpochInterval[] = [];
  for (const interval of intervals) {
    let cursor = interval.startEpochMilliseconds;
    for (const boundary of validBoundaries) {
      if (boundary <= cursor || boundary >= interval.endEpochMilliseconds) continue;
      split.push(Object.freeze({ startEpochMilliseconds: cursor, endEpochMilliseconds: boundary }));
      cursor = boundary;
    }
    if (cursor < interval.endEpochMilliseconds) {
      split.push(Object.freeze({ startEpochMilliseconds: cursor, endEpochMilliseconds: interval.endEpochMilliseconds }));
    }
  }
  return Object.freeze(split);
}

export function projectPastUnplanned(
  input: ProjectPastUnplannedInput,
): readonly EpochInterval[] {
  if (!Number.isFinite(input.nowEpochMilliseconds)) return Object.freeze([]);
  const elapsedEnd = Math.min(
    input.day.endEpochMilliseconds,
    Math.max(input.day.startEpochMilliseconds, input.nowEpochMilliseconds),
  );
  if (elapsedEnd <= input.day.startEpochMilliseconds) return Object.freeze([]);
  const elapsed = Object.freeze({
    startEpochMilliseconds: input.day.startEpochMilliseconds,
    endEpochMilliseconds: elapsedEnd,
  });
  const occupied = mergeIntervals([
    ...input.fixed,
    ...input.scheduled,
    ...input.completedHistory,
  ]);
  return splitAtBoundaries(
    subtractIntervals(elapsed, occupied),
    input.hourBoundariesEpochMilliseconds ?? [],
  );
}
