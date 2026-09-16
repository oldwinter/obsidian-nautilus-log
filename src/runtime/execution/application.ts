import { parseGrammar } from "../../core/grammar-v1";
import {
  decideExecutionCommand,
  type DeleteClockConfirmationFact,
  type ExecutionClockFact,
  type ExecutionClockFactState,
  type ExecutionCommandDecision,
  type ExecutionDecisionIntent,
  type ExecutionGeneratedIdentities,
  type ExecutionTaskFact,
} from "../../core/execution";
import type { PlanItem } from "../../core/model";
import {
  createClockExpectation,
  createMutationExpectation,
  createPlanItemExpectation,
  type ClockSelector,
  type MutationExpectation,
  type PlanItemSelector,
} from "../../workspace/expectation";
import { WorkspaceIndex, type IndexedClockSource } from "../../workspace/identity-index";
import {
  generateUniqueClockId,
  generateUniquePlanItemId,
} from "../../workspace/logbook-clock";
import { readLogbook, type LogbookReadOptions, type LogbookReadResult } from "../../workspace/logbook-reader";
import {
  createMutationPlan,
  type FileMutationOperation,
  type MutationAction,
  type MutationPlan,
  type MutationStage,
} from "../../workspace/mutations";
import {
  resolvePrimaryPlan,
  type WorkspacePlanItemSource,
} from "../../workspace/primary-plan-resolver";
import { createSourceVersion, utf8ByteLength } from "../../workspace/source-version";
import type { Unsubscribe } from "../../workspace/text-access";
import {
  WorkspaceCommitter,
  type AtomicTextAccess,
  type CommitContext,
} from "../../workspace/commit";
import type { WriteResultCode } from "../../workspace/conflicts";
import type { PluginDataStore } from "../plugin-data";
import type { ClockSample, PairedSystemClock } from "../system-clock";
import {
  ExecutionClockIndex,
  type ClockOwnerResolution,
  type ExecutionClockIndexState,
} from "./clock-index";
import {
  ExecutionCoordinator,
  type ExecutionCommandContext,
  type ExecutionCommandOutcome,
  type ExecutionMutationPreparation,
  type ExecutionRuntimeSnapshot,
} from "./commands";
import { projectExecutionState, type ExecutionReadyState } from "./execution-state";

const MAX_ACTIVE_NOTE_BYTES = 2 * 1024 * 1024;
const MAX_PLAN_REGION_BYTES = 1024 * 1024;
const MAX_PLAN_ITEMS = 1_000;
const MAX_PLAN_ITEM_BYTES = 16 * 1024;
const MAX_LIST_DEPTH = 16;
const MAXIMUM_DRIFT_MS = 5_000;
const MAXIMUM_QUEUE_DELAY_MS = 1_000;

export interface ExecutionTargetReference {
  readonly path: string;
  readonly ownerId: string | null;
  readonly sourceOrder: number;
  /** Opaque source digest; mandatory authority for an anonymous target. */
  readonly sourceFingerprint: string;
}

export interface ExecutionClockReference {
  readonly path: string;
  readonly ownerId: string;
  readonly clockId: string | null;
  readonly fromOffset: number;
  readonly startEpochMs: number;
  readonly targetKey: string;
}

export type ExecutionEditorAction =
  | { readonly kind: "clock-in"; readonly target: ExecutionTargetReference }
  | { readonly kind: "clock-out"; readonly target: ExecutionTargetReference };

export type ExecutionApplicationIntent =
  | { readonly type: "clock-in"; readonly intentId: string; readonly target: ExecutionTargetReference }
  | { readonly type: "clock-out"; readonly intentId: string }
  | { readonly type: "complete"; readonly intentId: string; readonly target: ExecutionTargetReference }
  | {
      readonly type: "delete-clock";
      readonly intentId: string;
      readonly target: ExecutionClockReference;
      readonly confirmation?: DeleteClockConfirmationFact;
    }
  | {
      readonly type: "advance-or-reopen-progress";
      readonly intentId: string;
      readonly target: ExecutionTargetReference;
    }
  | { readonly type: "start-standalone-pomo"; readonly intentId: string }
  | { readonly type: "stop-standalone-pomo"; readonly intentId: string }
  | { readonly type: "enable-execution"; readonly intentId: string }
  | { readonly type: "disable-execution"; readonly intentId: string }
  | {
      readonly type: "recover-standalone-pomo";
      readonly intentId: string;
      readonly choice: "keep-measured" | "use-system-time" | "stop-at-trusted";
    };

export interface ExecutionFocusedTaskSnapshot {
  readonly ownerId: string;
  readonly path: string;
  readonly sourceOrder: number;
  readonly label: string;
  readonly clock: ExecutionClockReference;
}

export type ExecutionApplicationStatus =
  | "starting"
  | "ready"
  | "working"
  | "degraded"
  | "stale"
  | "stopping"
  | "stopped";

export interface ExecutionApplicationSnapshot {
  readonly generation: number;
  readonly status: ExecutionApplicationStatus;
  readonly runtime: ExecutionRuntimeSnapshot;
  readonly execution: ExecutionReadyState;
  readonly writeBlocked: boolean;
  readonly pomoThresholdMinutes: number;
  readonly standalonePomoStartEpochMs: number | null;
  readonly focused?: ExecutionFocusedTaskSnapshot;
  readonly code?: string;
}

export type ExecutionApplicationListener = (snapshot: ExecutionApplicationSnapshot) => void;

export interface ExecutionApplicationDependencies {
  readonly access: AtomicTextAccess;
  readonly pluginData: PluginDataStore;
  readonly clock: PairedSystemClock;
  readonly workspaceIndex?: WorkspaceIndex;
  readonly logbook?: LogbookReadOptions;
}

interface ParsedSource {
  readonly path: string;
  readonly sourceText: string;
  readonly sourceFingerprint: string;
  readonly items: readonly PlanItem<WorkspacePlanItemSource>[];
}

interface ResolvedTask {
  readonly parsed: ParsedSource;
  readonly item: PlanItem<WorkspacePlanItemSource>;
  readonly fact: ExecutionTaskFact;
  readonly selector: PlanItemSelector;
  readonly logbook: LogbookReadResult;
}

interface ResolvedClock {
  readonly indexed: IndexedClockSource;
  readonly parsed: ParsedSource;
  readonly owner: PlanItem<WorkspacePlanItemSource>;
  readonly selector: ClockSelector;
  readonly expectation: ReturnType<typeof createClockExpectation>;
  readonly fact: ExecutionClockFact;
  readonly key: string;
}

function safeIntentId(value: string): void {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new TypeError("intentId must be a non-empty safe string");
  }
}

function legacyClockKey(path: string, fromOffset: number, text: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `legacy:${path}:${fromOffset}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function indexedClockKey(clock: IndexedClockSource): string {
  return clock.clockId ?? legacyClockKey(clock.path, clock.fromOffset, clock.text);
}

function offsetMinutesAt(epochMs: number, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    calendar: "gregory",
    numberingSystem: "latn",
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const values = new Map<string, number>();
  for (const part of formatter.formatToParts(new Date(epochMs))) {
    if (["year", "month", "day", "hour", "minute", "second"].includes(part.type)) {
      values.set(part.type, Number(part.value));
    }
  }
  const parts = ["year", "month", "day", "hour", "minute", "second"]
    .map((name) => values.get(name));
  if (parts.some((value) => value === undefined || !Number.isInteger(value))) {
    throw new RangeError("Unable to resolve the current UTC offset");
  }
  const [year, month, day, hour, minute, second] = parts as number[];
  const wholeSecondEpochMs = Math.floor(epochMs / 1_000) * 1_000;
  const offset = (Date.UTC(year!, month! - 1, day!, hour!, minute!, second!) - wholeSecondEpochMs) / 60_000;
  if (!Number.isInteger(offset) || Math.abs(offset) > 14 * 60) {
    throw new RangeError("Resolved UTC offset is invalid");
  }
  return offset;
}

function executionFact(item: PlanItem<WorkspacePlanItemSource>, path: string): ExecutionTaskFact {
  return Object.freeze({
    path,
    ...(item.source.blockId ? { ownerId: item.source.blockId } : {}),
    kind: item.kind,
    status: item.status,
    executionEligible: item.executionEligible,
    progress: item.tokens.progress
      ? Object.freeze({ kind: "known" as const, percent: item.progressPercent })
      : Object.freeze({ kind: "absent" as const }),
  });
}

function clockFact(clock: IndexedClockSource, timeZone: string): ExecutionClockFact | undefined {
  if (!clock.ownerId || clock.parsed.kind !== "record" || clock.parsed.record.state !== "running") {
    return undefined;
  }
  return Object.freeze({
    path: clock.path,
    ownerId: clock.ownerId,
    ...(clock.clockId ? { clockId: clock.clockId } : {}),
    startEpochMs: clock.parsed.record.startEpochMs,
    ...(clock.parsed.record.format === "legacy"
      ? { legacyStartOffsetMinutes: offsetMinutesAt(clock.parsed.record.startEpochMs, timeZone) }
      : {}),
  });
}

function coreClockState(state: ExecutionClockIndexState, timeZone: string): ExecutionClockFactState {
  if (state.kind === "idle") return Object.freeze({ kind: "idle" });
  if (state.kind === "degraded") {
    return Object.freeze({ kind: "degraded", code: state.code });
  }
  const fact = clockFact(state.clock, timeZone);
  return fact
    ? Object.freeze({ kind: "active", clock: fact })
    : Object.freeze({ kind: "degraded", code: "potential-running-clock" });
}

function closeFacts(decision: Extract<ExecutionCommandDecision, { close: unknown }>["close"]) {
  return Object.freeze({
    ...(decision.clock.clockId ? { clockId: decision.clock.clockId } : {}),
    ...(decision.assignedClockId ? { assignedClockId: decision.assignedClockId } : {}),
    endEpochMs: decision.endEpochMs,
    offsetMinutes: decision.offsetMinutes,
    ...(decision.clock.legacyStartOffsetMinutes === undefined
      ? {}
      : { legacyStartOffsetMinutes: decision.clock.legacyStartOffsetMinutes }),
  });
}

function applicationStatus(runtime: ExecutionRuntimeSnapshot): ExecutionApplicationStatus {
  if (runtime.status === "working" || runtime.status === "reconciling") return "working";
  if (runtime.status === "degraded") return "degraded";
  if (runtime.status === "stopping") return "stopping";
  if (runtime.status === "stopped") return "stopped";
  if (runtime.status === "starting") return "starting";
  return "ready";
}

function refreshedRuntime(
  prior: ExecutionRuntimeSnapshot,
  clocks: ExecutionClockIndexState,
): ExecutionRuntimeSnapshot {
  const clockDiagnosticOnly = prior.status === "degraded"
    && prior.clocks.kind === "degraded"
    && prior.code === prior.clocks.code;
  const replaceClockStatus = prior.status === "ready" || clockDiagnosticOnly;
  const status = replaceClockStatus
    ? clocks.kind === "degraded" ? "degraded" : "ready"
    : prior.status;
  const code = replaceClockStatus
    ? clocks.kind === "degraded" ? clocks.code : undefined
    : prior.code;
  return Object.freeze({
    status,
    clocks,
    writeBlocked: replaceClockStatus
      ? clocks.kind === "degraded"
      : prior.writeBlocked || clocks.kind === "degraded",
    pluginDataRevision: prior.pluginDataRevision,
    ...(code ? { code } : {}),
  });
}

export class ExecutionApplication {
  readonly #access: AtomicTextAccess;
  readonly #pluginData: PluginDataStore;
  readonly #clock: PairedSystemClock;
  readonly #index: WorkspaceIndex;
  readonly #ownsIndex: boolean;
  readonly #logbook: LogbookReadOptions;
  readonly #clockReader: ExecutionClockIndex;
  readonly #committer: WorkspaceCommitter;
  readonly #coordinator: ExecutionCoordinator;
  readonly #listeners = new Set<ExecutionApplicationListener>();
  #unsubscribeSource: Unsubscribe | undefined;
  #started = false;
  #stopped = false;
  #generation = 0;
  #refreshGeneration = 0;
  #refreshAgain = false;
  #refreshPromise: Promise<ExecutionApplicationSnapshot> | undefined;
  #refreshPromiseGeneration: number | undefined;
  #refreshFollowUpPromise: Promise<ExecutionApplicationSnapshot> | undefined;
  #resolveRefreshFollowUp: ((snapshot: ExecutionApplicationSnapshot) => void) | undefined;
  #rejectRefreshFollowUp: ((error: unknown) => void) | undefined;
  #dispatchDepth = 0;
  #sourceRefreshPending = false;
  #snapshot: ExecutionApplicationSnapshot;

  constructor(dependencies: ExecutionApplicationDependencies) {
    this.#access = dependencies.access;
    this.#pluginData = dependencies.pluginData;
    this.#clock = dependencies.clock;
    this.#ownsIndex = dependencies.workspaceIndex === undefined;
    this.#index = dependencies.workspaceIndex ?? new WorkspaceIndex(dependencies.access);
    this.#logbook = dependencies.logbook ?? {};
    this.#clockReader = new ExecutionClockIndex(
      this.#index,
      (clock) => this.#resolveClockOwner(clock),
    );
    this.#committer = new WorkspaceCommitter(dependencies.access, {
      workspaceIndex: this.#index,
      logbook: this.#logbook,
      readContext: () => this.#commitContext(),
    });
    this.#coordinator = new ExecutionCoordinator({
      clock: dependencies.clock,
      clockReader: this.#clockReader,
      committer: this.#committer,
      pluginData: dependencies.pluginData,
      publish: (runtime) => this.#publishRuntime(runtime),
    });
    this.#snapshot = this.#makeSnapshot(this.#coordinator.snapshot, "starting");
  }

  get snapshot(): ExecutionApplicationSnapshot {
    return this.#snapshot;
  }

  subscribe(listener: ExecutionApplicationListener): Unsubscribe {
    this.#listeners.add(listener);
    listener(this.#snapshot);
    return () => this.#listeners.delete(listener);
  }

  inspectEditorAction(
    path: string,
    sourceText: string,
    sourceOffset: number,
  ): ExecutionEditorAction["kind"] | undefined {
    const item = this.#editorItemAt(path, sourceText, sourceOffset, "editor-snapshot");
    if (!item) return undefined;
    return item.source.blockId && this.#snapshot.focused?.ownerId === item.source.blockId
      ? "clock-out"
      : "clock-in";
  }

  async resolveEditorAction(
    path: string,
    sourceText: string,
    sourceOffset: number,
  ): Promise<ExecutionEditorAction | undefined> {
    if (path.length === 0
      || !Number.isSafeInteger(sourceOffset)
      || sourceOffset < 0
      || sourceOffset > sourceText.length
      || utf8ByteLength(sourceText) > MAX_ACTIVE_NOTE_BYTES) {
      return undefined;
    }
    const version = await createSourceVersion(path, sourceText);
    const item = this.#editorItemAt(path, sourceText, sourceOffset, version.contentDigest);
    if (!item) return undefined;
    const target = Object.freeze({
      path,
      ownerId: item.source.blockId ?? null,
      sourceOrder: item.sourceOrder,
      sourceFingerprint: version.contentDigest,
    });
    return item.source.blockId && this.#snapshot.focused?.ownerId === item.source.blockId
      ? Object.freeze({ kind: "clock-out", target })
      : Object.freeze({ kind: "clock-in", target });
  }

  async start(): Promise<ExecutionApplicationSnapshot> {
    if (this.#stopped) throw new Error("Execution application cannot restart after stop");
    if (this.#started) return this.#snapshot;
    this.#started = true;
    try {
      const runtime = await this.#coordinator.start();
      this.#subscribeToSourceChanges();
      if (runtime.clocks.kind === "degraded"
        && runtime.clocks.code === "clock-index-unavailable"
        && runtime.clocks.reason === "source-changed") {
        return this.refresh();
      }
      await this.#publishConfirmed(runtime);
      return this.#snapshot;
    } catch (error) {
      this.#started = false;
      throw error;
    }
  }

  suspend(): void {
    if (this.#stopped) return;
    this.#refreshGeneration += 1;
    this.#refreshAgain = false;
    this.#sourceRefreshPending = false;
    this.#unsubscribeSource?.();
    this.#unsubscribeSource = undefined;
  }

  async resume(): Promise<ExecutionApplicationSnapshot> {
    if (this.#stopped) throw new Error("Execution application cannot resume after stop");
    if (!this.#started) return this.start();
    this.#subscribeToSourceChanges();
    return this.refresh();
  }

  async refresh(): Promise<ExecutionApplicationSnapshot> {
    if (!this.#started || this.#stopped) return this.#snapshot;
    if (this.#refreshPromise) {
      const pending = this.#refreshPromise;
      if (this.#refreshPromiseGeneration !== this.#refreshGeneration) {
        await pending;
        if (this.#refreshPromise === pending) {
          this.#refreshPromise = undefined;
          this.#refreshPromiseGeneration = undefined;
        }
        if (this.#stopped) return this.#snapshot;
        const current = this.#refreshPromise;
        return current ?? this.refresh();
      }
      this.#refreshAgain = true;
      return pending;
    }
    const generation = ++this.#refreshGeneration;
    const pending = this.#runRefresh(generation);
    this.#refreshPromise = pending;
    this.#refreshPromiseGeneration = generation;
    try {
      return await pending;
    } finally {
      if (this.#refreshPromise === pending) {
        this.#refreshPromise = undefined;
        this.#refreshPromiseGeneration = undefined;
        if (this.#refreshAgain && !this.#stopped) {
          this.#refreshAgain = false;
          const queuedGeneration = this.#refreshGeneration;
          const followUp = new Promise<ExecutionApplicationSnapshot>((resolve, reject) => {
            this.#resolveRefreshFollowUp = resolve;
            this.#rejectRefreshFollowUp = reject;
          });
          this.#refreshFollowUpPromise = followUp;
          queueMicrotask(() => {
            if (!this.#stopped && this.#refreshGeneration === queuedGeneration) {
              void this.refresh().then(
                (snapshot) => this.#resolveRefreshFollowUp?.(snapshot),
                (error: unknown) => this.#rejectRefreshFollowUp?.(error),
              ).finally(() => {
                if (this.#refreshFollowUpPromise === followUp) {
                  this.#refreshFollowUpPromise = undefined;
                  this.#resolveRefreshFollowUp = undefined;
                  this.#rejectRefreshFollowUp = undefined;
                }
              });
              return;
            }
            this.#resolveRefreshFollowUp?.(this.#snapshot);
            this.#refreshFollowUpPromise = undefined;
            this.#resolveRefreshFollowUp = undefined;
            this.#rejectRefreshFollowUp = undefined;
          });
        }
      }
    }
  }

  async dispatch(intent: ExecutionApplicationIntent): Promise<ExecutionCommandOutcome> {
    safeIntentId(intent.intentId);
    await this.#waitForRefreshSettled();
    this.#dispatchDepth += 1;
    try {
      return await this.#dispatchIntent(intent);
    } finally {
      this.#dispatchDepth -= 1;
      if (this.#dispatchDepth === 0 && this.#sourceRefreshPending && !this.#stopped) {
        this.#sourceRefreshPending = false;
        void this.refresh();
      }
    }
  }

  async #waitForRefreshSettled(): Promise<void> {
    for (;;) {
      const refresh = this.#refreshPromise;
      if (refresh) {
        await refresh;
        continue;
      }
      const followUp = this.#refreshFollowUpPromise;
      if (followUp) {
        await followUp;
        continue;
      }
      return;
    }
  }

  async #dispatchIntent(intent: ExecutionApplicationIntent): Promise<ExecutionCommandOutcome> {
    if (intent.type === "start-standalone-pomo") {
      return this.#settle(this.#coordinator.startStandalonePomo(intent.intentId));
    }
    if (intent.type === "stop-standalone-pomo") {
      return this.#settle(this.#coordinator.stopStandalonePomo(intent.intentId));
    }
    if (intent.type === "enable-execution") {
      return this.#settle(this.#coordinator.enableExecution(intent.intentId));
    }
    if (intent.type === "disable-execution") {
      return this.#settle(this.#coordinator.disableExecution({
        intentId: intent.intentId,
        prepareClose: (context) => this.#prepare(
          { type: "clock-out", intentId: intent.intentId },
          "clock-out",
          context,
        ),
      }));
    }
    if (intent.type === "recover-standalone-pomo") {
      return this.#settle(this.#coordinator.recoverStandalonePomo(intent.intentId, intent.choice));
    }

    const action = intent.type === "advance-or-reopen-progress"
      ? await this.#progressAction(intent.target)
      : intent.type === "clock-in"
        ? this.#clockInAction(intent.target)
        : intent.type;
    return this.#settle(this.#coordinator.dispatchMutation({
      intentId: intent.intentId,
      action,
      prepare: (context) => this.#prepare(intent, action, context),
    }));
  }

  async stop(): Promise<void> {
    if (this.#stopped) return;
    this.#stopped = true;
    this.#refreshGeneration += 1;
    this.#refreshAgain = false;
    this.#sourceRefreshPending = false;
    this.#unsubscribeSource?.();
    this.#unsubscribeSource = undefined;
    let failure: { readonly error: unknown } | undefined;
    try {
      await this.#coordinator.stop();
    } catch (error) {
      failure = { error };
    } finally {
      this.#committer.dispose();
      if (this.#ownsIndex) this.#index.dispose();
      this.#publish(this.#makeSnapshot(this.#coordinator.snapshot, "stopped", "runtime-stopping"));
      this.#listeners.clear();
    }
    if (failure) throw failure.error;
  }

  async #settle(outcomePromise: Promise<ExecutionCommandOutcome>): Promise<ExecutionCommandOutcome> {
    const outcome = await outcomePromise;
    await this.#publishConfirmed(outcome.snapshot);
    return outcome;
  }

  async #runRefresh(generation: number): Promise<ExecutionApplicationSnapshot> {
    while (true) {
      this.#refreshAgain = false;
      const clocks = await this.#clockReader.scan();
      if (generation !== this.#refreshGeneration || this.#stopped) return this.#snapshot;
      if (this.#refreshAgain) continue;
      const runtime = refreshedRuntime(this.#coordinator.snapshot, clocks);
      await this.#publishConfirmed(runtime);
      if (generation !== this.#refreshGeneration || this.#stopped) return this.#snapshot;
      if (this.#refreshAgain) continue;
      return this.#snapshot;
    }
  }

  #subscribeToSourceChanges(): void {
    if (this.#unsubscribeSource) return;
    this.#unsubscribeSource = this.#access.onChange(() => {
      if (this.#stopped) return;
      if (this.#dispatchDepth > 0) {
        this.#sourceRefreshPending = true;
        return;
      }
      this.#publish(this.#makeSnapshot(this.#coordinator.snapshot, "stale", "source-changed"));
      void this.refresh();
    });
  }

  async #readParsed(path: string): Promise<ParsedSource | undefined> {
    let sourceText: string | undefined;
    try {
      sourceText = await this.#access.readText(path);
    } catch {
      return undefined;
    }
    if (sourceText === undefined || utf8ByteLength(sourceText) > MAX_ACTIVE_NOTE_BYTES) return undefined;
    const version = await createSourceVersion(path, sourceText);
    return this.#parseSource(path, sourceText, version.contentDigest);
  }

  #parseSource(
    path: string,
    sourceText: string,
    sourceFingerprint: string,
  ): ParsedSource | undefined {
    const version = Object.freeze({
      file: path,
      contentDigest: sourceFingerprint,
      contentLength: sourceText.length,
    });
    const primary = resolvePrimaryPlan(version, sourceText, {
      maxPlanRegionBytes: MAX_PLAN_REGION_BYTES,
      maxPlanItems: MAX_PLAN_ITEMS,
      maxPlanItemBytes: MAX_PLAN_ITEM_BYTES,
      maxListDepth: MAX_LIST_DEPTH,
    });
    if (!primary.region || primary.limitExceeded || primary.diagnostics.length > 0) return undefined;
    const grammar = parseGrammar({
      version: primary.region.version,
      candidates: primary.candidates,
      settings: {
        defaultDurationMinutes: this.#pluginData.data.settings.defaultDurationMinutes,
        urgentTrigger: this.#pluginData.data.settings.urgentTrigger,
      },
    });
    if (!grammar.supported) return undefined;
    return Object.freeze({
      path,
      sourceText,
      sourceFingerprint,
      items: grammar.items,
    });
  }

  #editorItemAt(
    path: string,
    sourceText: string,
    sourceOffset: number,
    sourceFingerprint: string,
  ): PlanItem<WorkspacePlanItemSource> | undefined {
    if (!Number.isSafeInteger(sourceOffset) || sourceOffset < 0 || sourceOffset > sourceText.length) {
      return undefined;
    }
    if (utf8ByteLength(sourceText) > MAX_ACTIVE_NOTE_BYTES) return undefined;
    const parsed = this.#parseSource(path, sourceText, sourceFingerprint);
    const item = parsed?.items.find((candidate) =>
      sourceOffset >= candidate.source.itemSpan.fromOffset
      && sourceOffset <= candidate.source.itemSpan.toOffset);
    return item?.kind === "flexible-task" && item.status === "open" && item.executionEligible
      ? item
      : undefined;
  }

  async #resolveTarget(reference: ExecutionTargetReference): Promise<ResolvedTask | undefined> {
    if (!Number.isSafeInteger(reference.sourceOrder) || reference.sourceOrder < 0) return undefined;
    let path = reference.path;
    if (reference.ownerId) {
      const identity = this.#index.safetyIdentity(reference.ownerId);
      if (identity.kind !== "unique") return undefined;
      path = identity.location.path;
    }
    const parsed = await this.#readParsed(path);
    if (!parsed) return undefined;
    const item = reference.ownerId
      ? parsed.items.find((candidate) => candidate.source.blockId === reference.ownerId)
      : parsed.sourceFingerprint === reference.sourceFingerprint
        ? parsed.items.find((candidate) =>
            candidate.sourceOrder === reference.sourceOrder && !candidate.source.blockId)
        : undefined;
    if (!item) return undefined;
    const selector = Object.freeze({
      kind: "plan-item" as const,
      ...(item.source.blockId ? { id: item.source.blockId } : {}),
    });
    const logbook = readLogbook(parsed.sourceText, {
      path,
      itemFromOffset: item.source.itemSpan.fromOffset,
      itemToOffset: item.source.itemSpan.toOffset,
      ...(item.source.blockId ? { ownerId: item.source.blockId } : {}),
    }, this.#logbook);
    if (!logbook.complete || logbook.kind === "ambiguous") return undefined;
    return Object.freeze({
      parsed,
      item,
      fact: executionFact(item, path),
      selector,
      logbook,
    });
  }

  async #resolveOwnerTask(ownerId: string): Promise<ResolvedTask | undefined> {
    const identity = this.#index.safetyIdentity(ownerId);
    if (identity.kind !== "unique") return undefined;
    const parsed = await this.#readParsed(identity.location.path);
    const item = parsed?.items.find((candidate) => candidate.source.blockId === ownerId);
    if (!parsed || !item) return undefined;
    const logbook = readLogbook(parsed.sourceText, {
      path: parsed.path,
      itemFromOffset: item.source.itemSpan.fromOffset,
      itemToOffset: item.source.itemSpan.toOffset,
      ownerId,
    }, this.#logbook);
    if (!logbook.complete || logbook.kind === "ambiguous") return undefined;
    return Object.freeze({
      parsed,
      item,
      fact: executionFact(item, parsed.path),
      selector: Object.freeze({ kind: "plan-item", id: ownerId }),
      logbook,
    });
  }

  async #resolveClockOwner(clock: IndexedClockSource): Promise<ClockOwnerResolution> {
    if (!clock.ownerId) return Object.freeze({ state: "missing" });
    const owner = await this.#resolveOwnerTask(clock.ownerId);
    if (!owner || owner.parsed.path !== clock.path) return Object.freeze({ state: "stale" });
    const exactClock = owner.logbook.clocks.find((candidate) =>
      candidate.fromOffset === clock.fromOffset
      && candidate.toOffset === clock.toOffset
      && candidate.text === clock.text);
    if (!exactClock) return Object.freeze({ state: "stale" });
    if (owner.item.status === "done") return Object.freeze({ state: "done", ownerId: clock.ownerId });
    if (!owner.item.executionEligible) return Object.freeze({ state: "ineligible", ownerId: clock.ownerId });
    return Object.freeze({ state: "eligible", ownerId: clock.ownerId });
  }

  async #resolveActiveClock(
    state: ExecutionClockIndexState,
    timeZone: string,
  ): Promise<ResolvedClock | undefined> {
    if (state.kind !== "active") return undefined;
    const fact = clockFact(state.clock, timeZone);
    if (!fact) return undefined;
    const owner = await this.#resolveOwnerTask(state.ownerId);
    if (!owner) return undefined;
    const clock = owner.logbook.clocks.find((candidate) =>
      candidate.fromOffset === state.clock.fromOffset
      && candidate.toOffset === state.clock.toOffset
      && candidate.text === state.clock.text);
    if (!clock) return undefined;
    const selector = Object.freeze({
      kind: "clock" as const,
      ...(state.clock.clockId ? { id: state.clock.clockId } : { fromOffset: state.clock.fromOffset }),
      ownerId: state.ownerId,
    });
    return Object.freeze({
      indexed: state.clock,
      parsed: owner.parsed,
      owner: owner.item,
      selector,
      expectation: createClockExpectation({
        target: selector,
        path: state.clock.path,
        sourceText: owner.parsed.sourceText,
        clock,
      }),
      fact,
      key: indexedClockKey(state.clock),
    });
  }

  #generatedIdentities(
    target: ResolvedTask | undefined,
    active: ResolvedClock | undefined,
    needsOpen: boolean,
  ): ExecutionGeneratedIdentities {
    const reserved = new Set<string>();
    const collides = (id: string): boolean => reserved.has(id) || this.#index.safetyIdentity(id).kind !== "missing";
    const planItemId = target && !target.item.source.blockId
      ? generateUniquePlanItemId(collides)
      : undefined;
    if (planItemId) reserved.add(planItemId);
    const closedClockId = active && !active.indexed.clockId
      ? generateUniqueClockId(collides)
      : undefined;
    if (closedClockId) reserved.add(closedClockId);
    const openedClockId = needsOpen ? generateUniqueClockId(collides) : undefined;
    return Object.freeze({
      ...(planItemId ? { planItemId } : {}),
      ...(openedClockId ? { openedClockId } : {}),
      ...(closedClockId ? { closedClockId } : {}),
    });
  }

  async #progressAction(reference: ExecutionTargetReference): Promise<"advance-progress" | "reopen-progress"> {
    await this.#index.rebuild();
    const target = await this.#resolveTarget(reference);
    return target?.item.status === "done" ? "reopen-progress" : "advance-progress";
  }

  #clockInAction(reference: ExecutionTargetReference): "clock-in" | "switch-task" {
    const clocks = this.#coordinator.snapshot.clocks;
    if (clocks.kind !== "active") return "clock-in";
    return reference.ownerId !== null && reference.ownerId === clocks.ownerId
      ? "clock-in"
      : "switch-task";
  }

  async #prepare(
    intent: Exclude<ExecutionApplicationIntent, { readonly type:
      | "start-standalone-pomo"
      | "stop-standalone-pomo"
      | "enable-execution"
      | "disable-execution"
      | "recover-standalone-pomo" }>,
    advertisedAction: MutationAction,
    context: ExecutionCommandContext,
  ): Promise<ExecutionMutationPreparation> {
    try {
      if (!this.#index.safetySnapshot.complete) return { kind: "rejected", code: "source-over-limit" };
      const target = "target" in intent && intent.type !== "delete-clock"
        ? await this.#resolveTarget(intent.target)
        : undefined;
      if ("target" in intent && intent.type !== "delete-clock" && !target) {
        return { kind: "rejected", code: "plan-item-not-found" };
      }
      const active = await this.#resolveActiveClock(context.clocks, context.sample.timeZone);
      if (context.clocks.kind === "active" && !active) {
        return { kind: "rejected", code: "action-no-longer-applicable" };
      }
      if (intent.type === "delete-clock" && (!active
        || active.indexed.path !== intent.target.path
        || active.indexed.fromOffset !== intent.target.fromOffset
        || (active.indexed.clockId ?? null) !== intent.target.clockId
        || active.fact.ownerId !== intent.target.ownerId
        || active.fact.startEpochMs !== intent.target.startEpochMs
        || active.key !== intent.target.targetKey)) {
        return { kind: "rejected", code: "action-no-longer-applicable" };
      }
      const generated = this.#generatedIdentities(target, active, intent.type === "clock-in");
      const decisionIntent: ExecutionDecisionIntent = intent.type === "clock-in"
        ? { type: "clock-in", target: target!.fact }
        : intent.type === "clock-out"
          ? { type: "clock-out" }
          : intent.type === "complete"
            ? { type: "complete", target: target!.fact }
            : intent.type === "delete-clock"
              ? { type: "delete-clock", target: active!.fact, ...(intent.confirmation ? { confirmation: intent.confirmation } : {}) }
              : {
                  type: "advance-or-reopen-progress",
                  target: target!.fact,
                  logicalMinute: this.#logicalMinute(context.sample),
                };
      const decision = decideExecutionCommand(decisionIntent, {
        clocks: coreClockState(context.clocks, context.sample.timeZone),
        nowEpochMs: context.sample.wallEpochMs,
        offsetMinutes: offsetMinutesAt(context.sample.wallEpochMs, context.sample.timeZone),
        generated,
      });
      if (decision.kind === "rejected") {
        return { kind: "rejected", code: this.#rejectionCode(decision.code) };
      }
      if (decision.kind === "no-op") {
        return { kind: "confirmed-no-op", reason: decision.reason };
      }
      if (decision.action !== advertisedAction) {
        return { kind: "rejected", code: "action-no-longer-applicable" };
      }
      const plan = this.#mutationPlan(intent.intentId, decision, target, active, context);
      const expectation = this.#mutationExpectation(plan, target, active, context);
      return Object.freeze({ kind: "prepared", mutation: Object.freeze({ plan, expectation }) });
    } catch {
      return { kind: "rejected", code: "source-conflict" };
    }
  }

  #mutationPlan(
    intentId: string,
    decision: Exclude<ExecutionCommandDecision, { readonly kind: "rejected" | "no-op" }>,
    target: ResolvedTask | undefined,
    active: ResolvedClock | undefined,
    context: ExecutionCommandContext,
  ): MutationPlan {
    const targetSelector = target?.selector;
    const activeSelector = active?.selector;
    let stages: readonly MutationStage[];
    if (decision.kind === "start") {
      stages = [this.#stage(decision.start.target.path, [{
        kind: "clock-in",
        target: targetSelector!,
        ...(decision.start.assignedOwnerId ? { generatedPlanItemId: decision.start.assignedOwnerId } : {}),
        clock: {
          clockId: decision.start.clockId,
          startEpochMs: decision.start.startEpochMs,
          offsetMinutes: decision.start.offsetMinutes,
        },
      }])];
    } else if (decision.kind === "switch") {
      const close: FileMutationOperation = {
        kind: "clock-out",
        target: activeSelector!,
        close: closeFacts(decision.close),
      };
      const open: FileMutationOperation = {
        kind: "clock-in",
        target: targetSelector!,
        ...(decision.start.assignedOwnerId ? { generatedPlanItemId: decision.start.assignedOwnerId } : {}),
        clock: {
          clockId: decision.start.clockId,
          startEpochMs: decision.start.startEpochMs,
          offsetMinutes: decision.start.offsetMinutes,
        },
      };
      stages = decision.close.clock.path === decision.start.target.path
        ? [this.#stage(decision.close.clock.path, [close, open])]
        : [
            this.#stage(decision.close.clock.path, [close]),
            this.#stage(decision.start.target.path, [open]),
          ];
    } else if (decision.kind === "stop") {
      stages = [this.#stage(decision.close.clock.path, [{
        kind: "clock-out",
        target: activeSelector!,
        close: closeFacts(decision.close),
      }])];
    } else if (decision.kind === "complete") {
      stages = [this.#stage(decision.target.path, [{
        kind: "complete",
        target: targetSelector!,
        ...(decision.assignedOwnerId ? { generatedPlanItemId: decision.assignedOwnerId } : {}),
        ...(decision.close ? { closeClock: closeFacts(decision.close) } : {}),
      }])];
    } else if (decision.kind === "delete") {
      stages = [this.#stage(decision.target.path, [{
        kind: "delete-clock",
        target: activeSelector!,
        confirmation: decision.confirmation,
      }])];
    } else if (decision.kind === "advance-progress") {
      stages = [this.#stage(decision.target.path, [{
        kind: "advance-progress",
        target: targetSelector!,
        logicalMinute: decision.logicalMinute,
        ...(decision.assignedOwnerId ? { generatedPlanItemId: decision.assignedOwnerId } : {}),
        ...(decision.close ? { closeClock: closeFacts(decision.close) } : {}),
      }])];
    } else {
      stages = [this.#stage(decision.target.path, [{
        kind: "reopen-progress",
        target: targetSelector!,
        ...(decision.assignedOwnerId ? { generatedPlanItemId: decision.assignedOwnerId } : {}),
      }])];
    }
    return createMutationPlan({
      intentId,
      action: decision.action,
      stages,
      expectedRunningClockIds: context.clocks.kind === "active"
        ? [indexedClockKey(context.clocks.clock)]
        : [],
      settingsVersion: context.settingsVersion,
      zoneId: context.sample.timeZone,
      ...(decision.kind === "switch" ? { transitionEpochMs: decision.transitionEpochMs } : {}),
    });
  }

  #mutationExpectation(
    plan: MutationPlan,
    target: ResolvedTask | undefined,
    active: ResolvedClock | undefined,
    context: ExecutionCommandContext,
  ): MutationExpectation {
    const planItems = target ? [createPlanItemExpectation({
      target: target.selector,
      path: target.parsed.path,
      sourceText: target.parsed.sourceText,
      item: target.item,
      drawerCount: target.logbook.drawers.length,
      watch: "complete-item",
    })] : [];
    const usesActive = plan.stages.some((stage) => stage.operations.some((operation) =>
      operation.kind === "clock-out"
      || operation.kind === "delete-clock"
      || ("closeClock" in operation && operation.closeClock !== undefined)));
    return createMutationExpectation({
      intentId: plan.intentId,
      action: plan.action,
      planItems,
      clocks: usesActive && active ? [active.expectation] : [],
      expectedRunningClockIds: plan.expectedRunningClockIds,
      settingsVersion: plan.settingsVersion,
      zoneId: plan.zoneId,
      indexComplete: this.#index.safetySnapshot.complete,
      time: {
        wallEpochMs: context.sample.wallEpochMs,
        monotonicMs: context.sample.monotonicMs,
        maximumDriftMs: MAXIMUM_DRIFT_MS,
        maximumQueueDelayMs: MAXIMUM_QUEUE_DELAY_MS,
        discontinuity: false,
      },
      previewToken: plan.previewToken,
    });
  }

  #stage(path: string, operations: readonly FileMutationOperation[]): MutationStage {
    return Object.freeze({ path, operations: Object.freeze([...operations]), confirmationRequired: false });
  }

  #rejectionCode(code: Extract<ExecutionCommandDecision, { kind: "rejected" }>["code"]): WriteResultCode {
    if (code === "generated-identity-collision") return "identity-collision";
    if (code === "missing-generated-identity") return "source-conflict";
    return "action-no-longer-applicable";
  }

  #logicalMinute(sample: ClockSample): number {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: sample.timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    const values = new Map(formatter.formatToParts(new Date(sample.wallEpochMs))
      .filter((part) => part.type === "hour" || part.type === "minute")
      .map((part) => [part.type, Number(part.value)]));
    const hour = values.get("hour");
    const minute = values.get("minute");
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
      throw new RangeError("Unable to resolve the current local minute");
    }
    return hour! * 60 + minute!;
  }

  #commitContext(): CommitContext {
    const sample = this.#clock.sample();
    return Object.freeze({
      settingsVersion: this.#pluginData.revision,
      zoneId: sample.timeZone,
      wallEpochMs: sample.wallEpochMs,
      monotonicMs: sample.monotonicMs,
      discontinuity: false,
    });
  }

  #makeSnapshot(
    runtime: ExecutionRuntimeSnapshot,
    status: ExecutionApplicationStatus = applicationStatus(runtime),
    code: string | undefined = runtime.code,
    focused?: ExecutionFocusedTaskSnapshot,
  ): ExecutionApplicationSnapshot {
    return Object.freeze({
      generation: ++this.#generation,
      status,
      runtime,
      execution: projectExecutionState(
        runtime.clocks,
        this.#clock.now(),
        this.#pluginData.data.taskPomoStartEpochMs,
        this.#pluginData.data.settings.forgottenWarningMinutes,
      ),
      writeBlocked: runtime.writeBlocked || status === "stale" || status === "stopping" || status === "stopped",
      pomoThresholdMinutes: this.#pluginData.data.settings.pomoThresholdMinutes,
      standalonePomoStartEpochMs: this.#pluginData.data.standalonePomoStartEpochMs,
      ...(focused ? { focused } : {}),
      ...(code ? { code } : {}),
    });
  }

  #publishRuntime(runtime: ExecutionRuntimeSnapshot): void {
    const prior = this.#snapshot.focused;
    const focused = runtime.clocks.kind === "active" && prior?.ownerId === runtime.clocks.ownerId
      ? prior
      : undefined;
    this.#publish(this.#makeSnapshot(runtime, applicationStatus(runtime), runtime.code, focused));
  }

  async #publishConfirmed(runtime: ExecutionRuntimeSnapshot): Promise<void> {
    let focused: ExecutionFocusedTaskSnapshot | undefined;
    let code: string | undefined = runtime.code;
    let status = applicationStatus(runtime);
    if (runtime.clocks.kind === "active") {
      const owner = await this.#resolveOwnerTask(runtime.clocks.ownerId);
      if (owner) {
        focused = Object.freeze({
          ownerId: runtime.clocks.ownerId,
          path: owner.parsed.path,
          sourceOrder: owner.item.sourceOrder,
          label: owner.item.label,
          clock: Object.freeze({
            path: runtime.clocks.clock.path,
            ownerId: runtime.clocks.ownerId,
            clockId: runtime.clocks.clock.clockId ?? null,
            fromOffset: runtime.clocks.clock.fromOffset,
            startEpochMs: runtime.clocks.startEpochMs,
            targetKey: indexedClockKey(runtime.clocks.clock),
          }),
        });
      } else {
        status = "degraded";
        code = "focused-task-unavailable";
      }
    }
    this.#publish(this.#makeSnapshot(runtime, status, code, focused));
  }

  #publish(snapshot: ExecutionApplicationSnapshot): void {
    if (this.#stopped && snapshot.status !== "stopped") return;
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener(snapshot);
  }
}
