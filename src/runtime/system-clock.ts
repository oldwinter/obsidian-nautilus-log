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

export function zonedTimeParts(
  epochMilliseconds: number,
  timeZone: string,
): ZonedTimeParts {
  if (!Number.isFinite(epochMilliseconds)) {
    throw new RangeError("Epoch milliseconds must be finite");
  }
  const formatter = new Intl.DateTimeFormat("en-CA", {
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone: canonicalTimeZone(timeZone),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
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

  const resolvedTimeZone = formatter.resolvedOptions().timeZone;
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
