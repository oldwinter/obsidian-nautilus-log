export type TimerHandle = number;

export interface SystemClock {
  now(): number;
  timeZone(): string;
  setTimeout(callback: () => void, delayMilliseconds: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}

export interface ClockSample {
  readonly wallEpochMs: number;
  readonly monotonicMs: number;
  readonly timeZone: string;
}

export interface PairedSystemClock extends SystemClock {
  sample(): ClockSample;
}

export interface ZonedTimeParts {
  readonly timeZone: string;
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly minuteOfDay: number;
  readonly dateKey: string;
}

export interface LocalDateTimeParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

export type ZonedLocalTimeResolution =
  | { readonly kind: "unique"; readonly epochMs: number }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "nonexistent" }
  | { readonly kind: "invalid" };

export interface ZonedLocalTimeResolver {
  readonly timeZone: string;
  readonly resolve: (parts: LocalDateTimeParts) => ZonedLocalTimeResolution;
}

interface ManualTimer {
  readonly handle: TimerHandle;
  readonly monotonicDeadline: number;
  readonly callback: () => void;
}

function canonicalTimeZone(timeZone: string): string {
  if (timeZone.length === 0 || timeZone.trim() !== timeZone) {
    throw new RangeError("Invalid IANA time zone");
  }
  return new Intl.DateTimeFormat("en-US", { timeZone }).resolvedOptions().timeZone;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function zonedFormatter(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-CA", {
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
}

function partsFromFormatter(
  epochMilliseconds: number,
  formatter: Intl.DateTimeFormat,
  resolvedTimeZone: string,
): ZonedTimeParts {
  if (!Number.isFinite(epochMilliseconds)) {
    throw new RangeError("Epoch milliseconds must be finite");
  }
  const values = new Map<string, number>();
  for (const part of formatter.formatToParts(new Date(epochMilliseconds))) {
    if (["year", "month", "day", "hour", "minute"].includes(part.type)) {
      values.set(part.type, Number(part.value));
    }
  }

  const year = values.get("year");
  const month = values.get("month");
  const day = values.get("day");
  const hour = values.get("hour");
  const minute = values.get("minute");
  if (year === undefined
    || month === undefined
    || day === undefined
    || hour === undefined
    || minute === undefined
    || !Number.isInteger(year)
    || !Number.isInteger(month)
    || !Number.isInteger(day)
    || !Number.isInteger(hour)
    || !Number.isInteger(minute)
    || month < 1
    || month > 12
    || day < 1
    || day > 31
    || hour < 0
    || hour > 23
    || minute < 0
    || minute > 59) {
    throw new RangeError("Unable to resolve local date and minute");
  }

  return Object.freeze({
    timeZone: resolvedTimeZone,
    year,
    month,
    day,
    hour,
    minute,
    minuteOfDay: hour * 60 + minute,
    dateKey: `${String(year).padStart(4, "0")}-${twoDigits(month)}-${twoDigits(day)}`,
  });
}

function localWallEpoch(parts: LocalDateTimeParts): number | undefined {
  if (!Number.isInteger(parts.year)
    || !Number.isInteger(parts.month)
    || !Number.isInteger(parts.day)
    || !Number.isInteger(parts.hour)
    || !Number.isInteger(parts.minute)
    || parts.month < 1
    || parts.month > 12
    || parts.day < 1
    || parts.day > 31
    || parts.hour < 0
    || parts.hour > 23
    || parts.minute < 0
    || parts.minute > 59) {
    return undefined;
  }
  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, 0, 0);
  return date.getUTCFullYear() === parts.year
    && date.getUTCMonth() === parts.month - 1
    && date.getUTCDate() === parts.day
    && date.getUTCHours() === parts.hour
    && date.getUTCMinutes() === parts.minute
    ? date.getTime()
    : undefined;
}

function sameLocalTime(left: ZonedTimeParts, right: LocalDateTimeParts): boolean {
  return left.year === right.year
    && left.month === right.month
    && left.day === right.day
    && left.hour === right.hour
    && left.minute === right.minute;
}

function cacheBounded<K, V>(cache: Map<K, V>, key: K, value: V, maximumSize: number): void {
  if (!cache.has(key) && cache.size >= maximumSize) {
    const oldest = cache.keys().next().value as K | undefined;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

export function zonedTimeParts(
  epochMilliseconds: number,
  timeZone: string,
): ZonedTimeParts {
  const resolvedTimeZone = canonicalTimeZone(timeZone);
  return partsFromFormatter(
    epochMilliseconds,
    zonedFormatter(resolvedTimeZone),
    resolvedTimeZone,
  );
}

export function createZonedLocalTimeResolver(timeZone: string): ZonedLocalTimeResolver {
  const resolvedTimeZone = canonicalTimeZone(timeZone);
  const formatter = zonedFormatter(resolvedTimeZone);
  const offsetsByDate = new Map<string, readonly number[]>();
  const resolutions = new Map<string, ZonedLocalTimeResolution>();
  const invalid = Object.freeze({ kind: "invalid" as const });
  const ambiguous = Object.freeze({ kind: "ambiguous" as const });
  const nonexistent = Object.freeze({ kind: "nonexistent" as const });
  const twoDaysMilliseconds = 2 * 24 * 60 * 60 * 1_000;
  const maximumCachedDates = 3_650;
  const maximumCachedResolutions = 2 * 25_000;

  return Object.freeze({
    timeZone: resolvedTimeZone,
    resolve: (parts: LocalDateTimeParts): ZonedLocalTimeResolution => {
      const targetWallEpoch = localWallEpoch(parts);
      if (targetWallEpoch === undefined) return invalid;
      const resolutionKey = `${String(parts.year).padStart(4, "0")}-${twoDigits(parts.month)}-${twoDigits(parts.day)}T${twoDigits(parts.hour)}:${twoDigits(parts.minute)}`;
      const cached = resolutions.get(resolutionKey);
      if (cached) return cached;

      const dateKey = resolutionKey.slice(0, 10);
      let offsets = offsetsByDate.get(dateKey);
      if (!offsets) {
        const found = new Set<number>();
        for (const delta of [-twoDaysMilliseconds, 0, twoDaysMilliseconds]) {
          const sampleEpoch = targetWallEpoch + delta;
          const observed = partsFromFormatter(sampleEpoch, formatter, resolvedTimeZone);
          const observedWallEpoch = localWallEpoch(observed);
          if (observedWallEpoch !== undefined) found.add(observedWallEpoch - sampleEpoch);
        }
        offsets = Object.freeze([...found]);
        cacheBounded(offsetsByDate, dateKey, offsets, maximumCachedDates);
      }

      const matches = new Set<number>();
      for (const offset of offsets) {
        const candidate = targetWallEpoch - offset;
        if (sameLocalTime(partsFromFormatter(candidate, formatter, resolvedTimeZone), parts)) {
          matches.add(candidate);
        }
      }
      const resolution = matches.size === 1
        ? Object.freeze({ kind: "unique" as const, epochMs: [...matches][0]! })
        : matches.size > 1 ? ambiguous : nonexistent;
      cacheBounded(resolutions, resolutionKey, resolution, maximumCachedResolutions);
      return resolution;
    },
  });
}

export class RealSystemClock implements PairedSystemClock {
  now(): number {
    return Date.now();
  }

  timeZone(): string {
    const detected = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return canonicalTimeZone(detected || "UTC");
  }

  sample(): ClockSample {
    return Object.freeze({
      wallEpochMs: Date.now(),
      monotonicMs: globalThis.performance.now(),
      timeZone: this.timeZone(),
    });
  }

  setTimeout(callback: () => void, delayMilliseconds: number): TimerHandle {
    return globalThis.setTimeout(callback, delayMilliseconds);
  }

  clearTimeout(handle: TimerHandle): void {
    globalThis.clearTimeout(handle);
  }
}

export class ManualSystemClock implements PairedSystemClock {
  private currentEpochMilliseconds: number;
  private currentMonotonicMilliseconds: number;
  private currentTimeZone: string;
  private nextHandle = 1;
  private readonly timers = new Map<TimerHandle, ManualTimer>();
  private scheduledTimerCount = 0;
  private clearedTimerCount = 0;
  private firedTimerCount = 0;

  constructor(epochMilliseconds = 0, timeZone = "UTC", monotonicMilliseconds = 0) {
    if (!Number.isFinite(epochMilliseconds)) {
      throw new RangeError("Epoch milliseconds must be finite");
    }
    if (!Number.isFinite(monotonicMilliseconds) || monotonicMilliseconds < 0) {
      throw new RangeError("Monotonic milliseconds must be finite and nonnegative");
    }
    this.currentEpochMilliseconds = epochMilliseconds;
    this.currentMonotonicMilliseconds = monotonicMilliseconds;
    this.currentTimeZone = canonicalTimeZone(timeZone);
  }

  now(): number {
    return this.currentEpochMilliseconds;
  }

  timeZone(): string {
    return this.currentTimeZone;
  }

  sample(): ClockSample {
    return Object.freeze({
      wallEpochMs: this.currentEpochMilliseconds,
      monotonicMs: this.currentMonotonicMilliseconds,
      timeZone: this.currentTimeZone,
    });
  }

  get totalScheduledTimerCount(): number {
    return this.scheduledTimerCount;
  }

  get totalClearedTimerCount(): number {
    return this.clearedTimerCount;
  }

  get totalFiredTimerCount(): number {
    return this.firedTimerCount;
  }

  setTimeZone(timeZone: string): void {
    this.currentTimeZone = canonicalTimeZone(timeZone);
  }

  setWallTime(epochMilliseconds: number): void {
    if (!Number.isFinite(epochMilliseconds)) {
      throw new RangeError("Epoch milliseconds must be finite");
    }
    this.currentEpochMilliseconds = epochMilliseconds;
  }

  advanceMonotonicBy(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new RangeError("Monotonic advance must be finite and nonnegative");
    }
    this.advanceClocks(
      this.currentEpochMilliseconds,
      this.currentMonotonicMilliseconds + milliseconds,
      false,
    );
  }

  setTimeout(callback: () => void, delayMilliseconds: number): TimerHandle {
    if (!Number.isFinite(delayMilliseconds) || delayMilliseconds < 0) {
      throw new RangeError("Timer delay must be finite and nonnegative");
    }
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.scheduledTimerCount += 1;
    this.timers.set(handle, {
      handle,
      monotonicDeadline: this.currentMonotonicMilliseconds + delayMilliseconds,
      callback,
    });
    return handle;
  }

  clearTimeout(handle: TimerHandle): void {
    if (this.timers.delete(handle)) this.clearedTimerCount += 1;
  }

  pendingTimerCount(): number {
    return this.timers.size;
  }

  advanceBy(milliseconds: number): void {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) {
      throw new RangeError("Clock advance must be finite and nonnegative");
    }
    this.advanceTo(this.currentEpochMilliseconds + milliseconds);
  }

  advanceTo(epochMilliseconds: number): void {
    if (!Number.isFinite(epochMilliseconds)
      || epochMilliseconds < this.currentEpochMilliseconds) {
      throw new RangeError("Manual clock cannot move backwards");
    }

    const wallDelta = epochMilliseconds - this.currentEpochMilliseconds;
    this.advanceClocks(
      epochMilliseconds,
      this.currentMonotonicMilliseconds + wallDelta,
      true,
    );
  }

  private advanceClocks(
    targetEpochMilliseconds: number,
    targetMonotonicMilliseconds: number,
    advanceWallWithMonotonic: boolean,
  ): void {
    while (true) {
      let next: ManualTimer | undefined;
      for (const timer of this.timers.values()) {
        if (timer.monotonicDeadline > targetMonotonicMilliseconds) continue;
        if (next === undefined
          || timer.monotonicDeadline < next.monotonicDeadline
          || (timer.monotonicDeadline === next.monotonicDeadline && timer.handle < next.handle)) {
          next = timer;
        }
      }
      if (next === undefined) break;

      this.timers.delete(next.handle);
      const monotonicDelta = next.monotonicDeadline - this.currentMonotonicMilliseconds;
      this.currentMonotonicMilliseconds = next.monotonicDeadline;
      if (advanceWallWithMonotonic) this.currentEpochMilliseconds += monotonicDelta;
      this.firedTimerCount += 1;
      next.callback();
    }
    this.currentMonotonicMilliseconds = targetMonotonicMilliseconds;
    if (advanceWallWithMonotonic) this.currentEpochMilliseconds = targetEpochMilliseconds;
  }
}
