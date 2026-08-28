export type ClockDiagnosticCode =
  | "invalid-clock-syntax"
  | "invalid-timestamp"
  | "weekday-mismatch"
  | "displayed-duration-mismatch"
  | "end-before-start"
  | "ambiguous-local-time"
  | "nonexistent-local-time"
  | "local-time-resolver-required";

export interface ClockDiagnostic {
  readonly code: ClockDiagnosticCode;
}

export interface LocalTimestampParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
}

export type LocalTimeResolution =
  | { readonly kind: "unique"; readonly epochMs: number }
  | { readonly kind: "ambiguous" }
  | { readonly kind: "nonexistent" }
  | { readonly kind: "invalid" };

export type LocalTimeResolver = (parts: LocalTimestampParts) => LocalTimeResolution;

export interface ParseClockOptions {
  readonly resolveLocalTime?: LocalTimeResolver;
}

interface ClockRecordBase {
  readonly format: "canonical" | "legacy";
  readonly startEpochMs: number;
  readonly clockId?: string;
}

export interface RunningClockRecord extends ClockRecordBase {
  readonly state: "running";
}

export interface ClosedClockRecord extends ClockRecordBase {
  readonly state: "closed";
  readonly endEpochMs: number;
  readonly actualMinutes: number;
  readonly displayedDurationMinutes?: number;
}

export type ClockRecord = RunningClockRecord | ClosedClockRecord;

export type ClockParseResult =
  | {
      readonly kind: "not-clock";
      readonly diagnostics: readonly [];
    }
  | {
      readonly kind: "record";
      readonly record: ClockRecord;
      readonly diagnostics: readonly ClockDiagnostic[];
    }
  | {
      readonly kind: "malformed";
      readonly potentialRunning: boolean;
      readonly diagnostics: readonly ClockDiagnostic[];
    };

const UUID_V4 = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const CLOCK_ID_SOURCE = `nl-clock-${UUID_V4}`;
const STAMP_SOURCE = "(\\d{4})-(\\d{2})-(\\d{2}) (Mon|Tue|Wed|Thu|Fri|Sat|Sun) (\\d{2}):(\\d{2}):(\\d{2})\\.(\\d{3}) ([+-])(\\d{2}):(\\d{2})";
const CANONICAL_RUNNING = new RegExp(`^CLOCK: \\[${STAMP_SOURCE}\\] \\^(${CLOCK_ID_SOURCE})$`);
const CANONICAL_CLOSED = new RegExp(
  `^CLOCK: \\[${STAMP_SOURCE}\\]--\\[${STAMP_SOURCE}\\] => (\\d+):(\\d{2}) \\^(${CLOCK_ID_SOURCE})$`,
);
const LEGACY_PREFIX = /^:?[ \t]*clock::?[ \t]*/i;
const LEGACY_STAMP = "(\\d{4})-(\\d{2})-(\\d{2})(?: (Mon|Tue|Wed|Thu|Fri|Sat|Sun))? (\\d{2}):(\\d{2})";
const LEGACY_RUNNING = new RegExp(`^\\[${LEGACY_STAMP}\\](?: \\^(${CLOCK_ID_SOURCE}))?$`);
const LEGACY_CLOSED = new RegExp(
  `^\\[${LEGACY_STAMP}\\][ \\t]*--[ \\t]*\\[${LEGACY_STAMP}\\](?:[ \\t]*=>[ \\t]*(\\d+):(\\d{2}))?(?: \\^(${CLOCK_ID_SOURCE}))?$`,
);
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

interface ParsedStamp {
  readonly epochMs: number;
}

function frozenDiagnostics(...codes: readonly ClockDiagnosticCode[]): readonly ClockDiagnostic[] {
  return Object.freeze(codes.map((code) => Object.freeze({ code })));
}

function malformed(
  potentialRunning: boolean,
  ...codes: readonly ClockDiagnosticCode[]
): ClockParseResult {
  return Object.freeze({
    kind: "malformed" as const,
    potentialRunning,
    diagnostics: frozenDiagnostics(...codes),
  });
}

function validDateTime(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second = 0,
  millisecond = 0,
): number | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) {
    return undefined;
  }
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, millisecond);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
    || date.getUTCHours() !== hour
    || date.getUTCMinutes() !== minute
    || date.getUTCSeconds() !== second
    || date.getUTCMilliseconds() !== millisecond
  ) {
    return undefined;
  }
  return date.getTime();
}

function expectedWeekday(year: number, month: number, day: number): string | undefined {
  const epochMs = validDateTime(year, month, day, 0, 0);
  return epochMs === undefined ? undefined : WEEKDAYS[new Date(epochMs).getUTCDay()];
}

function parseCanonicalStamp(values: readonly string[], start: number): ParsedStamp | ClockDiagnosticCode {
  const year = Number(values[start]);
  const month = Number(values[start + 1]);
  const day = Number(values[start + 2]);
  const weekday = values[start + 3]!;
  const hour = Number(values[start + 4]);
  const minute = Number(values[start + 5]);
  const second = Number(values[start + 6]);
  const millisecond = Number(values[start + 7]);
  const sign = values[start + 8] === "+" ? 1 : -1;
  const offsetHour = Number(values[start + 9]);
  const offsetMinute = Number(values[start + 10]);
  const localEpochMs = validDateTime(year, month, day, hour, minute, second, millisecond);
  if (localEpochMs === undefined || offsetHour > 23 || offsetMinute > 59) return "invalid-timestamp";
  if (expectedWeekday(year, month, day) !== weekday) return "weekday-mismatch";
  return { epochMs: localEpochMs - sign * (offsetHour * 60 + offsetMinute) * 60_000 };
}

function parseDuration(hoursText: string, minutesText: string): number | undefined {
  const hours = Number(hoursText);
  const minutes = Number(minutesText);
  if (!Number.isSafeInteger(hours) || hours < 0 || minutes > 59) return undefined;
  const total = hours * 60 + minutes;
  return Number.isSafeInteger(total) ? total : undefined;
}

function canonicalRecord(text: string): ClockParseResult | undefined {
  const running = CANONICAL_RUNNING.exec(text);
  if (running) {
    const stamp = parseCanonicalStamp(running, 1);
    if (typeof stamp === "string") return malformed(true, stamp);
    const record: RunningClockRecord = Object.freeze({
      format: "canonical",
      state: "running",
      startEpochMs: stamp.epochMs,
      clockId: running[12]!,
    });
    return Object.freeze({ kind: "record", record, diagnostics: frozenDiagnostics() });
  }

  const closed = CANONICAL_CLOSED.exec(text);
  if (!closed) return undefined;
  const start = parseCanonicalStamp(closed, 1);
  const end = parseCanonicalStamp(closed, 12);
  if (typeof start === "string") return malformed(false, start);
  if (typeof end === "string") return malformed(false, end);
  if (end.epochMs < start.epochMs) return malformed(false, "end-before-start");
  const displayedDurationMinutes = parseDuration(closed[23]!, closed[24]!);
  if (displayedDurationMinutes === undefined) return malformed(false, "invalid-clock-syntax");
  const actualMinutes = Math.floor((end.epochMs - start.epochMs) / 60_000);
  const diagnostics = displayedDurationMinutes === actualMinutes
    ? frozenDiagnostics()
    : frozenDiagnostics("displayed-duration-mismatch");
  const record: ClosedClockRecord = Object.freeze({
    format: "canonical",
    state: "closed",
    startEpochMs: start.epochMs,
    endEpochMs: end.epochMs,
    actualMinutes,
    displayedDurationMinutes,
    clockId: closed[25]!,
  });
  return Object.freeze({ kind: "record", record, diagnostics });
}

function parseLegacyStamp(
  values: readonly string[],
  start: number,
  resolver: LocalTimeResolver | undefined,
): ParsedStamp | ClockDiagnosticCode {
  const year = Number(values[start]);
  const month = Number(values[start + 1]);
  const day = Number(values[start + 2]);
  const weekday = values[start + 3];
  const hour = Number(values[start + 4]);
  const minute = Number(values[start + 5]);
  if (validDateTime(year, month, day, hour, minute) === undefined) return "invalid-timestamp";
  if (weekday !== undefined && expectedWeekday(year, month, day) !== weekday) return "weekday-mismatch";
  if (!resolver) return "local-time-resolver-required";
  const resolution = resolver({ year, month, day, hour, minute });
  if (resolution.kind === "ambiguous") return "ambiguous-local-time";
  if (resolution.kind === "nonexistent") return "nonexistent-local-time";
  if (resolution.kind !== "unique" || !Number.isFinite(resolution.epochMs)) return "invalid-timestamp";
  return { epochMs: resolution.epochMs };
}

function legacyRecord(text: string, resolver: LocalTimeResolver | undefined): ClockParseResult | undefined {
  const prefix = LEGACY_PREFIX.exec(text);
  if (!prefix) return undefined;
  const body = text.slice(prefix[0].length).trimEnd();
  const running = LEGACY_RUNNING.exec(body);
  if (running) {
    const stamp = parseLegacyStamp(running, 1, resolver);
    if (typeof stamp === "string") return malformed(true, stamp);
    const record: RunningClockRecord = Object.freeze({
      format: "legacy",
      state: "running",
      startEpochMs: stamp.epochMs,
      ...(running[7] ? { clockId: running[7] } : {}),
    });
    return Object.freeze({ kind: "record", record, diagnostics: frozenDiagnostics() });
  }

  const closed = LEGACY_CLOSED.exec(body);
  if (!closed) return malformed(!looksClosed(body), "invalid-clock-syntax");
  const start = parseLegacyStamp(closed, 1, resolver);
  const end = parseLegacyStamp(closed, 7, resolver);
  if (typeof start === "string") return malformed(false, start);
  if (typeof end === "string") return malformed(false, end);
  if (end.epochMs < start.epochMs) return malformed(false, "end-before-start");
  const actualMinutes = Math.floor((end.epochMs - start.epochMs) / 60_000);
  const displayedDurationMinutes = closed[13] === undefined
    ? undefined
    : parseDuration(closed[13], closed[14]!);
  if (closed[13] !== undefined && displayedDurationMinutes === undefined) {
    return malformed(false, "invalid-clock-syntax");
  }
  const diagnostics = displayedDurationMinutes === undefined || displayedDurationMinutes === actualMinutes
    ? frozenDiagnostics()
    : frozenDiagnostics("displayed-duration-mismatch");
  const record: ClosedClockRecord = Object.freeze({
    format: "legacy",
    state: "closed",
    startEpochMs: start.epochMs,
    endEpochMs: end.epochMs,
    actualMinutes,
    ...(displayedDurationMinutes === undefined ? {} : { displayedDurationMinutes }),
    ...(closed[15] ? { clockId: closed[15] } : {}),
  });
  return Object.freeze({ kind: "record", record, diagnostics });
}

function looksClosed(text: string): boolean {
  return /\][ \t]*--[ \t]*\[/.test(text);
}

export function isCanonicalClockId(id: string): boolean {
  return new RegExp(`^${CLOCK_ID_SOURCE}$`).test(id);
}

export function parseClockText(text: string, options: ParseClockOptions = {}): ClockParseResult {
  const canonical = canonicalRecord(text);
  if (canonical) return canonical;

  const legacy = legacyRecord(text, options.resolveLocalTime);
  if (legacy) return legacy;

  if (LEGACY_PREFIX.test(text)) return malformed(!looksClosed(text), "invalid-clock-syntax");
  return Object.freeze({
    kind: "not-clock" as const,
    diagnostics: Object.freeze([]) as readonly [],
  });
}
