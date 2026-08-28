import { parseGrammar } from "../core/grammar-v1";
import type { PlanItem, PlanItemStatus } from "../core/model";
import { isCanonicalClockId, parseClockText } from "./clock-parser";
import { createCommitConflict, type CommitConflict } from "./conflicts";
import type { BlockIdLocation, IdentityLookup } from "./identity-index";
import { readLogbook, type LogbookClock, type LogbookReadOptions, type LogbookReadResult } from "./logbook-reader";
import {
  createCanonicalPreviewToken,
  isMutationPreviewToken,
  mutationPlanPreviewTokenMatches,
  type MutationAction,
  type MutationPlan,
} from "./mutations";
import { resolvePrimaryPlan, type WorkspacePlanItemSource } from "./primary-plan-resolver";
import type { SourceSpan, SourceVersion } from "./source-version";

export interface PlanItemSelector {
  readonly kind: "plan-item";
  readonly id?: string;
}

export interface ClockSelector {
  readonly kind: "clock";
  readonly id?: string;
  readonly ownerId?: string;
  readonly fromOffset?: number;
}

export type PlanItemWatch = "first-line" | "complete-item" | "identity-and-state";

export interface PlanItemExpectation {
  readonly target: PlanItemSelector;
  readonly path: string;
  readonly sourceText: string;
  readonly itemSpan: SourceSpan;
  readonly firstLineText: string;
  readonly watchedText: string;
  readonly watch: PlanItemWatch;
  readonly grammarVersion: "v1";
  readonly itemKind: "flexible-task" | "fixed-event";
  readonly status: PlanItemStatus;
  readonly drawerCount: number;
}

export interface ClockExpectation {
  readonly target: ClockSelector;
  readonly path: string;
  readonly sourceText: string;
  readonly span: SourceSpan;
  readonly text: string;
  readonly state: "running" | "closed" | "potential-running";
  readonly ownerId: string | undefined;
}

export interface TrustedTimeExpectation {
  readonly wallEpochMs: number;
  readonly monotonicMs: number;
  readonly maximumDriftMs: number;
  readonly maximumQueueDelayMs: number;
  readonly discontinuity: boolean;
}

export interface MutationExpectation {
  readonly intentId: string;
  readonly action: MutationAction;
  readonly planItems: readonly PlanItemExpectation[];
  readonly clocks: readonly ClockExpectation[];
  readonly expectedRunningClockIds: readonly string[];
  readonly settingsVersion: number;
  readonly zoneId: string;
  readonly indexComplete: boolean;
  readonly time: TrustedTimeExpectation;
  readonly previewToken: string;
  readonly expectationToken: string;
  readonly selectedRepair?: SelectedRepairEvidence;
}

export interface SelectedRepairEvidence {
  readonly id: string;
  readonly locations: readonly BlockIdLocation[];
  readonly selectedSpan: Pick<SourceSpan, "fromOffset" | "toOffset"> & { readonly path: string };
}

export type MutationExpectationInput = Omit<MutationExpectation, "expectationToken"> & {
  readonly expectationToken?: string;
};

export interface CreatePlanItemExpectationInput {
  readonly target: PlanItemSelector;
  readonly path: string;
  readonly sourceText: string;
  readonly item: PlanItem<WorkspacePlanItemSource>;
  readonly drawerCount: number;
  readonly watch: PlanItemWatch;
}

export interface CreateClockExpectationInput {
  readonly target: ClockSelector;
  readonly path: string;
  readonly sourceText: string;
  readonly clock: LogbookClock;
}

export interface RevalidatedPlanItem {
  readonly item: PlanItem<WorkspacePlanItemSource>;
  readonly source: WorkspacePlanItemSource;
  readonly logbook: LogbookReadResult;
}

export interface RevalidatedClock {
  readonly clock: LogbookClock;
  readonly owner?: RevalidatedPlanItem;
}

export type RevalidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly conflict: CommitConflict };

export interface SelectedRepairAdmission {
  readonly kind: "selected-repair";
  readonly identity: Extract<IdentityLookup, { readonly kind: "collision" }>;
  readonly selectedSpan: Pick<SourceSpan, "fromOffset" | "toOffset"> & { readonly path: string };
}

export type TargetIdentityAdmission = IdentityLookup | SelectedRepairAdmission;

function freezeSpan(span: SourceSpan): SourceSpan {
  return Object.freeze({ ...span });
}

function assertNonempty(name: string, value: string): void {
  if (typeof value !== "string" || value.length === 0) throw new TypeError(`${name} must be non-empty`);
}

const LEGACY_LOCAL_STAMP = "\\[\\d{4}-\\d{2}-\\d{2}(?: (?:Mon|Tue|Wed|Thu|Fri|Sat|Sun))? \\d{2}:\\d{2}\\]";

function ambiguousLegacyState(text: string): "running" | "closed" | undefined {
  const body = text.replace(/^:?[ \t]*clock::?[ \t]*/i, "").trimEnd();
  const terminalId = "(?: \\^nl-clock-[0-9A-Za-z-]+)?";
  if (new RegExp(`^${LEGACY_LOCAL_STAMP}${terminalId}$`).test(body)) return "running";
  if (new RegExp(`^${LEGACY_LOCAL_STAMP}[ \\t]*--[ \\t]*${LEGACY_LOCAL_STAMP}(?:[ \\t]*=>[ \\t]*\\d+:\\d{2})?${terminalId}$`).test(body)) {
    return "closed";
  }
  return undefined;
}

function conflict(
  code: CommitConflict["code"],
  action: MutationAction,
  path: string,
  id?: string,
): RevalidationResult<never> {
  return Object.freeze({
    ok: false as const,
    conflict: createCommitConflict(code, {
      action,
      sources: [{ path, ...(id ? { identitySuffix: id.slice(-12) } : {}) }],
    }),
  });
}

function synchronousVersion(path: string, content: string): SourceVersion {
  return Object.freeze({ file: path, contentDigest: "0".repeat(64), contentLength: content.length });
}

function parsedItems(path: string, sourceText: string): readonly PlanItem<WorkspacePlanItemSource>[] {
  const primary = resolvePrimaryPlan(synchronousVersion(path, sourceText), sourceText);
  if (!primary.region || primary.limitExceeded || primary.diagnostics.length > 0) return Object.freeze([]);
  const parsed = parseGrammar({ version: primary.region.version, candidates: primary.candidates });
  return parsed.supported ? parsed.items : Object.freeze([]);
}

function itemWatchedText(
  sourceText: string,
  source: WorkspacePlanItemSource,
  watch: PlanItemWatch,
): string {
  if (watch === "first-line") return sourceText.slice(source.firstLineSpan.fromOffset, source.firstLineSpan.toOffset);
  if (watch === "complete-item") return sourceText.slice(source.itemSpan.fromOffset, source.itemSpan.toOffset);
  return `${source.blockId ?? ""}\0${sourceText.slice(
    source.checkboxSpan?.fromOffset ?? source.firstLineSpan.fromOffset,
    source.checkboxSpan?.toOffset ?? source.firstLineSpan.fromOffset,
  )}`;
}

export function createPlanItemExpectation(input: CreatePlanItemExpectationInput): PlanItemExpectation {
  assertNonempty("Plan Item expectation path", input.path);
  if (input.item.source.version.file !== input.path) {
    throw new TypeError("Plan Item expectation source path mismatch");
  }
  if (input.target.id !== undefined && input.item.source.blockId !== input.target.id) {
    throw new TypeError("Plan Item expectation identity mismatch");
  }
  if (input.target.id === undefined && input.item.source.blockId !== undefined) {
    throw new TypeError("Anonymous Plan Item expectation cannot target an identified item");
  }
  const watchedText = itemWatchedText(input.sourceText, input.item.source, input.watch);
  return Object.freeze({
    target: Object.freeze({ ...input.target }),
    path: input.path,
    sourceText: input.sourceText,
    itemSpan: freezeSpan(input.item.source.itemSpan),
    firstLineText: input.item.source.firstLineText,
    watchedText,
    watch: input.watch,
    grammarVersion: "v1",
    itemKind: input.item.kind,
    status: input.item.status,
    drawerCount: input.drawerCount,
  });
}

export function createClockExpectation(input: CreateClockExpectationInput): ClockExpectation {
  assertNonempty("CLOCK expectation path", input.path);
  const record = input.clock.parsed.kind === "record" ? input.clock.parsed.record : undefined;
  const rawIdMatch = /(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/.exec(input.clock.text);
  const rawId = rawIdMatch && isCanonicalClockId(rawIdMatch[1]!) ? rawIdMatch[1]! : undefined;
  const observedId = record?.clockId ?? rawId;
  const selectedFoldState = input.clock.parsed.kind === "malformed"
    && input.clock.parsed.diagnostics.length === 1
    && input.clock.parsed.diagnostics[0]?.code === "ambiguous-local-time"
    ? ambiguousLegacyState(input.clock.text)
    : undefined;
  if (!record && !selectedFoldState) throw new TypeError("CLOCK expectation requires a parsed record or selected DST fold");
  if (input.target.id !== undefined && observedId !== input.target.id) {
    throw new TypeError("CLOCK expectation identity mismatch");
  }
  if (input.target.id === undefined && observedId !== undefined) {
    throw new TypeError("Exact legacy CLOCK expectation cannot target an identified record");
  }
  if (input.target.id !== undefined && input.target.fromOffset !== undefined) {
    throw new TypeError("Identified CLOCK selectors cannot carry an anonymous locator");
  }
  if (input.target.fromOffset !== undefined && input.target.fromOffset !== input.clock.fromOffset) {
    throw new TypeError("Exact legacy CLOCK expectation locator mismatch");
  }
  if (input.target.ownerId !== undefined && input.target.ownerId !== input.clock.ownerId) {
    throw new TypeError("CLOCK expectation owner relationship mismatch");
  }
  return Object.freeze({
    target: Object.freeze({
      ...input.target,
      ...(observedId === undefined ? { fromOffset: input.clock.fromOffset } : {}),
    }),
    path: input.path,
    sourceText: input.sourceText,
    span: Object.freeze({
      fromOffset: input.clock.fromOffset,
      toOffset: input.clock.toOffset,
      fromLine: 0,
      fromColumn: 0,
      toLine: 0,
      toColumn: 0,
    }),
    text: input.clock.text,
    state: record?.state ?? (selectedFoldState === "running" ? "potential-running" : "closed"),
    ownerId: input.clock.ownerId,
  });
}

function freezeSelectedRepairEvidence(
  evidence: SelectedRepairEvidence,
  planItems: readonly PlanItemExpectation[],
  clocks: readonly ClockExpectation[],
): SelectedRepairEvidence {
  assertNonempty("selected repair identity", evidence.id);
  assertNonempty("selected repair path", evidence.selectedSpan.path);
  if (
    evidence.locations.length < 2
    || !Number.isSafeInteger(evidence.selectedSpan.fromOffset)
    || !Number.isSafeInteger(evidence.selectedSpan.toOffset)
    || evidence.selectedSpan.fromOffset < 0
    || evidence.selectedSpan.toOffset < evidence.selectedSpan.fromOffset
  ) throw new TypeError("selected repair evidence requires a collision and a valid exact span");
  const locations = evidence.locations.map((location) => {
    if (
      location.id !== evidence.id
      || location.path.length === 0
      || !Number.isSafeInteger(location.fromOffset)
      || !Number.isSafeInteger(location.toOffset)
      || !Number.isSafeInteger(location.line)
      || !Number.isSafeInteger(location.column)
      || location.fromOffset < 0
      || location.toOffset <= location.fromOffset
      || location.line < 0
      || location.column < 0
    ) throw new TypeError("selected repair collision locations must be exact and internally valid");
    return Object.freeze({ ...location });
  });
  if (new Set(locations.map((location) =>
    `${location.path}\0${String(location.fromOffset)}\0${String(location.toOffset)}`)).size !== locations.length) {
    throw new TypeError("selected repair collision locations must be distinct");
  }
  const selectedLocation = locations.find((location) =>
    location.path === evidence.selectedSpan.path
    && location.fromOffset >= evidence.selectedSpan.fromOffset
    && location.toOffset <= evidence.selectedSpan.toOffset);
  const selectedTarget = [...planItems, ...clocks].some((target) =>
    target.target.id === evidence.id
    && target.path === evidence.selectedSpan.path
    && ("itemSpan" in target ? target.itemSpan : target.span).fromOffset === evidence.selectedSpan.fromOffset
    && ("itemSpan" in target ? target.itemSpan : target.span).toOffset === evidence.selectedSpan.toOffset);
  if (!selectedLocation || !selectedTarget) {
    throw new TypeError("selected repair span must bind one expected collision occurrence");
  }
  return Object.freeze({
    id: evidence.id,
    locations: Object.freeze(locations),
    selectedSpan: Object.freeze({ ...evidence.selectedSpan }),
  });
}

function expectationTokenPayload(expectation: MutationExpectationInput): Record<string, unknown> {
  return Object.fromEntries(Object.entries(expectation).filter(([key]) => key !== "expectationToken"));
}

export function createMutationExpectationToken(expectation: MutationExpectationInput): string {
  return createCanonicalPreviewToken(expectationTokenPayload(expectation));
}

export function mutationExpectationTokenMatches(expectation: MutationExpectation): boolean {
  return isMutationPreviewToken(expectation.expectationToken)
    && createMutationExpectationToken(expectation) === expectation.expectationToken;
}

export function createMutationExpectation(input: MutationExpectationInput): MutationExpectation {
  assertNonempty("expectation intentId", input.intentId);
  assertNonempty("expectation zoneId", input.zoneId);
  if (!Number.isSafeInteger(input.settingsVersion) || input.settingsVersion < 0) {
    throw new RangeError("expectation settingsVersion must be a nonnegative safe integer");
  }
  if (!isMutationPreviewToken(input.previewToken)) {
    throw new TypeError("expectation previewToken must be a SHA-256 preview token");
  }
  if (
    !Number.isFinite(input.time.wallEpochMs)
    || !Number.isFinite(input.time.monotonicMs)
    || !Number.isFinite(input.time.maximumDriftMs)
    || input.time.maximumDriftMs < 0
    || typeof input.time.discontinuity !== "boolean"
  ) throw new TypeError("expectation time facts must be finite and internally valid");
  if (!Number.isSafeInteger(input.time.maximumQueueDelayMs) || input.time.maximumQueueDelayMs < 0) {
    throw new RangeError("expectation maximumQueueDelayMs must be a nonnegative safe integer");
  }
  const planItems = Object.freeze([...input.planItems]);
  const clocks = Object.freeze([...input.clocks]);
  const selectedRepair = input.selectedRepair === undefined
    ? undefined
    : freezeSelectedRepairEvidence(input.selectedRepair, planItems, clocks);
  const normalized: MutationExpectationInput = Object.freeze({
    intentId: input.intentId,
    action: input.action,
    planItems,
    clocks,
    expectedRunningClockIds: Object.freeze([...input.expectedRunningClockIds].sort()),
    settingsVersion: input.settingsVersion,
    zoneId: input.zoneId,
    indexComplete: input.indexComplete,
    time: Object.freeze({ ...input.time }),
    previewToken: input.previewToken,
    ...(selectedRepair ? { selectedRepair } : {}),
  });
  const expectationToken = createMutationExpectationToken(normalized);
  if (input.expectationToken !== undefined && input.expectationToken !== expectationToken) {
    throw new TypeError("Mutation expectation no longer matches its confirmed preview token");
  }
  return Object.freeze({ ...normalized, expectationToken });
}

function identityPermitsTarget(
  admission: TargetIdentityAdmission | undefined,
  expectation: { readonly target: { readonly id?: string }; readonly path: string },
  expectedSpan: Pick<SourceSpan, "fromOffset" | "toOffset">,
  action: MutationAction,
): RevalidationResult<true> {
  const id = expectation.target.id;
  if (!id) return Object.freeze({ ok: true, value: true });
  const isSelectedRepair = action === "repair-plan-item-identity" || action === "repair-clock-identity";
  if (isSelectedRepair) {
    if (
      admission?.kind === "selected-repair"
      && admission.selectedSpan.path === expectation.path
      && admission.selectedSpan.fromOffset === expectedSpan.fromOffset
      && admission.selectedSpan.toOffset === expectedSpan.toOffset
      && admission.identity.locations.length > 1
      && admission.identity.locations.some((location) =>
        location.id === id
        && location.path === admission.selectedSpan.path
        && location.fromOffset >= admission.selectedSpan.fromOffset
        && location.toOffset <= admission.selectedSpan.toOffset)
    ) {
      return Object.freeze({ ok: true, value: true });
    }
    return conflict("action-no-longer-applicable", action, expectation.path, id);
  }
  if (!admission || admission.kind === "unavailable" || admission.kind === "selected-repair") {
    return conflict("source-conflict", action, expectation.path, id);
  }
  const identity = admission;
  if (identity.kind === "collision") {
    return conflict("identity-collision", action, expectation.path, id);
  }
  if (identity.kind === "missing") return conflict("plan-item-not-found", action, expectation.path, id);
  return Object.freeze({ ok: true, value: true });
}

export function revalidatePlanItemExpectation(
  currentPath: string,
  currentText: string,
  expectation: PlanItemExpectation,
  action: MutationAction,
  identity?: TargetIdentityAdmission,
  logbookOptions: LogbookReadOptions = {},
): RevalidationResult<RevalidatedPlanItem> {
  const identityCheck = identityPermitsTarget(identity, expectation, expectation.itemSpan, action);
  if (!identityCheck.ok) return identityCheck;
  if (!expectation.target.id) {
    if (currentPath !== expectation.path || currentText !== expectation.sourceText) {
      return conflict("anonymous-source-changed", action, expectation.path);
    }
  }

  const matches = parsedItems(currentPath, currentText).filter((item) => expectation.target.id
    ? item.source.blockId === expectation.target.id
      && (action !== "repair-plan-item-identity"
        || item.source.itemSpan.fromOffset === expectation.itemSpan.fromOffset)
    : item.source.itemSpan.fromOffset === expectation.itemSpan.fromOffset
      && item.source.itemSpan.toOffset === expectation.itemSpan.toOffset
      && item.source.firstLineText === expectation.firstLineText);
  if (matches.length !== 1) {
    return conflict(matches.length > 1 ? "identity-collision" : "plan-item-not-found", action, currentPath, expectation.target.id);
  }
  const item = matches[0]!;
  if (item.kind !== expectation.itemKind || item.status !== expectation.status) {
    return conflict("action-no-longer-applicable", action, currentPath, expectation.target.id);
  }
  if (itemWatchedText(currentText, item.source, expectation.watch) !== expectation.watchedText) {
    return conflict("source-conflict", action, currentPath, expectation.target.id);
  }
  const logbook = readLogbook(currentText, {
    path: currentPath,
    itemFromOffset: item.source.itemSpan.fromOffset,
    itemToOffset: item.source.itemSpan.toOffset,
    ...(item.source.blockId ? { ownerId: item.source.blockId } : {}),
  }, logbookOptions);
  if (!logbook.complete) return conflict("source-over-limit", action, currentPath, expectation.target.id);
  if (logbook.kind === "ambiguous") return conflict("logbook-ambiguous", action, currentPath, expectation.target.id);
  if (logbook.drawers.length !== expectation.drawerCount) {
    return conflict("source-conflict", action, currentPath, expectation.target.id);
  }
  return Object.freeze({
    ok: true,
    value: Object.freeze({ item, source: item.source, logbook }),
  });
}

function clocksInItems(
  path: string,
  sourceText: string,
  options: LogbookReadOptions,
): readonly { readonly clock: LogbookClock; readonly owner: RevalidatedPlanItem }[] {
  const found: { clock: LogbookClock; owner: RevalidatedPlanItem }[] = [];
  for (const item of parsedItems(path, sourceText)) {
    const logbook = readLogbook(sourceText, {
      path,
      itemFromOffset: item.source.itemSpan.fromOffset,
      itemToOffset: item.source.itemSpan.toOffset,
      ...(item.source.blockId ? { ownerId: item.source.blockId } : {}),
    }, options);
    const owner = Object.freeze({ item, source: item.source, logbook });
    for (const clock of logbook.clocks) found.push({ clock, owner });
  }
  return Object.freeze(found);
}

const ORPHAN_CLOCK_RECOVERY_ACTIONS: ReadonlySet<MutationAction> = new Set([
  "clock-out",
  "delete-clock",
  "stop-at-trusted-time",
  "repair-overlap",
  "repair-done-owner-clock",
  "repair-clock-identity",
  "normalize-legacy-clock",
]);

function exactCanonicalClockPhysicalLine(
  source: string,
  expectedText: string,
  identity: BlockIdLocation,
): { readonly fromOffset: number; readonly toOffset: number } | undefined {
  const lineStart = source.lastIndexOf("\n", Math.max(0, identity.fromOffset - 1)) + 1;
  const newlineOffset = source.indexOf("\n", identity.toOffset);
  const physicalEnd = newlineOffset < 0 ? source.length : newlineOffset;
  const lineEnd = source[physicalEnd - 1] === "\r" ? physicalEnd - 1 : physicalEnd;
  const line = source.slice(lineStart, lineEnd);
  const prefix = /^[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?/.exec(line)?.[0] ?? "";
  const fromOffset = lineStart + prefix.length;
  const toOffset = fromOffset + expectedText.length;
  if (
    source.slice(fromOffset, toOffset) !== expectedText
    || !/^[ \t]*$/.test(source.slice(toOffset, lineEnd))
    || identity.fromOffset < fromOffset
    || identity.toOffset > toOffset
  ) return undefined;
  return Object.freeze({ fromOffset, toOffset });
}

function exactCanonicalOrphanClock(
  currentPath: string,
  currentText: string,
  expectation: ClockExpectation,
  action: MutationAction,
  identity: TargetIdentityAdmission | undefined,
): RevalidationResult<RevalidatedClock> | undefined {
  if (
    !ORPHAN_CLOCK_RECOVERY_ACTIONS.has(action)
    || expectation.target.id === undefined
    || expectation.ownerId !== undefined
  ) return undefined;
  if (!identity || identity.kind !== "unique" || identity.location.path !== currentPath) {
    return conflict("source-conflict", action, currentPath, expectation.target.id);
  }
  const matchingSpan = exactCanonicalClockPhysicalLine(currentText, expectation.text, identity.location);
  if (!matchingSpan) {
    return conflict("source-conflict", action, currentPath, expectation.target.id);
  }
  const parsed = parseClockText(expectation.text);
  if (
    parsed.kind !== "record"
    || parsed.record.format !== "canonical"
    || parsed.record.clockId !== expectation.target.id
    || parsed.record.state !== expectation.state
  ) return conflict("action-no-longer-applicable", action, expectation.path, expectation.target.id);
  const clock: LogbookClock = Object.freeze({
    path: currentPath,
    fromOffset: matchingSpan.fromOffset,
    toOffset: matchingSpan.toOffset,
    text: expectation.text,
    parsed,
  });
  return Object.freeze({ ok: true, value: Object.freeze({ clock }) });
}

export function revalidateClockExpectation(
  currentPath: string,
  currentText: string,
  expectation: ClockExpectation,
  action: MutationAction,
  identity?: TargetIdentityAdmission,
  logbookOptions: LogbookReadOptions = {},
): RevalidationResult<RevalidatedClock> {
  const identityCheck = identityPermitsTarget(identity, expectation, expectation.span, action);
  if (!identityCheck.ok) return identityCheck;
  if (!expectation.target.id && (currentPath !== expectation.path || currentText !== expectation.sourceText)) {
    return conflict("anonymous-source-changed", action, expectation.path);
  }
  const found = clocksInItems(currentPath, currentText, logbookOptions).filter(({ clock }) => {
    if (expectation.state === "potential-running" || (
      expectation.state === "closed"
      && clock.parsed.kind === "malformed"
      && ambiguousLegacyState(clock.text) === "closed"
    )) {
      return clock.parsed.kind === "malformed"
        && (expectation.state === "closed" || clock.parsed.potentialRunning)
        && clock.parsed.diagnostics.length === 1
        && clock.parsed.diagnostics[0]?.code === "ambiguous-local-time"
        && clock.fromOffset === expectation.span.fromOffset
        && clock.toOffset === expectation.span.toOffset
        && clock.text === expectation.text;
    }
    if (clock.parsed.kind !== "record") return false;
    return expectation.target.id
      ? clock.parsed.record.clockId === expectation.target.id
        && (action !== "repair-clock-identity"
          || clock.fromOffset === expectation.span.fromOffset)
      : clock.fromOffset === expectation.span.fromOffset
        && clock.toOffset === expectation.span.toOffset
        && clock.text === expectation.text;
  });
  if (found.length !== 1) {
    if (found.length === 0) {
      const orphan = exactCanonicalOrphanClock(currentPath, currentText, expectation, action, identity);
      if (orphan) return orphan;
    }
    return conflict(found.length > 1 ? "identity-collision" : "plan-item-not-found", action, currentPath, expectation.target.id);
  }
  const result = found[0]!;
  if (!result.owner?.logbook.complete) return conflict("source-over-limit", action, currentPath, expectation.target.id);
  if (result.owner.logbook.kind === "ambiguous") {
    return conflict("logbook-ambiguous", action, currentPath, expectation.target.id);
  }
  const currentState = result.clock.parsed.kind === "record"
    ? result.clock.parsed.record.state
    : result.clock.parsed.kind === "malformed" && ambiguousLegacyState(result.clock.text) === "closed"
      ? "closed"
      : result.clock.parsed.kind === "malformed" && result.clock.parsed.potentialRunning
        ? "potential-running"
      : undefined;
  if (currentState !== expectation.state || result.clock.ownerId !== expectation.ownerId) {
    return conflict("action-no-longer-applicable", action, currentPath, expectation.target.id);
  }
  if (expectation.target.id && result.clock.text !== expectation.text) {
    return conflict("source-conflict", action, currentPath, expectation.target.id);
  }
  return Object.freeze({ ok: true, value: Object.freeze({ clock: result.clock, owner: result.owner }) });
}

export function timeExpectationIsTrusted(time: TrustedTimeExpectation): boolean {
  return !time.discontinuity
    && Number.isFinite(time.wallEpochMs)
    && Number.isFinite(time.monotonicMs)
    && Number.isFinite(time.maximumDriftMs)
    && Number.isSafeInteger(time.maximumQueueDelayMs)
    && time.maximumDriftMs >= 0
    && time.maximumQueueDelayMs >= 0;
}

export function expectationMatchesPlan(
  expectation: MutationExpectation,
  plan: MutationPlan,
): boolean {
  return expectation.intentId === plan.intentId
    && expectation.action === plan.action
    && expectation.settingsVersion === plan.settingsVersion
    && expectation.zoneId === plan.zoneId
    && expectation.expectedRunningClockIds.join("\0") === [...plan.expectedRunningClockIds].sort().join("\0")
    && expectation.previewToken === plan.previewToken
    && mutationPlanPreviewTokenMatches(plan)
    && mutationExpectationTokenMatches(expectation);
}
