import type { FixedEvent, FlexibleTask, PlanItem } from "./model";

export interface MinuteInterval {
  readonly startMinutes: number;
  readonly endMinutes: number;
}

export interface FixedInterval extends MinuteInterval {
  readonly kind: "fixed";
}

export interface ProjectedFixedEvent<TSource = unknown> extends MinuteInterval {
  readonly kind: "fixed-event";
  readonly event: FixedEvent<TSource>;
  readonly conflict: boolean;
}

export interface PlannedSlot<TSource = unknown> extends MinuteInterval {
  readonly kind: "planned";
  readonly task: FlexibleTask<TSource>;
  readonly durationMinutes: number;
}

export interface OverflowTask<TSource = unknown> {
  readonly task: FlexibleTask<TSource>;
  readonly durationMinutes: number;
}

export type ScheduleInterval<TSource = unknown> = FixedInterval | PlannedSlot<TSource>;

export interface ScheduleInput<TSource = unknown> {
  readonly startMinutes: number;
  readonly endMinutes: number;
  readonly nowMinutes?: number;
  readonly items: readonly PlanItem<TSource>[];
}

export interface ScheduleResult<TSource = unknown> {
  readonly validDay: boolean;
  readonly cursorMinutes: number | null;
  readonly fixedEvents: readonly ProjectedFixedEvent<TSource>[];
  readonly fixedIntervals: readonly FixedInterval[];
  readonly plannedSlots: readonly PlannedSlot<TSource>[];
  readonly overflowTasks: readonly OverflowTask<TSource>[];
  readonly intervals: readonly ScheduleInterval<TSource>[];
  readonly fixedMinutes: number;
}

export function isValidDayBounds(startMinutes: number, endMinutes: number): boolean {
  return Number.isFinite(startMinutes)
    && Number.isFinite(endMinutes)
    && endMinutes > startMinutes;
}

export function effectiveCursor(
  startMinutes: number,
  endMinutes: number,
  nowMinutes: number | undefined,
): number {
  if (!isValidDayBounds(startMinutes, endMinutes)) {
    throw new RangeError("A day requires finite bounds with end after start");
  }
  if (nowMinutes === undefined || !Number.isFinite(nowMinutes)) return startMinutes;
  return Math.min(endMinutes, Math.max(startMinutes, nowMinutes));
}

function frozenFixedInterval(startMinutes: number, endMinutes: number): FixedInterval {
  return Object.freeze({ kind: "fixed", startMinutes, endMinutes });
}

export function clipSortMergeIntervals(
  intervals: readonly MinuteInterval[],
  startMinutes: number,
  endMinutes: number,
): readonly FixedInterval[] {
  if (!isValidDayBounds(startMinutes, endMinutes)) return Object.freeze([]);

  const clipped = intervals.flatMap((interval, inputOrder) => {
    if (!Number.isFinite(interval.startMinutes)
      || !Number.isFinite(interval.endMinutes)
      || interval.endMinutes <= interval.startMinutes) {
      return [];
    }
    const start = Math.max(startMinutes, interval.startMinutes);
    const end = Math.min(endMinutes, interval.endMinutes);
    return end > start ? [{ start, end, inputOrder }] : [];
  });
  clipped.sort((left, right) => left.start - right.start
    || left.end - right.end
    || left.inputOrder - right.inputOrder);

  const merged: FixedInterval[] = [];
  for (const interval of clipped) {
    const previous = merged[merged.length - 1];
    if (previous && interval.start <= previous.endMinutes) {
      if (interval.end > previous.endMinutes) {
        merged[merged.length - 1] = frozenFixedInterval(previous.startMinutes, interval.end);
      }
    } else {
      merged.push(frozenFixedInterval(interval.start, interval.end));
    }
  }
  return Object.freeze(merged);
}

export function fixedIntervalsForWindow<TSource>(
  items: readonly PlanItem<TSource>[],
  startMinutes: number,
  endMinutes: number,
  includeCompleted = false,
): readonly FixedInterval[] {
  const fixedEvents: FixedEvent<TSource>[] = [];
  for (const item of items) {
    if (item.kind === "fixed-event" && (includeCompleted || item.status !== "done")) {
      fixedEvents.push(item);
    }
  }
  return clipSortMergeIntervals(fixedEvents, startMinutes, endMinutes);
}

function snapshotFixedEvent<TSource>(event: FixedEvent<TSource>): FixedEvent<TSource> {
  return Object.freeze({
    ...event,
    tokens: Object.freeze({ ...event.tokens }),
  });
}

export function projectFixedEvents<TSource>(
  items: readonly PlanItem<TSource>[],
  startMinutes: number,
  endMinutes: number,
): readonly ProjectedFixedEvent<TSource>[] {
  if (!isValidDayBounds(startMinutes, endMinutes)) return Object.freeze([]);

  const events = items.filter((item): item is FixedEvent<TSource> => item.kind === "fixed-event"
    && Number.isFinite(item.startMinutes)
    && Number.isFinite(item.endMinutes)
    && item.endMinutes > item.startMinutes);
  const conflicts = events.map(() => false);
  for (let leftIndex = 0; leftIndex < events.length; leftIndex += 1) {
    const left = events[leftIndex]!;
    if (left.status === "done") continue;
    for (let rightIndex = leftIndex + 1; rightIndex < events.length; rightIndex += 1) {
      const right = events[rightIndex]!;
      if (right.status === "done") continue;
      if (left.startMinutes < right.endMinutes && right.startMinutes < left.endMinutes) {
        conflicts[leftIndex] = true;
        conflicts[rightIndex] = true;
      }
    }
  }

  const projected: ProjectedFixedEvent<TSource>[] = [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index]!;
    const start = Math.max(startMinutes, event.startMinutes);
    const end = Math.min(endMinutes, event.endMinutes);
    if (end <= start) continue;
    projected.push(Object.freeze({
      kind: "fixed-event",
      event: snapshotFixedEvent(event),
      startMinutes: start,
      endMinutes: end,
      conflict: conflicts[index]!,
    }));
  }
  return Object.freeze(projected);
}

function snapshotTask<TSource>(task: FlexibleTask<TSource>): FlexibleTask<TSource> {
  return Object.freeze({
    ...task,
    tokens: Object.freeze({ ...task.tokens }),
  });
}

function pendingDuration<TSource>(task: FlexibleTask<TSource>): number {
  if (task.status === "done"
    || !Number.isFinite(task.remainingDurationMinutes)
    || task.remainingDurationMinutes <= 0) {
    return 0;
  }
  return task.remainingDurationMinutes;
}

function frozenOverflow<TSource>(
  task: FlexibleTask<TSource>,
  durationMinutes: number,
): OverflowTask<TSource> {
  return Object.freeze({ task: snapshotTask(task), durationMinutes });
}

function invalidSchedule<TSource>(items: readonly PlanItem<TSource>[]): ScheduleResult<TSource> {
  const overflowTasks: OverflowTask<TSource>[] = [];
  for (const item of items) {
    if (item.kind === "flexible-task") {
      overflowTasks.push(frozenOverflow(item, item.remainingDurationMinutes));
    }
  }
  return Object.freeze({
    validDay: false,
    cursorMinutes: null,
    fixedEvents: Object.freeze([]),
    fixedIntervals: Object.freeze([]),
    plannedSlots: Object.freeze([]),
    overflowTasks: Object.freeze(overflowTasks),
    intervals: Object.freeze([]),
    fixedMinutes: 0,
  });
}

function intervalOrder<TSource>(
  left: ScheduleInterval<TSource>,
  right: ScheduleInterval<TSource>,
): number {
  return left.startMinutes - right.startMinutes
    || left.endMinutes - right.endMinutes
    || (left.kind === right.kind ? 0 : left.kind === "fixed" ? -1 : 1);
}

export function schedulePlan<TSource>(input: ScheduleInput<TSource>): ScheduleResult<TSource> {
  const { startMinutes, endMinutes, items } = input;
  if (!isValidDayBounds(startMinutes, endMinutes)) return invalidSchedule(items);

  const cursorMinutes = effectiveCursor(startMinutes, endMinutes, input.nowMinutes);
  const fixedEvents = projectFixedEvents(items, startMinutes, endMinutes);
  const fixedIntervals = fixedIntervalsForWindow(items, cursorMinutes, endMinutes);
  const plannedSlots: PlannedSlot<TSource>[] = [];
  const overflowTasks: OverflowTask<TSource>[] = [];
  let cursor = cursorMinutes;
  let fixedIndex = 0;

  for (const item of items) {
    if (item.kind !== "flexible-task") continue;
    const durationMinutes = pendingDuration(item);
    if (durationMinutes === 0) continue;

    let placed = false;
    while (cursor < endMinutes && !placed) {
      while (fixedIndex < fixedIntervals.length
        && fixedIntervals[fixedIndex]!.endMinutes <= cursor) {
        fixedIndex += 1;
      }
      const reservation = fixedIntervals[fixedIndex];
      if (!reservation) {
        if (cursor + durationMinutes <= endMinutes) {
          const slot: PlannedSlot<TSource> = {
            kind: "planned",
            task: snapshotTask(item),
            durationMinutes,
            startMinutes: cursor,
            endMinutes: cursor + durationMinutes,
          };
          plannedSlots.push(Object.freeze(slot));
          cursor += durationMinutes;
          placed = true;
        } else {
          cursor = endMinutes;
        }
      } else if (reservation.startMinutes > cursor
        && cursor + durationMinutes <= reservation.startMinutes) {
        const slot: PlannedSlot<TSource> = {
          kind: "planned",
          task: snapshotTask(item),
          durationMinutes,
          startMinutes: cursor,
          endMinutes: cursor + durationMinutes,
        };
        plannedSlots.push(Object.freeze(slot));
        cursor += durationMinutes;
        placed = true;
      } else {
        cursor = Math.max(cursor, reservation.endMinutes);
      }
    }
    if (!placed) overflowTasks.push(frozenOverflow(item, durationMinutes));
  }

  const intervals: ScheduleInterval<TSource>[] = [...fixedIntervals, ...plannedSlots];
  intervals.sort(intervalOrder);
  const fixedMinutes = fixedIntervals.reduce(
    (total, interval) => total + interval.endMinutes - interval.startMinutes,
    0,
  );
  return Object.freeze({
    validDay: true,
    cursorMinutes,
    fixedEvents,
    fixedIntervals,
    plannedSlots: Object.freeze(plannedSlots),
    overflowTasks: Object.freeze(overflowTasks),
    intervals: Object.freeze(intervals),
    fixedMinutes,
  });
}
