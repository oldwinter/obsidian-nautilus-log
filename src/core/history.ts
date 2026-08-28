import type { CalendarDayBounds } from "./day";

export interface EpochInterval {
  readonly startEpochMilliseconds: number;
  readonly endEpochMilliseconds: number;
}

function validInterval(interval: EpochInterval): boolean {
  return Number.isFinite(interval.startEpochMilliseconds)
    && Number.isFinite(interval.endEpochMilliseconds)
    && interval.endEpochMilliseconds > interval.startEpochMilliseconds;
}

function validBounds(bounds: CalendarDayBounds): boolean {
  return Number.isFinite(bounds.startEpochMilliseconds)
    && Number.isFinite(bounds.endEpochMilliseconds)
    && bounds.endEpochMilliseconds > bounds.startEpochMilliseconds;
}

export function clipEpochIntervalToDay(
  interval: EpochInterval,
  bounds: CalendarDayBounds,
): EpochInterval | null {
  if (!validInterval(interval) || !validBounds(bounds)) return null;
  const startEpochMilliseconds = Math.max(
    interval.startEpochMilliseconds,
    bounds.startEpochMilliseconds,
  );
  const endEpochMilliseconds = Math.min(
    interval.endEpochMilliseconds,
    bounds.endEpochMilliseconds,
  );
  return endEpochMilliseconds > startEpochMilliseconds
    ? Object.freeze({ startEpochMilliseconds, endEpochMilliseconds })
    : null;
}

export function clipEpochIntervalsToDay(
  intervals: readonly EpochInterval[],
  bounds: CalendarDayBounds,
): readonly EpochInterval[] {
  const clipped: EpochInterval[] = [];
  for (const interval of intervals) {
    const overlap = clipEpochIntervalToDay(interval, bounds);
    if (overlap) clipped.push(overlap);
  }
  return Object.freeze(clipped);
}

export function sumClippedEpochMilliseconds(
  intervals: readonly EpochInterval[],
  bounds: CalendarDayBounds,
): number {
  return clipEpochIntervalsToDay(intervals, bounds).reduce(
    (total, interval) => total
      + interval.endEpochMilliseconds
      - interval.startEpochMilliseconds,
    0,
  );
}
