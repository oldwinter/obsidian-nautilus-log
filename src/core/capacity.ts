import {
  fixedIntervalsForWindow,
  isValidDayBounds,
  schedulePlan,
  type ScheduleInput,
  type ScheduleResult,
} from "./scheduler";

export type CapacityStatus = "remaining" | "overload" | "no-fitting-slot";
export type CapacityMetricKind = "planned" | CapacityStatus | "available" | "events";
export type CapacityBurningBucket = "available" | "events";

export interface CapacityMetric {
  readonly kind: CapacityMetricKind;
  readonly minutes: number;
  readonly percent: number | null;
  readonly burning: boolean;
}

export interface CapacityResult<TSource = unknown> {
  readonly schedule: ScheduleResult<TSource>;
  readonly availableMinutes: number;
  readonly demandMinutes: number;
  readonly overloadMinutes: number;
  readonly slackMinutes: number;
  readonly unplacedMinutes: number;
  readonly fixedMinutes: number;
  readonly totalFixedMinutes: number;
  readonly totalAvailableMinutes: number;
  readonly status: CapacityStatus;
  readonly plannedPercent: number | null;
  readonly burningBucket: CapacityBurningBucket | null;
  readonly metrics: readonly CapacityMetric[];
}

function metric(
  kind: CapacityMetricKind,
  minutes: number,
  percent: number | null = null,
  burning = false,
) {
  return Object.freeze({ kind, minutes, percent, burning });
}

function intervalMinutes(intervals: readonly { readonly startMinutes: number; readonly endMinutes: number }[]) {
  return intervals.reduce(
    (total, interval) => total + interval.endMinutes - interval.startMinutes,
    0,
  );
}

export function burningCapacityBucket<TSource>(
  input: ScheduleInput<TSource>,
): CapacityBurningBucket | null {
  const { startMinutes, endMinutes, nowMinutes } = input;
  if (!isValidDayBounds(startMinutes, endMinutes)
    || nowMinutes === undefined
    || !Number.isFinite(nowMinutes)
    || nowMinutes < startMinutes
    || nowMinutes >= endMinutes) {
    return null;
  }
  const fixedIntervals = fixedIntervalsForWindow(input.items, startMinutes, endMinutes);
  return fixedIntervals.some((interval) => interval.startMinutes <= nowMinutes
    && nowMinutes < interval.endMinutes)
    ? "events"
    : "available";
}

export function calculateCapacity<TSource>(
  input: ScheduleInput<TSource>,
): CapacityResult<TSource> {
  const schedule = schedulePlan(input);
  const burningBucket = burningCapacityBucket(input);
  if (!isValidDayBounds(input.startMinutes, input.endMinutes) || schedule.cursorMinutes === null) {
    const metrics = Object.freeze([
      metric("planned", 0, 0),
      metric("remaining", 0),
      metric("available", 0),
      metric("events", 0),
    ]);
    return Object.freeze({
      schedule,
      availableMinutes: 0,
      demandMinutes: 0,
      overloadMinutes: 0,
      slackMinutes: 0,
      unplacedMinutes: 0,
      fixedMinutes: 0,
      totalFixedMinutes: 0,
      totalAvailableMinutes: 0,
      status: "remaining",
      plannedPercent: 0,
      burningBucket,
      metrics,
    });
  }

  const fixedMinutes = schedule.fixedMinutes;
  const totalFixedMinutes = intervalMinutes(fixedIntervalsForWindow(
    input.items,
    input.startMinutes,
    input.endMinutes,
    true,
  ));
  const availableMinutes = Math.max(0, input.endMinutes - schedule.cursorMinutes - fixedMinutes);
  const demandMinutes = [...schedule.plannedSlots, ...schedule.overflowTasks].reduce(
    (total, entry) => total + entry.durationMinutes,
    0,
  );
  const overloadMinutes = Math.max(0, demandMinutes - availableMinutes);
  const slackMinutes = Math.max(0, availableMinutes - demandMinutes);
  const unplacedMinutes = schedule.overflowTasks.reduce(
    (total, entry) => total + entry.durationMinutes,
    0,
  );
  const totalAvailableMinutes = Math.max(
    0,
    input.endMinutes - input.startMinutes - totalFixedMinutes,
  );
  const status: CapacityStatus = overloadMinutes > 0
    ? "overload"
    : unplacedMinutes > 0
      ? "no-fitting-slot"
      : "remaining";
  const plannedPercent = availableMinutes === 0
    ? demandMinutes === 0 ? 0 : null
    : Math.round(demandMinutes / availableMinutes * 100);
  const statusMinutes = status === "overload"
    ? overloadMinutes
    : status === "no-fitting-slot"
      ? unplacedMinutes
      : slackMinutes;
  const metrics = Object.freeze([
    metric("planned", demandMinutes, plannedPercent),
    metric(status, statusMinutes),
    metric("available", availableMinutes, null, burningBucket === "available"),
    metric("events", fixedMinutes, null, burningBucket === "events"),
  ]);

  return Object.freeze({
    schedule,
    availableMinutes,
    demandMinutes,
    overloadMinutes,
    slackMinutes,
    unplacedMinutes,
    fixedMinutes,
    totalFixedMinutes,
    totalAvailableMinutes,
    status,
    plannedPercent,
    burningBucket,
    metrics,
  });
}
