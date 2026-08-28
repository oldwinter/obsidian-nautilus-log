import type { InlineSegment, TokenLocation } from "../model";
import { maskedSemanticText, type RemovalMap } from "./projection";
import { isUnicodeWhitespace } from "./whitespace";

export interface DurationToken {
  readonly location: TokenLocation;
  readonly minutes: number;
}

interface InvalidTimeRangeToken {
  readonly location: TokenLocation;
  readonly valid: false;
}

interface ValidTimeRangeToken {
  readonly location: TokenLocation;
  readonly valid: true;
  readonly startMinutes: number;
  readonly endMinutes: number;
  readonly warning?: "same-time" | "overnight-truncated";
}

export type TimeRangeToken = InvalidTimeRangeToken | ValidTimeRangeToken;

export interface ProgressToken {
  readonly location: TokenLocation;
  readonly percent: number;
}

export interface CompletionAnchorToken {
  readonly location: TokenLocation;
  readonly minutes: number;
}

const DURATION_PATTERN = /(?:[0-9]+[hH](?:[0-9]+[mM](?:[iI][nN])?)?|[0-9]+[mM](?:[iI][nN])?)/g;
const TIME_RANGE_PATTERN = /[0-9]{1,2}(?::[0-9]{1,2})?\p{White_Space}*(?:[aA][mM]|[pP][mM])?\p{White_Space}*(?:-|\u2013|[aA]\u017e|[tT][oO])\p{White_Space}*[0-9]{1,2}(?::[0-9]{1,2})?(?:\p{White_Space}*(?:[aA][mM]|[pP][mM]))?/gu;
const TIME_RANGE_PARTS = /^([0-9]{1,2})(?::([0-9]{1,2}))?\p{White_Space}*([aA][mM]|[pP][mM])?\p{White_Space}*(?:-|\u2013|[aA]\u017e|[tT][oO])\p{White_Space}*([0-9]{1,2})(?::([0-9]{1,2}))?\p{White_Space}*([aA][mM]|[pP][mM])?$/u;
const PROGRESS_PATTERN = /[dD][0-9]{1,3}%/g;
const COMPLETION_PATTERN = /d[0-9]{1,2}(?::[0-9]{1,2})?/g;

function isStartBoundary(text: string, index: number): boolean {
  return index <= 0 || isUnicodeWhitespace(text[index - 1]);
}

function isEndBoundary(text: string, index: number): boolean {
  return index >= text.length || isUnicodeWhitespace(text[index]);
}

function findBoundaryLocation(
  segments: readonly InlineSegment[],
  pattern: RegExp,
  removals: RemovalMap,
): { readonly location: TokenLocation; readonly text: string } | undefined {
  for (const [segmentIndex, segment] of segments.entries()) {
    if (segment.kind !== "semantic") continue;
    const text = maskedSemanticText(segment, segmentIndex, removals);
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const fromOffset = match.index;
      const toOffset = fromOffset + match[0].length;
      if (isStartBoundary(text, fromOffset) && isEndBoundary(text, toOffset)) {
        return {
          location: { segmentIndex, fromOffset, toOffset },
          text: match[0],
        };
      }
    }
  }
  return undefined;
}

function findSubstringLocation(
  segments: readonly InlineSegment[],
  pattern: RegExp,
  removals: RemovalMap,
): { readonly location: TokenLocation; readonly text: string } | undefined {
  for (const [segmentIndex, segment] of segments.entries()) {
    if (segment.kind !== "semantic") continue;
    const text = maskedSemanticText(segment, segmentIndex, removals);
    pattern.lastIndex = 0;
    const match = pattern.exec(text);
    if (match) {
      return {
        location: {
          segmentIndex,
          fromOffset: match.index,
          toOffset: match.index + match[0].length,
        },
        text: match[0],
      };
    }
  }
  return undefined;
}

function parseMinuteUnit(text: string): number {
  return Number.parseInt(text.replace(/[mM](?:[iI][nN])?$/, ""), 10);
}

export function findDuration(
  segments: readonly InlineSegment[],
  removals: RemovalMap,
): DurationToken | undefined {
  const match = findBoundaryLocation(segments, DURATION_PATTERN, removals);
  if (!match) return undefined;

  const hourIndex = match.text.search(/[hH]/);
  const minutes = hourIndex < 0
    ? parseMinuteUnit(match.text)
    : Number.parseInt(match.text.slice(0, hourIndex), 10) * 60
      + (hourIndex + 1 < match.text.length ? parseMinuteUnit(match.text.slice(hourIndex + 1)) : 0);
  return { location: match.location, minutes };
}

function parseClock(
  hourText: string,
  minuteText: string | undefined,
  meridiem: string | undefined,
): number | undefined {
  const hour = Number.parseInt(hourText, 10);
  const minute = minuteText === undefined ? 0 : Number.parseInt(minuteText, 10);
  if (minute > 59) return undefined;
  if (!meridiem) return hour <= 23 ? hour * 60 + minute : undefined;
  if (hour < 1 || hour > 12) return undefined;

  const normalizedHour = hour % 12 + (meridiem.toLowerCase() === "pm" ? 12 : 0);
  return normalizedHour * 60 + minute;
}

export function findTimeRange(
  segments: readonly InlineSegment[],
  removals: RemovalMap,
): TimeRangeToken | undefined {
  const match = findBoundaryLocation(segments, TIME_RANGE_PATTERN, removals);
  if (!match) return undefined;
  const parts = TIME_RANGE_PARTS.exec(match.text);
  if (!parts) return { location: match.location, valid: false };

  const endMeridiem = parts[6];
  const endMinutes = parseClock(parts[4]!, parts[5], endMeridiem);
  const startMinutes = parseClock(parts[1]!, parts[2], parts[3] ?? endMeridiem);
  if (startMinutes === undefined || endMinutes === undefined) {
    return { location: match.location, valid: false };
  }
  if (endMinutes > startMinutes) {
    return { location: match.location, valid: true, startMinutes, endMinutes };
  }
  if (endMinutes === startMinutes) {
    return {
      location: match.location,
      valid: true,
      startMinutes,
      endMinutes,
      warning: "same-time",
    };
  }
  return {
    location: match.location,
    valid: true,
    startMinutes,
    endMinutes: 1440,
    ...(endMinutes === 0 ? {} : { warning: "overnight-truncated" as const }),
  };
}

export function findProgress(
  segments: readonly InlineSegment[],
  removals: RemovalMap,
): ProgressToken | undefined {
  const match = findBoundaryLocation(segments, PROGRESS_PATTERN, removals);
  if (!match) return undefined;
  return {
    location: match.location,
    percent: Math.min(100, Number.parseInt(match.text.slice(1, -1), 10)),
  };
}

export function findCompletionAnchor(
  segments: readonly InlineSegment[],
  removals: RemovalMap,
): CompletionAnchorToken | undefined {
  const match = findSubstringLocation(segments, COMPLETION_PATTERN, removals);
  if (!match) return undefined;
  const [hourText, minuteText] = match.text.slice(1).split(":");
  return {
    location: match.location,
    minutes: Number.parseInt(hourText!, 10) * 60
      + (minuteText === undefined ? 0 : Number.parseInt(minuteText, 10)),
  };
}

export function findUrgentTrigger(
  segments: readonly InlineSegment[],
  trigger: string,
  removals: RemovalMap,
): TokenLocation | undefined {
  if (trigger.length === 0) return undefined;
  for (const [segmentIndex, segment] of segments.entries()) {
    if (segment.kind !== "semantic") continue;
    const text = maskedSemanticText(segment, segmentIndex, removals);
    let fromOffset = text.indexOf(trigger);
    while (fromOffset >= 0) {
      const toOffset = fromOffset + trigger.length;
      if (isStartBoundary(text, fromOffset) && isEndBoundary(text, toOffset)) {
        return { segmentIndex, fromOffset, toOffset };
      }
      fromOffset = text.indexOf(trigger, fromOffset + 1);
    }
  }
  return undefined;
}
