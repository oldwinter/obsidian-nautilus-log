import { parseGrammar } from "../core/grammar-v1";
import type { PlanItem, TokenLocation } from "../core/model";
import { addRemoval } from "../core/parser/projection";
import { findProgress } from "../core/parser/tokens";
import type { Editor, TFile, Vault } from "obsidian";
import { isCanonicalClockId, parseClockText } from "./clock-parser";
import { createCommitConflict, type CommitConflict, type WriteResultCode } from "./conflicts";
import {
  expectationMatchesPlan,
  revalidateClockExpectation,
  revalidatePlanItemExpectation,
  timeExpectationIsTrusted,
  type ClockExpectation,
  type ClockSelector,
  type MutationExpectation,
  type PlanItemExpectation,
  type PlanItemSelector,
  type RevalidatedClock,
  type RevalidatedPlanItem,
  type SelectedRepairAdmission,
} from "./expectation";
import { WorkspaceIndex, type IdentityLookup, type IndexedClockSource, type WorkspaceIndexOptions } from "./identity-index";
import {
  LogbookClockMutationError,
  canonicalClockPhysicalLine,
  clockHasAttachedContent,
  createClockIdentityRepairEdit,
  createCloseRunningClockEdit,
  createDeleteClockPhysicalLineEdit,
  createNormalizeLegacyClockEdit,
  createPlanItemIdentityInsertionEdit,
  createPlanItemIdentityRepairEdit,
  createRebaseRunningClockEdit,
  createRunningClockInsertionEdits,
  formatCanonicalClosedClock,
  formatCanonicalRunningClock,
  markdownContainerContent,
} from "./logbook-clock";
import { readLogbook, type LogbookReadOptions } from "./logbook-reader";
import {
  applyAllowedByteEdits,
  createMutationPlan,
  deleteConfirmationIsCurrent,
  isNoMarkdownAction,
  mutationPlanIsValid,
  type ByteEdit,
  type FileMutationOperation,
  type MutationAction,
  type MutationPlan,
  type MutationStage,
  type MigratePlanItemClassification,
  type SemanticChange,
} from "./mutations";
import { PLAN_CLOSE_MARKER, PLAN_OPEN_MARKER_V1, markdownHtmlBlockStart, scanPrimaryPlanRegion } from "./plan-region";
import { resolvePrimaryPlan, type WorkspacePlanItemSource } from "./primary-plan-resolver";
import {
  createCommitReceipt,
  type CommitOutcome,
  type CommitReceipt,
  type ResultingIdentity,
  type SourceReceiptInput,
  type SourceWritePrimitive,
} from "./receipt";
import { createSourceVersion, type SourceVersion } from "./source-version";
import type { SourceChangeListener, TextAccess, Unsubscribe } from "./text-access";

export interface AtomicTransformDecision<T> {
  readonly text: string;
  readonly edits: readonly ByteEdit[];
  readonly value: T;
}

export type AtomicConfirmationReader = () => Promise<string | undefined>;

export interface AtomicTransformResult<T> {
  readonly primitive: SourceWritePrimitive;
  readonly value: T;
  readonly readConfirmationText: AtomicConfirmationReader;
}

/**
 * Production adapters map this single callback to one Editor transaction for an
 * active file or one Vault.process transform for a background file.
 */
export interface AtomicTextAccess extends TextAccess {
  primitiveFor(path: string): SourceWritePrimitive;
  atomicTransform<T>(
    path: string,
    transform: (currentText: string) => AtomicTransformDecision<T>,
    onEnter?: (primitive: SourceWritePrimitive, readConfirmationText: AtomicConfirmationReader) => void,
  ): Promise<AtomicTransformResult<T>>;
}

export interface ObsidianAtomicTextAccessOptions {
  readonly text: TextAccess;
  readonly vault: Pick<Vault, "process">;
  readonly editorForPath: (path: string) => Pick<Editor, "getValue" | "transaction"> | undefined;
  readonly fileForPath: (path: string) => TFile | undefined;
}

function editorPositionAtOffset(text: string, targetOffset: number): { readonly line: number; readonly ch: number } {
  if (!Number.isSafeInteger(targetOffset) || targetOffset < 0 || targetOffset > text.length) {
    throw new RangeError("Editor edit offset is outside the source text");
  }
  let line = 0;
  let ch = 0;
  for (let index = 0; index < targetOffset; index += 1) {
    if (text[index] === "\r") {
      if (text[index + 1] === "\n" && index + 1 < targetOffset) index += 1;
      line += 1;
      ch = 0;
    } else if (text[index] === "\n") {
      line += 1;
      ch = 0;
    } else ch += 1;
  }
  return Object.freeze({ line, ch });
}

/** Active buffers use one Editor transaction; background files use one Vault.process transform. */
export class ObsidianAtomicTextAccess implements AtomicTextAccess {
  readonly #options: ObsidianAtomicTextAccessOptions;

  constructor(options: ObsidianAtomicTextAccessOptions) {
    this.#options = options;
  }

  listMarkdownPaths(signal?: AbortSignal): Promise<readonly string[]> {
    return this.#options.text.listMarkdownPaths(signal);
  }

  readText(path: string, signal?: AbortSignal): Promise<string | undefined> {
    const editor = this.#options.editorForPath(path);
    if (editor) return Promise.resolve(editor.getValue());
    return this.#options.text.readText(path, signal);
  }

  onChange(listener: SourceChangeListener): Unsubscribe {
    return this.#options.text.onChange(listener);
  }

  primitiveFor(path: string): SourceWritePrimitive {
    return this.#options.editorForPath(path) ? "editor" : "vault-process";
  }

  async atomicTransform<T>(
    path: string,
    transform: (currentText: string) => AtomicTransformDecision<T>,
    onEnter?: (primitive: SourceWritePrimitive, readConfirmationText: AtomicConfirmationReader) => void,
  ): Promise<AtomicTransformResult<T>> {
    const editor = this.#options.editorForPath(path);
    if (editor) {
      const readConfirmationText = async () => editor.getValue();
      onEnter?.("editor", readConfirmationText);
      const current = editor.getValue();
      const decision = transform(current);
      if (decision.text !== current) {
        if (applyAllowedByteEdits(current, decision.edits).text !== decision.text) {
          throw new Error("Editor transaction edits do not reconstruct the validated transform");
        }
        const descending = [...decision.edits]
          .sort((left, right) => right.fromOffset - left.fromOffset || right.toOffset - left.toOffset);
        const coalesced = descending.flatMap((edit, index) => {
          if (edit.fromOffset !== edit.toOffset) return [edit];
          if (index > 0 && descending[index - 1]?.fromOffset === edit.fromOffset
            && descending[index - 1]?.toOffset === edit.toOffset) return [];
          const atOffset = descending.filter((candidate) => candidate.fromOffset === edit.fromOffset
            && candidate.toOffset === edit.toOffset);
          return [Object.freeze({ ...edit, replacement: [...atOffset].reverse().map((candidate) => candidate.replacement).join("") })];
        });
        const changes = coalesced
          .map((edit) => Object.freeze({
            from: editorPositionAtOffset(current, edit.fromOffset),
            to: editorPositionAtOffset(current, edit.toOffset),
            text: edit.replacement,
          }));
        editor.transaction({
          changes,
        }, "nautilus-log");
      }
      return Object.freeze({ primitive: "editor" as const, value: decision.value, readConfirmationText });
    }

    const file = this.#options.fileForPath(path);
    if (!file) throw new Error("Background source is no longer available");
    const readConfirmationText = () => this.#options.text.readText(path);
    let value: T | undefined;
    let entered = false;
    await this.#options.vault.process(file, (current) => {
      onEnter?.("vault-process", readConfirmationText);
      const decision = transform(current);
      value = decision.value;
      entered = true;
      return decision.text;
    });
    if (!entered) throw new Error("Vault.process did not enter its transform");
    return Object.freeze({ primitive: "vault-process" as const, value: value as T, readConfirmationText });
  }
}

export interface CommitContext {
  readonly settingsVersion: number;
  readonly zoneId: string;
  readonly wallEpochMs: number;
  readonly monotonicMs: number;
  readonly discontinuity: boolean;
}

export interface WorkspaceCommitterOptions {
  readonly index?: WorkspaceIndexOptions;
  readonly logbook?: LogbookReadOptions;
  readonly readContext: () => CommitContext;
  /** Borrowed vault-scoped index; its caller retains lifecycle ownership. */
  readonly workspaceIndex?: WorkspaceIndex;
}

interface BuiltStage {
  readonly text: string;
  readonly byteEdits: readonly ByteEdit[];
  readonly semanticChanges: readonly SemanticChange[];
  readonly resultingIdentities: readonly ResultingIdentity[];
  readonly legacyKeyRelocations: readonly LegacyKeyRelocation[];
  readonly alreadyApplied: boolean;
}

interface LegacyKeyRelocation {
  readonly before: string;
  readonly after: string;
}

interface StageIndexFacts {
  readonly identity: (id: string) => IdentityLookup;
  readonly liveIdentity: (id: string) => IdentityLookup;
  readonly running: readonly IndexedClockSource[];
  readonly potentialRunning: readonly IndexedClockSource[];
}

type BuiltStageResult =
  | { readonly ok: true; readonly value: BuiltStage }
  | { readonly ok: false; readonly conflict: CommitConflict };

interface StageSuccess {
  readonly kind: "success";
  readonly path: string;
  readonly source?: SourceReceiptInput;
  readonly semanticChanges: readonly SemanticChange[];
  readonly resultingIdentities: readonly ResultingIdentity[];
  readonly legacyKeyRelocations?: readonly LegacyKeyRelocation[];
  readonly alreadyApplied: boolean;
  readonly confirmedNoChange?: SourceVersion;
}

interface StageStopped {
  readonly kind: "stopped";
  readonly outcome: Exclude<CommitOutcome, "applied" | "already-applied" | "partial-safe">;
  readonly sources: readonly SourceReceiptInput[];
  readonly result: CommitConflict;
}

type StageResult = StageSuccess | StageStopped;

class StageConflictError extends Error {
  readonly conflict: CommitConflict;

  constructor(conflict: CommitConflict) {
    super(conflict.code);
    this.name = "StageConflictError";
    this.conflict = conflict;
  }
}

function conflict(
  code: WriteResultCode,
  action: MutationAction,
  path?: string,
  stage?: number,
): CommitConflict {
  return createCommitConflict(code, {
    action,
    sources: path ? [{ path }] : [],
    ...(stage === undefined ? {} : { stage }),
  });
}

function isConflictOutcome(value: CommitConflict): "rejected" | "conflict" {
  return value.code === "action-no-longer-applicable"
    || value.code === "plan-item-not-found"
    || value.code === "clock-has-attached-content"
    || value.code === "ambiguous-local-time"
    || value.code === "nonexistent-local-time"
    ? "rejected"
    : "conflict";
}

function synchronousVersion(path: string, text: string): SourceVersion {
  return Object.freeze({ file: path, contentDigest: "0".repeat(64), contentLength: text.length });
}

function parsedPlanItemsIn(path: string, text: string): readonly PlanItem<WorkspacePlanItemSource>[] {
  const resolved = resolvePrimaryPlan(synchronousVersion(path, text), text);
  if (!resolved.region || resolved.limitExceeded || resolved.diagnostics.length > 0) return Object.freeze([]);
  const parsed = parseGrammar({ version: resolved.region.version, candidates: resolved.candidates });
  return parsed.supported ? parsed.items : Object.freeze([]);
}

function selectedRepairAdmission(
  identity: IdentityLookup,
  expectation: MutationExpectation,
  id: string,
): SelectedRepairAdmission | undefined {
  const selected = expectation.selectedRepair;
  if (!selected || selected.id !== id || identity.kind !== "collision") return undefined;
  const locationKey = (location: { readonly id: string; readonly path: string; readonly fromOffset: number; readonly toOffset: number }): string =>
    `${location.id}\0${location.path}\0${location.fromOffset}\0${location.toOffset}`;
  const current = identity.locations.map(locationKey).sort();
  const confirmed = selected.locations.map(locationKey).sort();
  if (!arraysEqual(current, confirmed)) return undefined;
  return Object.freeze({
    kind: "selected-repair" as const,
    identity,
    selectedSpan: selected.selectedSpan,
  });
}

function tokenOffsets(source: WorkspacePlanItemSource, location: TokenLocation): readonly [number, number] {
  const segment = source.segmentSources[location.segmentIndex];
  const from = segment?.sourceOffsets[location.fromOffset];
  const to = segment?.sourceOffsets[location.toOffset];
  if (!segment || from === undefined || to === undefined || to < from) {
    throw new RangeError("Owned token location is outside the revalidated source segment");
  }
  return Object.freeze([from, to]);
}

function insertionBeforeIdentity(source: WorkspacePlanItemSource): number {
  return source.contentSpan.toOffset;
}

function exactEdit(
  sourceText: string,
  fromOffset: number,
  toOffset: number,
  replacement: string,
  semanticChange: SemanticChange,
): ByteEdit {
  return Object.freeze({
    fromOffset,
    toOffset,
    expected: sourceText.slice(fromOffset, toOffset),
    replacement,
    semanticChange,
  });
}

function checkboxEdit(
  sourceText: string,
  item: WorkspacePlanItemSource,
  replacement: "[ ]" | "[x]",
): ByteEdit {
  if (!item.checkboxSpan) throw new RangeError("Action requires a canonical checkbox");
  return exactEdit(
    sourceText,
    item.checkboxSpan.fromOffset,
    item.checkboxSpan.toOffset,
    replacement,
    replacement === "[x]" ? "task-completed" : "task-reopened",
  );
}

function progressEdit(
  sourceText: string,
  item: PlanItem<WorkspacePlanItemSource>,
  replacement: string,
  semanticChange: SemanticChange,
): ByteEdit {
  const location = item.tokens.progress;
  if (!location) {
    const offset = insertionBeforeIdentity(item.source);
    return exactEdit(sourceText, offset, offset, ` ${replacement}`, semanticChange);
  }
  const [from, to] = tokenOffsets(item.source, location);
  return exactEdit(sourceText, from, to, replacement, semanticChange);
}

function removeTokenEdit(
  sourceText: string,
  item: WorkspacePlanItemSource,
  location: TokenLocation,
  semanticChange: SemanticChange,
): ByteEdit {
  const [from, to] = tokenOffsets(item, location);
  return exactEdit(sourceText, from, to, "", semanticChange);
}

function completionAnchor(logicalMinute: number): string {
  if (!Number.isInteger(logicalMinute) || logicalMinute < 0 || logicalMinute > 1_439) {
    throw new RangeError("logicalMinute must be a minute in the current logical day");
  }
  return `d${Math.floor(logicalMinute / 60)}:${String(logicalMinute % 60).padStart(2, "0")}`;
}

function targetId(operation: FileMutationOperation): string | undefined {
  switch (operation.kind) {
    case "assign-plan-item-identity": return undefined;
    case "initialize-plan":
    case "migrate-plan": return undefined;
    case "repair-plan-item-identity":
    case "repair-clock-identity":
    case "advance-progress":
    case "reopen-progress":
    case "clock-in":
    case "clock-out":
    case "complete":
    case "delete-clock":
    case "normalize-legacy-clock":
    case "rebase-clock": return operation.target.id;
  }
}

function stableTargetIds(
  operation: FileMutationOperation,
  boundOwnerId?: string,
  ignoreUnusedClockInFacts = false,
): readonly string[] {
  const ids: string[] = [];
  if (boundOwnerId) ids.push(boundOwnerId);
  switch (operation.kind) {
    case "repair-plan-item-identity":
    case "repair-clock-identity":
    case "delete-clock":
      break;
    case "normalize-legacy-clock":
      ids.push(operation.clockId);
      break;
    case "assign-plan-item-identity":
    case "initialize-plan":
    case "migrate-plan":
      break;
    case "clock-in":
      if (operation.target.id) ids.push(operation.target.id);
      if (!ignoreUnusedClockInFacts) ids.push(operation.clock.clockId);
      break;
    case "advance-progress":
    case "complete":
      if (operation.target.id) ids.push(operation.target.id);
      if (operation.closeClock?.clockId) ids.push(operation.closeClock.clockId);
      break;
    default: {
      const id = targetId(operation);
      if (id) ids.push(id);
      break;
    }
  }
  return Object.freeze(ids);
}

function missingTargetIds(operation: FileMutationOperation): readonly string[] {
  return operation.kind === "delete-clock" && operation.target.id
    ? Object.freeze([operation.target.id])
    : Object.freeze([]);
}

function findPlanExpectation(
  expectation: MutationExpectation,
  selector: PlanItemSelector,
  originalPath: string,
): PlanItemExpectation | undefined {
  return expectation.planItems.find((entry) => selector.id
    ? entry.target.id === selector.id
    : entry.target.id === undefined && entry.path === originalPath);
}

function findClockExpectation(
  expectation: MutationExpectation,
  selector: ClockSelector,
  originalPath: string,
): ClockExpectation | undefined {
  const matches = expectation.clocks.filter((entry) => selector.id
    ? entry.target.id === selector.id
    : entry.target.id === undefined && entry.path === originalPath
      && (selector.ownerId === undefined || entry.ownerId === selector.ownerId)
      && (selector.fromOffset === undefined || entry.span.fromOffset === selector.fromOffset));
  return selector.id ? matches[0] : matches.length === 1 ? matches[0] : undefined;
}

function identityFor(index: StageIndexFacts, id: string | undefined): IdentityLookup | undefined {
  return id === undefined ? undefined : index.identity(id);
}

function resultingIdentity(kind: "plan-item" | "clock", id: string, path: string): ResultingIdentity {
  return Object.freeze({ kind, id, path });
}

function identityIsUniqueOrNew(index: StageIndexFacts, id: string): boolean {
  return index.identity(id).kind === "missing";
}

function logbookErrorConflict(error: LogbookClockMutationError, action: MutationAction, path: string): CommitConflict {
  const mapped: Partial<Record<LogbookClockMutationError["code"], WriteResultCode>> = {
    "ambiguous-logbook": "logbook-ambiguous",
    "logbook-read-incomplete": "source-over-limit",
    "clock-has-attached-content": "clock-has-attached-content",
    "end-before-start": "clock-discontinuity",
    "legacy-start-offset-required": "ambiguous-local-time",
  };
  return conflict(mapped[error.code] ?? "source-conflict", action, path);
}

function contextMatches(expectation: MutationExpectation, context: CommitContext): boolean {
  if (
    context.settingsVersion !== expectation.settingsVersion
    || context.zoneId !== expectation.zoneId
    || context.discontinuity
    || !timeExpectationIsTrusted(expectation.time)
  ) return false;
  const wallElapsed = context.wallEpochMs - expectation.time.wallEpochMs;
  const monotonicElapsed = context.monotonicMs - expectation.time.monotonicMs;
  return monotonicElapsed >= 0
    && monotonicElapsed <= expectation.time.maximumQueueDelayMs
    && Math.abs(wallElapsed - monotonicElapsed) <= expectation.time.maximumDriftMs;
}

function actionRequiresTrustedTime(action: MutationAction): boolean {
  return action === "clock-in"
    || action === "switch-task"
    || action === "clock-out"
    || action === "advance-progress"
    || action === "complete"
    || action === "delete-clock"
    || action === "normalize-legacy-clock"
    || action === "repair-overlap"
    || action === "repair-done-owner-clock"
    ;
}

function mutationContextMatches(expectation: MutationExpectation, context: CommitContext): boolean {
  if (context.settingsVersion !== expectation.settingsVersion || context.zoneId !== expectation.zoneId) return false;
  if (expectation.action === "keep-measured-time" || expectation.action === "stop-at-trusted-time") {
    return expectation.time.discontinuity
      && context.discontinuity
      && Number.isFinite(context.wallEpochMs)
      && Number.isFinite(context.monotonicMs)
      && context.monotonicMs >= expectation.time.monotonicMs;
  }
  return !actionRequiresTrustedTime(expectation.action) || contextMatches(expectation, context);
}

function planContextMatches(
  plan: MutationPlan,
  expectation: MutationExpectation,
  context: CommitContext,
): boolean {
  if (!mutationContextMatches(expectation, context)) return false;
  for (const stage of plan.stages) {
    for (const operation of stage.operations) {
      if (operation.kind !== "delete-clock") continue;
      const elapsed = context.wallEpochMs - operation.confirmation.secondActivationEpochMs;
      if (!Number.isFinite(elapsed) || elapsed < 0 || elapsed > 2_500) return false;
    }
  }
  const operations = plan.stages.flatMap((stage) => stage.operations);
  const anchor = localMinuteInZone(expectation.time.wallEpochMs, plan.zoneId);
  const isAnchorEndpoint = (epochMs: number, offsetMinutes: number): boolean => anchor !== undefined
    && epochMs === expectation.time.wallEpochMs
    && offsetMinutes === anchor.offsetMinutes;
  for (const operation of operations) {
    if (operation.kind === "clock-out"
      && localMinuteInZone(operation.close.endEpochMs, plan.zoneId)?.offsetMinutes !== operation.close.offsetMinutes) {
      return false;
    }
    if (operation.kind === "normalize-legacy-clock"
      && operation.endEpochMs !== undefined
      && localMinuteInZone(operation.endEpochMs, plan.zoneId)?.offsetMinutes !== operation.endOffsetMinutes) {
      return false;
    }
  }
  if (plan.action === "clock-in") {
    if (operations.length !== 1 || operations[0]?.kind !== "clock-in"
      || !isAnchorEndpoint(operations[0].clock.startEpochMs, operations[0].clock.offsetMinutes)) return false;
  }
  if (plan.action === "switch-task") {
    if (operations.length !== 2
      || operations[0]?.kind !== "clock-out"
      || operations[1]?.kind !== "clock-in"
      || !isAnchorEndpoint(operations[0].close.endEpochMs, operations[0].close.offsetMinutes)
      || !isAnchorEndpoint(operations[1].clock.startEpochMs, operations[1].clock.offsetMinutes)) return false;
  }
  if (plan.action === "clock-out") {
    if (operations.length === 1 && (operations[0]?.kind !== "clock-out"
      || !isAnchorEndpoint(operations[0].close.endEpochMs, operations[0].close.offsetMinutes))) return false;
  }
  if (plan.action === "complete") {
    if (operations.length !== 1 || operations[0]?.kind !== "complete") return false;
    if (operations[0].closeClock
      && !isAnchorEndpoint(operations[0].closeClock.endEpochMs, operations[0].closeClock.offsetMinutes)) return false;
  }
  if (plan.action === "advance-progress") {
    if (operations.length !== 1 || operations[0]?.kind !== "advance-progress" || !anchor) return false;
    if (operations[0].logicalMinute !== anchor.hour * 60 + anchor.minute) return false;
    if (operations[0].closeClock
      && !isAnchorEndpoint(operations[0].closeClock.endEpochMs, operations[0].closeClock.offsetMinutes)) return false;
  }
  if (plan.action === "stop-at-trusted-time") {
    if (operations.length !== 1 || operations[0]?.kind !== "clock-out") return false;
    const plannedDelta = operations[0].close.endEpochMs - expectation.time.wallEpochMs;
    const currentDelta = context.monotonicMs - expectation.time.monotonicMs;
    if (!Number.isFinite(plannedDelta)
      || plannedDelta < 0
      || currentDelta < plannedDelta
      || currentDelta - plannedDelta > expectation.time.maximumQueueDelayMs) return false;
  }
  if (plan.action === "keep-measured-time") {
    if (operations.length !== 1 || operations[0]?.kind !== "rebase-clock"
      || !Number.isFinite(operations[0].startEpochMs)
      || operations[0].startEpochMs > context.wallEpochMs
      || localMinuteInZone(operations[0].startEpochMs, plan.zoneId)?.offsetMinutes !== operations[0].offsetMinutes) return false;
  }
  return true;
}

function initializeLineEnding(text: string): "\n" | "\r\n" | "mixed" | "invalid" | undefined {
  let sawLf = false;
  let sawCrLf = false;
  for (let offset = 0; offset < text.length; offset += 1) {
    if (text[offset] === "\r") {
      if (text[offset + 1] !== "\n") return "invalid";
      sawCrLf = true;
      offset += 1;
    } else if (text[offset] === "\n") {
      sawLf = true;
    }
    if (sawLf && sawCrLf) return "mixed";
  }
  return sawCrLf ? "\r\n" : sawLf ? "\n" : undefined;
}

function initializeInsertionIsPhysicalLineBoundary(text: string, insertionOffset: number): boolean {
  if (!Number.isSafeInteger(insertionOffset) || insertionOffset < 0 || insertionOffset > text.length) return false;
  const logicalStart = text.startsWith("\uFEFF") ? 1 : 0;
  if (insertionOffset === logicalStart) return true;
  if (insertionOffset < logicalStart || insertionOffset === 0) return false;
  return text[insertionOffset - 1] === "\n";
}

export function legacyRunningClockKey(path: string, fromOffset: number, text: string): string {
  return `legacy:${path.length}:${path}:${fromOffset}:${text.length}:${text}`;
}

function redactedLegacyRunningClockKey(path: string, fromOffset: number, text: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `legacy:${path}:${fromOffset}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function indexedClockKey(clock: IndexedClockSource): string {
  if (clock.clockId) return clock.clockId;
  const rawIdMatch = /(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/.exec(clock.text);
  if (rawIdMatch && isCanonicalClockId(rawIdMatch[1]!)) return rawIdMatch[1]!;
  return legacyRunningClockKey(clock.path, clock.fromOffset, clock.text);
}

function sortedRunningKeys(running: readonly IndexedClockSource[]): readonly string[] {
  return Object.freeze(running.map(indexedClockKey).sort());
}

function receiptRunningKey(clock: IndexedClockSource): string {
  return clock.clockId ?? redactedLegacyRunningClockKey(clock.path, clock.fromOffset, clock.text);
}

function receiptRunningKeys(running: readonly IndexedClockSource[]): readonly string[] {
  return Object.freeze(running.map(receiptRunningKey).sort());
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function relocateLegacyKeys(
  keys: readonly string[],
  relocations: ReadonlyMap<string, string>,
): readonly string[] {
  return Object.freeze(keys.map((key) => relocations.get(key) ?? key).sort());
}

function legacyKeyRelocationsForStage(
  currentPath: string,
  currentText: string,
  afterText: string,
  edits: readonly ByteEdit[],
  expectation: MutationExpectation,
): readonly LegacyKeyRelocation[] {
  const relocations: LegacyKeyRelocation[] = [];
  for (const expected of expectation.clocks) {
    if (
      expected.target.id !== undefined
      || expected.state !== "running"
      || expected.path !== currentPath
      || expected.sourceText !== currentText
    ) continue;
    const touched = edits.some((edit) =>
      (edit.fromOffset < expected.span.toOffset && edit.toOffset > expected.span.fromOffset)
      || (edit.fromOffset === edit.toOffset
        && edit.fromOffset > expected.span.fromOffset
        && edit.fromOffset < expected.span.toOffset),
    );
    if (touched) continue;
    const delta = edits.reduce((total, edit) => edit.toOffset <= expected.span.fromOffset
      ? total + edit.replacement.length - (edit.toOffset - edit.fromOffset)
      : total, 0);
    const relocatedOffset = expected.span.fromOffset + delta;
    if (afterText.slice(relocatedOffset, relocatedOffset + expected.text.length) !== expected.text) continue;
    const before = legacyRunningClockKey(currentPath, expected.span.fromOffset, expected.text);
    const after = legacyRunningClockKey(currentPath, relocatedOffset, expected.text);
    if (before !== after) relocations.push(Object.freeze({ before, after }));
  }
  return Object.freeze(relocations);
}

function migrateClassifications(
  items: readonly PlanItem<WorkspacePlanItemSource>[],
): readonly MigratePlanItemClassification[] | undefined {
  const classifications: MigratePlanItemClassification[] = [];
  for (const item of items) {
    if (!item.source.blockId) return undefined;
    classifications.push(Object.freeze({
      id: item.source.blockId,
      kind: item.kind,
      status: item.status,
    }));
  }
  return Object.freeze(classifications.sort((left, right) => left.id.localeCompare(right.id)));
}

function classificationsEqual(
  left: readonly MigratePlanItemClassification[],
  right: readonly MigratePlanItemClassification[],
): boolean {
  const normalized = (values: readonly MigratePlanItemClassification[]) => [...values]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(({ id, kind, status }) => `${id}\0${kind}\0${status}`);
  return arraysEqual(normalized(left), normalized(right));
}

interface SynchronousPhysicalLine {
  readonly start: number;
  readonly end: number;
  readonly content: string;
}

const SYNC_FENCE_OPEN = /^([ \t]*)(`{3,}|~{3,})/;
const SYNC_LIST_ITEM = /^([ \t]*)([-+*]|[0-9]{1,9}[.)])([ \t]+)/;

function synchronousPhysicalLines(text: string): readonly SynchronousPhysicalLine[] {
  const lines: SynchronousPhysicalLine[] = [];
  let start = 0;
  for (let offset = 0; offset < text.length; offset += 1) {
    const code = text.charCodeAt(offset);
    if (code !== 10 && code !== 13) continue;
    lines.push({ start, end: offset, content: text.slice(start, offset) });
    if (code === 13 && text.charCodeAt(offset + 1) === 10) offset += 1;
    start = offset + 1;
  }
  lines.push({ start, end: text.length, content: text.slice(start) });
  return lines;
}

function synchronousIndentationWidth(text: string): number {
  let width = 0;
  for (const character of text) width = character === "\t" ? width + (4 - width % 4) : width + 1;
  return width;
}

function synchronousTableRow(content: string): boolean {
  return /^ {0,3}\S.*\|.*$/.test(content) || /^ {0,3}\|.*$/.test(content);
}

function synchronousTableDelimiter(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.includes("|")) return false;
  const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|");
  return cells.length > 0 && cells.every((cell) => /^[ \t]*:?-{3,}:?[ \t]*$/.test(cell));
}

function synchronousOutsideFenceLines(text: string): readonly SynchronousPhysicalLine[] {
  const output: SynchronousPhysicalLine[] = [];
  let fence: { readonly marker: string; readonly length: number; readonly quoteDepth: number } | undefined;
  let htmlBlock: { readonly closePattern?: RegExp; readonly endsOnBlank: boolean; readonly quoteDepth: number } | undefined;
  let frontmatter = false;
  let firstLine = true;
  let separatedByBlank = false;
  let listQuoteDepth = 0;
  let indentedCodeAt: number | undefined;
  let pendingTableHeader: SynchronousPhysicalLine | undefined;
  let inTable = false;
  const listContentIndents: number[] = [];
  for (const line of synchronousPhysicalLines(text)) {
    const firstContent = firstLine && line.content.startsWith("\uFEFF") ? line.content.slice(1) : line.content;
    if (firstLine && firstContent === "---") {
      frontmatter = true;
      firstLine = false;
      continue;
    }
    firstLine = false;
    if (frontmatter) {
      if (line.content === "---" || line.content === "...") frontmatter = false;
      continue;
    }
    const container = markdownContainerContent(line.content);
    if (pendingTableHeader) {
      if (synchronousTableDelimiter(container.content)) {
        pendingTableHeader = undefined;
        inTable = true;
        continue;
      }
      output.push(pendingTableHeader);
      pendingTableHeader = undefined;
    }
    if (inTable) {
      if (synchronousTableRow(container.content)) continue;
      inTable = false;
    }
    if (container.quoteDepth !== listQuoteDepth) {
      listContentIndents.length = 0;
      separatedByBlank = false;
      indentedCodeAt = undefined;
      listQuoteDepth = container.quoteDepth;
    }
    if (fence && container.quoteDepth < fence.quoteDepth) fence = undefined;
    const rawFenceMatch = SYNC_FENCE_OPEN.exec(container.content);
    if (fence) {
      if (rawFenceMatch) {
        const run = rawFenceMatch[2]!;
        const remainder = container.content.slice(rawFenceMatch[0].length);
        const indent = synchronousIndentationWidth(rawFenceMatch[1]!);
        const validIndent = indent <= 3 || (listContentIndents.length > 0
          && indent >= listContentIndents[listContentIndents.length - 1]!
          && indent <= listContentIndents[listContentIndents.length - 1]! + 3);
        if (container.quoteDepth === fence.quoteDepth && validIndent && run[0] === fence.marker
          && run.length >= fence.length && /^[ \t]*$/.test(remainder)) fence = undefined;
      }
      continue;
    }
    if (htmlBlock) {
      if (container.quoteDepth < htmlBlock.quoteDepth) htmlBlock = undefined;
      else {
        if (container.quoteDepth === htmlBlock.quoteDepth && htmlBlock.endsOnBlank && /^[ \t]*$/.test(container.content)) {
          htmlBlock = undefined;
        } else if (container.quoteDepth === htmlBlock.quoteDepth && htmlBlock.closePattern?.test(container.content)) {
          htmlBlock = undefined;
        }
        continue;
      }
    }
    const blank = /^[ \t]*$/.test(container.content);
    const indentText = /^([ \t]*)/.exec(container.content)![1]!;
    const indent = synchronousIndentationWidth(indentText);
    if (indentedCodeAt !== undefined) {
      if (blank) {
        separatedByBlank = true;
        continue;
      }
      if (indent >= indentedCodeAt) continue;
      indentedCodeAt = undefined;
    }
    if (blank) {
      separatedByBlank = true;
      continue;
    }
    while (listContentIndents.length > 0 && indent < listContentIndents[listContentIndents.length - 1]!) {
      listContentIndents.pop();
    }
    if (separatedByBlank && listContentIndents.length > 0
      && indent >= listContentIndents[listContentIndents.length - 1]! + 4) {
      indentedCodeAt = listContentIndents[listContentIndents.length - 1]! + 4;
      separatedByBlank = false;
      continue;
    }
    if (listContentIndents.length === 0 && indent >= 4) {
      indentedCodeAt = 4;
      separatedByBlank = false;
      continue;
    }
    const list = SYNC_LIST_ITEM.exec(container.content);
    if (list) {
      const blockContent = container.content.slice(list[0].length);
      listContentIndents.push(synchronousIndentationWidth(list[1]! + list[2]! + list[3]!));
      const listFence = SYNC_FENCE_OPEN.exec(blockContent);
      if (listFence) {
        const run = listFence[2]!;
        const remainder = blockContent.slice(listFence[0].length);
        if (run[0] !== "`" || !remainder.includes("`")) {
          fence = { marker: run[0]!, length: run.length, quoteDepth: container.quoteDepth };
          separatedByBlank = false;
          continue;
        }
      }
      const listHtmlStart = markdownHtmlBlockStart(blockContent);
      if (listHtmlStart) {
        if (listHtmlStart.endsOnBlank || !listHtmlStart.closedOnOpeningLine) {
          htmlBlock = {
            ...(listHtmlStart.closePattern ? { closePattern: listHtmlStart.closePattern } : {}),
            endsOnBlank: listHtmlStart.endsOnBlank,
            quoteDepth: container.quoteDepth,
          };
        }
        separatedByBlank = false;
        continue;
      }
      separatedByBlank = false;
      output.push(line);
      continue;
    }
    if (rawFenceMatch) {
      const run = rawFenceMatch[2]!;
      const remainder = container.content.slice(rawFenceMatch[0].length);
      const validIndent = indent <= 3 || (listContentIndents.length > 0
        && indent >= listContentIndents[listContentIndents.length - 1]!
        && indent <= listContentIndents[listContentIndents.length - 1]! + 3);
      if (validIndent && (run[0] !== "`" || !remainder.includes("`"))) {
        fence = { marker: run[0]!, length: run.length, quoteDepth: container.quoteDepth };
        separatedByBlank = false;
        continue;
      }
    }
    const htmlStart = markdownHtmlBlockStart(container.content);
    if (htmlStart) {
      if (htmlStart.endsOnBlank || !htmlStart.closedOnOpeningLine) {
        htmlBlock = {
          ...(htmlStart.closePattern ? { closePattern: htmlStart.closePattern } : {}),
          endsOnBlank: htmlStart.endsOnBlank,
          quoteDepth: container.quoteDepth,
        };
      }
      separatedByBlank = false;
      continue;
    }
    separatedByBlank = false;
    if (synchronousTableRow(container.content)) pendingTableHeader = line;
    else output.push(line);
  }
  if (pendingTableHeader) output.push(pendingTableHeader);
  return output;
}

function runningFingerprint(
  key: string,
  path: string,
  fromOffset: number,
  toOffset: number,
  text: string,
  ownerId: string | undefined,
): string {
  return `${key}\0${path}\0${fromOffset}\0${toOffset}\0${ownerId ?? ""}\0${text}`;
}

function indexedRunningFingerprint(clock: IndexedClockSource): string {
  return runningFingerprint(indexedClockKey(clock), clock.path, clock.fromOffset, clock.toOffset, clock.text, clock.ownerId);
}

function localMinuteInZone(epochMs: number, zoneId: string): {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly offsetMinutes: number;
} | undefined {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zoneId,
      calendar: "gregory",
      numberingSystem: "latn",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(epochMs));
    const number = (type: Intl.DateTimeFormatPartTypes): number | undefined => {
      const value = parts.find((part) => part.type === type)?.value;
      return value === undefined ? undefined : Number(value);
    };
    const year = number("year");
    const month = number("month");
    const day = number("day");
    const hour = number("hour");
    const minute = number("minute");
    const second = number("second");
    if ([year, month, day, hour, minute, second].some((value) => !Number.isInteger(value))) return undefined;
    const localAsUtc = Date.UTC(year!, month! - 1, day!, hour!, minute!, second!);
    const wholeSecondEpochMs = Math.floor(epochMs / 1_000) * 1_000;
    const offsetMinutes = (localAsUtc - wholeSecondEpochMs) / 60_000;
    if (!Number.isInteger(offsetMinutes)) return undefined;
    return { year: year!, month: month!, day: day!, hour: hour!, minute: minute!, offsetMinutes };
  } catch {
    return undefined;
  }
}

function legacyEndpointParts(
  text: string,
  endpointIndex: number,
): readonly [number, number, number, number, number] | undefined {
  const matches = [...text.matchAll(/\[(\d{4})-(\d{2})-(\d{2})(?: (?:Mon|Tue|Wed|Thu|Fri|Sat|Sun))? (\d{2}):(\d{2})\]/g)];
  const match = matches[endpointIndex];
  return match ? Object.freeze([
    Number(match[1]),
    Number(match[2]),
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  ] as const) : undefined;
}

function ambiguousLegacyShape(text: string): "running" | "closed" | undefined {
  const body = text.replace(/^:?[ \t]*clock::?[ \t]*/i, "").trimEnd();
  const stamp = "\\[\\d{4}-\\d{2}-\\d{2}(?: (?:Mon|Tue|Wed|Thu|Fri|Sat|Sun))? \\d{2}:\\d{2}\\]";
  const id = "(?: \\^nl-clock-[0-9A-Za-z-]+)?";
  if (new RegExp(`^${stamp}${id}$`).test(body)) return "running";
  return new RegExp(`^${stamp}[ \\t]*--[ \\t]*${stamp}(?:[ \\t]*=>[ \\t]*\\d+:\\d{2})?${id}$`).test(body)
    ? "closed"
    : undefined;
}

function legacyEndpointIsExact(
  text: string,
  zoneId: string,
  selectedEpochMs: number,
  selectedOffsetMinutes: number,
  candidates: readonly { readonly epochMs: number; readonly offsetMinutes: number }[] | undefined,
  expectedClockId: string | undefined,
  endpointIndex: number,
  requireAmbiguousCandidates: boolean,
): boolean {
  const terminalIdMatch = /(?:^|[ \t])\^([^ \t]+)[ \t]*$/.exec(text);
  const terminalClockId = terminalIdMatch?.[1];
  if (
    (terminalClockId !== undefined && (!isCanonicalClockId(terminalClockId) || terminalClockId !== expectedClockId))
    || (terminalClockId === undefined && expectedClockId !== undefined)
  ) return false;
  const expected = legacyEndpointParts(text, endpointIndex);
  if (!expected) return false;
  const selectedLocal = localMinuteInZone(selectedEpochMs, zoneId);
  if (
    !selectedLocal
    || selectedLocal.offsetMinutes !== selectedOffsetMinutes
    || ![selectedLocal.year, selectedLocal.month, selectedLocal.day, selectedLocal.hour, selectedLocal.minute]
      .every((value, index) => value === expected[index])
  ) return false;
  if (!candidates) return !requireAmbiguousCandidates;
  if (
    candidates.length < 1
    || candidates.length > 2
    || (requireAmbiguousCandidates && candidates.length !== 2)
    || new Set(candidates.map((candidate) => candidate.epochMs)).size !== candidates.length
  ) return false;
  const valid = candidates.every((candidate) => {
    const local = localMinuteInZone(candidate.epochMs, zoneId);
    return local !== undefined
      && local.offsetMinutes === candidate.offsetMinutes
      && [local.year, local.month, local.day, local.hour, local.minute].every((value, index) => value === expected[index]);
  });
  return valid && candidates.some((candidate) =>
    candidate.epochMs === selectedEpochMs && candidate.offsetMinutes === selectedOffsetMinutes,
  );
}

function currentFileRunningFacts(
  path: string,
  text: string,
  logbookOptions: LogbookReadOptions,
  index: StageIndexFacts,
  plan: MutationPlan,
  expectation: MutationExpectation,
): {
  readonly fingerprints: readonly string[];
  readonly potentialFingerprints: readonly string[];
  readonly potential: boolean;
  readonly blockingPotential: boolean;
  readonly planInvalid: boolean;
  readonly invalidOwner: boolean;
} {
  const resolved = resolvePrimaryPlan(synchronousVersion(path, text), text);
  const fingerprints = new Set<string>();
  const potentialFingerprints = new Set<string>();
  const structuredLocations = new Set<string>();
  let potential = false;
  let blockingPotential = false;
  let invalidOwner = false;
  const planInvalid = resolved.diagnostics.length > 0 || resolved.limitExceeded !== undefined;
  if (resolved.region && !planInvalid) {
    const parsed = parseGrammar({ version: resolved.region.version, candidates: resolved.candidates });
    for (const item of parsed.items) {
      const ownerIdentity = item.source.blockId ? index.identity(item.source.blockId) : undefined;
      const logbook = readLogbook(text, {
        path,
        itemFromOffset: item.source.itemSpan.fromOffset,
        itemToOffset: item.source.itemSpan.toOffset,
        ...(item.source.blockId ? { ownerId: item.source.blockId } : {}),
      }, logbookOptions);
      if (!logbook.complete || logbook.kind === "ambiguous") {
        return {
          fingerprints: Object.freeze([]),
          potentialFingerprints: Object.freeze([]),
          potential: true,
          blockingPotential: true,
          planInvalid,
          invalidOwner,
        };
      }
      for (const clock of logbook.clocks) {
        structuredLocations.add(`${clock.fromOffset}\0${clock.toOffset}`);
        if (clock.parsed.kind === "record" && clock.parsed.record.state === "running") {
          const key = clock.parsed.record.clockId ?? legacyRunningClockKey(path, clock.fromOffset, clock.text);
          fingerprints.add(runningFingerprint(key, path, clock.fromOffset, clock.toOffset, clock.text, clock.ownerId));
          const indexedClock: IndexedClockSource = Object.freeze({
            path,
            fromOffset: clock.fromOffset,
            toOffset: clock.toOffset,
            text: clock.text,
            ...(clock.ownerId ? { ownerId: clock.ownerId } : {}),
            ...(clock.parsed.record.clockId ? { clockId: clock.parsed.record.clockId } : {}),
            scope: "accepted-logbook",
            parsed: clock.parsed,
          });
          const ownerValid = item.executionEligible
            && item.source.blockId !== undefined
            && clock.ownerId === item.source.blockId
            && ownerIdentity?.kind === "unique"
            && ownerIdentity.location.path === path;
          if (!ownerValid && !runningClockIsSelectedRecovery(indexedClock, plan, expectation)) invalidOwner = true;
        } else if (clock.parsed.kind === "malformed" && clock.parsed.potentialRunning) {
          potential = true;
          const indexedClock: IndexedClockSource = Object.freeze({
            path,
            fromOffset: clock.fromOffset,
            toOffset: clock.toOffset,
            text: clock.text,
            ...(clock.ownerId ? { ownerId: clock.ownerId } : {}),
            scope: "accepted-logbook",
            parsed: clock.parsed,
          });
          if (
            !potentialClockIsSelectedPlanRepair(indexedClock, plan, expectation, "before")
            && !potentialClockIsSelectedClockRepair(indexedClock, plan, expectation, "before")
          ) {
            blockingPotential = true;
          }
          const rawIdMatch = /(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/.exec(clock.text);
          const rawId = rawIdMatch && isCanonicalClockId(rawIdMatch[1]!) ? rawIdMatch[1]! : undefined;
          potentialFingerprints.add(runningFingerprint(
            rawId ?? legacyRunningClockKey(path, clock.fromOffset, clock.text),
            path,
            clock.fromOffset,
            clock.toOffset,
            clock.text,
            clock.ownerId,
          ));
        }
      }
    }
  }

  for (const line of synchronousOutsideFenceLines(text)) {
    const located = canonicalClockPhysicalLine(line.content);
    if (located) {
      const clockText = located.text;
      const parsed = located.parsed;
      const fromOffset = line.start + located.fromColumn;
      const toOffset = line.start + located.toColumn;
      if (structuredLocations.has(`${fromOffset}\0${toOffset}`)) continue;
      if (parsed.kind === "record" && parsed.record.state === "running") {
        fingerprints.add(runningFingerprint(
          located.clockId, path, fromOffset, toOffset, clockText, undefined,
        ));
        const indexedClock: IndexedClockSource = Object.freeze({
          path,
          fromOffset,
          toOffset,
          text: clockText,
          clockId: located.clockId,
          scope: "canonical-global",
          parsed,
        });
        if (!runningClockIsSelectedRecovery(indexedClock, plan, expectation)) invalidOwner = true;
      }
      else if (parsed.kind === "malformed" && parsed.potentialRunning) {
        potential = true;
        const indexedClock: IndexedClockSource = Object.freeze({
          path,
          fromOffset,
          toOffset,
          text: clockText,
          clockId: located.clockId,
          scope: "canonical-global",
          parsed,
        });
        if (!potentialClockIsSelectedClockRepair(indexedClock, plan, expectation, "before")) {
          blockingPotential = true;
        }
        potentialFingerprints.add(runningFingerprint(located.clockId, path, fromOffset, toOffset, clockText, undefined));
      }
    }
  }
  return {
    fingerprints: Object.freeze([...fingerprints].sort()),
    potentialFingerprints: Object.freeze([...potentialFingerprints].sort()),
    potential,
    blockingPotential,
    planInvalid,
    invalidOwner,
  };
}

function expectationResolvedPotentialClock(
  index: WorkspaceIndex,
  clock: IndexedClockSource,
  expectation: MutationExpectation,
  logbookOptions: LogbookReadOptions,
): IndexedClockSource | undefined {
  const bound = expectation.clocks.find((candidate) => {
    if (candidate.text !== clock.text || candidate.state !== "running") return false;
    if (!candidate.target.id) {
      return candidate.path === clock.path
        && candidate.span.fromOffset === clock.fromOffset
        && candidate.span.toOffset === clock.toOffset;
    }
    const identity = index.safetyIdentity(candidate.target.id);
    return clock.clockId === candidate.target.id
      && identity.kind === "unique"
      && identity.location.path === clock.path;
  });
  if (!bound?.ownerId || clock.ownerId !== bound.ownerId) return undefined;
  const owner = index.safetyIdentity(bound.ownerId);
  if (owner.kind !== "unique" || owner.location.path !== clock.path) return undefined;
  const parsed = parseClockText(bound.text, logbookOptions);
  if (parsed.kind !== "record" || parsed.record.state !== "running") return undefined;
  return Object.freeze({
    ...clock,
    ...(bound.ownerId ? { ownerId: bound.ownerId } : {}),
    ...(parsed.record.clockId ? { clockId: parsed.record.clockId } : {}),
    parsed,
  });
}

interface ReconciledClockFacts {
  readonly running: readonly IndexedClockSource[];
  readonly potentialRunning: readonly IndexedClockSource[];
}

function selectedPlanRepairOwner(
  clock: IndexedClockSource,
  expectation: MutationExpectation,
): string | undefined {
  if (expectation.action !== "repair-plan-item-identity" || clock.ownerId) return undefined;
  const selected = expectation.planItems.find((item) => item.target.id
    && item.path === clock.path
    && clock.fromOffset >= item.itemSpan.fromOffset
    && clock.toOffset <= item.itemSpan.toOffset
    && item.sourceText.slice(clock.fromOffset, clock.toOffset) === clock.text);
  return selected?.target.id;
}

function reconciledClockFacts(
  index: WorkspaceIndex,
  expectation: MutationExpectation,
  logbookOptions: LogbookReadOptions,
): ReconciledClockFacts {
  const snapshot = index.safetySnapshot;
  const resolvedPotential = snapshot.potentialRunning
    .map((clock) => expectationResolvedPotentialClock(index, clock, expectation, logbookOptions))
    .filter((clock): clock is IndexedClockSource => clock !== undefined);
  const potentialRunning = snapshot.potentialRunning.filter((clock) =>
    !resolvedPotential.some((resolved) =>
      resolved.path === clock.path
      && resolved.fromOffset === clock.fromOffset
      && resolved.toOffset === clock.toOffset));
  return Object.freeze({
    running: Object.freeze([
      ...snapshot.running.map((clock) => {
        const repairedOwner = selectedPlanRepairOwner(clock, expectation);
        return repairedOwner ? Object.freeze({ ...clock, ownerId: repairedOwner }) : clock;
      }),
      ...resolvedPotential,
    ]),
    potentialRunning: Object.freeze(potentialRunning),
  });
}

function actionAllowsInvalidClockOwnerRecovery(action: MutationAction): boolean {
  return action === "clock-out"
    || action === "delete-clock"
    || action === "stop-at-trusted-time"
    || action === "normalize-legacy-clock"
    || action === "repair-overlap"
    || action === "repair-done-owner-clock"
    || action === "repair-plan-item-identity"
    || action === "repair-clock-identity";
}

function selectedPlanIdentityRepair(
  plan: MutationPlan,
  expectation: MutationExpectation,
) {
  if (plan.action !== "repair-plan-item-identity") return undefined;
  for (const stage of plan.stages) {
    for (const operation of stage.operations) {
      if (operation.kind !== "repair-plan-item-identity") continue;
      const expected = findPlanExpectation(expectation, operation.target, stage.path);
      const selected = expectation.selectedRepair;
      if (
        !expected
        || !selected
        || selected.id !== operation.target.id
        || selected.selectedSpan.path !== expected.path
        || selected.selectedSpan.fromOffset !== expected.itemSpan.fromOffset
        || selected.selectedSpan.toOffset !== expected.itemSpan.toOffset
      ) return undefined;
      return { operation, expected, selected };
    }
  }
  return undefined;
}

function potentialClockIsSelectedPlanRepair(
  clock: IndexedClockSource,
  plan: MutationPlan,
  expectation: MutationExpectation,
  phase: "before" | "after",
): boolean {
  if (clock.parsed.kind !== "malformed" || !clock.parsed.potentialRunning) return false;
  const repair = selectedPlanIdentityRepair(plan, expectation);
  if (!repair) return false;
  const expectedOwner = phase === "before" ? repair.operation.target.id : repair.operation.newId;
  return clock.ownerId === expectedOwner
    && clock.path === repair.expected.path
    && clock.fromOffset >= repair.expected.itemSpan.fromOffset
    && clock.toOffset <= repair.expected.itemSpan.toOffset;
}

function selectedClockIdentityRepair(
  plan: MutationPlan,
  expectation: MutationExpectation,
) {
  if (plan.action !== "repair-clock-identity") return undefined;
  for (const stage of plan.stages) {
    for (const operation of stage.operations) {
      if (operation.kind !== "repair-clock-identity") continue;
      const selected = expectation.selectedRepair;
      const expected = selected && expectation.clocks.find((clock) =>
        clock.target.id === operation.target.id
        && clock.path === selected.selectedSpan.path
        && clock.span.fromOffset === selected.selectedSpan.fromOffset
        && clock.span.toOffset === selected.selectedSpan.toOffset,
      );
      if (!selected || !expected || selected.id !== operation.target.id) {
        return undefined;
      }
      return { operation, expected };
    }
  }
  return undefined;
}

function potentialClockIsSelectedClockRepair(
  clock: IndexedClockSource,
  plan: MutationPlan,
  expectation: MutationExpectation,
  phase: "before" | "after",
): boolean {
  if (clock.parsed.kind !== "malformed" || !clock.parsed.potentialRunning) return false;
  const repair = selectedClockIdentityRepair(plan, expectation);
  if (!repair || repair.expected.state !== "potential-running") return false;
  const oldTerminal = `^${repair.operation.target.id}`;
  if (!repair.expected.text.endsWith(oldTerminal)) return false;
  const repairedText = `${repair.expected.text.slice(0, -oldTerminal.length)}^${repair.operation.newId}`;
  const expectedText = phase === "before" ? repair.expected.text : repairedText;
  const expectedId = phase === "before" ? repair.operation.target.id : repair.operation.newId;
  return clock.path === repair.expected.path
    && clock.fromOffset === repair.expected.span.fromOffset
    && clock.toOffset === repair.expected.span.toOffset
    && clock.text === expectedText
    && indexedClockKey(clock) === expectedId
    && clock.ownerId === repair.expected.ownerId;
}

function runningClockIsSelectedRecovery(
  clock: IndexedClockSource,
  plan: MutationPlan,
  expectation: MutationExpectation,
  phase: "before" | "after" = "before",
): boolean {
  if (!actionAllowsInvalidClockOwnerRecovery(plan.action)) return false;
  const clockKey = indexedClockKey(clock);
  return plan.stages.some((stage) => stage.operations.some((operation) => {
    if (operation.kind === "repair-plan-item-identity") {
      if (phase === "after") return false;
      const repair = selectedPlanIdentityRepair(plan, expectation);
      if (!repair || clock.ownerId !== operation.target.id) return false;
      const insideSelected = clock.path === repair.expected.path
        && clock.fromOffset >= repair.expected.itemSpan.fromOffset
        && clock.toOffset <= repair.expected.itemSpan.toOffset;
      return insideSelected || repair.selected.locations.length === 2;
    }
    if (operation.kind === "repair-clock-identity") {
      const repair = selectedClockIdentityRepair(plan, expectation);
      if (!repair || repair.expected.state !== "running") return false;
      const oldTerminal = `^${repair.operation.target.id}`;
      if (!repair.expected.text.endsWith(oldTerminal)) return false;
      const repairedText = `${repair.expected.text.slice(0, -oldTerminal.length)}^${repair.operation.newId}`;
      const originalMatches = clock.text === repair.expected.text
        && clockKey === repair.operation.target.id;
      const repairedMatches = clock.text === repairedText
        && clockKey === repair.operation.newId;
      const phaseMatches = phase === "after" ? repairedMatches : originalMatches || repairedMatches;
      return phaseMatches
        && clock.path === repair.expected.path
        && clock.fromOffset === repair.expected.span.fromOffset
        && clock.toOffset === repair.expected.span.toOffset
        && clock.ownerId === repair.expected.ownerId;
    }
    if (operation.kind !== "clock-out"
      && operation.kind !== "delete-clock"
      && operation.kind !== "normalize-legacy-clock") return false;
    const expected = findClockExpectation(expectation, operation.target, stage.path);
    if (!expected || expected.text !== clock.text) return false;
    const expectedKey = expected.target.id
      ?? legacyRunningClockKey(expected.path, expected.span.fromOffset, expected.text);
    return expectedKey === clockKey;
  }));
}

async function invalidClockOwnerPrecondition(
  index: WorkspaceIndex,
  access: Pick<TextAccess, "readText">,
  plan: MutationPlan,
  expectation: MutationExpectation,
  logbookOptions: LogbookReadOptions,
  stopped: () => boolean,
  phase: "before" | "after" = "before",
  onSelectedInvalidOwner?: () => void,
  onInvalidOwner?: () => void,
): Promise<CommitConflict | undefined> {
  const facts = reconciledClockFacts(index, expectation, logbookOptions);
  const texts = new Map<string, string>();
  for (const clock of facts.running) {
    let valid = false;
    if (clock.ownerId) {
      const identity = index.safetyIdentity(clock.ownerId);
      if (identity.kind === "unique" && identity.location.path === clock.path) {
        let text = texts.get(clock.path);
        if (text === undefined) {
          try {
            text = await access.readText(clock.path);
          } catch {
            text = undefined;
          }
          if (stopped()) return conflict("action-no-longer-applicable", plan.action, clock.path);
          if (text !== undefined) texts.set(clock.path, text);
        }
        if (text !== undefined && index.safetySnapshot.complete) {
          const owners = parsedPlanItemsIn(clock.path, text).filter((item) => item.source.blockId === clock.ownerId);
          valid = owners.length === 1 && owners[0]!.kind === "flexible-task" && owners[0]!.status === "open";
        }
      }
    }
    if (!valid) {
      onInvalidOwner?.();
      if (!runningClockIsSelectedRecovery(clock, plan, expectation, phase)) {
        return conflict("clock-owner-invalid", plan.action, clock.path);
      }
      onSelectedInvalidOwner?.();
    }
  }
  return undefined;
}

function globalPrecondition(
  index: WorkspaceIndex,
  expectation: MutationExpectation,
  plan: MutationPlan,
  logbookOptions: LogbookReadOptions,
): CommitConflict | undefined {
  const action = plan.action;
  const snapshot = index.safetySnapshot;
  if (!snapshot.complete || !expectation.indexComplete) return conflict("source-over-limit", action);
  const facts = reconciledClockFacts(index, expectation, logbookOptions);
  const unresolvedPotential = facts.potentialRunning;
  if (unresolvedPotential.length > 0) {
    const selectedPlanRepair = plan.action === "repair-plan-item-identity"
      && unresolvedPotential.every((clock) =>
        potentialClockIsSelectedPlanRepair(clock, plan, expectation, "before"));
    const selectedClockRepair = plan.action === "repair-clock-identity"
      && unresolvedPotential.every((clock) =>
        potentialClockIsSelectedClockRepair(clock, plan, expectation, "before"));
    const normalize = plan.stages.flatMap((stage) => stage.operations)
      .find((operation): operation is Extract<FileMutationOperation, { kind: "normalize-legacy-clock" }> =>
        operation.kind === "normalize-legacy-clock",
      );
    const expected = normalize
      ? findClockExpectation(expectation, normalize.target, plan.stages[0]?.path ?? "")
      : undefined;
    const identityPath = normalize?.target.id
      ? (() => {
          const lookup = index.safetyIdentity(normalize.target.id!);
          return lookup.kind === "unique" ? lookup.location.path : undefined;
        })()
      : undefined;
    const selected = unresolvedPotential.filter((clock) => expected !== undefined
      && clock.path === (identityPath ?? expected.path)
      && clock.text === expected.text
      && (normalize?.target.id !== undefined
        || (clock.fromOffset === expected.span.fromOffset && clock.toOffset === expected.span.toOffset)));
    if (!selectedPlanRepair && !selectedClockRepair && (
      action !== "normalize-legacy-clock"
      || unresolvedPotential.length !== 1
      || selected.length !== 1
      || normalize?.endEpochMs !== undefined
      || facts.running.length !== 0
    )) return conflict("potential-running-clock", action, unresolvedPotential[0]?.path);
  }
  const running = facts.running;
  if (
    running.length > 1
    && action !== "repair-overlap"
    && action !== "repair-clock-identity"
  ) {
    return conflict("multiple-running-clocks", action, running[0]?.path);
  }
  const unselectedInvalidOwner = running.find((clock) => !clock.ownerId
    && !runningClockIsSelectedRecovery(clock, plan, expectation));
  if (unselectedInvalidOwner) {
    return conflict("clock-owner-invalid", action, unselectedInvalidOwner.path);
  }
  const actual = sortedRunningKeys(running);
  const expected = [...expectation.expectedRunningClockIds].sort();
  if (!arraysEqual(actual, expected)) return conflict("action-no-longer-applicable", action);
  return undefined;
}

type SwitchAdmission = "ready" | "already-applied" | CommitConflict;

function switchTargetEndStateMatches(
  currentPath: string,
  currentText: string,
  stage: MutationStage,
  operation: Extract<FileMutationOperation, { kind: "clock-in" }>,
  expectation: MutationExpectation,
  logbookOptions: LogbookReadOptions,
): boolean {
  const expected = findPlanExpectation(expectation, operation.target, stage.path);
  const ownerId = operation.target.id ?? operation.generatedPlanItemId;
  if (!expected || expected.watch !== "complete-item" || !ownerId) return false;
  const originalMatches = parsedPlanItemsIn(expected.path, expected.sourceText).filter((item) => operation.target.id
    ? item.source.blockId === operation.target.id
    : item.source.itemSpan.fromOffset === expected.itemSpan.fromOffset
      && item.source.itemSpan.toOffset === expected.itemSpan.toOffset
      && item.source.firstLineText === expected.firstLineText);
  if (originalMatches.length !== 1) return false;
  const original = originalMatches[0]!;
  if (original.kind !== "flexible-task" || original.status !== "open") return false;
  try {
    const inserted = createRunningClockInsertionEdits(
      expected.sourceText,
      original.source,
      operation.clock.startEpochMs,
      operation.clock.offsetMinutes,
      operation.clock.clockId,
      logbookOptions,
    );
    const edits = [...inserted.edits];
    if (operation.generatedPlanItemId) {
      edits.push(createPlanItemIdentityInsertionEdit(
        expected.sourceText,
        original.source,
        operation.generatedPlanItemId,
      ));
    }
    const expectedAfter = applyAllowedByteEdits(expected.sourceText, edits).text;
    const expectedItems = parsedPlanItemsIn(expected.path, expectedAfter).filter((item) => item.source.blockId === ownerId);
    const currentItems = parsedPlanItemsIn(currentPath, currentText).filter((item) => item.source.blockId === ownerId);
    if (expectedItems.length !== 1 || currentItems.length !== 1) return false;
    const expectedItem = expectedItems[0]!;
    const currentItem = currentItems[0]!;
    return currentItem.kind === "flexible-task"
      && currentItem.status === "open"
      && currentText.slice(currentItem.source.itemSpan.fromOffset, currentItem.source.itemSpan.toOffset)
        === expectedAfter.slice(expectedItem.source.itemSpan.fromOffset, expectedItem.source.itemSpan.toOffset);
  } catch {
    return false;
  }
}

async function switchAdmission(
  index: WorkspaceIndex,
  access: Pick<TextAccess, "readText">,
  plan: MutationPlan,
  expectation: MutationExpectation,
  logbookOptions: LogbookReadOptions,
): Promise<SwitchAdmission | undefined> {
  if (plan.action !== "switch-task") return undefined;
  const planned = plan.stages.flatMap((stage) =>
    stage.operations.map((operation) => ({ stage, operation })),
  );
  const closeEntry = planned.find((entry): entry is {
    readonly stage: MutationStage;
    readonly operation: Extract<FileMutationOperation, { kind: "clock-out" }>;
  } => entry.operation.kind === "clock-out");
  const openEntry = planned.find((entry): entry is {
    readonly stage: MutationStage;
    readonly operation: Extract<FileMutationOperation, { kind: "clock-in" }>;
  } => entry.operation.kind === "clock-in");
  if (!closeEntry || !openEntry) return conflict("source-conflict", plan.action);

  const snapshot = index.safetySnapshot;
  if (!snapshot.complete || !expectation.indexComplete) return conflict("source-over-limit", plan.action);
  const facts = reconciledClockFacts(index, expectation, logbookOptions);
  if (facts.potentialRunning.length > 0) {
    return conflict("potential-running-clock", plan.action, facts.potentialRunning[0]?.path);
  }
  if (facts.running.length !== 1) {
    return conflict(facts.running.length > 1 ? "multiple-running-clocks" : "action-no-longer-applicable", plan.action);
  }

  const running = facts.running[0]!;
  const oldKey = expectedClockKey(closeEntry.operation.target, closeEntry.stage.path, expectation);
  if (oldKey && indexedClockKey(running) === oldKey) return "ready";

  const newClockId = openEntry.operation.clock.clockId;
  const newOwnerId = openEntry.operation.target.id ?? openEntry.operation.generatedPlanItemId;
  if (
    indexedClockKey(running) !== newClockId
    || !newOwnerId
    || running.ownerId !== newOwnerId
    || running.parsed.kind !== "record"
    || running.parsed.record.state !== "running"
    || running.parsed.record.startEpochMs !== openEntry.operation.clock.startEpochMs
    || running.text !== formatCanonicalRunningClock(
      openEntry.operation.clock.startEpochMs,
      openEntry.operation.clock.offsetMinutes,
      newClockId,
    )
  ) return conflict("action-no-longer-applicable", plan.action, running.path);

  const oldExpectation = findClockExpectation(expectation, closeEntry.operation.target, closeEntry.stage.path);
  const expectedOld = oldExpectation ? parseClockText(oldExpectation.text) : undefined;
  const oldClockId = closeEntry.operation.target.id
    ?? closeEntry.operation.close.assignedClockId
    ?? closeEntry.operation.close.clockId;
  const canonicalStartOffset = oldExpectation
    ? /^CLOCK: \[[^\]]+ ([+-])(\d{2}):(\d{2})\]/.exec(oldExpectation.text)
    : undefined;
  const expectedStartOffset = canonicalStartOffset
    ? (canonicalStartOffset[1] === "+" ? 1 : -1)
      * (Number(canonicalStartOffset[2]) * 60 + Number(canonicalStartOffset[3]))
    : closeEntry.operation.close.legacyStartOffsetMinutes;
  const expectedClosedText = oldClockId
    && expectedOld?.kind === "record"
    && expectedStartOffset !== undefined
    ? formatCanonicalClosedClock(
      expectedOld.record.startEpochMs,
      expectedStartOffset,
      closeEntry.operation.close.endEpochMs,
      closeEntry.operation.close.offsetMinutes,
      oldClockId,
    )
    : undefined;
  const closedMatches = oldClockId ? index.snapshot.clocks.filter((clock) =>
    clock.clockId === oldClockId
    && clock.ownerId === oldExpectation?.ownerId
    && clock.parsed.kind === "record"
    && clock.parsed.record.state === "closed"
    && clock.text === expectedClosedText
  ) : [];
  const oldIdentity = oldClockId ? index.safetyIdentity(oldClockId) : undefined;
  const newIdentity = index.safetyIdentity(newClockId);
  const ownerIdentity = index.safetyIdentity(newOwnerId);
  if (
    closedMatches.length !== 1
    || oldIdentity?.kind !== "unique"
    || newIdentity.kind !== "unique"
    || ownerIdentity.kind !== "unique"
    || newIdentity.location.path !== running.path
    || ownerIdentity.location.path !== running.path
  ) return conflict("action-no-longer-applicable", plan.action, running.path);
  let currentTargetText: string | undefined;
  try {
    currentTargetText = await access.readText(running.path);
  } catch {
    currentTargetText = undefined;
  }
  const liveSnapshot = index.safetySnapshot;
  if (!liveSnapshot.complete || liveSnapshot.generation !== snapshot.generation) {
    return conflict("source-conflict", plan.action, running.path);
  }
  if (
    currentTargetText === undefined
    || !switchTargetEndStateMatches(
      running.path,
      currentTargetText,
      openEntry.stage,
      openEntry.operation,
      expectation,
      logbookOptions,
    )
  ) return conflict("clock-owner-invalid", plan.action, running.path);
  return "already-applied";
}

async function identityEndStateAdmission(
  index: WorkspaceIndex,
  access: Pick<TextAccess, "readText">,
  plan: MutationPlan,
  expectation: MutationExpectation,
  logbookOptions: LogbookReadOptions,
): Promise<"already-applied" | CommitConflict | undefined> {
  if (
    plan.action !== "assign-plan-item-identity"
    && plan.action !== "repair-plan-item-identity"
    && plan.action !== "repair-clock-identity"
  ) return undefined;
  const stage = plan.stages[0];
  const operation = stage?.operations[0];
  if (!stage || !operation) return conflict("source-conflict", plan.action);
  const newId = operation.kind === "assign-plan-item-identity"
    || operation.kind === "repair-plan-item-identity"
    || operation.kind === "repair-clock-identity"
    ? operation.newId
    : undefined;
  if (!newId) return conflict("source-conflict", plan.action, stage.path);
  const newIdentity = index.safetyIdentity(newId);
  if (newIdentity.kind === "missing") return undefined;
  if (newIdentity.kind !== "unique") return conflict("identity-collision", plan.action, stage.path);

  let expectedPath: string | undefined;
  let expectedAfter: string | undefined;
  try {
    if (operation.kind === "assign-plan-item-identity") {
      const expected = findPlanExpectation(expectation, operation.target, stage.path);
      if (!expected || expected.target.id !== undefined) return conflict("source-conflict", plan.action, stage.path);
      const target = revalidatePlanItemExpectation(
        expected.path,
        expected.sourceText,
        expected,
        plan.action,
        undefined,
        logbookOptions,
      );
      if (!target.ok) return target.conflict;
      expectedPath = expected.path;
      expectedAfter = applyAllowedByteEdits(expected.sourceText, [
        createPlanItemIdentityInsertionEdit(expected.sourceText, target.value.source, operation.newId),
      ]).text;
    } else if (operation.kind === "repair-plan-item-identity") {
      const expected = findPlanExpectation(expectation, operation.target, stage.path);
      if (!expected || !operation.target.id) return conflict("source-conflict", plan.action, stage.path);
      const selected = expectation.selectedRepair;
      if (!selected || selected.id !== operation.target.id) {
        return conflict("action-no-longer-applicable", plan.action, stage.path);
      }
      const target = revalidatePlanItemExpectation(
        expected.path,
        expected.sourceText,
        expected,
        plan.action,
        Object.freeze({
          kind: "selected-repair" as const,
          identity: Object.freeze({ kind: "collision" as const, locations: selected.locations }),
          selectedSpan: selected.selectedSpan,
        }),
        logbookOptions,
      );
      if (!target.ok) return target.conflict;
      expectedPath = expected.path;
      expectedAfter = applyAllowedByteEdits(expected.sourceText, [
        createPlanItemIdentityRepairEdit(expected.sourceText, target.value.source, operation.newId),
      ]).text;
    } else if (operation.kind === "repair-clock-identity") {
      const expected = findClockExpectation(expectation, operation.target, stage.path);
      if (!expected || !operation.target.id) return conflict("source-conflict", plan.action, stage.path);
      const selected = expectation.selectedRepair;
      if (!selected || selected.id !== operation.target.id) {
        return conflict("action-no-longer-applicable", plan.action, stage.path);
      }
      const target = revalidateClockExpectation(
        expected.path,
        expected.sourceText,
        expected,
        plan.action,
        Object.freeze({
          kind: "selected-repair" as const,
          identity: Object.freeze({ kind: "collision" as const, locations: selected.locations }),
          selectedSpan: selected.selectedSpan,
        }),
        logbookOptions,
      );
      if (!target.ok) return target.conflict;
      expectedPath = expected.path;
      expectedAfter = applyAllowedByteEdits(expected.sourceText, [
        createClockIdentityRepairEdit(expected.sourceText, target.value.clock, operation.newId),
      ]).text;
    }
  } catch {
    return conflict("source-conflict", plan.action, stage.path);
  }
  if (!expectedPath || expectedAfter === undefined || newIdentity.location.path !== expectedPath) {
    return conflict("action-no-longer-applicable", plan.action, stage.path);
  }
  let currentText: string | undefined;
  try {
    currentText = await access.readText(expectedPath);
  } catch {
    currentText = undefined;
  }
  return currentText === expectedAfter && index.safetySnapshot.complete
    ? "already-applied"
    : conflict("action-no-longer-applicable", plan.action, expectedPath);
}

function expectedClockKey(
  selector: ClockSelector,
  originalPath: string,
  expectation: MutationExpectation,
): string | undefined {
  if (selector.id) return selector.id;
  const expected = findClockExpectation(expectation, selector, originalPath);
  return expected && !expected.target.id
    ? legacyRunningClockKey(expected.path, expected.span.fromOffset, expected.text)
    : undefined;
}

function repairPrecondition(
  index: WorkspaceIndex,
  plan: MutationPlan,
  expectation: MutationExpectation,
  logbookOptions: LogbookReadOptions,
): CommitConflict | undefined {
  if (plan.action !== "repair-overlap") return undefined;
  const facts = reconciledClockFacts(index, expectation, logbookOptions);
  const running = [...facts.running];
  if (facts.potentialRunning.length > 0 || running.length < 2) {
    return conflict("action-no-longer-applicable", plan.action);
  }
  const ordered = running.sort((left, right) => {
    const leftStart = left.parsed.kind === "record" ? left.parsed.record.startEpochMs : Number.NaN;
    const rightStart = right.parsed.kind === "record" ? right.parsed.record.startEpochMs : Number.NaN;
    return leftStart - rightStart || left.path.localeCompare(right.path) || left.fromOffset - right.fromOffset;
  });
  if (ordered.some((clock) => clock.parsed.kind !== "record" || clock.parsed.record.state !== "running")) {
    return conflict("action-no-longer-applicable", plan.action);
  }
  const newest = ordered[ordered.length - 1]!;
  if (newest.parsed.kind !== "record") return conflict("action-no-longer-applicable", plan.action);
  const newestStart = newest.parsed.record.startEpochMs;
  if (ordered.filter((clock) => clock.parsed.kind === "record" && clock.parsed.record.startEpochMs === newestStart).length !== 1) {
    return conflict("action-no-longer-applicable", plan.action);
  }
  const expectedOlderKeys = ordered.slice(0, -1).map(indexedClockKey);
  const planned = plan.stages.flatMap((stage) => stage.operations.map((operation) => ({ stage, operation })));
  if (planned.length !== expectedOlderKeys.length || planned.some(({ operation }) => operation.kind !== "clock-out")) {
    return conflict("action-no-longer-applicable", plan.action);
  }
  const plannedKeys: string[] = [];
  for (const { stage, operation } of planned) {
    if (operation.kind !== "clock-out" || operation.close.endEpochMs !== newestStart) {
      return conflict("action-no-longer-applicable", plan.action, stage.path);
    }
    const key = expectedClockKey(operation.target, stage.path, expectation);
    if (!key) return conflict("source-conflict", plan.action, stage.path);
    plannedKeys.push(key);
  }
  return arraysEqual(plannedKeys, expectedOlderKeys)
    ? undefined
    : conflict("action-no-longer-applicable", plan.action);
}

function finalGlobalExpectation(
  plan: MutationPlan,
  expectation: MutationExpectation,
  before: readonly string[],
): readonly string[] | undefined {
  if (plan.action === "repair-clock-identity") {
    const repair = selectedClockIdentityRepair(plan, expectation);
    if (!repair) return undefined;
    const replaced = [...before];
    if (repair.expected.state !== "running") return Object.freeze(replaced.sort());
    const runningIndex = replaced.indexOf(repair.operation.target.id);
    if (runningIndex < 0) return undefined;
    replaced[runningIndex] = repair.operation.newId;
    return Object.freeze(replaced.sort());
  }
  const ids = new Set(before);
  for (const stage of plan.stages) {
    for (const operation of stage.operations) {
      switch (operation.kind) {
        case "clock-in": ids.add(operation.clock.clockId); break;
        case "clock-out":
          if (operation.target.id) ids.delete(operation.target.id);
          else {
            const key = expectedClockKey(operation.target, stage.path, expectation);
            if (key) ids.delete(key);
          }
          break;
        case "complete":
        case "advance-progress":
          if (operation.closeClock?.clockId) ids.delete(operation.closeClock.clockId);
          else if (operation.closeClock) for (const key of ids) if (key.startsWith("legacy:")) ids.delete(key);
          break;
        case "delete-clock":
          if (operation.target.id) ids.delete(operation.target.id);
          else {
            const key = expectedClockKey(operation.target, stage.path, expectation);
            if (key) ids.delete(key);
          }
          break;
        case "repair-clock-identity":
          if (ids.delete(operation.target.id)) ids.add(operation.newId);
          break;
        case "normalize-legacy-clock":
          if (operation.target.id) {
            ids.delete(operation.target.id);
            if (operation.endEpochMs === undefined) ids.add(operation.clockId);
          } else {
            const key = expectedClockKey(operation.target, stage.path, expectation);
            if (key) ids.delete(key);
            if (operation.endEpochMs === undefined) ids.add(operation.clockId);
          }
          break;
        default: break;
      }
    }
  }
  if (plan.action === "clock-in" && before.length === 1) return Object.freeze([...before].sort());
  if (plan.action === "switch-task" || plan.action === "clock-in") {
    const opened = plan.stages.flatMap((stage) => stage.operations)
      .filter((operation): operation is Extract<FileMutationOperation, { kind: "clock-in" }> => operation.kind === "clock-in")
      .map((operation) => operation.clock.clockId);
    return opened.length === 0 ? undefined : Object.freeze(opened.sort());
  }
  return Object.freeze([...ids].sort());
}

function validateFinalGlobal(
  index: WorkspaceIndex,
  expected: readonly string[] | undefined,
  expectation: MutationExpectation,
  logbookOptions: LogbookReadOptions,
): {
  readonly status: "confirmed" | "unavailable" | "violated";
  readonly ids: readonly string[];
  readonly receiptIds: readonly string[];
} {
  const snapshot = index.safetySnapshot;
  if (!snapshot.complete) return { status: "unavailable", ids: Object.freeze([]), receiptIds: Object.freeze([]) };
  const facts = reconciledClockFacts(index, expectation, logbookOptions);
  const ids = sortedRunningKeys(facts.running);
  const receiptIds = receiptRunningKeys(facts.running);
  if (facts.potentialRunning.length > 0 || facts.running.length > 1) {
    return { status: "violated", ids, receiptIds };
  }
  return { status: expected === undefined || arraysEqual(ids, expected) ? "confirmed" : "violated", ids, receiptIds };
}

function deleteIsAuthoritativelyAbsent(
  plan: MutationPlan,
  expectation: MutationExpectation,
  index: WorkspaceIndex,
  logbookOptions: LogbookReadOptions,
): boolean {
  if (plan.action !== "delete-clock") return false;
  const operations = plan.stages.flatMap((stage) => stage.operations);
  if (operations.length !== 1 || operations[0]?.kind !== "delete-clock" || !operations[0].target.id) return false;
  const operation = operations[0];
  if (
    !deleteConfirmationIsCurrent(operation.confirmation)
    || operation.confirmation.firstTargetKey !== operation.target.id
    || operation.confirmation.secondTargetKey !== operation.target.id
    || index.safetyIdentity(operation.target.id).kind !== "missing"
  ) return false;
  const snapshot = index.safetySnapshot;
  const facts = reconciledClockFacts(index, expectation, logbookOptions);
  if (!snapshot.complete || facts.potentialRunning.length > 0 || facts.running.length > 1) return false;
  const expectedRemaining = expectation.expectedRunningClockIds.filter((id) => id !== operation.target.id).sort();
  return arraysEqual(sortedRunningKeys(facts.running), expectedRemaining);
}

function relocateStagePath(stage: MutationStage, expectation: MutationExpectation, index: WorkspaceIndex): string | CommitConflict {
  const paths = new Set<string>();
  let hasAnonymous = false;
  for (const operation of stage.operations) {
    const id = targetId(operation);
    if (!id) {
      if (operation.kind !== "initialize-plan" && operation.kind !== "migrate-plan") hasAnonymous = true;
      continue;
    }
    if (operation.kind === "repair-plan-item-identity" || operation.kind === "repair-clock-identity") {
      paths.add(stage.path);
      continue;
    }
    const lookup = index.safetyIdentity(id);
    if (lookup.kind === "collision") return conflict("identity-collision", expectation.action, stage.path);
    if (lookup.kind === "missing") return conflict("plan-item-not-found", expectation.action, stage.path);
    if (lookup.kind === "unavailable") return conflict("source-conflict", expectation.action, stage.path);
    paths.add(lookup.location.path);
  }
  if (hasAnonymous) paths.add(stage.path);
  if (paths.size > 1) return conflict("source-conflict", expectation.action, stage.path);
  return paths.values().next().value ?? stage.path;
}

function captureStageIndexFacts(
  index: WorkspaceIndex,
  plan: MutationPlan,
  expectation: MutationExpectation,
  logbookOptions: LogbookReadOptions,
): StageIndexFacts {
  const ids = new Set<string>();
  for (const item of expectation.planItems) if (item.target.id) ids.add(item.target.id);
  for (const clock of expectation.clocks) {
    if (clock.target.id) ids.add(clock.target.id);
    if (clock.ownerId) ids.add(clock.ownerId);
  }
  for (const stage of plan.stages) {
    for (const operation of stage.operations) {
      const target = targetId(operation);
      if (target) ids.add(target);
      if ("target" in operation && operation.target.kind === "clock" && operation.target.ownerId) {
        ids.add(operation.target.ownerId);
      }
      switch (operation.kind) {
        case "assign-plan-item-identity":
        case "repair-plan-item-identity":
        case "repair-clock-identity": ids.add(operation.newId); break;
        case "advance-progress":
        case "reopen-progress":
        case "complete":
          if (operation.generatedPlanItemId) ids.add(operation.generatedPlanItemId);
          if (operation.kind !== "reopen-progress" && operation.closeClock?.assignedClockId) ids.add(operation.closeClock.assignedClockId);
          break;
        case "clock-in":
          ids.add(operation.clock.clockId);
          if (operation.generatedPlanItemId) ids.add(operation.generatedPlanItemId);
          break;
        case "clock-out":
          if (operation.close.assignedClockId) ids.add(operation.close.assignedClockId);
          break;
        case "normalize-legacy-clock": ids.add(operation.clockId); break;
        default: break;
      }
    }
  }
  const facts = reconciledClockFacts(index, expectation, logbookOptions);
  for (const clock of [...facts.running, ...facts.potentialRunning]) if (clock.ownerId) ids.add(clock.ownerId);
  const identities = new Map([...ids].map((id) => [id, index.safetyIdentity(id)]));
  return Object.freeze({
    identity: (id: string) => identities.get(id) ?? Object.freeze({ kind: "unavailable" as const, reason: "source-changed" as const }),
    liveIdentity: (id: string) => index.safetyIdentity(id),
    running: facts.running,
    potentialRunning: facts.potentialRunning,
  });
}

function buildStage(
  currentPath: string,
  currentText: string,
  originalPath: string,
  stage: MutationStage,
  plan: MutationPlan,
  expectation: MutationExpectation,
  index: StageIndexFacts,
  logbookOptions: LogbookReadOptions,
  context: CommitContext,
): BuiltStageResult {
  const edits: ByteEdit[] = [];
  const identities: ResultingIdentity[] = [];
  const semanticExtras: SemanticChange[] = [];
  const planPostconditions: {
    readonly ownerId: string;
    readonly completionAnchor: string | undefined;
  }[] = [];
  let alreadyApplied = true;

  const expectedFileRunning = index.running
    .filter((clock) => clock.path === currentPath)
    .map(indexedRunningFingerprint)
    .sort();
  const expectedFilePotential = index.potentialRunning
    .filter((clock) => clock.path === currentPath)
    .map(indexedRunningFingerprint)
    .sort();
  const actualFileRunning = currentFileRunningFacts(currentPath, currentText, logbookOptions, index, plan, expectation);
  const permitsOldPlan = plan.action === "migrate-plan";
  if (actualFileRunning.invalidOwner) {
    return { ok: false, conflict: conflict("clock-owner-invalid", plan.action, currentPath) };
  }
  if (
    (actualFileRunning.planInvalid && !permitsOldPlan)
    || !arraysEqual(actualFileRunning.fingerprints, expectedFileRunning)
    || !arraysEqual(actualFileRunning.potentialFingerprints, expectedFilePotential)
    || (actualFileRunning.blockingPotential && plan.action !== "normalize-legacy-clock")
  ) {
    return { ok: false, conflict: conflict(actualFileRunning.potential ? "potential-running-clock" : "source-conflict", plan.action, currentPath) };
  }

  const planTarget = (
    selector: PlanItemSelector,
    requiredWatch: "first-line" | "complete-item" = "first-line",
  ): RevalidatedPlanItem | CommitConflict => {
    if (selector.id) {
      if (plan.action === "repair-plan-item-identity") {
        const live = index.liveIdentity(selector.id);
        if (live.kind !== "collision") return conflict("action-no-longer-applicable", plan.action, currentPath);
        const expectedHere = live.locations.filter((location) => location.path === currentPath).length;
        if (expectedHere === 0 || currentIdentityCount(selector.id) !== expectedHere) {
          return conflict("action-no-longer-applicable", plan.action, currentPath);
        }
      } else if (currentIdentityCount(selector.id) !== 1) {
        return conflict("identity-collision", plan.action, currentPath);
      }
    }
    const expected = findPlanExpectation(expectation, selector, originalPath);
    if (!expected) return conflict("source-conflict", plan.action, currentPath);
    if (
      expected.watch === "identity-and-state"
      || (requiredWatch === "complete-item" && expected.watch !== "complete-item")
    ) return conflict("source-conflict", plan.action, currentPath);
    const checked = revalidatePlanItemExpectation(
      currentPath,
      currentText,
      expected,
      plan.action,
      plan.action === "repair-plan-item-identity" && selector.id
        ? selectedRepairAdmission(index.liveIdentity(selector.id), expectation, selector.id)
        : identityFor(index, selector.id),
      logbookOptions,
    );
    return checked.ok ? checked.value : checked.conflict;
  };
  const clockTarget = (selector: ClockSelector): RevalidatedClock | CommitConflict => {
    const expected = findClockExpectation(expectation, selector, originalPath);
    if (!expected) return conflict("source-conflict", plan.action, currentPath);
    if (selector.id) {
      if (plan.action === "repair-clock-identity") {
        const live = index.liveIdentity(selector.id);
        if (live.kind !== "collision") return conflict("action-no-longer-applicable", plan.action, currentPath);
        const expectedHere = live.locations.filter((location) => location.path === currentPath).length;
        if (expectedHere === 0 || currentIdentityCount(selector.id) !== expectedHere) {
          return conflict("action-no-longer-applicable", plan.action, currentPath);
        }
      } else if (currentIdentityCount(selector.id) !== 1) {
        return conflict("identity-collision", plan.action, currentPath);
      }
    }
    if (expected.ownerId && !actionAllowsInvalidClockOwnerRecovery(plan.action)) {
      const ownerIdentity = index.identity(expected.ownerId);
      if (
        currentIdentityCount(expected.ownerId) !== 1
        || ownerIdentity.kind !== "unique"
        || ownerIdentity.location.path !== currentPath
      ) return conflict("identity-collision", plan.action, currentPath);
    }
    const checked = revalidateClockExpectation(
      currentPath,
      currentText,
      expected,
      plan.action,
      plan.action === "repair-clock-identity" && selector.id
        ? selectedRepairAdmission(index.liveIdentity(selector.id), expectation, selector.id)
        : identityFor(index, selector.id),
      logbookOptions,
    );
    return checked.ok ? checked.value : checked.conflict;
  };
  const isConflict = (value: RevalidatedPlanItem | RevalidatedClock | CommitConflict): value is CommitConflict =>
    "code" in value;
  const currentIdentityCount = (id: string): number => synchronousOutsideFenceLines(currentText)
    .filter((line) => new RegExp(`(?:^|[ \\t])\\^${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*$`).test(line.content))
    .length;
  const reservedIds = new Set<string>();
  const ensureNewId = (id: string): CommitConflict | undefined => {
    if (!identityIsUniqueOrNew(index, id) || currentIdentityCount(id) !== 0 || reservedIds.has(id)) {
      return conflict("identity-collision", plan.action, currentPath);
    }
    reservedIds.add(id);
    return undefined;
  };
  const appendClose = (
    close: NonNullable<Extract<FileMutationOperation, { kind: "complete" }>["closeClock"]>,
    expectedOwnerId: string | undefined,
  ): CommitConflict | undefined => {
    const selector: ClockSelector = {
      kind: "clock",
      ...(close.clockId ? { id: close.clockId } : {}),
      ...(!close.clockId && expectedOwnerId ? { ownerId: expectedOwnerId } : {}),
    };
    const target = clockTarget(selector);
    if (isConflict(target)) return target;
    if (!expectedOwnerId || target.clock.ownerId !== expectedOwnerId) {
      return conflict("clock-owner-invalid", plan.action, currentPath);
    }
    if (target.clock.parsed.kind !== "record") {
      return conflict("action-no-longer-applicable", plan.action, currentPath);
    }
    if (
      target.clock.parsed.record.format === "legacy"
      && localMinuteInZone(target.clock.parsed.record.startEpochMs, plan.zoneId)?.offsetMinutes
        !== close.legacyStartOffsetMinutes
    ) return conflict("clock-discontinuity", plan.action, currentPath);
    const existingClockId = target.clock.parsed.record.clockId;
    if (!existingClockId) {
      if (!close.assignedClockId) return conflict("action-no-longer-applicable", plan.action, currentPath);
      const collision = ensureNewId(close.assignedClockId);
      if (collision) return collision;
      identities.push(resultingIdentity("clock", close.assignedClockId, currentPath));
    } else if (close.assignedClockId !== undefined && close.assignedClockId !== existingClockId) {
      return conflict("source-conflict", plan.action, currentPath);
    }
    edits.push(createCloseRunningClockEdit(currentText, target.clock, {
      endEpochMs: close.endEpochMs,
      endOffsetMinutes: close.offsetMinutes,
      ...(close.assignedClockId ? { assignedClockId: close.assignedClockId } : {}),
      ...(close.legacyStartOffsetMinutes === undefined ? {} : { legacyStartOffsetMinutes: close.legacyStartOffsetMinutes }),
    }));
    return undefined;
  };
  const hasDuplicateProgressState = (target: RevalidatedPlanItem): boolean => {
    const resolved = resolvePrimaryPlan(synchronousVersion(currentPath, currentText), currentText);
    const candidates = resolved.candidates.filter((candidate) =>
      candidate.source.itemSpan.fromOffset === target.source.itemSpan.fromOffset
      && candidate.source.itemSpan.toOffset === target.source.itemSpan.toOffset,
    );
    if (candidates.length !== 1) return true;
    const removals = new Map<number, TokenLocation[]>();
    let count = 0;
    while (true) {
      const progress = findProgress(candidates[0]!.segments, removals);
      if (!progress) return count > 1;
      count += 1;
      if (count > 1) return true;
      addRemoval(removals, progress.location);
    }
  };

  try {
    for (const operation of stage.operations) {
      switch (operation.kind) {
        case "initialize-plan": {
          if (currentPath !== originalPath) {
            return { ok: false, conflict: conflict("anonymous-source-changed", plan.action, originalPath) };
          }
          const expectedLineEnding = initializeLineEnding(operation.expectedSource);
          if (
            expectedLineEnding === "mixed"
            || expectedLineEnding === "invalid"
            || (expectedLineEnding !== undefined && expectedLineEnding !== operation.lineEnding)
            || !initializeInsertionIsPhysicalLineBoundary(operation.expectedSource, operation.insertionOffset)
          ) {
            return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
          }
          const inserted = `${PLAN_OPEN_MARKER_V1}${operation.lineEnding}${PLAN_CLOSE_MARKER}${operation.lineEnding}`;
          const expectedAfter = operation.expectedSource.slice(0, operation.insertionOffset)
            + inserted
            + operation.expectedSource.slice(operation.insertionOffset);
          const endState = scanPrimaryPlanRegion(currentText);
          if (endState.region?.version === "v1" && endState.diagnostics.length === 0) break;
          if (currentText !== operation.expectedSource) {
            return { ok: false, conflict: conflict("anonymous-source-changed", plan.action, originalPath) };
          }
          const scan = endState;
          if (scan.region && scan.diagnostics.length === 0) {
            return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
          }
          const outsideMarker = synchronousOutsideFenceLines(currentText).some((line, index) => {
            const content = index === 0 && line.content.startsWith("\uFEFF") ? line.content.slice(1) : line.content;
            return /^<!-- nautilus-log:plan\/v[0-9]+ -->[ \t]*$/.test(content)
              || /^<!-- \/nautilus-log:plan -->[ \t]*$/.test(content);
          });
          if (
            scan.diagnostics.length > 0
            || outsideMarker
          ) {
            return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
          }
          const candidate = expectedAfter;
          const candidateScan = scanPrimaryPlanRegion(candidate);
          if (!candidateScan.region || candidateScan.region.version !== "v1" || candidateScan.diagnostics.length !== 0) {
            return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
          }
          edits.push(exactEdit(currentText, operation.insertionOffset, operation.insertionOffset, inserted, "plan-region-inserted"));
          alreadyApplied = false;
          break;
        }
        case "migrate-plan": {
          if (currentPath !== originalPath || currentText.slice(operation.span.fromOffset, operation.span.toOffset) !== operation.expectedRegion) {
            return { ok: false, conflict: conflict("source-conflict", plan.action, originalPath) };
          }
          const currentScan = scanPrimaryPlanRegion(currentText);
          const oldVersion = operation.expectedOldVersion.startsWith("v")
            ? operation.expectedOldVersion.slice(1)
            : operation.expectedOldVersion;
          if (
            currentScan.region
            || currentScan.diagnostics.length !== 1
            || currentScan.diagnostics[0]?.code !== "unsupported-plan-version"
            || currentScan.diagnostics[0]?.version !== oldVersion
            || currentScan.diagnostics[0]!.markerSpan.fromOffset < operation.span.fromOffset
            || currentScan.diagnostics[0]!.markerSpan.toOffset > operation.span.toOffset
          ) return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
          const candidate = currentText.slice(0, operation.span.fromOffset)
            + operation.replacementRegion
            + currentText.slice(operation.span.toOffset);
          const candidateScan = scanPrimaryPlanRegion(candidate);
          const resolved = resolvePrimaryPlan(synchronousVersion(currentPath, candidate), candidate);
          const parsed = parseGrammar({ version: resolved.region?.version ?? "unsupported", candidates: resolved.candidates });
          const ids = parsed.items.map((item) => item.source.blockId).filter((id): id is string => id !== undefined).sort();
          const classifications = migrateClassifications(parsed.items);
          if (
            !candidateScan.region
            || candidateScan.region.version !== "v1"
            || candidateScan.diagnostics.length !== 0
            || !resolved.region
            || resolved.region.version !== "v1"
            || resolved.diagnostics.length !== 0
            || resolved.limitExceeded
            || !parsed.supported
            || parsed.diagnostics.length !== 0
            || !arraysEqual(ids, [...operation.expectedPlanItemIds].sort())
            || !classifications
            || !classificationsEqual(classifications, operation.expectedClassifications)
          ) {
            return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
          }
          edits.push(exactEdit(currentText, operation.span.fromOffset, operation.span.toOffset, operation.replacementRegion, "plan-region-migrated"));
          alreadyApplied = false;
          break;
        }
        case "assign-plan-item-identity": {
          const target = planTarget(operation.target);
          if (isConflict(target)) return { ok: false, conflict: target };
          const collision = ensureNewId(operation.newId);
          if (collision) return { ok: false, conflict: collision };
          edits.push(createPlanItemIdentityInsertionEdit(currentText, target.source, operation.newId));
          identities.push(resultingIdentity("plan-item", operation.newId, currentPath));
          alreadyApplied = false;
          break;
        }
        case "repair-plan-item-identity": {
          const target = planTarget(operation.target);
          if (isConflict(target)) return { ok: false, conflict: target };
          const collision = ensureNewId(operation.newId);
          if (collision) return { ok: false, conflict: collision };
          edits.push(createPlanItemIdentityRepairEdit(currentText, target.source, operation.newId));
          identities.push(resultingIdentity("plan-item", operation.newId, currentPath));
          alreadyApplied = false;
          break;
        }
        case "repair-clock-identity": {
          const target = clockTarget(operation.target);
          if (isConflict(target)) return { ok: false, conflict: target };
          const collision = ensureNewId(operation.newId);
          if (collision) return { ok: false, conflict: collision };
          edits.push(createClockIdentityRepairEdit(currentText, target.clock, operation.newId));
          identities.push(resultingIdentity("clock", operation.newId, currentPath));
          alreadyApplied = false;
          break;
        }
        case "advance-progress": {
          const target = planTarget(operation.target);
          if (isConflict(target)) return { ok: false, conflict: target };
          if (hasDuplicateProgressState(target)) {
            return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
          }
          if (target.item.kind !== "flexible-task" || target.item.status !== "open" || !target.source.checkboxSpan) {
            return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
          }
          if (operation.generatedPlanItemId) {
            const collision = ensureNewId(operation.generatedPlanItemId);
            if (collision) return { ok: false, conflict: collision };
            edits.push(createPlanItemIdentityInsertionEdit(currentText, target.source, operation.generatedPlanItemId));
            identities.push(resultingIdentity("plan-item", operation.generatedPlanItemId, currentPath));
          }
          const rawProgress = target.item.tokens.progress
            ? (() => { const [from, to] = tokenOffsets(target.source, target.item.tokens.progress!); return currentText.slice(from, to); })()
            : undefined;
          const current = rawProgress === undefined ? 0 : Number.parseInt(rawProgress.slice(1, -1), 10);
          const next = current + 10;
          if (next < 100) {
            edits.push(progressEdit(currentText, target.item, `d${next}%`, rawProgress ? "progress-updated" : "progress-inserted"));
          } else if (next === 100) {
            const targetOwnerId = target.source.blockId ?? operation.generatedPlanItemId;
            if (!targetOwnerId) {
              return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
            }
            if (targetOwnerId && index.running.some((clock) => clock.ownerId === targetOwnerId) && !operation.closeClock) {
              return { ok: false, conflict: conflict("clock-owner-invalid", plan.action, currentPath) };
            }
            edits.push(checkboxEdit(currentText, target.source, "[x]"));
            const anchor = completionAnchor(operation.logicalMinute);
            edits.push(progressEdit(currentText, target.item, anchor, "completion-anchor-inserted"));
            planPostconditions.push({ ownerId: targetOwnerId, completionAnchor: anchor });
            semanticExtras.push("progress-removed");
            if (operation.closeClock) {
              const closeConflict = appendClose(
                operation.closeClock,
                target.source.blockId ?? operation.generatedPlanItemId,
              );
              if (closeConflict) return { ok: false, conflict: closeConflict };
            }
          } else if (target.item.tokens.progress) {
            edits.push(removeTokenEdit(currentText, target.source, target.item.tokens.progress, "progress-removed"));
          }
          alreadyApplied = false;
          break;
        }
        case "reopen-progress": {
          const target = planTarget(operation.target);
          if (isConflict(target)) return { ok: false, conflict: target };
          if (hasDuplicateProgressState(target)) {
            return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
          }
          if (target.item.kind !== "flexible-task" || target.item.status !== "done" || target.item.tokens.progress || !target.source.checkboxSpan) {
            return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
          }
          if (operation.generatedPlanItemId) {
            const collision = ensureNewId(operation.generatedPlanItemId);
            if (collision) return { ok: false, conflict: collision };
            edits.push(createPlanItemIdentityInsertionEdit(currentText, target.source, operation.generatedPlanItemId));
            identities.push(resultingIdentity("plan-item", operation.generatedPlanItemId, currentPath));
          }
          edits.push(checkboxEdit(currentText, target.source, "[ ]"));
          if (target.item.tokens.completionAnchor) {
            const [from, to] = tokenOffsets(target.source, target.item.tokens.completionAnchor);
            edits.push(exactEdit(currentText, from, to, "d10%", "completion-anchor-removed"));
            semanticExtras.push("progress-inserted");
          } else {
            edits.push(progressEdit(currentText, target.item, "d10%", "progress-inserted"));
          }
          alreadyApplied = false;
          break;
        }
        case "clock-in": {
          const target = planTarget(operation.target, "complete-item");
          if (isConflict(target)) return { ok: false, conflict: target };
          if (target.item.kind !== "flexible-task" || target.item.status !== "open") {
            return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
          }
          const running = index.running;
          const owner = target.source.blockId ?? operation.generatedPlanItemId;
          if (running.length === 1 && owner && running[0]?.ownerId === owner) {
            if (plan.action === "switch-task") {
              return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
            }
            break;
          }
          if (running.length !== 0 && plan.action !== "switch-task") {
            return { ok: false, conflict: conflict("multiple-running-clocks", plan.action, currentPath) };
          }
          const clockCollision = ensureNewId(operation.clock.clockId);
          if (clockCollision) return { ok: false, conflict: clockCollision };
          const inserted = createRunningClockInsertionEdits(
            currentText,
            target.source,
            operation.clock.startEpochMs,
            operation.clock.offsetMinutes,
            operation.clock.clockId,
            logbookOptions,
          );
          edits.push(...inserted.edits);
          if (operation.generatedPlanItemId) {
            const collision = ensureNewId(operation.generatedPlanItemId);
            if (collision) return { ok: false, conflict: collision };
            edits.push(createPlanItemIdentityInsertionEdit(currentText, target.source, operation.generatedPlanItemId));
            identities.push(resultingIdentity("plan-item", operation.generatedPlanItemId, currentPath));
          } else if (!target.source.blockId) {
            return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
          }
          identities.push(resultingIdentity("clock", operation.clock.clockId, currentPath));
          alreadyApplied = false;
          break;
        }
        case "clock-out": {
          const target = clockTarget(operation.target);
          if (isConflict(target)) return { ok: false, conflict: target };
          if (plan.action === "repair-done-owner-clock" && target.owner?.item.status !== "done") {
            return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
          }
          if (target.clock.parsed.kind === "record" && target.clock.parsed.record.state === "closed") {
            if (target.clock.parsed.record.endEpochMs === operation.close.endEpochMs) break;
            return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
          }
          if (target.clock.parsed.kind !== "record") {
            return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
          }
          if (
            target.clock.parsed.record.format === "legacy"
            && localMinuteInZone(target.clock.parsed.record.startEpochMs, plan.zoneId)?.offsetMinutes
              !== operation.close.legacyStartOffsetMinutes
          ) return { ok: false, conflict: conflict("clock-discontinuity", plan.action, currentPath) };
          const existingClockId = target.clock.parsed.record.clockId;
          if (!existingClockId) {
            if (!operation.close.assignedClockId) {
              return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
            }
            const collision = ensureNewId(operation.close.assignedClockId);
            if (collision) return { ok: false, conflict: collision };
          } else if (operation.close.assignedClockId !== undefined && operation.close.assignedClockId !== existingClockId) {
            return { ok: false, conflict: conflict("source-conflict", plan.action, currentPath) };
          }
          edits.push(createCloseRunningClockEdit(currentText, target.clock, {
            endEpochMs: operation.close.endEpochMs,
            endOffsetMinutes: operation.close.offsetMinutes,
            ...(operation.close.assignedClockId ? { assignedClockId: operation.close.assignedClockId } : {}),
            ...(operation.close.legacyStartOffsetMinutes === undefined ? {} : { legacyStartOffsetMinutes: operation.close.legacyStartOffsetMinutes }),
          }));
          if (!existingClockId && operation.close.assignedClockId) {
            identities.push(resultingIdentity("clock", operation.close.assignedClockId, currentPath));
          }
          alreadyApplied = false;
          break;
        }
        case "complete": {
          const target = planTarget(operation.target);
          if (isConflict(target)) return { ok: false, conflict: target };
          if (hasDuplicateProgressState(target)) {
            return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
          }
          if (target.item.kind !== "flexible-task") {
            return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
          }
          if (target.item.status === "done" && !operation.closeClock) {
            const stableOwnerId = target.source.blockId;
            if (!stableOwnerId || index.running.some((clock) => clock.ownerId === stableOwnerId)) {
              return { ok: false, conflict: conflict("clock-owner-invalid", plan.action, currentPath) };
            }
            break;
          }
          if (target.item.status !== "open" || !target.source.checkboxSpan) {
            return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
          }
          const targetOwnerId = target.source.blockId ?? operation.generatedPlanItemId;
          if (!targetOwnerId) {
            return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
          }
          if (targetOwnerId && index.running.some((clock) => clock.ownerId === targetOwnerId) && !operation.closeClock) {
            return { ok: false, conflict: conflict("clock-owner-invalid", plan.action, currentPath) };
          }
          if (operation.generatedPlanItemId) {
            const collision = ensureNewId(operation.generatedPlanItemId);
            if (collision) return { ok: false, conflict: collision };
            edits.push(createPlanItemIdentityInsertionEdit(currentText, target.source, operation.generatedPlanItemId));
            identities.push(resultingIdentity("plan-item", operation.generatedPlanItemId, currentPath));
          }
          edits.push(checkboxEdit(currentText, target.source, "[x]"));
          planPostconditions.push({ ownerId: targetOwnerId, completionAnchor: undefined });
          if (target.item.tokens.progress) edits.push(removeTokenEdit(currentText, target.source, target.item.tokens.progress, "progress-removed"));
          if (operation.closeClock) {
            const closeConflict = appendClose(
              operation.closeClock,
              target.source.blockId ?? operation.generatedPlanItemId,
            );
            if (closeConflict) return { ok: false, conflict: closeConflict };
          }
          alreadyApplied = false;
          break;
        }
        case "delete-clock": {
          if (!deleteConfirmationIsCurrent(operation.confirmation)) {
            return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
          }
          const target = clockTarget(operation.target);
          if (isConflict(target)) return { ok: false, conflict: target };
          const confirmationTarget = operation.target.id
            ?? legacyRunningClockKey(currentPath, target.clock.fromOffset, target.clock.text);
          if (operation.confirmation.secondTargetKey !== confirmationTarget) {
            return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
          }
          if (target.clock.parsed.kind !== "record" || target.clock.parsed.record.state !== "running") {
            return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
          }
          if (clockHasAttachedContent(currentText, target.clock)) {
            return { ok: false, conflict: conflict("clock-has-attached-content", plan.action, currentPath) };
          }
          edits.push(createDeleteClockPhysicalLineEdit(currentText, target.clock));
          alreadyApplied = false;
          break;
        }
        case "normalize-legacy-clock": {
          const target = clockTarget(operation.target);
          if (isConflict(target)) return { ok: false, conflict: target };
          const selectedFoldShape = target.clock.parsed.kind === "malformed"
            && target.clock.parsed.diagnostics.length === 1
            && target.clock.parsed.diagnostics[0]?.code === "ambiguous-local-time"
            ? ambiguousLegacyShape(target.clock.text)
            : undefined;
          const selectedFold = selectedFoldShape === "running"
            ? operation.endEpochMs === undefined
              && legacyEndpointIsExact(
                target.clock.text,
                plan.zoneId,
                operation.startEpochMs,
                operation.startOffsetMinutes,
                operation.foldCandidates,
                operation.target.id,
                0,
                true,
              )
            : selectedFoldShape === "closed"
              && operation.endEpochMs !== undefined
              && operation.endOffsetMinutes !== undefined
              && operation.foldCandidates !== undefined
              && operation.endFoldCandidates !== undefined
              && (operation.foldCandidates.length === 2 || operation.endFoldCandidates.length === 2)
              && legacyEndpointIsExact(
                target.clock.text,
                plan.zoneId,
                operation.startEpochMs,
                operation.startOffsetMinutes,
                operation.foldCandidates,
                operation.target.id,
                0,
                false,
              )
              && legacyEndpointIsExact(
                target.clock.text,
                plan.zoneId,
                operation.endEpochMs,
                operation.endOffsetMinutes,
                operation.endFoldCandidates,
                operation.target.id,
                1,
                false,
              );
          if (target.clock.parsed.kind === "record") {
            if (
              target.clock.parsed.record.startEpochMs !== operation.startEpochMs
              || (target.clock.parsed.record.state === "closed"
                ? target.clock.parsed.record.endEpochMs !== operation.endEpochMs
                : operation.endEpochMs !== undefined)
              || !legacyEndpointIsExact(
                target.clock.text,
                plan.zoneId,
                operation.startEpochMs,
                operation.startOffsetMinutes,
                undefined,
                operation.target.id,
                0,
                false,
              )
              || (operation.endEpochMs !== undefined && (
                operation.endOffsetMinutes === undefined
                || !legacyEndpointIsExact(
                  target.clock.text,
                  plan.zoneId,
                  operation.endEpochMs,
                  operation.endOffsetMinutes,
                  undefined,
                  operation.target.id,
                  1,
                  false,
                )
              ))
            ) return { ok: false, conflict: conflict("source-conflict", plan.action, currentPath) };
          } else if (!selectedFold) {
            return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
          }
          const collision = ensureNewId(operation.clockId);
          if (collision && operation.target.id !== operation.clockId) return { ok: false, conflict: collision };
          edits.push(createNormalizeLegacyClockEdit(currentText, target.clock, {
            clockId: operation.clockId,
            startEpochMs: operation.startEpochMs,
            startOffsetMinutes: operation.startOffsetMinutes,
            ...(operation.endEpochMs === undefined ? {} : { endEpochMs: operation.endEpochMs }),
            ...(operation.endOffsetMinutes === undefined ? {} : { endOffsetMinutes: operation.endOffsetMinutes }),
          }));
          identities.push(resultingIdentity("clock", operation.clockId, currentPath));
          alreadyApplied = false;
          break;
        }
        case "rebase-clock": {
          const target = clockTarget(operation.target);
          if (isConflict(target)) return { ok: false, conflict: target };
          if (target.clock.parsed.kind !== "record" || target.clock.parsed.record.state !== "running") {
            return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
          }
          const trustedEffectiveNow = expectation.time.wallEpochMs
            + (context.monotonicMs - expectation.time.monotonicMs);
          const trustedElapsed = trustedEffectiveNow - target.clock.parsed.record.startEpochMs;
          const expectedRebasedStart = context.wallEpochMs - trustedElapsed;
          if (
            !Number.isSafeInteger(trustedEffectiveNow)
            || !Number.isSafeInteger(trustedElapsed)
            || trustedElapsed < 0
            || !Number.isSafeInteger(expectedRebasedStart)
            || operation.startEpochMs !== expectedRebasedStart
            || localMinuteInZone(expectedRebasedStart, plan.zoneId)?.offsetMinutes !== operation.offsetMinutes
          ) return { ok: false, conflict: conflict("clock-discontinuity", plan.action, currentPath) };
          const currentId = target.clock.parsed.record.clockId;
          if (
            currentId
            && target.clock.text === formatCanonicalRunningClock(
              operation.startEpochMs,
              operation.offsetMinutes,
              currentId,
            )
          ) break;
          edits.push(createRebaseRunningClockEdit(currentText, target.clock, operation.startEpochMs, operation.offsetMinutes));
          alreadyApplied = false;
          break;
        }
      }
    }
    const applied = applyAllowedByteEdits(currentText, edits);
    if (planPostconditions.length > 0) {
      const afterItems = parsedPlanItemsIn(currentPath, applied.text);
      for (const postcondition of planPostconditions) {
        const matches = afterItems.filter((item) => item.source.blockId === postcondition.ownerId);
        const item = matches[0];
        if (matches.length !== 1 || !item || item.status !== "done") {
          return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
        }
        const token = item.tokens.completionAnchor;
        if (postcondition.completionAnchor === undefined) {
          if (token) return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
        } else {
          if (!token) return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
          const [from, to] = tokenOffsets(item.source, token);
          if (applied.text.slice(from, to) !== postcondition.completionAnchor) {
            return { ok: false, conflict: conflict("action-no-longer-applicable", plan.action, currentPath) };
          }
        }
      }
    }
    return {
      ok: true,
      value: Object.freeze({
        text: applied.text,
        byteEdits: Object.freeze(edits.map((edit) => Object.freeze({ ...edit }))),
        semanticChanges: Object.freeze([...applied.semanticChanges, ...semanticExtras]),
        resultingIdentities: Object.freeze(identities),
        legacyKeyRelocations: legacyKeyRelocationsForStage(
          currentPath,
          currentText,
          applied.text,
          edits,
          expectation,
        ),
        alreadyApplied: alreadyApplied && applied.text === currentText,
      }),
    };
  } catch (error) {
    if (error instanceof LogbookClockMutationError) {
      return { ok: false, conflict: logbookErrorConflict(error, plan.action, currentPath) };
    }
    return { ok: false, conflict: conflict("source-conflict", plan.action, currentPath) };
  }
}

async function sourceReceipt(
  path: string,
  primitive: SourceWritePrimitive,
  beforeText: string,
  afterText: string,
  edits: readonly ByteEdit[],
): Promise<SourceReceiptInput> {
  const physicalLineAt = (text: string, offset: number): number => {
    let line = 0;
    for (let index = 0; index < Math.min(offset, text.length); index += 1) {
      if (text[index] === "\r") {
        if (text[index + 1] === "\n") index += 1;
        line += 1;
      } else if (text[index] === "\n") line += 1;
    }
    return line;
  };
  const locations = (() => {
    if (beforeText === afterText) return Object.freeze([]);
    try {
      if (applyAllowedByteEdits(beforeText, edits).text === afterText) {
        const appliedOrder = [...edits]
          .sort((left, right) => right.fromOffset - left.fromOffset || right.toOffset - left.toOffset)
          .reverse();
        let sourceCursor = 0;
        let afterCursor = 0;
        const lines: number[] = [];
        for (const edit of appliedOrder) {
          afterCursor += edit.fromOffset - sourceCursor;
          const replacementStart = afterCursor;
          const locationCountBeforeEdit = lines.length;
          let segmentStart = 0;
          for (let index = 0; index < edit.replacement.length; index += 1) {
            const width = edit.replacement[index] === "\r" && edit.replacement[index + 1] === "\n" ? 2
              : edit.replacement[index] === "\r" || edit.replacement[index] === "\n" ? 1 : 0;
            if (width === 0) continue;
            if (index > segmentStart) lines.push(physicalLineAt(afterText, replacementStart + segmentStart));
            index += width - 1;
            segmentStart = index + 1;
          }
          if (segmentStart < edit.replacement.length) {
            lines.push(physicalLineAt(afterText, replacementStart + segmentStart));
          } else if (edit.replacement.length === 0) {
            lines.push(physicalLineAt(afterText, replacementStart));
          } else if (lines.length === locationCountBeforeEdit) {
            lines.push(physicalLineAt(afterText, replacementStart));
          }
          afterCursor += edit.replacement.length;
          sourceCursor = edit.toOffset;
        }
        return Object.freeze([...new Set(lines)].map((line) => Object.freeze({ line })));
      }
    } catch {
      // A divergent host result is located from its actual confirmed bytes below.
    }
    let commonPrefix = 0;
    while (
      commonPrefix < beforeText.length
      && commonPrefix < afterText.length
      && beforeText[commonPrefix] === afterText[commonPrefix]
    ) commonPrefix += 1;
    return Object.freeze([Object.freeze({ line: physicalLineAt(afterText, commonPrefix) })]);
  })();
  return Object.freeze({
    path,
    primitive,
    before: await createSourceVersion(path, beforeText),
    after: await createSourceVersion(path, afterText),
    locations,
  });
}

export class WorkspaceCommitter {
  readonly #access: AtomicTextAccess;
  readonly #index: WorkspaceIndex;
  readonly #ownsIndex: boolean;
  readonly #logbookOptions: LogbookReadOptions;
  readonly #readContext: () => CommitContext;
  readonly #pathChangeGenerations = new Map<string, number>();
  readonly #unsubscribeChanges: Unsubscribe;
  #changeGeneration = 0;
  #blocked = false;
  #disposed = false;

  constructor(access: AtomicTextAccess, options: WorkspaceCommitterOptions) {
    if (options.workspaceIndex && options.index) {
      throw new TypeError("workspaceIndex and index options are mutually exclusive");
    }
    this.#access = access;
    this.#ownsIndex = options.workspaceIndex === undefined;
    this.#index = options.workspaceIndex ?? new WorkspaceIndex(access, options.index);
    this.#logbookOptions = options.logbook ?? {};
    this.#readContext = options.readContext;
    this.#unsubscribeChanges = access.onChange((change) => {
      this.#recordChange(change.path);
      if (change.kind === "rename" && change.oldPath !== undefined && change.oldPath !== change.path) {
        this.#recordChange(change.oldPath);
      }
    });
  }

  get blocked(): boolean {
    return this.#blocked || this.#disposed;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#blocked = true;
    this.#unsubscribeChanges();
    if (this.#ownsIndex) this.#index.dispose();
  }

  #recordChange(path: string): void {
    this.#changeGeneration += 1;
    const generation = (this.#pathChangeGenerations.get(path) ?? 0) + 1;
    this.#pathChangeGenerations.delete(path);
    this.#pathChangeGenerations.set(path, generation);
    if (this.#pathChangeGenerations.size > 1_024) {
      const oldest = this.#pathChangeGenerations.keys().next().value as string | undefined;
      if (oldest !== undefined) this.#pathChangeGenerations.delete(oldest);
    }
  }

  #changeCursor(path: string): { readonly all: number; readonly path: number } {
    return Object.freeze({
      all: this.#changeGeneration,
      path: this.#pathChangeGenerations.get(path) ?? 0,
    });
  }

  #otherSourceChanged(
    path: string,
    cursor: { readonly all: number; readonly path: number },
  ): boolean {
    const allChanges = this.#changeGeneration - cursor.all;
    const pathChanges = (this.#pathChangeGenerations.get(path) ?? 0) - cursor.path;
    return allChanges > pathChanges;
  }

  async #stoppedReceipt(
    plan: MutationPlan,
    outcome: StageStopped["outcome"],
    result: CommitConflict,
    sources: readonly SourceReceiptInput[] = [],
    expectation?: MutationExpectation,
    selectedInvalidOwner = false,
  ): Promise<CommitReceipt> {
    const ownerSnapshot = this.#index.safetySnapshot;
    let ownerCheckCurrent = true;
    let invalidOwner = selectedInvalidOwner;
    if (expectation && ownerSnapshot.complete) {
      const ownerFacts = reconciledClockFacts(this.#index, expectation, this.#logbookOptions);
      if (ownerFacts.running.length > 0) {
        let observedInvalidOwner = false;
        await invalidClockOwnerPrecondition(
          this.#index,
          this.#access,
          plan,
          expectation,
          this.#logbookOptions,
          () => this.#disposed,
          "after",
          undefined,
          () => { observedInvalidOwner = true; },
        );
        const afterOwnerCheck = this.#index.safetySnapshot;
        ownerCheckCurrent = afterOwnerCheck.complete
          && afterOwnerCheck.generation === ownerSnapshot.generation;
        if (ownerCheckCurrent) invalidOwner ||= observedInvalidOwner;
      }
    }
    const snapshot = this.#index.safetySnapshot;
    const facts = expectation && snapshot.complete
      ? reconciledClockFacts(this.#index, expectation, this.#logbookOptions)
      : Object.freeze({ running: snapshot.running, potentialRunning: snapshot.potentialRunning });
    return createCommitReceipt({
      intentId: plan.intentId,
      action: plan.action,
      outcome,
      sources,
      confirmation: outcome === "failed-no-change" ? "confirmed-no-change" : outcome === "uncertain" ? "unconfirmed" : outcome === "invariant-broken" ? "invariant-broken" : "confirmed-no-change",
      globalCheck: {
        status: !snapshot.complete || !ownerCheckCurrent
          ? "unavailable"
          : invalidOwner
            || result.code === "clock-owner-invalid"
            || facts.potentialRunning.length > 0
            || facts.running.length > 1
            || (expectation !== undefined
              && selectedClockIdentityRepair(plan, expectation)?.expected.state === "malformed")
            ? "violated"
            : "confirmed",
        runningClockIds: snapshot.complete ? receiptRunningKeys(facts.running) : [],
      },
      result,
    });
  }

  #unloadAfterHostStage(
    plan: MutationPlan,
    path: string,
    stageNumber: number,
    sources: readonly SourceReceiptInput[] = [],
  ): StageStopped {
    this.#blocked = true;
    return {
      kind: "stopped",
      outcome: "uncertain",
      sources,
      result: conflict("write-outcome-uncertain", plan.action, path, stageNumber),
    };
  }

  #unloadAfterHostReceipt(
    plan: MutationPlan,
    sources: readonly SourceReceiptInput[] = [],
    semanticChanges: readonly SemanticChange[] = [],
    resultingIdentities: readonly ResultingIdentity[] = [],
  ): CommitReceipt {
    this.#blocked = true;
    return createCommitReceipt({
      intentId: plan.intentId,
      action: plan.action,
      outcome: "uncertain",
      sources,
      semanticChanges,
      resultingIdentities,
      confirmation: "unconfirmed",
      globalCheck: { status: "unavailable", runningClockIds: [] },
      result: conflict("write-outcome-uncertain", plan.action),
    });
  }

  async #executeStage(
    plan: MutationPlan,
    expectation: MutationExpectation,
    stage: MutationStage,
    stageNumber: number,
    priorTouchedPaths: readonly string[],
  ): Promise<StageResult> {
    if (this.#disposed) {
      return { kind: "stopped", outcome: "rejected", sources: [], result: conflict("action-no-longer-applicable", plan.action, stage.path, stageNumber) };
    }
    if (!this.#index.safetySnapshot.complete) {
      return { kind: "stopped", outcome: "conflict", sources: [], result: conflict("source-conflict", plan.action, stage.path, stageNumber) };
    }
    const relocated = relocateStagePath(stage, expectation, this.#index);
    if (typeof relocated !== "string") {
      return { kind: "stopped", outcome: isConflictOutcome(relocated), sources: [], result: relocated };
    }
    const path = relocated;
    if (priorTouchedPaths.includes(path)) {
      return {
        kind: "stopped",
        outcome: "conflict",
        sources: [],
        result: conflict("action-no-longer-applicable", plan.action, path, stageNumber),
      };
    }
    const changeCursor = this.#changeCursor(path);
    const otherSourceChanged = (): boolean => this.#otherSourceChanged(path, changeCursor);
    const indexFacts = captureStageIndexFacts(this.#index, plan, expectation, this.#logbookOptions);
    let queuedText: string | undefined;
    try {
      queuedText = await this.#access.readText(path);
    } catch {
      queuedText = undefined;
    }
    if (this.#disposed) {
      return { kind: "stopped", outcome: "rejected", sources: [], result: conflict("action-no-longer-applicable", plan.action, path, stageNumber) };
    }
    if (queuedText === undefined) {
      const result = conflict("plan-item-not-found", plan.action, path, stageNumber);
      return { kind: "stopped", outcome: "rejected", sources: [], result };
    }
    if (otherSourceChanged()) {
      return { kind: "stopped", outcome: "conflict", sources: [], result: conflict("source-conflict", plan.action, path, stageNumber) };
    }
    let queuedContext: CommitContext | undefined;
    try {
      queuedContext = this.#readContext();
    } catch {
      queuedContext = undefined;
    }
    if (!queuedContext || !planContextMatches(plan, expectation, queuedContext)) {
      return { kind: "stopped", outcome: "rejected", sources: [], result: conflict("clock-discontinuity", plan.action, path, stageNumber) };
    }
    const queued = buildStage(
      path,
      queuedText,
      stage.path,
      stage,
      plan,
      expectation,
      indexFacts,
      this.#logbookOptions,
      queuedContext,
    );
    if (!queued.ok) {
      return { kind: "stopped", outcome: isConflictOutcome(queued.conflict), sources: [], result: queued.conflict };
    }
    if (queued.value.alreadyApplied) {
      let observed: string | undefined;
      try {
        observed = await this.#access.readText(path);
      } catch {
        observed = undefined;
      }
      if (this.#disposed) {
        return { kind: "stopped", outcome: "rejected", sources: [], result: conflict("action-no-longer-applicable", plan.action, path, stageNumber) };
      }
      if (observed === undefined) {
        this.#blocked = true;
        return { kind: "stopped", outcome: "uncertain", sources: [], result: conflict("write-outcome-uncertain", plan.action, path, stageNumber) };
      }
      if (otherSourceChanged()) {
        return { kind: "stopped", outcome: "conflict", sources: [], result: conflict("source-conflict", plan.action, path, stageNumber) };
      }
      let verifiedContext: CommitContext | undefined;
      try {
        verifiedContext = this.#readContext();
      } catch {
        verifiedContext = undefined;
      }
      if (!verifiedContext || !planContextMatches(plan, expectation, verifiedContext)) {
        return { kind: "stopped", outcome: "rejected", sources: [], result: conflict("clock-discontinuity", plan.action, path, stageNumber) };
      }
      const verified = buildStage(
        path,
        observed,
        stage.path,
        stage,
        plan,
        expectation,
        indexFacts,
        this.#logbookOptions,
        verifiedContext,
      );
      if (!verified.ok || !verified.value.alreadyApplied) {
        const result = verified.ok ? conflict("action-no-longer-applicable", plan.action, path, stageNumber) : verified.conflict;
        return { kind: "stopped", outcome: isConflictOutcome(result), sources: [], result };
      }
      return {
        kind: "success",
        path,
        semanticChanges: Object.freeze([]),
        resultingIdentities: Object.freeze([]),
        alreadyApplied: true,
        confirmedNoChange: await createSourceVersion(path, observed),
      };
    }

    let callbackBefore = queuedText;
    let intended = queued.value;
    let primitive = this.#access.primitiveFor(path);
    let hostEntered = false;
    let readConfirmationText: AtomicConfirmationReader | undefined;
    if (this.#disposed) {
      return { kind: "stopped", outcome: "rejected", sources: [], result: conflict("action-no-longer-applicable", plan.action, path, stageNumber) };
    }
    try {
      const host = await this.#access.atomicTransform(path, (currentText) => {
        callbackBefore = currentText;
        if (this.#disposed) {
          throw new StageConflictError(conflict("action-no-longer-applicable", plan.action, path, stageNumber));
        }
        if (otherSourceChanged()) {
          throw new StageConflictError(conflict("source-conflict", plan.action, path, stageNumber));
        }
        const callbackContext = this.#readContext();
        if (!planContextMatches(plan, expectation, callbackContext)) {
          throw new StageConflictError(conflict("clock-discontinuity", plan.action, path, stageNumber));
        }
        const rebuilt = buildStage(
          path,
          currentText,
          stage.path,
          stage,
          plan,
          expectation,
          indexFacts,
          this.#logbookOptions,
          callbackContext,
        );
        if (!rebuilt.ok) throw new StageConflictError(rebuilt.conflict);
        intended = rebuilt.value;
        return Object.freeze({ text: rebuilt.value.text, edits: rebuilt.value.byteEdits, value: rebuilt.value });
      }, (enteredPrimitive, confirmationReader) => {
        hostEntered = true;
        primitive = enteredPrimitive;
        readConfirmationText = confirmationReader;
      });
      primitive = host.primitive;
      intended = host.value;
      readConfirmationText = host.readConfirmationText;
    } catch (error) {
      if (this.#disposed) {
        if (error instanceof StageConflictError && error.conflict.code === "action-no-longer-applicable") {
          return { kind: "stopped", outcome: "rejected", sources: [], result: error.conflict };
        }
        if (hostEntered) {
          this.#blocked = true;
          return { kind: "stopped", outcome: "uncertain", sources: [], result: conflict("write-outcome-uncertain", plan.action, path, stageNumber) };
        }
        return { kind: "stopped", outcome: "rejected", sources: [], result: conflict("action-no-longer-applicable", plan.action, path, stageNumber) };
      }
      let observed: string | undefined;
      try {
        observed = await (readConfirmationText ?? (() => this.#access.readText(path)))();
      } catch {
        observed = undefined;
      }
      if (this.#disposed) {
        return this.#unloadAfterHostStage(plan, path, stageNumber);
      }
      if (observed === undefined) {
        this.#blocked = true;
        return { kind: "stopped", outcome: "uncertain", sources: [], result: conflict("write-outcome-uncertain", plan.action, path, stageNumber) };
      }
      const receipt = await sourceReceipt(path, primitive, callbackBefore, observed, intended.byteEdits);
      if (this.#disposed) return this.#unloadAfterHostStage(plan, path, stageNumber);
      if (observed === intended.text && observed !== callbackBefore) {
        return {
          kind: "success",
          path,
          source: receipt,
          semanticChanges: intended.semanticChanges,
          resultingIdentities: intended.resultingIdentities,
          legacyKeyRelocations: intended.legacyKeyRelocations,
          alreadyApplied: false,
        };
      }
      if (observed === callbackBefore) {
        if (error instanceof StageConflictError) {
          return { kind: "stopped", outcome: isConflictOutcome(error.conflict), sources: [receipt], result: error.conflict };
        }
        return { kind: "stopped", outcome: "failed-no-change", sources: [receipt], result: conflict("write-failed-no-change", plan.action, path, stageNumber) };
      }
      this.#blocked = true;
      return { kind: "stopped", outcome: "uncertain", sources: [receipt], result: conflict("write-outcome-uncertain", plan.action, path, stageNumber) };
    }

    if (this.#disposed) {
      this.#blocked = true;
      return { kind: "stopped", outcome: "uncertain", sources: [], result: conflict("write-outcome-uncertain", plan.action, path, stageNumber) };
    }

    let observed: string | undefined;
    try {
      observed = await (readConfirmationText ?? (() => this.#access.readText(path)))();
    } catch {
      observed = undefined;
    }
    if (this.#disposed) {
      return this.#unloadAfterHostStage(plan, path, stageNumber);
    }
    if (observed === undefined) {
      this.#blocked = true;
      return { kind: "stopped", outcome: "uncertain", sources: [], result: conflict("write-outcome-uncertain", plan.action, path, stageNumber) };
    }
    const receipt = await sourceReceipt(path, primitive, callbackBefore, observed, intended.byteEdits);
    if (this.#disposed) return this.#unloadAfterHostStage(plan, path, stageNumber);
    if (observed !== intended.text) {
      if (observed === callbackBefore) {
        return { kind: "stopped", outcome: "failed-no-change", sources: [receipt], result: conflict("write-failed-no-change", plan.action, path, stageNumber) };
      }
      this.#blocked = true;
      return { kind: "stopped", outcome: "invariant-broken", sources: [receipt], result: conflict("write-invariant-broken", plan.action, path, stageNumber) };
    }
    return {
      kind: "success",
      path,
      source: receipt,
      semanticChanges: intended.semanticChanges,
      resultingIdentities: intended.resultingIdentities,
      legacyKeyRelocations: intended.legacyKeyRelocations,
      alreadyApplied: intended.alreadyApplied,
    };
  }

  async commit(plan: MutationPlan, expectation: MutationExpectation): Promise<CommitReceipt> {
    if (this.#disposed) {
      return this.#stoppedReceipt(plan, "rejected", conflict("action-no-longer-applicable", plan.action));
    }
    if (this.#blocked) {
      return this.#stoppedReceipt(plan, "uncertain", conflict("write-outcome-uncertain", plan.action));
    }
    if (!mutationPlanIsValid(plan)) {
      const receiptPlan = typeof plan.intentId === "string" && plan.intentId.length > 0 && !plan.intentId.includes("\0")
        ? plan
        : { ...plan, intentId: "invalid-intent" };
      return this.#stoppedReceipt(receiptPlan, "rejected", conflict("source-conflict", plan.action));
    }
    plan = createMutationPlan(plan);
    let currentContext: CommitContext | undefined;
    try {
      currentContext = this.#readContext();
    } catch {
      currentContext = undefined;
    }
    if (!currentContext || !expectationMatchesPlan(expectation, plan) || !planContextMatches(plan, expectation, currentContext)) {
      return this.#stoppedReceipt(plan, "rejected", conflict("clock-discontinuity", plan.action));
    }
    if (isNoMarkdownAction(plan.action)) {
      return createCommitReceipt({
        intentId: plan.intentId,
        action: plan.action,
        outcome: "already-applied",
        confirmation: "confirmed",
        globalCheck: { status: "not-required", runningClockIds: [] },
      });
    }
    await this.#index.rebuild();
    const snapshot = this.#index.safetySnapshot;
    if (this.#disposed) {
      return this.#stoppedReceipt(plan, "rejected", conflict("action-no-longer-applicable", plan.action));
    }
    if (!snapshot.complete) return this.#stoppedReceipt(plan, "rejected", conflict("source-over-limit", plan.action));
    let selectedInvalidOwnerAtAdmission = false;
    const invalidOwner = await invalidClockOwnerPrecondition(
      this.#index,
      this.#access,
      plan,
      expectation,
      this.#logbookOptions,
      () => this.#disposed,
      "before",
      () => { selectedInvalidOwnerAtAdmission = true; },
    );
    const stoppedAfterOwnerAdmission = (
      outcome: StageStopped["outcome"],
      result: CommitConflict,
      sources: readonly SourceReceiptInput[] = [],
    ) => this.#stoppedReceipt(
      plan,
      outcome,
      result,
      sources,
      expectation,
      selectedInvalidOwnerAtAdmission,
    );
    if (this.#disposed) {
      return stoppedAfterOwnerAdmission(
        "rejected",
        conflict("action-no-longer-applicable", plan.action),
      );
    }
    if (invalidOwner) {
      return stoppedAfterOwnerAdmission(
        isConflictOutcome(invalidOwner),
        invalidOwner,
      );
    }
    const initialFacts = reconciledClockFacts(this.#index, expectation, this.#logbookOptions);
    if (deleteIsAuthoritativelyAbsent(plan, expectation, this.#index, this.#logbookOptions)) {
      return createCommitReceipt({
        intentId: plan.intentId,
        action: plan.action,
        outcome: "already-applied",
        confirmation: "confirmed",
        globalCheck: { status: "confirmed", runningClockIds: receiptRunningKeys(initialFacts.running) },
      });
    }
    const admittedSwitch = await switchAdmission(
      this.#index,
      this.#access,
      plan,
      expectation,
      this.#logbookOptions,
    );
    if (this.#disposed) {
      return stoppedAfterOwnerAdmission("rejected", conflict("action-no-longer-applicable", plan.action));
    }
    if (admittedSwitch && admittedSwitch !== "ready" && admittedSwitch !== "already-applied") {
      return stoppedAfterOwnerAdmission(isConflictOutcome(admittedSwitch), admittedSwitch);
    }
    if (admittedSwitch === "already-applied") {
      return createCommitReceipt({
        intentId: plan.intentId,
        action: plan.action,
        outcome: "already-applied",
        confirmation: "confirmed",
        globalCheck: { status: "confirmed", runningClockIds: receiptRunningKeys(initialFacts.running) },
      });
    }
    const identityEndState = await identityEndStateAdmission(
      this.#index,
      this.#access,
      plan,
      expectation,
      this.#logbookOptions,
    );
    if (this.#disposed) {
      return stoppedAfterOwnerAdmission("rejected", conflict("action-no-longer-applicable", plan.action));
    }
    if (identityEndState && identityEndState !== "already-applied") {
      return stoppedAfterOwnerAdmission(isConflictOutcome(identityEndState), identityEndState);
    }
    if (identityEndState === "already-applied") {
      let selectedInvalidOwner = false;
      const finalOwner = await invalidClockOwnerPrecondition(
        this.#index,
        this.#access,
        plan,
        expectation,
        this.#logbookOptions,
        () => this.#disposed,
        "after",
        () => { selectedInvalidOwner = true; },
      );
      if (this.#disposed) {
        return stoppedAfterOwnerAdmission("rejected", conflict("action-no-longer-applicable", plan.action));
      }
      const liveIdentitySnapshot = this.#index.safetySnapshot;
      if (!liveIdentitySnapshot.complete || liveIdentitySnapshot.generation !== snapshot.generation) {
        const changedGlobalState = conflict("source-conflict", plan.action);
        return stoppedAfterOwnerAdmission(
          isConflictOutcome(changedGlobalState),
          changedGlobalState,
        );
      }
      if (finalOwner) {
        return stoppedAfterOwnerAdmission(isConflictOutcome(finalOwner), finalOwner);
      }
      const blockingPotential = initialFacts.potentialRunning.find((clock) =>
        !potentialClockIsSelectedPlanRepair(clock, plan, expectation, "after")
        && !potentialClockIsSelectedClockRepair(clock, plan, expectation, "after"));
      if (blockingPotential) {
        const potential = conflict("potential-running-clock", plan.action, blockingPotential.path);
        return stoppedAfterOwnerAdmission(isConflictOutcome(potential), potential);
      }
      const expectedFinalRunningClockIds = finalGlobalExpectation(
        plan,
        expectation,
        expectation.expectedRunningClockIds,
      );
      if (
        expectedFinalRunningClockIds === undefined
        || !arraysEqual(sortedRunningKeys(initialFacts.running), expectedFinalRunningClockIds)
      ) {
        const changedGlobalState = conflict("source-conflict", plan.action);
        return stoppedAfterOwnerAdmission(
          isConflictOutcome(changedGlobalState),
          changedGlobalState,
        );
      }
      const status = selectedInvalidOwner
        || initialFacts.potentialRunning.length > 0
        || initialFacts.running.length > 1
        || selectedClockIdentityRepair(plan, expectation)?.expected.state === "malformed"
        ? "violated"
        : "confirmed";
      return createCommitReceipt({
        intentId: plan.intentId,
        action: plan.action,
        outcome: "already-applied",
        confirmation: "confirmed",
        globalCheck: { status, runningClockIds: receiptRunningKeys(initialFacts.running) },
      });
    }
    const invalidRepair = repairPrecondition(this.#index, plan, expectation, this.#logbookOptions);
    if (invalidRepair) return stoppedAfterOwnerAdmission(isConflictOutcome(invalidRepair), invalidRepair);
    const beforeConflict = globalPrecondition(this.#index, expectation, plan, this.#logbookOptions);
    if (beforeConflict) return stoppedAfterOwnerAdmission(isConflictOutcome(beforeConflict), beforeConflict);
    const relocatedPaths: string[] = [];
    for (const stage of plan.stages) {
      const relocated = relocateStagePath(stage, expectation, this.#index);
      if (typeof relocated !== "string") return stoppedAfterOwnerAdmission(isConflictOutcome(relocated), relocated);
      relocatedPaths.push(relocated);
    }
    if (new Set(relocatedPaths).size !== relocatedPaths.length) {
      return stoppedAfterOwnerAdmission("conflict", conflict("source-conflict", plan.action, relocatedPaths[0]));
    }

    const sources: SourceReceiptInput[] = [];
    const confirmedNoChange: SourceVersion[] = [];
    const touchedPaths: string[] = [];
    const semanticChanges: SemanticChange[] = [];
    const identities: ResultingIdentity[] = [];
    const legacyKeyRelocations = new Map<string, string>();
    let allAlreadyApplied = true;
    for (const [stageIndex, stage] of plan.stages.entries()) {
      if (this.#disposed) {
        if (sources.length === 0) {
          return stoppedAfterOwnerAdmission(
            "rejected",
            conflict("action-no-longer-applicable", plan.action, stage.path, stageIndex),
          );
        }
        return createCommitReceipt({
          intentId: plan.intentId,
          action: plan.action,
          outcome: "partial-safe",
          sources,
          semanticChanges,
          resultingIdentities: identities,
          confirmation: "partial",
          globalCheck: { status: "unavailable", runningClockIds: [] },
          result: plan.action === "switch-task"
            ? conflict("partial-switch", plan.action, stage.path, stageIndex)
            : conflict("action-no-longer-applicable", plan.action, stage.path, stageIndex),
        });
      }
      if (stageIndex > 0) {
        await this.#index.rebuild();
        const intermediate = this.#index.safetySnapshot;
        if (this.#disposed) {
          return createCommitReceipt({
            intentId: plan.intentId,
            action: plan.action,
            outcome: "partial-safe",
            sources,
            semanticChanges,
            resultingIdentities: identities,
            confirmation: "partial",
            globalCheck: { status: "unavailable", runningClockIds: [] },
            result: plan.action === "switch-task"
              ? conflict("partial-switch", plan.action, stage.path, stageIndex)
              : conflict("action-no-longer-applicable", plan.action, stage.path, stageIndex),
          });
        }
        const intermediateFacts = reconciledClockFacts(this.#index, expectation, this.#logbookOptions);
        const unsafeSwitch = plan.action === "switch-task"
          && (intermediateFacts.potentialRunning.length > 0 || intermediateFacts.running.length !== 0);
        const appliedRepairKeys = plan.action === "repair-overlap"
          ? plan.stages.slice(0, stageIndex).flatMap((priorStage) => priorStage.operations.flatMap((operation) => {
              if (operation.kind !== "clock-out") return [];
              const key = expectedClockKey(operation.target, priorStage.path, expectation);
              return key ? [key] : [];
            }))
          : [];
        const expectedRepairRunning = relocateLegacyKeys(expectation.expectedRunningClockIds
          .filter((key) => !appliedRepairKeys.includes(key))
          .sort(), legacyKeyRelocations);
        const unsafeRepair = plan.action === "repair-overlap"
          && (intermediateFacts.potentialRunning.length > 0
            || !arraysEqual(sortedRunningKeys(intermediateFacts.running), expectedRepairRunning));
        if (!intermediate.complete || unsafeSwitch || unsafeRepair) {
          const result = plan.action === "switch-task"
            ? conflict("partial-switch", plan.action, stage.path, stageIndex)
            : conflict(intermediate.complete ? "action-no-longer-applicable" : "source-over-limit", plan.action, stage.path, stageIndex);
          return createCommitReceipt({
            intentId: plan.intentId,
            action: plan.action,
            outcome: "partial-safe",
            sources,
            semanticChanges,
            resultingIdentities: identities,
            confirmation: "partial",
            globalCheck: {
              status: intermediate.complete && intermediateFacts.running.length <= 1 && intermediateFacts.potentialRunning.length === 0 ? "confirmed" : "violated",
              runningClockIds: intermediate.complete ? receiptRunningKeys(intermediateFacts.running) : [],
            },
            result,
          });
        }
      }
      const result = await this.#executeStage(plan, expectation, stage, stageIndex, touchedPaths);
      if (result.kind === "stopped") {
        if (sources.length > 0) {
          if (this.#disposed) {
            if (result.outcome === "rejected" && result.sources.length === 0) {
              return createCommitReceipt({
                intentId: plan.intentId,
                action: plan.action,
                outcome: "partial-safe",
                sources,
                semanticChanges,
                resultingIdentities: identities,
                confirmation: "partial",
                globalCheck: { status: "unavailable", runningClockIds: [] },
                result: plan.action === "switch-task"
                  ? conflict("partial-switch", plan.action, stage.path, stageIndex)
                  : result.result,
              });
            }
            return this.#unloadAfterHostReceipt(plan, sources, semanticChanges, identities);
          }
          await this.#index.rebuild();
          const latest = this.#index.safetySnapshot;
          const latestFacts = reconciledClockFacts(this.#index, expectation, this.#logbookOptions);
          if (result.outcome === "uncertain" || result.outcome === "invariant-broken") {
            this.#blocked = true;
            return createCommitReceipt({
              intentId: plan.intentId,
              action: plan.action,
              outcome: result.outcome,
              sources: [...sources, ...result.sources],
              semanticChanges,
              resultingIdentities: identities,
              confirmation: result.outcome === "uncertain" ? "unconfirmed" : "invariant-broken",
              globalCheck: {
                status: !latest.complete
                  ? "unavailable"
                  : latestFacts.potentialRunning.length > 0 || latestFacts.running.length > 1
                    ? "violated"
                    : "confirmed",
                runningClockIds: latest.complete ? receiptRunningKeys(latestFacts.running) : [],
              },
              result: result.result,
            });
          }
          return createCommitReceipt({
            intentId: plan.intentId,
            action: plan.action,
            outcome: "partial-safe",
            sources: [...sources, ...result.sources],
            semanticChanges,
            resultingIdentities: identities,
            confirmation: "partial",
            globalCheck: {
              status: !latest.complete
                ? "unavailable"
                : latestFacts.running.length <= 1 && latestFacts.potentialRunning.length === 0
                  ? "confirmed"
                  : "violated",
              runningClockIds: latest.complete ? receiptRunningKeys(latestFacts.running) : [],
            },
            result: plan.action === "switch-task"
              ? conflict("partial-switch", plan.action, stage.path, stageIndex)
              : result.result,
          });
        }
        return stoppedAfterOwnerAdmission(result.outcome, result.result, result.sources);
      }
      if (result.source) sources.push(result.source);
      if (result.confirmedNoChange) confirmedNoChange.push(result.confirmedNoChange);
      touchedPaths.push(result.path);
      semanticChanges.push(...result.semanticChanges);
      identities.push(...result.resultingIdentities);
      for (const relocation of result.legacyKeyRelocations ?? []) {
        legacyKeyRelocations.set(relocation.before, relocation.after);
      }
      allAlreadyApplied &&= result.alreadyApplied;
    }

    await this.#index.rebuild();
    const finalSnapshot = this.#index.safetySnapshot;
    if (this.#disposed) {
      return this.#unloadAfterHostReceipt(plan, sources, semanticChanges, identities);
    }
    const finalGeneration = finalSnapshot.generation;
    let selectedInvalidOwner = false;
    const finalInvalidOwner = finalSnapshot.complete
      ? await invalidClockOwnerPrecondition(
          this.#index,
          this.#access,
          plan,
          expectation,
          this.#logbookOptions,
          () => this.#disposed,
          "after",
          () => { selectedInvalidOwner = true; },
        )
      : undefined;
    if (this.#disposed) {
      return this.#unloadAfterHostReceipt(plan, sources, semanticChanges, identities);
    }
    const plannedFinal = finalGlobalExpectation(plan, expectation, expectation.expectedRunningClockIds);
    const expectedFinal = plannedFinal === undefined
      ? undefined
      : relocateLegacyKeys(plannedFinal, legacyKeyRelocations);
    const finalFacts = reconciledClockFacts(this.#index, expectation, this.#logbookOptions);
    const global = validateFinalGlobal(this.#index, expectedFinal, expectation, this.#logbookOptions);
    const confirmedDegradedIdentityRepair = finalSnapshot.complete
      && expectedFinal !== undefined
      && arraysEqual(global.ids, expectedFinal)
      && (
        (plan.action === "repair-clock-identity"
          && selectedClockIdentityRepair(plan, expectation)?.expected.state === "malformed"
          && finalFacts.potentialRunning.length === 0)
        || ((plan.action === "repair-clock-identity" || plan.action === "repair-plan-item-identity")
          && selectedInvalidOwner
          && finalFacts.potentialRunning.length === 0)
        || (global.status !== "confirmed"
          && plan.action === "repair-clock-identity"
          && finalFacts.potentialRunning.length === 0)
        || (global.status !== "confirmed" && plan.action === "repair-clock-identity"
          && finalFacts.potentialRunning.length > 0
          && finalFacts.potentialRunning.every((clock) =>
            potentialClockIsSelectedClockRepair(clock, plan, expectation, "after")))
        || (global.status !== "confirmed" && plan.action === "repair-plan-item-identity"
          && finalFacts.potentialRunning.length > 0
          && finalFacts.potentialRunning.every((clock) =>
            potentialClockIsSelectedPlanRepair(clock, plan, expectation, "after")))
      );
    let sourceConfirmationBroken = false;
    const confirmedVersions = [
      ...sources.map((source) => source.after),
      ...confirmedNoChange,
    ];
    for (const confirmed of confirmedVersions) {
      let current: string | undefined;
      try {
        current = await this.#access.readText(confirmed.file);
      } catch {
        current = undefined;
      }
      if (this.#disposed) {
        return this.#unloadAfterHostReceipt(plan, sources, semanticChanges, identities);
      }
      if (current === undefined) {
        sourceConfirmationBroken = true;
        break;
      }
      const version = await createSourceVersion(confirmed.file, current);
      if (this.#disposed) {
        return this.#unloadAfterHostReceipt(plan, sources, semanticChanges, identities);
      }
      if (
        version.contentDigest !== confirmed.contentDigest
        || version.contentLength !== confirmed.contentLength
      ) {
        sourceConfirmationBroken = true;
        break;
      }
    }
    const stableTargets = plan.stages.flatMap((stage, stageIndex) => stage.operations.flatMap((operation) => {
      const boundOwnerId = !actionAllowsInvalidClockOwnerRecovery(plan.action)
        && "target" in operation && operation.target.kind === "clock"
        ? findClockExpectation(expectation, operation.target, stage.path)?.ownerId
        : undefined;
      return stableTargetIds(operation, boundOwnerId, allAlreadyApplied && plan.action === "clock-in")
        .map((id) => Object.freeze({ id, path: touchedPaths[stageIndex]! }));
    }));
    const missingTargets = plan.stages.flatMap((stage) => stage.operations.flatMap(missingTargetIds));
    const resultingIdentityBroken = identities.some((identity) => {
      const lookup = this.#index.safetyIdentity(identity.id);
      return lookup.kind !== "unique" || lookup.location.path !== identity.path;
    });
    const stableTargetBroken = stableTargets.some((target) => {
      const lookup = this.#index.safetyIdentity(target.id);
      return lookup.kind !== "unique" || lookup.location.path !== target.path;
    });
    const missingTargetBroken = missingTargets.some((id) => this.#index.safetyIdentity(id).kind !== "missing");
    const liveSnapshot = this.#index.safetySnapshot;
    const finalIndexStillCurrent = liveSnapshot.complete && liveSnapshot.generation === finalGeneration;
    if (this.#disposed) {
      return this.#unloadAfterHostReceipt(plan, sources, semanticChanges, identities);
    }
    if (
      !finalSnapshot.complete
      || !finalIndexStillCurrent
      || (global.status !== "confirmed" && !confirmedDegradedIdentityRepair)
      || resultingIdentityBroken
      || stableTargetBroken
      || missingTargetBroken
      || sourceConfirmationBroken
      || finalInvalidOwner !== undefined
    ) {
      this.#blocked = true;
      return createCommitReceipt({
        intentId: plan.intentId,
        action: plan.action,
        outcome: "invariant-broken",
        sources,
        semanticChanges,
        resultingIdentities: identities,
        confirmation: "invariant-broken",
        globalCheck: {
          status: resultingIdentityBroken || stableTargetBroken || missingTargetBroken
            || sourceConfirmationBroken || !finalIndexStillCurrent || finalInvalidOwner !== undefined
            ? "violated"
            : global.status,
          runningClockIds: global.receiptIds,
        },
        result: conflict("write-invariant-broken", plan.action),
      });
    }
    return createCommitReceipt({
      intentId: plan.intentId,
      action: plan.action,
      outcome: allAlreadyApplied ? "already-applied" : "applied",
      sources,
      semanticChanges,
      resultingIdentities: identities,
      confirmation: "confirmed",
      globalCheck: {
        status: confirmedDegradedIdentityRepair ? "violated" : "confirmed",
        runningClockIds: global.receiptIds,
      },
    });
  }
}
