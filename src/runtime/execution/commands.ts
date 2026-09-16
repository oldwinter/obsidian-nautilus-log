import type { WriteResultCode } from "../../workspace/conflicts";
import type { MutationExpectation } from "../../workspace/expectation";
import type { MutationAction, MutationPlan } from "../../workspace/mutations";
import { isCommitReceipt, type CommitOutcome, type CommitReceipt } from "../../workspace/receipt";
import type { PluginDataStore } from "../plugin-data";
import type { ClockSample, PairedSystemClock } from "../system-clock";
import type {
  ExecutionClockDiagnosticCode,
  ExecutionClockIndexState,
} from "./clock-index";
import {
  MutationQueue,
  MutationQueueCapacityError,
  MutationQueueStoppedError,
} from "./mutation-queue";
import { PomoController } from "./pomo";
import type { AcknowledgedTimingRepair } from "./recovery";
import { timingRepairIsAcknowledged } from "./recovery";
import { TimeContinuity, type TimeRecoveryChoice } from "./time-continuity";

export type ExecutionRuntimeCode =
  | WriteResultCode
  | ExecutionClockDiagnosticCode
  | "execution-disabled"
  | "intent-queue-over-limit"
  | "intent-mismatch"
  | "plugin-data-failed"
  | "repair-confirmation-required"
  | "runtime-not-started"
  | "runtime-stopping"
  | "time-review-required"
  | "already-idle"
  | "already-focused";

export type ExecutionRuntimeStatus =
  | "starting"
  | "ready"
  | "working"
  | "reconciling"
  | "degraded"
  | "stopping"
  | "stopped";

export interface ExecutionRuntimeSnapshot {
  readonly status: ExecutionRuntimeStatus;
  readonly clocks: ExecutionClockIndexState;
  readonly writeBlocked: boolean;
  readonly pluginDataRevision: number;
  readonly code?: ExecutionRuntimeCode;
}

export interface ExecutionCommandOutcome {
  readonly intentId: string;
  readonly outcome: CommitOutcome;
  readonly snapshot: ExecutionRuntimeSnapshot;
  readonly receipt?: CommitReceipt;
  readonly code?: ExecutionRuntimeCode;
  readonly pluginDataWarning: boolean;
}

export interface PreparedExecutionMutation {
  readonly plan: MutationPlan;
  readonly expectation: MutationExpectation;
}

export interface ExecutionCommandContext {
  readonly sample: ClockSample;
  readonly clocks: ExecutionClockIndexState;
  readonly settingsVersion: number;
}

export type ExecutionMutationPreparation =
  | { readonly kind: "prepared"; readonly mutation: PreparedExecutionMutation }
  | { readonly kind: "confirmed-no-op"; readonly reason?: "already-focused" | "already-idle" }
  | { readonly kind: "rejected"; readonly code: WriteResultCode };

export interface ExecutionMutationIntent {
  readonly intentId: string;
  readonly action: MutationAction;
  readonly prepare: (
    context: ExecutionCommandContext,
  ) => ExecutionMutationPreparation | Promise<ExecutionMutationPreparation>;
  readonly repair?: AcknowledgedTimingRepair;
}

export interface DisableExecutionIntent {
  readonly intentId: string;
  readonly prepareClose?: ExecutionMutationIntent["prepare"];
}

export interface ExecutionClockReader {
  scan(signal?: AbortSignal): Promise<ExecutionClockIndexState>;
}

export interface ExecutionCommitter {
  commit(plan: MutationPlan, expectation: MutationExpectation): Promise<CommitReceipt>;
}

export interface ExecutionCoordinatorDependencies {
  readonly clock: PairedSystemClock;
  readonly clockReader: ExecutionClockReader;
  readonly committer: ExecutionCommitter;
  readonly pluginData: PluginDataStore;
  readonly publish?: (snapshot: ExecutionRuntimeSnapshot) => void;
}

const REPAIR_ACTIONS: ReadonlySet<MutationAction> = new Set([
  "repair-plan-item-identity",
  "repair-clock-identity",
  "normalize-legacy-clock",
  "repair-overlap",
  "repair-done-owner-clock",
]);

const TIME_RECOVERY_ACTIONS: ReadonlyMap<MutationAction, TimeRecoveryChoice> = new Map([
  ["keep-measured-time", "keep-measured"],
  ["use-system-time", "use-system-time"],
  ["stop-at-trusted-time", "stop-at-trusted"],
]);

const POMO_END_ACTIONS: ReadonlySet<MutationAction> = new Set([
  "clock-out",
  "complete",
  "delete-clock",
  "stop-at-trusted-time",
]);

function initialClockState(): ExecutionClockIndexState {
  return Object.freeze({
    kind: "degraded",
    generation: 0,
    code: "clock-index-unavailable",
    count: 0,
    reason: "not-built",
    clocks: Object.freeze([]),
  });
}

function scanFailureState(generation: number): ExecutionClockIndexState {
  return Object.freeze({
    kind: "degraded",
    generation,
    code: "clock-index-unavailable",
    count: 0,
    reason: "source-read-failed",
    clocks: Object.freeze([]),
  });
}

function actionAllowedInDegradedState(
  action: MutationAction,
  clocks: Extract<ExecutionClockIndexState, { kind: "degraded" }>,
): boolean {
  if (REPAIR_ACTIONS.has(action)) {
    return clocks.code !== "clock-index-unavailable";
  }
  return clocks.code === "clock-owner-invalid"
    && (action === "clock-out" || action === "delete-clock");
}

function receiptBlocksWrites(receipt: CommitReceipt): boolean {
  return receipt.outcome === "uncertain" || receipt.outcome === "invariant-broken";
}

function receiptSucceeded(receipt: CommitReceipt): boolean {
  return receipt.outcome === "applied" || receipt.outcome === "already-applied";
}

function sameConfirmedClockState(
  left: ExecutionClockIndexState,
  right: ExecutionClockIndexState,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "idle" && right.kind === "idle") return true;
  if (left.kind === "degraded" && right.kind === "degraded") {
    return left.code === right.code && left.count === right.count;
  }
  if (left.kind !== "active" || right.kind !== "active") return false;
  return left.ownerId === right.ownerId
    && left.startEpochMs === right.startEpochMs
    && left.clock.path === right.clock.path
    && left.clock.fromOffset === right.clock.fromOffset
    && left.clock.toOffset === right.clock.toOffset
    && left.clock.text === right.clock.text;
}

export class ExecutionCoordinator {
  readonly #clock: PairedSystemClock;
  readonly #clockReader: ExecutionClockReader;
  readonly #committer: ExecutionCommitter;
  readonly #pluginData: PluginDataStore;
  readonly #pomo: PomoController;
  readonly #continuity: TimeContinuity;
  readonly #queue = new MutationQueue();
  readonly #publishSnapshot: ((snapshot: ExecutionRuntimeSnapshot) => void) | undefined;
  #started = false;
  #startPromise: Promise<ExecutionRuntimeSnapshot> | undefined;
  #stopping = false;
  #stopPromise: Promise<void> | undefined;
  #hardBlocked = false;
  #sessionBlocked = false;
  #snapshot: ExecutionRuntimeSnapshot;

  constructor(dependencies: ExecutionCoordinatorDependencies) {
    this.#clock = dependencies.clock;
    this.#clockReader = dependencies.clockReader;
    this.#committer = dependencies.committer;
    this.#pluginData = dependencies.pluginData;
    this.#pomo = new PomoController(dependencies.pluginData);
    this.#continuity = new TimeContinuity(dependencies.clock);
    this.#publishSnapshot = dependencies.publish;
    this.#snapshot = Object.freeze({
      status: "starting",
      clocks: initialClockState(),
      writeBlocked: true,
      pluginDataRevision: dependencies.pluginData.revision,
    });
  }

  get snapshot(): ExecutionRuntimeSnapshot {
    return this.#snapshot;
  }

  get continuity(): TimeContinuity {
    return this.#continuity;
  }

  start(): Promise<ExecutionRuntimeSnapshot> {
    if (this.#started || this.#stopping) return Promise.resolve(this.#snapshot);
    if (this.#startPromise) return this.#startPromise;
    const operation = this.#startRuntime();
    this.#startPromise = operation;
    void operation.catch(() => {
      this.#startPromise = undefined;
    });
    return operation;
  }

  async #startRuntime(): Promise<ExecutionRuntimeSnapshot> {
    await this.#pluginData.load();
    const clocks = await this.#safeScan();
    const sample = this.#clock.sample();
    const restoredStart = clocks.kind === "active"
      ? clocks.startEpochMs
      : clocks.kind === "idle"
        ? this.#pluginData.data.standalonePomoStartEpochMs ?? undefined
        : undefined;
    const continuity = this.#continuity.restore(sample, restoredStart);
    let code: ExecutionRuntimeCode | undefined;
    if (!this.#stopping) {
      try {
        if (clocks.kind === "active") await this.#pomo.restore(clocks.startEpochMs, sample.wallEpochMs);
        if (clocks.kind === "idle") await this.#pomo.restore();
      } catch {
        this.#sessionBlocked = true;
        code = "plugin-data-failed";
      }
    }
    this.#started = true;
    if (this.#stopping) {
      return this.#setSnapshot("stopping", clocks, "runtime-stopping");
    }
    return this.#setSnapshot(
      clocks.kind === "degraded" || code || continuity.kind === "time-review-required" ? "degraded" : "ready",
      clocks,
      code
        ?? (clocks.kind === "degraded"
          ? clocks.code
          : continuity.kind === "time-review-required"
            ? "time-review-required"
            : undefined),
    );
  }

  dispatchMutation(intent: ExecutionMutationIntent): Promise<ExecutionCommandOutcome> {
    return this.#enqueue(intent.intentId, () => this.#attemptMutation(intent));
  }

  startStandalonePomo(intentId: string): Promise<ExecutionCommandOutcome> {
    return this.#enqueue(intentId, async () => {
      const rejected = this.#admissionRejection(intentId);
      if (rejected) return rejected;
      const clocks = await this.#safeScan();
      if (clocks.kind !== "idle") {
        const code = clocks.kind === "degraded" ? clocks.code : "action-no-longer-applicable";
        return this.#reject(intentId, clocks, code);
      }
      const observed = this.#clock.sample();
      const continuity = this.#continuity.observe(observed);
      if (continuity.kind === "time-review-required"
        && (this.#pluginData.data.taskPomoStartEpochMs !== null
          || this.#pluginData.data.standalonePomoStartEpochMs !== null)) {
        return this.#reject(intentId, clocks, "time-review-required");
      }
      const sample = continuity.kind === "time-review-required"
        ? this.#continuity.reanchor(observed)
        : continuity.sample;
      this.#setSnapshot("working", clocks);
      try {
        const changed = await this.#pomo.startStandalone(sample.wallEpochMs, false);
        if (this.#stopping) return this.#reject(intentId, clocks, "runtime-stopping");
        const confirmedClocks = await this.#safeScan();
        if (confirmedClocks.kind === "active") {
          await this.#pomo.restore(confirmedClocks.startEpochMs);
          return this.#reject(intentId, confirmedClocks, "action-no-longer-applicable");
        }
        if (confirmedClocks.kind === "degraded") {
          this.#sessionBlocked = true;
          return this.#reject(intentId, confirmedClocks, confirmedClocks.code);
        }
        const snapshot = this.#setSnapshot("ready", confirmedClocks);
        return this.#outcome(intentId, changed ? "applied" : "already-applied", snapshot);
      } catch {
        this.#sessionBlocked = true;
        return this.#reject(intentId, clocks, "plugin-data-failed", "uncertain", true);
      }
    });
  }

  stopStandalonePomo(intentId: string): Promise<ExecutionCommandOutcome> {
    return this.#enqueue(intentId, async () => {
      const rejected = this.#admissionRejection(intentId);
      if (rejected) return rejected;
      const clocks = await this.#safeScan();
      if (clocks.kind === "degraded") return this.#reject(intentId, clocks, clocks.code);
      const continuity = this.#continuity.observe(this.#clock.sample());
      if (continuity.kind === "time-review-required") {
        return this.#reject(intentId, clocks, "time-review-required");
      }
      this.#setSnapshot("working", clocks);
      try {
        const changed = await this.#pomo.stopStandalone();
        const snapshot = this.#setSnapshot("ready", clocks);
        return this.#outcome(intentId, changed ? "applied" : "already-applied", snapshot);
      } catch {
        this.#sessionBlocked = true;
        return this.#reject(intentId, clocks, "plugin-data-failed", "uncertain", true);
      }
    });
  }

  recoverStandalonePomo(
    intentId: string,
    choice: TimeRecoveryChoice,
  ): Promise<ExecutionCommandOutcome> {
    return this.#enqueue(intentId, async () => {
      const rejected = this.#admissionRejection(intentId, { allowTimeReview: true });
      if (rejected) return rejected;
      const clocks = await this.#safeScan();
      const standaloneStart = this.#pluginData.data.standalonePomoStartEpochMs;
      if (clocks.kind !== "idle" || standaloneStart === null) {
        const code = clocks.kind === "degraded" ? clocks.code : "action-no-longer-applicable";
        return this.#reject(intentId, clocks, code);
      }
      const review = this.#continuity.observe(this.#clock.sample());
      if (review.kind !== "time-review-required" || !this.#continuity.canResolve(choice)) {
        return this.#reject(intentId, clocks, "action-no-longer-applicable");
      }
      this.#setSnapshot("working", clocks);
      try {
        let changed = false;
        if (choice === "keep-measured") {
          const trustedElapsed = review.lastTrusted.wallEpochMs - standaloneStart;
          if (trustedElapsed < 0) {
            return this.#reject(intentId, clocks, "action-no-longer-applicable");
          }
          changed = await this.#pomo.rebaseStandalone(
            review.observed.wallEpochMs - trustedElapsed,
          ) !== undefined;
        } else if (choice === "stop-at-trusted") {
          changed = await this.#pomo.stopStandalone() !== undefined;
        }
        this.#continuity.resolve(choice);
        return this.#outcome(
          intentId,
          changed ? "applied" : "already-applied",
          this.#setSnapshot("ready", clocks),
        );
      } catch {
        this.#sessionBlocked = true;
        return this.#reject(intentId, clocks, "plugin-data-failed", "uncertain", true);
      }
    });
  }

  enableExecution(intentId: string): Promise<ExecutionCommandOutcome> {
    return this.#enqueue(intentId, async () => {
      const rejected = this.#admissionRejection(intentId, { allowDisabled: true });
      if (rejected) return rejected;
      const clocks = await this.#safeScan();
      if (clocks.kind === "degraded") return this.#reject(intentId, clocks, clocks.code);
      if (this.#pluginData.data.settings.executionEnabled) {
        return this.#outcome(intentId, "already-applied", this.#setSnapshot("ready", clocks));
      }
      this.#setSnapshot("working", clocks);
      try {
        await this.#pluginData.update((current) => ({
          ...current,
          settings: { ...current.settings, executionEnabled: true },
        }));
        return this.#outcome(intentId, "applied", this.#setSnapshot("ready", clocks));
      } catch {
        this.#sessionBlocked = true;
        return this.#reject(intentId, clocks, "plugin-data-failed", "uncertain", true);
      }
    });
  }

  disableExecution(intent: DisableExecutionIntent): Promise<ExecutionCommandOutcome> {
    return this.#enqueue(intent.intentId, async () => {
      const rejected = this.#admissionRejection(intent.intentId, { allowDisabled: true });
      if (rejected) return rejected;
      let clocks = await this.#safeScan();
      if (clocks.kind === "degraded") return this.#reject(intent.intentId, clocks, clocks.code);
      let closeOutcome: ExecutionCommandOutcome | undefined;
      if (clocks.kind === "active") {
        if (!intent.prepareClose) {
          return this.#reject(intent.intentId, clocks, "action-no-longer-applicable");
        }
        closeOutcome = await this.#attemptMutation({
          intentId: intent.intentId,
          action: "clock-out",
          prepare: intent.prepareClose,
        }, false);
        clocks = closeOutcome.snapshot.clocks;
        if (!closeOutcome.receipt || !receiptSucceeded(closeOutcome.receipt) || clocks.kind !== "idle") {
          return closeOutcome;
        }
      }
      if (this.#stopping) return this.#reject(intent.intentId, clocks, "runtime-stopping");
      if (!this.#pluginData.data.settings.executionEnabled
        && this.#pluginData.data.taskPomoStartEpochMs === null
        && this.#pluginData.data.standalonePomoStartEpochMs === null) {
        return this.#outcome(intent.intentId, "already-applied", this.#setSnapshot("ready", clocks));
      }
      try {
        await this.#pluginData.update((current) => ({
          ...current,
          settings: { ...current.settings, executionEnabled: false },
          taskPomoStartEpochMs: null,
          standalonePomoStartEpochMs: null,
        }));
        return this.#outcome(
          intent.intentId,
          "applied",
          this.#setSnapshot("ready", clocks),
          closeOutcome?.receipt,
        );
      } catch {
        const snapshot = this.#setSnapshot("degraded", clocks, "plugin-data-failed");
        return this.#outcome(
          intent.intentId,
          closeOutcome?.outcome === "applied" ? "partial-safe" : "uncertain",
          snapshot,
          closeOutcome?.receipt,
          "plugin-data-failed",
          true,
        );
      }
    });
  }

  stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;
    this.#stopping = true;
    this.#stopPromise = Promise.resolve().then(() => this.#finishStop());
    this.#setSnapshot("stopping", this.#snapshot.clocks, "runtime-stopping", true);
    return this.#stopPromise;
  }

  async #finishStop(): Promise<void> {
    await this.#queue.stop();
    await this.#startPromise?.catch(() => undefined);
    await this.#pluginData.stop();
    this.#snapshot = Object.freeze({
      status: "stopped",
      clocks: this.#snapshot.clocks,
      writeBlocked: true,
      pluginDataRevision: this.#pluginData.revision,
      code: "runtime-stopping",
    });
  }

  async #attemptMutation(
    intent: ExecutionMutationIntent,
    managePomo = true,
  ): Promise<ExecutionCommandOutcome> {
    const recoveryChoice = TIME_RECOVERY_ACTIONS.get(intent.action);
    const rejected = this.#admissionRejection(intent.intentId, {
      allowTimeReview: recoveryChoice !== undefined,
    });
    if (rejected) return rejected;
    const clocks = await this.#safeScan();
    if (clocks.kind === "degraded" && !actionAllowedInDegradedState(intent.action, clocks)) {
      return this.#reject(intent.intentId, clocks, clocks.code);
    }
    if (REPAIR_ACTIONS.has(intent.action)) {
      if (!intent.repair
        || !timingRepairIsAcknowledged(intent.repair)
        || intent.repair.plan.action !== intent.action) {
        return this.#reject(intent.intentId, clocks, "repair-confirmation-required");
      }
    }

    const observed = this.#clock.sample();
    const continuity = this.#continuity.observe(observed);
    let effectiveSample = observed;
    if (recoveryChoice && continuity.kind !== "time-review-required") {
      return this.#reject(intent.intentId, clocks, "action-no-longer-applicable");
    }
    if (continuity.kind === "time-review-required") {
      const hasPomo = this.#pluginData.data.taskPomoStartEpochMs !== null
        || this.#pluginData.data.standalonePomoStartEpochMs !== null;
      if (recoveryChoice) {
        if (clocks.kind === "idle") {
          this.#continuity.reanchor(observed);
          return this.#reject(intent.intentId, clocks, "action-no-longer-applicable");
        }
        if (!this.#continuity.canResolve(recoveryChoice)) {
          return this.#reject(intent.intentId, clocks, "action-no-longer-applicable");
        }
        effectiveSample = this.#continuity.previewResolution(recoveryChoice);
      } else if (clocks.kind === "idle" && !hasPomo) {
        effectiveSample = this.#continuity.reanchor(observed);
      } else {
        return this.#reject(intent.intentId, clocks, "time-review-required");
      }
    }

    let prepared: ExecutionMutationPreparation;
    try {
      prepared = await intent.prepare(Object.freeze({
        sample: effectiveSample,
        clocks,
        settingsVersion: this.#pluginData.revision,
      }));
    } catch {
      return this.#reject(intent.intentId, clocks, "action-no-longer-applicable");
    }
    if (prepared.kind === "rejected") {
      return this.#reject(intent.intentId, clocks, prepared.code);
    }
    if (prepared.kind === "confirmed-no-op") {
      const confirmed = await this.#safeScan();
      if (!sameConfirmedClockState(clocks, confirmed)) {
        return this.#reject(intent.intentId, confirmed, "action-no-longer-applicable");
      }
      return this.#outcome(
        intent.intentId,
        "already-applied",
        this.#setSnapshot("ready", confirmed),
        undefined,
        prepared.reason === "already-idle" || prepared.reason === "already-focused"
          ? prepared.reason
          : undefined,
      );
    }
    const { plan, expectation } = prepared.mutation;
    if (plan.intentId !== intent.intentId
      || expectation.intentId !== intent.intentId
      || plan.action !== intent.action
      || expectation.action !== intent.action) {
      return this.#reject(intent.intentId, clocks, "intent-mismatch");
    }
    if (intent.repair
      && (intent.repair.plan !== plan || intent.repair.expectation !== expectation)) {
      return this.#reject(intent.intentId, clocks, "repair-confirmation-required");
    }
    if (this.#stopping) return this.#reject(intent.intentId, clocks, "runtime-stopping");
    this.#setSnapshot("working", clocks);

    let receipt: CommitReceipt;
    try {
      receipt = await this.#committer.commit(plan, expectation);
    } catch {
      this.#hardBlocked = true;
      if (this.#stopping) {
        return this.#outcome(
          intent.intentId,
          "uncertain",
          this.#setSnapshot("stopping", clocks, "write-outcome-uncertain"),
          undefined,
          "write-outcome-uncertain",
        );
      }
      const post = await this.#safeScan();
      return this.#outcome(
        intent.intentId,
        "uncertain",
        this.#setSnapshot("reconciling", post, "write-outcome-uncertain"),
        undefined,
        "write-outcome-uncertain",
      );
    }
    if (!isCommitReceipt(receipt)
      || receipt.intentId !== intent.intentId
      || receipt.action !== intent.action) {
      this.#hardBlocked = true;
      if (this.#stopping) {
        return this.#outcome(
          intent.intentId,
          "uncertain",
          this.#setSnapshot("stopping", clocks, "write-outcome-uncertain"),
          undefined,
          "write-outcome-uncertain",
        );
      }
      const post = await this.#safeScan();
      return this.#outcome(
        intent.intentId,
        "uncertain",
        this.#setSnapshot("reconciling", post, "write-outcome-uncertain"),
        undefined,
        "write-outcome-uncertain",
      );
    }
    if (this.#stopping) {
      return this.#outcome(
        intent.intentId,
        receipt.outcome,
        this.#setSnapshot("stopping", clocks, "runtime-stopping"),
        receipt,
        "runtime-stopping",
      );
    }
    const post = await this.#safeScan();

    let pluginDataWarning = false;
    if (managePomo) {
      try {
        await this.#applyPomoPostcondition(intent.action, receipt, post);
      } catch {
        pluginDataWarning = true;
      }
    }
    if (receiptBlocksWrites(receipt)) this.#hardBlocked = true;
    if (receiptSucceeded(receipt) && recoveryChoice) this.#continuity.resolve(recoveryChoice);

    const code = receipt.result?.code ?? (pluginDataWarning ? "plugin-data-failed" : undefined);
    const status = receiptBlocksWrites(receipt)
      ? "reconciling"
      : post.kind === "degraded" || pluginDataWarning
        ? "degraded"
        : "ready";
    return this.#outcome(
      intent.intentId,
      receipt.outcome,
      this.#setSnapshot(status, post, code ?? (post.kind === "degraded" ? post.code : undefined)),
      receipt,
      code,
      pluginDataWarning,
    );
  }

  async #applyPomoPostcondition(
    action: MutationAction,
    receipt: CommitReceipt,
    clocks: ExecutionClockIndexState,
  ): Promise<void> {
    if (!receiptSucceeded(receipt) && receipt.outcome !== "partial-safe") return;
    if ((action === "clock-in" || action === "switch-task") && clocks.kind === "active") {
      await this.#pomo.afterClockIn(clocks.startEpochMs);
      return;
    }
    if (clocks.kind === "idle"
      && (POMO_END_ACTIONS.has(action) || (action === "switch-task" && receipt.outcome === "partial-safe"))) {
      await this.#pomo.clearTask();
    }
  }

  #admissionRejection(
    intentId: string,
    options: {
      readonly allowDisabled?: boolean;
      readonly allowTimeReview?: boolean;
    } = {},
  ): ExecutionCommandOutcome | undefined {
    if (!this.#started) return this.#reject(intentId, this.#snapshot.clocks, "runtime-not-started");
    if (this.#stopping || this.#queue.state !== "accepting") {
      return this.#reject(intentId, this.#snapshot.clocks, "runtime-stopping");
    }
    if (this.#hardBlocked) return this.#reject(intentId, this.#snapshot.clocks, "write-outcome-uncertain");
    if (this.#sessionBlocked) return this.#reject(intentId, this.#snapshot.clocks, "plugin-data-failed");
    if (!options.allowTimeReview && this.#continuity.state?.kind === "time-review-required") {
      return this.#reject(intentId, this.#snapshot.clocks, "time-review-required");
    }
    if (!options.allowDisabled && !this.#pluginData.data.settings.executionEnabled) {
      return this.#reject(intentId, this.#snapshot.clocks, "execution-disabled");
    }
    return undefined;
  }

  #enqueue(
    intentId: string,
    attempt: () => Promise<ExecutionCommandOutcome>,
  ): Promise<ExecutionCommandOutcome> {
    try {
      return this.#queue.enqueue(intentId, attempt).catch((error: unknown) => {
        if (error instanceof MutationQueueStoppedError) {
          return this.#reject(intentId, this.#snapshot.clocks, "runtime-stopping");
        }
        if (error instanceof MutationQueueCapacityError) {
          return this.#reject(intentId, this.#snapshot.clocks, "intent-queue-over-limit");
        }
        this.#hardBlocked = true;
        return this.#reject(
          intentId,
          this.#snapshot.clocks,
          "write-outcome-uncertain",
          "uncertain",
        );
      });
    } catch {
      return Promise.resolve(this.#reject(intentId, this.#snapshot.clocks, "intent-mismatch"));
    }
  }

  async #safeScan(): Promise<ExecutionClockIndexState> {
    try {
      return await this.#clockReader.scan();
    } catch {
      return scanFailureState(this.#snapshot.clocks.generation + 1);
    }
  }

  #reject(
    intentId: string,
    clocks: ExecutionClockIndexState,
    code: ExecutionRuntimeCode,
    outcome: CommitOutcome = "rejected",
    pluginDataWarning = false,
  ): ExecutionCommandOutcome {
    const status = code === "runtime-stopping"
      ? "stopping"
      : clocks.kind === "degraded"
        || code === "plugin-data-failed"
        || code === "write-outcome-uncertain"
        || code === "time-review-required"
          ? "degraded"
          : "ready";
    return this.#outcome(
      intentId,
      outcome,
      this.#setSnapshot(status, clocks, code),
      undefined,
      code,
      pluginDataWarning,
    );
  }

  #outcome(
    intentId: string,
    outcome: CommitOutcome,
    snapshot: ExecutionRuntimeSnapshot,
    receipt?: CommitReceipt,
    code?: ExecutionRuntimeCode,
    pluginDataWarning = false,
  ): ExecutionCommandOutcome {
    return Object.freeze({
      intentId,
      outcome,
      snapshot,
      ...(receipt ? { receipt } : {}),
      ...(code ? { code } : {}),
      pluginDataWarning,
    });
  }

  #setSnapshot(
    status: ExecutionRuntimeStatus,
    clocks: ExecutionClockIndexState,
    code?: ExecutionRuntimeCode,
    forcePublish = false,
  ): ExecutionRuntimeSnapshot {
    const writeBlocked = this.#hardBlocked
      || this.#sessionBlocked
      || clocks.kind === "degraded"
      || this.#continuity.state?.kind === "time-review-required"
      || status === "starting"
      || status === "reconciling"
      || status === "stopping"
      || status === "stopped";
    this.#snapshot = Object.freeze({
      status,
      clocks,
      writeBlocked,
      pluginDataRevision: this.#pluginData.revision,
      ...(code ? { code } : {}),
    });
    if ((!this.#stopping || forcePublish) && this.#publishSnapshot) {
      try {
        this.#publishSnapshot(this.#snapshot);
      } catch {
        // A surface callback cannot change the authoritative command result.
      }
    }
    return this.#snapshot;
  }
}
