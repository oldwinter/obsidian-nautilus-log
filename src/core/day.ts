import { effectiveCursor, isValidDayBounds, type MinuteInterval } from "./scheduler";

export interface LogicalDate {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

export interface CalendarDayBounds {
  readonly date: LogicalDate;
  readonly timeZone: string;
  readonly startEpochMilliseconds: number;
  readonly endEpochMilliseconds: number;
}

export type LocalMidnightResolver = (
  date: LogicalDate,
  timeZone: string,
) => number;

export type DayRelation = "past" | "today" | "future" | "other";

export interface DayProjectionInput {
  readonly displayedDate?: LogicalDate;
  readonly today: LogicalDate;
  readonly startMinutes: number;
  readonly endMinutes: number;
  readonly nowMinutes: number;
  readonly playbackMinutes?: number;
}

export interface DayProjection {
  readonly relation: DayRelation;
  readonly scheduleFromMinutes: number;
  readonly capacityFromMinutes: number;
  readonly elapsedUntilMinutes: number | null;
  readonly showNowNeedle: boolean;
  readonly showBurning: boolean;
  readonly availableInteractive: boolean;
  readonly taskInteractive: boolean;
  readonly playbackActive: boolean;
}

export interface PlaybackInput {
  readonly startMinutes: number;
  readonly endMinutes: number;
  readonly elapsedMilliseconds: number;
  readonly durationMilliseconds?: number;
}

interface CurrentInterval extends MinuteInterval {
  readonly status?: "plain" | "open" | "done";
  readonly task?: { readonly status: "plain" | "open" | "done" };
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function assertLogicalDate(date: LogicalDate): void {
  if (!Number.isInteger(date.year)
    || date.year < 100
    || date.year > 9_999
    || !Number.isInteger(date.month)
    || date.month < 1
    || date.month > 12
    || !Number.isInteger(date.day)
    || date.day < 1
    || date.day > daysInMonth(date.year, date.month)) {
    throw new RangeError("Invalid logical calendar date");
  }
}

function nextLogicalDate(date: LogicalDate): LogicalDate {
  const monthDays = daysInMonth(date.year, date.month);
  if (date.day < monthDays) return { ...date, day: date.day + 1 };
  if (date.month < 12) return { year: date.year, month: date.month + 1, day: 1 };
  if (date.year === 9_999) throw new RangeError("Logical date has no supported successor");
  return { year: date.year + 1, month: 1, day: 1 };
}

export function calendarDayBounds(
  date: LogicalDate,
  timeZone: string,
  resolveLocalMidnight: LocalMidnightResolver,
): CalendarDayBounds {
  assertLogicalDate(date);
  if (timeZone.length === 0 || timeZone.trim() !== timeZone) {
    throw new RangeError("Invalid IANA time zone");
  }
  const followingDate = nextLogicalDate(date);
  const startEpochMilliseconds = resolveLocalMidnight(Object.freeze({ ...date }), timeZone);
  const endEpochMilliseconds = resolveLocalMidnight(
    Object.freeze(followingDate),
    timeZone,
  );
  if (!Number.isFinite(startEpochMilliseconds)
    || !Number.isFinite(endEpochMilliseconds)
    || endEpochMilliseconds <= startEpochMilliseconds) {
    throw new RangeError("Calendar day did not resolve to a positive interval");
  }
  return Object.freeze({
    date: Object.freeze({ ...date }),
    timeZone,
    startEpochMilliseconds,
    endEpochMilliseconds,
  });
}

export function relateLogicalDay(
  displayedDate: LogicalDate | undefined,
  today: LogicalDate,
): DayRelation {
  assertLogicalDate(today);
  if (displayedDate === undefined) return "other";
  assertLogicalDate(displayedDate);
  const displayedKey = displayedDate.year * 10_000 + displayedDate.month * 100 + displayedDate.day;
  const todayKey = today.year * 10_000 + today.month * 100 + today.day;
  return displayedKey < todayKey ? "past" : displayedKey > todayKey ? "future" : "today";
}

export function projectDay(input: DayProjectionInput): DayProjection {
  if (!isValidDayBounds(input.startMinutes, input.endMinutes)) {
    throw new RangeError("A day projection requires valid minute bounds");
  }
  const relation = relateLogicalDay(input.displayedDate, input.today);
  const playbackActive = input.playbackMinutes !== undefined
    && Number.isFinite(input.playbackMinutes);
  if (playbackActive) {
    const cursor = effectiveCursor(input.startMinutes, input.endMinutes, input.playbackMinutes);
    return Object.freeze({
      relation,
      scheduleFromMinutes: cursor,
      capacityFromMinutes: cursor,
      elapsedUntilMinutes: cursor,
      showNowNeedle: true,
      showBurning: true,
      availableInteractive: true,
      taskInteractive: relation === "today",
      playbackActive: true,
    });
  }

  if (relation === "today") {
    const cursor = effectiveCursor(input.startMinutes, input.endMinutes, input.nowMinutes);
    const nowInsideDay = Number.isFinite(input.nowMinutes)
      && input.startMinutes <= input.nowMinutes
      && input.nowMinutes < input.endMinutes;
    return Object.freeze({
      relation,
      scheduleFromMinutes: cursor,
      capacityFromMinutes: cursor,
      elapsedUntilMinutes: cursor,
      showNowNeedle: nowInsideDay,
      showBurning: nowInsideDay,
      availableInteractive: true,
      taskInteractive: true,
      playbackActive: false,
    });
  }
  if (relation === "past") {
    return Object.freeze({
      relation,
      scheduleFromMinutes: input.startMinutes,
      capacityFromMinutes: input.endMinutes,
      elapsedUntilMinutes: input.endMinutes,
      showNowNeedle: false,
      showBurning: false,
      availableInteractive: false,
      taskInteractive: false,
      playbackActive: false,
    });
  }
  return Object.freeze({
    relation,
    scheduleFromMinutes: input.startMinutes,
    capacityFromMinutes: input.startMinutes,
    elapsedUntilMinutes: null,
    showNowNeedle: false,
    showBurning: false,
    availableInteractive: true,
    taskInteractive: false,
    playbackActive: false,
  });
}

export function projectPlaybackMinute(input: PlaybackInput): number | null {
  if (!isValidDayBounds(input.startMinutes, input.endMinutes)) {
    throw new RangeError("Playback requires valid minute bounds");
  }
  const duration = input.durationMilliseconds ?? 6_000;
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(input.elapsedMilliseconds)) {
    throw new RangeError("Playback requires finite positive duration and elapsed time");
  }
  if (input.elapsedMilliseconds >= duration) return null;
  const progress = Math.max(0, input.elapsedMilliseconds) / duration;
  return input.startMinutes + (input.endMinutes - input.startMinutes) * progress;
}

export function isCurrentMinute(interval: CurrentInterval, nowMinutes: number): boolean {
  if (interval.status === "done" || interval.task?.status === "done") return false;
  return Number.isFinite(nowMinutes)
    && Number.isFinite(interval.startMinutes)
    && Number.isFinite(interval.endMinutes)
    && interval.startMinutes <= nowMinutes
    && nowMinutes < interval.endMinutes;
}
