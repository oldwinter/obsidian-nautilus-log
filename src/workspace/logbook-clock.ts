import {
  isCanonicalClockId,
  parseClockText,
  type ClockParseResult,
  type ClockRecord,
} from "./clock-parser";
import {
  readLogbook,
  type LogbookClock,
  type LogbookReadOptions,
  type LogbookReadResult,
} from "./logbook-reader";
import { iteratePhysicalLines, markdownHtmlBlockStart, type PhysicalLine } from "./plan-region";
import type { WorkspacePlanItemSource } from "./primary-plan-resolver";
import type { ByteEdit } from "./mutations";

export type MarkdownLineEnding = "\n" | "\r\n" | "\r";

export type LogbookClockMutationErrorCode =
  | "source-span-mismatch"
  | "invalid-plan-item-id"
  | "invalid-clock-id"
  | "logbook-read-incomplete"
  | "ambiguous-logbook"
  | "clock-not-running"
  | "clock-not-legacy"
  | "clock-has-attached-content"
  | "end-before-start"
  | "legacy-start-offset-required"
  | "canonical-round-trip-failed";

export class LogbookClockMutationError extends Error {
  readonly code: LogbookClockMutationErrorCode;

  constructor(code: LogbookClockMutationErrorCode, message: string) {
    super(message);
    this.name = "LogbookClockMutationError";
    this.code = code;
  }
}

export interface CanonicalClockExpectation {
  readonly state: "running" | "closed";
  readonly clockId: string;
  readonly startEpochMs: number;
  readonly endEpochMs?: number;
}

export type SecureRandomValues = (
  values: Uint8Array<ArrayBuffer>,
) => Uint8Array<ArrayBuffer>;
export type IdCollisionLookup = (id: string) => boolean;

export interface UniqueIdGenerationOptions {
  readonly randomValues?: SecureRandomValues;
  readonly maximumAttempts?: number;
}

export interface RunningClockInsertion {
  readonly edits: readonly ByteEdit[];
  readonly clockText: string;
  readonly clockId: string;
  readonly lineEnding: MarkdownLineEnding;
  readonly insertedLogbook: boolean;
  readonly logbook: LogbookReadResult;
}

export interface CloseRunningClockInput {
  readonly endEpochMs: number;
  readonly endOffsetMinutes: number;
  readonly assignedClockId?: string;
  readonly legacyStartOffsetMinutes?: number;
}

export interface NormalizeLegacyClockInput {
  readonly clockId: string;
  readonly startEpochMs?: number;
  readonly startOffsetMinutes: number;
  readonly endEpochMs?: number;
  readonly endOffsetMinutes?: number;
}

export interface MarkdownContainerContent {
  readonly content: string;
  readonly contentOffset: number;
  readonly quoteDepth: number;
}

export interface CanonicalClockPhysicalLine {
  readonly text: string;
  readonly fromColumn: number;
  readonly toColumn: number;
  readonly clockId: string;
  readonly parsed: ClockParseResult;
  readonly standalone: boolean;
}

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const GENERATED_PLAN_ITEM_ID = /^nl-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BLOCK_ID = /^[A-Za-z0-9-]+$/;
const LIST_ITEM = /^([ \t]*)([-+*]|[0-9]{1,9}[.)])([ \t]+)(.*)$/;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function markdownContainerContent(lineText: string): MarkdownContainerContent {
  let contentOffset = 0;
  let quoteDepth = 0;
  while (contentOffset < lineText.length) {
    const marker = /^[ ]{0,3}>[ \t]?/.exec(lineText.slice(contentOffset));
    if (!marker) break;
    contentOffset += marker[0].length;
    quoteDepth += 1;
  }
  return Object.freeze({
    content: lineText.slice(contentOffset),
    contentOffset,
    quoteDepth,
  });
}

export function canonicalClockPhysicalLine(lineText: string): CanonicalClockPhysicalLine | undefined {
  const container = markdownContainerContent(lineText);
  const trimmed = container.content.slice(0, container.content.length - /[ \t]*$/.exec(container.content)![0].length);
  const clockColumn = trimmed.indexOf("CLOCK: [");
  if (clockColumn < 0) return undefined;
  const text = trimmed.slice(clockColumn);
  const idMatch = /(?:^|[ \t])\^([A-Za-z0-9-]+)$/.exec(text);
  if (!idMatch || !isCanonicalClockId(idMatch[1]!)) return undefined;
  const parsed = parseClockText(text);
  if (parsed.kind === "not-clock") return undefined;
  const leading = trimmed.slice(0, clockColumn);
  const standalone = /^[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?$/.test(leading);
  const fromColumn = container.contentOffset + clockColumn;
  return Object.freeze({
    text,
    fromColumn,
    toColumn: fromColumn + text.length,
    clockId: idMatch[1]!,
    parsed,
    standalone,
  });
}

function mutationError(code: LogbookClockMutationErrorCode, message: string): never {
  throw new LogbookClockMutationError(code, message);
}

function assertFiniteEpoch(name: string, epochMs: number): void {
  if (!Number.isFinite(epochMs) || !Number.isSafeInteger(epochMs)) {
    throw new RangeError(`${name} must be a finite safe integer in milliseconds`);
  }
}

function assertOffsetMinutes(offsetMinutes: number): void {
  if (!Number.isInteger(offsetMinutes) || Math.abs(offsetMinutes) > 23 * 60 + 59) {
    throw new RangeError("offsetMinutes must be a whole minute between -23:59 and +23:59");
  }
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

function localDate(epochMs: number, offsetMinutes: number): Date {
  assertFiniteEpoch("epochMs", epochMs);
  assertOffsetMinutes(offsetMinutes);
  const shifted = epochMs + offsetMinutes * 60_000;
  if (!Number.isSafeInteger(shifted)) throw new RangeError("shifted timestamp is outside the safe range");
  const date = new Date(shifted);
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 0 || date.getUTCFullYear() > 9999) {
    throw new RangeError("timestamp cannot be represented by CLOCK grammar v1");
  }
  return date;
}

function formatOffset(offsetMinutes: number): string {
  assertOffsetMinutes(offsetMinutes);
  const absolute = Math.abs(offsetMinutes);
  return `${offsetMinutes < 0 ? "-" : "+"}${pad(Math.floor(absolute / 60), 2)}:${pad(absolute % 60, 2)}`;
}

export function formatCanonicalClockTimestamp(epochMs: number, offsetMinutes: number): string {
  const date = localDate(epochMs, offsetMinutes);
  return [
    `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}`,
    WEEKDAYS[date.getUTCDay()],
    `${pad(date.getUTCHours(), 2)}:${pad(date.getUTCMinutes(), 2)}:${pad(date.getUTCSeconds(), 2)}.${pad(date.getUTCMilliseconds(), 3)}`,
    formatOffset(offsetMinutes),
  ].join(" ");
}

export function formatCanonicalRunningClock(
  startEpochMs: number,
  startOffsetMinutes: number,
  clockId: string,
): string {
  assertClockId(clockId);
  const text = `CLOCK: [${formatCanonicalClockTimestamp(startEpochMs, startOffsetMinutes)}] ^${clockId}`;
  assertCanonicalClockRoundTrip(text, {
    state: "running",
    clockId,
    startEpochMs,
  });
  return text;
}

export function formatClockDuration(startEpochMs: number, endEpochMs: number): string {
  assertFiniteEpoch("startEpochMs", startEpochMs);
  assertFiniteEpoch("endEpochMs", endEpochMs);
  if (endEpochMs < startEpochMs) {
    mutationError("end-before-start", "CLOCK end must not precede its start");
  }
  const minutes = Math.floor((endEpochMs - startEpochMs) / 60_000);
  if (!Number.isSafeInteger(minutes)) throw new RangeError("CLOCK duration is outside the safe range");
  return `${Math.floor(minutes / 60)}:${pad(minutes % 60, 2)}`;
}

export function formatCanonicalClosedClock(
  startEpochMs: number,
  startOffsetMinutes: number,
  endEpochMs: number,
  endOffsetMinutes: number,
  clockId: string,
): string {
  assertClockId(clockId);
  const text = [
    `CLOCK: [${formatCanonicalClockTimestamp(startEpochMs, startOffsetMinutes)}]`,
    `--[${formatCanonicalClockTimestamp(endEpochMs, endOffsetMinutes)}]`,
    ` => ${formatClockDuration(startEpochMs, endEpochMs)} ^${clockId}`,
  ].join("");
  assertCanonicalClockRoundTrip(text, {
    state: "closed",
    clockId,
    startEpochMs,
    endEpochMs,
  });
  return text;
}

export function canonicalClockRoundTrips(
  text: string,
  expectation: CanonicalClockExpectation,
): boolean {
  const parsed = parseClockText(text);
  if (
    parsed.kind !== "record"
    || parsed.record.format !== "canonical"
    || parsed.record.state !== expectation.state
    || parsed.record.clockId !== expectation.clockId
    || parsed.record.startEpochMs !== expectation.startEpochMs
    || parsed.diagnostics.length !== 0
  ) return false;
  if (expectation.state === "running") return expectation.endEpochMs === undefined;
  return parsed.record.state === "closed"
    && expectation.endEpochMs !== undefined
    && parsed.record.endEpochMs === expectation.endEpochMs
    && parsed.record.displayedDurationMinutes === parsed.record.actualMinutes;
}

export function assertCanonicalClockRoundTrip(
  text: string,
  expectation: CanonicalClockExpectation,
): void {
  if (!canonicalClockRoundTrips(text, expectation)) {
    mutationError("canonical-round-trip-failed", "Canonical CLOCK output did not round-trip exactly");
  }
}

function defaultRandomValues(values: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("CLOCK identity generation requires the public Web Crypto API");
  }
  return globalThis.crypto.getRandomValues(values);
}

export function generateUuidV4(randomValues: SecureRandomValues = defaultRandomValues): string {
  const generated = randomValues(new Uint8Array(16));
  if (!(generated instanceof Uint8Array) || generated.length !== 16) {
    throw new TypeError("randomValues must return the supplied 16-byte Uint8Array");
  }
  generated[6] = (generated[6]! & 0x0f) | 0x40;
  generated[8] = (generated[8]! & 0x3f) | 0x80;
  const hexadecimal = Array.from(generated, (value) => value.toString(16).padStart(2, "0"));
  const uuid = [
    hexadecimal.slice(0, 4).join(""),
    hexadecimal.slice(4, 6).join(""),
    hexadecimal.slice(6, 8).join(""),
    hexadecimal.slice(8, 10).join(""),
    hexadecimal.slice(10, 16).join(""),
  ].join("-");
  if (!UUID_V4.test(uuid)) throw new Error("Secure random source produced an invalid UUID v4");
  return uuid;
}

function generateUniqueId(
  prefix: "nl-" | "nl-clock-",
  collisionLookup: IdCollisionLookup,
  options: UniqueIdGenerationOptions,
): string {
  const maximumAttempts = options.maximumAttempts ?? 128;
  if (!Number.isSafeInteger(maximumAttempts) || maximumAttempts < 1) {
    throw new RangeError("maximumAttempts must be a positive safe integer");
  }
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const id = `${prefix}${generateUuidV4(options.randomValues)}`;
    if (!collisionLookup(id)) return id;
  }
  throw new Error(`Could not generate a collision-free ${prefix === "nl-" ? "Plan Item" : "CLOCK"} ID`);
}

export function generateUniquePlanItemId(
  collisionLookup: IdCollisionLookup,
  options: UniqueIdGenerationOptions = {},
): string {
  return generateUniqueId("nl-", collisionLookup, options);
}

export function generateUniqueClockId(
  collisionLookup: IdCollisionLookup,
  options: UniqueIdGenerationOptions = {},
): string {
  return generateUniqueId("nl-clock-", collisionLookup, options);
}

export function deriveFileLineEnding(source: string): MarkdownLineEnding {
  for (let offset = 0; offset < source.length; offset += 1) {
    if (source[offset] === "\n") return "\n";
    if (source[offset] === "\r") return source[offset + 1] === "\n" ? "\r\n" : "\r";
  }
  return "\n";
}

function assertPlanItemId(id: string): void {
  if (!GENERATED_PLAN_ITEM_ID.test(id)) {
    mutationError("invalid-plan-item-id", "Generated Plan Item ID must be nl- plus a lowercase UUID v4");
  }
}

function assertClockId(id: string): void {
  if (!isCanonicalClockId(id)) {
    mutationError("invalid-clock-id", "CLOCK ID must be nl-clock- plus a lowercase UUID v4");
  }
}

function frozenEdit(edit: ByteEdit): ByteEdit {
  return Object.freeze(edit);
}

function assertSpanText(source: string, fromOffset: number, toOffset: number, expected: string): void {
  if (
    !Number.isSafeInteger(fromOffset)
    || !Number.isSafeInteger(toOffset)
    || fromOffset < 0
    || toOffset < fromOffset
    || toOffset > source.length
    || source.slice(fromOffset, toOffset) !== expected
  ) {
    mutationError("source-span-mismatch", "Revalidated source span does not match current text");
  }
}

function assertPlanItemSource(source: string, item: WorkspacePlanItemSource): void {
  assertSpanText(
    source,
    item.firstLineSpan.fromOffset,
    item.firstLineSpan.toOffset,
    item.firstLineText,
  );
  if (
    item.itemSpan.fromOffset !== item.firstLineSpan.fromOffset
    || item.itemSpan.toOffset < item.firstLineSpan.toOffset
    || item.itemSpan.toOffset > source.length
  ) {
    mutationError("source-span-mismatch", "Plan Item structural span does not match its first line");
  }
}

export function createPlanItemIdentityInsertionEdit(
  source: string,
  item: WorkspacePlanItemSource,
  newId: string,
): ByteEdit {
  assertPlanItemId(newId);
  assertPlanItemSource(source, item);
  if (item.blockId !== undefined || item.blockIdSpan !== undefined) {
    mutationError("source-span-mismatch", "Plan Item already has a terminal identity");
  }
  const trailingWhitespace = /[ \t]*$/.exec(item.firstLineText)![0];
  const insertionOffset = item.firstLineSpan.toOffset - trailingWhitespace.length;
  return frozenEdit({
    fromOffset: insertionOffset,
    toOffset: insertionOffset,
    expected: "",
    replacement: ` ^${newId}`,
    semanticChange: "plan-item-identity-assigned",
  });
}

export function createPlanItemIdentityRepairEdit(
  source: string,
  item: WorkspacePlanItemSource,
  newId: string,
): ByteEdit {
  assertPlanItemId(newId);
  assertPlanItemSource(source, item);
  if (!item.blockId || !item.blockIdSpan || !BLOCK_ID.test(item.blockId)) {
    mutationError("source-span-mismatch", "Plan Item does not have the expected terminal identity");
  }
  const expected = `^${item.blockId}`;
  assertSpanText(source, item.blockIdSpan.fromOffset, item.blockIdSpan.toOffset, expected);
  return frozenEdit({
    fromOffset: item.blockIdSpan.fromOffset,
    toOffset: item.blockIdSpan.toOffset,
    expected,
    replacement: `^${newId}`,
    semanticChange: "plan-item-identity-repaired",
  });
}

function physicalLineForSpan(source: string, fromOffset: number, toOffset: number): PhysicalLine {
  for (const line of iteratePhysicalLines(source)) {
    if (fromOffset >= line.fromOffset && toOffset <= line.toOffset) return line;
  }
  return mutationError("source-span-mismatch", "Source span does not occupy one physical line");
}

function lineEndingForLine(source: string, line: PhysicalLine): MarkdownLineEnding | undefined {
  const ending = source.slice(line.toOffset, line.toOffsetWithEnding);
  return ending === "\n" || ending === "\r" || ending === "\r\n" ? ending : undefined;
}

function visualWidth(text: string): number {
  let width = 0;
  for (const character of text) width = character === "\t" ? width + (4 - width % 4) : width + 1;
  return width;
}

function childIndent(lineText: string): string {
  const match = LIST_ITEM.exec(lineText);
  if (!match) mutationError("source-span-mismatch", "LOGBOOK parent is not a list item");
  const parentIndent = match[1]!;
  const contentColumn = visualWidth(parentIndent + match[2]! + match[3]!);
  return parentIndent + " ".repeat(contentColumn - visualWidth(parentIndent));
}

function assertClockSource(source: string, clock: LogbookClock): void {
  assertSpanText(source, clock.fromOffset, clock.toOffset, clock.text);
}

export function createClockIdentityRepairEdit(
  source: string,
  clock: LogbookClock,
  newId: string,
): ByteEdit {
  assertClockId(newId);
  assertClockSource(source, clock);
  const rawIdMatch = /(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/.exec(clock.text);
  const rawId = rawIdMatch && isCanonicalClockId(rawIdMatch[1]!) ? rawIdMatch[1]! : undefined;
  const oldId = clock.parsed.kind === "record" ? clock.parsed.record.clockId : rawId;
  if (!oldId) {
    mutationError("source-span-mismatch", "CLOCK does not have the expected terminal identity");
  }
  const terminal = `^${oldId}`;
  if (!clock.text.endsWith(terminal)) {
    mutationError("source-span-mismatch", "CLOCK identity is not terminal in the selected source");
  }
  const fromOffset = clock.toOffset - terminal.length;
  return frozenEdit({
    fromOffset,
    toOffset: clock.toOffset,
    expected: terminal,
    replacement: `^${newId}`,
    semanticChange: "clock-identity-repaired",
  });
}

export function createRunningClockInsertionEdits(
  source: string,
  item: WorkspacePlanItemSource,
  startEpochMs: number,
  startOffsetMinutes: number,
  clockId: string,
  readOptions: LogbookReadOptions = {},
): RunningClockInsertion {
  assertPlanItemSource(source, item);
  const clockText = formatCanonicalRunningClock(startEpochMs, startOffsetMinutes, clockId);
  const logbook = readLogbook(source, {
    path: item.version.file,
    itemFromOffset: item.itemSpan.fromOffset,
    itemToOffset: item.itemSpan.toOffset,
    ...(item.blockId ? { ownerId: item.blockId } : {}),
  }, readOptions);
  if (!logbook.complete) {
    mutationError("logbook-read-incomplete", "LOGBOOK read exceeded its CLOCK record limit");
  }
  if (logbook.kind === "ambiguous") {
    mutationError("ambiguous-logbook", "Multiple accepted LOGBOOK drawers block insertion");
  }

  if (logbook.kind === "accepted") {
    const drawer = logbook.drawers[0]!;
    assertSpanText(source, drawer.fromOffset, drawer.toOffset, drawer.text);
    const drawerLine = physicalLineForSpan(source, drawer.fromOffset, drawer.toOffset);
    const lineEnding = lineEndingForLine(source, drawerLine) ?? deriveFileLineEnding(source);
    const clockLine = `${childIndent(drawerLine.text)}- ${clockText}`;
    const edit = frozenEdit({
      fromOffset: drawerLine.toOffset,
      toOffset: drawerLine.toOffset,
      expected: "",
      replacement: `${lineEnding}${clockLine}`,
      semanticChange: "clock-opened",
    });
    return Object.freeze({
      edits: Object.freeze([edit]),
      clockText,
      clockId,
      lineEnding,
      insertedLogbook: false,
      logbook,
    });
  }

  const ownerLine = physicalLineForSpan(
    source,
    item.firstLineSpan.fromOffset,
    item.firstLineSpan.toOffset,
  );
  const finalItemLine = physicalLineForSpan(source, item.itemSpan.toOffset, item.itemSpan.toOffset);
  const lineEnding = lineEndingForLine(source, finalItemLine) ?? deriveFileLineEnding(source);
  const drawerIndent = childIndent(ownerLine.text);
  const drawerLine = `${drawerIndent}- LOGBOOK::`;
  const clockLine = `${childIndent(drawerLine)}- ${clockText}`;
  const insertionOffset = item.itemSpan.toOffset;

  // Equal-offset insertions are intentionally ordered for applyAllowedByteEdits:
  // the later drawer edit is prepended before the CLOCK edit in the result.
  const clockEdit = frozenEdit({
    fromOffset: insertionOffset,
    toOffset: insertionOffset,
    expected: "",
    replacement: `${lineEnding}${clockLine}`,
    semanticChange: "clock-opened",
  });
  const drawerEdit = frozenEdit({
    fromOffset: insertionOffset,
    toOffset: insertionOffset,
    expected: "",
    replacement: `${lineEnding}${drawerLine}`,
    semanticChange: "logbook-inserted",
  });
  return Object.freeze({
    edits: Object.freeze([clockEdit, drawerEdit]),
    clockText,
    clockId,
    lineEnding,
    insertedLogbook: true,
    logbook,
  });
}

function exactClockReplacement(
  source: string,
  clock: LogbookClock,
  replacement: string,
  semanticChange: ByteEdit["semanticChange"],
): ByteEdit {
  assertClockSource(source, clock);
  return frozenEdit({
    fromOffset: clock.fromOffset,
    toOffset: clock.toOffset,
    expected: clock.text,
    replacement,
    semanticChange,
  });
}

function recordClockId(record: ClockRecord, assignedClockId: string | undefined): string {
  const clockId = record.clockId ?? assignedClockId;
  if (!clockId) mutationError("invalid-clock-id", "An ID-less legacy CLOCK must receive an ID in the same mutation");
  assertClockId(clockId);
  if (record.clockId && assignedClockId && record.clockId !== assignedClockId) {
    mutationError("invalid-clock-id", "Closing a CLOCK cannot replace an existing identity");
  }
  return clockId;
}

function canonicalStartOffset(clockText: string): number | undefined {
  const match = /^CLOCK: \[[^\]]+ ([+-])(\d{2}):(\d{2})\] \^nl-clock-/.exec(clockText);
  if (!match) return undefined;
  const absolute = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "+" ? absolute : -absolute;
}

export function createCloseRunningClockEdit(
  source: string,
  clock: LogbookClock,
  input: CloseRunningClockInput,
): ByteEdit {
  assertClockSource(source, clock);
  if (clock.parsed.kind !== "record" || clock.parsed.record.state !== "running") {
    mutationError("clock-not-running", "Only the exact running CLOCK can be closed");
  }
  const record = clock.parsed.record;
  if (input.endEpochMs < record.startEpochMs) {
    mutationError("end-before-start", "CLOCK end must not precede its start");
  }
  const clockId = recordClockId(record, input.assignedClockId);
  const startOffsetMinutes = record.format === "canonical"
    ? canonicalStartOffset(clock.text)
    : input.legacyStartOffsetMinutes;
  if (startOffsetMinutes === undefined) {
    mutationError(
      "legacy-start-offset-required",
      "Closing a legacy CLOCK requires its explicitly resolved start offset",
    );
  }
  const replacement = formatCanonicalClosedClock(
    record.startEpochMs,
    startOffsetMinutes,
    input.endEpochMs,
    input.endOffsetMinutes,
    clockId,
  );
  return exactClockReplacement(source, clock, replacement, "clock-closed");
}

export function createNormalizeLegacyClockEdit(
  source: string,
  clock: LogbookClock,
  input: NormalizeLegacyClockInput,
): ByteEdit {
  assertClockSource(source, clock);
  const legacyBody = clock.text.replace(/^:?[ \t]*clock::?[ \t]*/i, "").trimEnd();
  const stamp = "\\[\\d{4}-\\d{2}-\\d{2}(?: (?:Mon|Tue|Wed|Thu|Fri|Sat|Sun))? \\d{2}:\\d{2}\\]";
  const id = "(?: \\^nl-clock-[0-9A-Za-z-]+)?";
  const selectedFoldState = new RegExp(`^${stamp}${id}$`).test(legacyBody)
    ? "running"
    : new RegExp(`^${stamp}[ \\t]*--[ \\t]*${stamp}(?:[ \\t]*=>[ \\t]*\\d+:\\d{2})?${id}$`).test(legacyBody)
      ? "closed"
      : undefined;
  const selectedFold = clock.parsed.kind === "malformed"
    && clock.parsed.diagnostics.length === 1
    && clock.parsed.diagnostics[0]?.code === "ambiguous-local-time"
    && input.startEpochMs !== undefined
    && ((selectedFoldState === "running" && input.endEpochMs === undefined)
      || (selectedFoldState === "closed" && input.endEpochMs !== undefined));
  if (!selectedFold && (clock.parsed.kind !== "record" || clock.parsed.record.format !== "legacy")) {
    mutationError("clock-not-legacy", "Only an unambiguous legacy CLOCK or explicitly selected DST fold can be normalized");
  }
  const record = clock.parsed.kind === "record" ? clock.parsed.record : undefined;
  const rawId = /(?:^|[ \t])\^(nl-clock-[A-Za-z0-9-]+)[ \t]*$/.exec(clock.text)?.[1];
  if ((record?.clockId ?? rawId) && (record?.clockId ?? rawId) !== input.clockId) {
    mutationError("invalid-clock-id", "Legacy normalization cannot replace an existing CLOCK identity");
  }
  assertClockId(input.clockId);
  const startEpochMs = input.startEpochMs ?? record?.startEpochMs;
  if (startEpochMs === undefined) mutationError("clock-not-legacy", "Legacy normalization requires an exact selected start instant");
  const endEpochMs = input.endEpochMs ?? (record?.state === "closed" ? record.endEpochMs : undefined);
  const replacement = endEpochMs === undefined
    ? formatCanonicalRunningClock(startEpochMs, input.startOffsetMinutes, input.clockId)
    : formatCanonicalClosedClock(
        startEpochMs,
        input.startOffsetMinutes,
        endEpochMs,
        input.endOffsetMinutes ?? input.startOffsetMinutes,
        input.clockId,
      );
  return exactClockReplacement(source, clock, replacement, "legacy-clock-normalized");
}

export function createRebaseRunningClockEdit(
  source: string,
  clock: LogbookClock,
  startEpochMs: number,
  startOffsetMinutes: number,
): ByteEdit {
  assertClockSource(source, clock);
  if (
    clock.parsed.kind !== "record"
    || clock.parsed.record.state !== "running"
    || !clock.parsed.record.clockId
  ) {
    mutationError("clock-not-running", "Only an identified running CLOCK can be rebased");
  }
  const replacement = formatCanonicalRunningClock(
    startEpochMs,
    startOffsetMinutes,
    clock.parsed.record.clockId,
  );
  return exactClockReplacement(source, clock, replacement, "clock-rebased");
}

function indentationWidth(text: string): number {
  let width = 0;
  for (const character of text) width = character === "\t" ? width + (4 - width % 4) : width + 1;
  return width;
}

function structuralBlockStarts(lineText: string): boolean {
  if (markdownHtmlBlockStart(lineText)) return true;
  return /^ {0,3}(?:>|#{1,6}(?:[ \t]+|$)|`{3,}|~{3,})/.test(lineText)
    || /^ {0,3}(?:[*_-][ \t]*){3,}$/.test(lineText);
}

export function clockHasAttachedContent(source: string, clock: LogbookClock): boolean {
  assertClockSource(source, clock);
  const lines = [...iteratePhysicalLines(source)];
  const clockIndex = lines.findIndex((line) =>
    clock.fromOffset >= line.fromOffset && clock.toOffset <= line.toOffset,
  );
  if (clockIndex < 0) mutationError("source-span-mismatch", "CLOCK does not occupy a physical line");
  const clockLine = lines[clockIndex]!;
  const clockContainer = markdownContainerContent(clockLine.text);
  const clockList = LIST_ITEM.exec(clockContainer.content);
  if (!clockList) mutationError("source-span-mismatch", "CLOCK is not a list item");
  const contentIndent = visualWidth(clockList[1]! + clockList[2]! + clockList[3]!);
  let separatedByBlank = false;

  for (let index = clockIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    const container = markdownContainerContent(line.text);
    if (container.quoteDepth < clockContainer.quoteDepth) {
      if (separatedByBlank || /^[ \t]*$/.test(container.content)) return false;
      if (LIST_ITEM.test(container.content) || structuralBlockStarts(container.content)) return false;
      return true;
    }
    if (container.quoteDepth > clockContainer.quoteDepth) return true;
    if (/^[ \t]*$/.test(container.content)) {
      separatedByBlank = true;
      continue;
    }
    const lineIndent = indentationWidth(/^([ \t]*)/.exec(container.content)![1]!);
    const list = LIST_ITEM.exec(container.content);
    if (list) return lineIndent >= contentIndent;
    if (lineIndent >= contentIndent) return true;
    if (structuralBlockStarts(container.content)) return false;
    return !separatedByBlank;
  }
  return false;
}

export function createDeleteClockPhysicalLineEdit(
  source: string,
  clock: LogbookClock,
): ByteEdit {
  assertClockSource(source, clock);
  if (clockHasAttachedContent(source, clock)) {
    mutationError(
      "clock-has-attached-content",
      "CLOCK physical line has continuation or nested content",
    );
  }
  const line = physicalLineForSpan(source, clock.fromOffset, clock.toOffset);
  const expected = source.slice(line.fromOffset, line.toOffsetWithEnding);
  return frozenEdit({
    fromOffset: line.fromOffset,
    toOffset: line.toOffsetWithEnding,
    expected,
    replacement: "",
    semanticChange: "clock-deleted",
  });
}
