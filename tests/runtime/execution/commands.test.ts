import assert from "node:assert/strict";
import test from "node:test";

import {
  ExecutionCoordinator,
  type ExecutionClockReader,
  type ExecutionCommitter,
  type ExecutionMutationIntent,
} from "../../../src/runtime/execution/commands";
import type { ExecutionClockIndexState } from "../../../src/runtime/execution/clock-index";
import {
  DEFAULT_PLUGIN_DATA,
  DEFAULT_PLUGIN_SETTINGS,
  PluginDataStore,
  type PluginDataDocument,
  type PluginDataPort,
} from "../../../src/runtime/plugin-data";
import { ManualSystemClock } from "../../../src/runtime/system-clock";
import { createWriteResult } from "../../../src/workspace/conflicts";
import type { MutationExpectation } from "../../../src/workspace/expectation";
import type { MutationAction, MutationPlan } from "../../../src/workspace/mutations";
import { createCommitReceipt, type CommitOutcome, type CommitReceipt } from "../../../src/workspace/receipt";
import type { IndexedClockSource } from "../../../src/workspace/identity-index";

const CLOCK_A = "nl-clock-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLOCK_B = "nl-clock-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function idle(generation = 1): ExecutionClockIndexState {
  return Object.freeze({ kind: "idle", generation });
}

function active(
  ownerId = "task-a",
  startEpochMs = 1_000,
  clockId = CLOCK_A,
  generation = 1,
): ExecutionClockIndexState {
  const clock = Object.freeze({
    path: "Daily/2026-08-29.md",
    fromOffset: 10,
    toOffset: 20,
    text: "CLOCK",
    ownerId,
    clockId,
    scope: "accepted-logbook",
    parsed: Object.freeze({
      kind: "record",
      record: Object.freeze({ format: "canonical", state: "running", startEpochMs, clockId }),
      diagnostics: Object.freeze([]),
    }),
  }) as IndexedClockSource;
  return Object.freeze({ kind: "active", generation, clock, ownerId, startEpochMs });
}

function degraded(
  code: "multiple-running-clocks" | "potential-running-clock" | "clock-owner-invalid",
  generation = 1,
): ExecutionClockIndexState {
  return Object.freeze({ kind: "degraded", generation, code, count: 2, clocks: Object.freeze([]) });
}

class ScriptedClockReader implements ExecutionClockReader {
  readonly #states: ExecutionClockIndexState[];
  #last: ExecutionClockIndexState;
  scans = 0;

  constructor(states: readonly ExecutionClockIndexState[]) {
    if (states.length === 0) throw new Error("scripted reader requires one state");
    this.#states = [...states];
    this.#last = states[states.length - 1]!;
  }

  async scan(): Promise<ExecutionClockIndexState> {
    this.scans += 1;
    this.#last = this.#states.shift() ?? this.#last;
    return this.#last;
  }
}

class ScriptedCommitter implements ExecutionCommitter {
  readonly #receipts: CommitReceipt[];
  attempts: Array<{ readonly plan: MutationPlan; readonly expectation: MutationExpectation }> = [];

  constructor(receipts: readonly CommitReceipt[]) {
    this.#receipts = [...receipts];
  }

  async commit(plan: MutationPlan, expectation: MutationExpectation): Promise<CommitReceipt> {
    this.attempts.push({ plan, expectation });
    const receipt = this.#receipts.shift();
    if (!receipt) throw new Error("unscripted commit");
    return receipt;
  }
}

class BlockingCommitter implements ExecutionCommitter {
  readonly receipt: CommitReceipt;
  readonly entered: Promise<void>;
  readonly #gate: Promise<void>;
  #signalEntered!: () => void;
  #release!: () => void;
  attempts = 0;

  constructor(receipt: CommitReceipt) {
    this.receipt = receipt;
    this.entered = new Promise<void>((resolve) => { this.#signalEntered = resolve; });
    this.#gate = new Promise<void>((resolve) => { this.#release = resolve; });
  }

  async commit(): Promise<CommitReceipt> {
    this.attempts += 1;
    this.#signalEntered();
    await this.#gate;
    return this.receipt;
  }

  settle(): void {
    this.#release();
  }
}

class ToggleSavePort implements PluginDataPort {
  data: unknown;
  saveCount = 0;
  failSaves = false;

  constructor(data: unknown) {
    this.data = structuredClone(data);
  }

  async load(): Promise<unknown> {
    return structuredClone(this.data);
  }

  async save(data: PluginDataDocument): Promise<void> {
    this.saveCount += 1;
    if (this.failSaves) throw new Error("injected save failure");
    this.data = structuredClone(data);
  }
}

function pluginData(input: {
  enabled?: boolean;
  task?: number | null;
  standalone?: number | null;
} = {}): PluginDataDocument {
  return {
    ...DEFAULT_PLUGIN_DATA,
    settings: {
      ...DEFAULT_PLUGIN_SETTINGS,
      executionEnabled: input.enabled ?? true,
    },
    taskPomoStartEpochMs: input.task ?? null,
    standalonePomoStartEpochMs: input.standalone ?? null,
  };
}

function commitReceipt(
  intentId: string,
  action: MutationAction,
  outcome: CommitOutcome = "already-applied",
  code?: "action-no-longer-applicable" | "partial-switch" | "write-outcome-uncertain",
): CommitReceipt {
  const confirmation = outcome === "uncertain"
    ? "unconfirmed"
    : outcome === "failed-no-change"
      ? "confirmed-no-change"
      : outcome === "partial-safe"
        ? "partial"
        : outcome === "invariant-broken"
          ? "invariant-broken"
          : outcome === "applied" || outcome === "already-applied"
            ? "confirmed"
            : "not-required";
  return createCommitReceipt({
    intentId,
    action,
    outcome,
    ...(outcome === "applied" ? {
      sources: [{
        path: "Daily/2026-08-29.md",
        primitive: "vault-process" as const,
        before: {
          file: "Daily/2026-08-29.md",
          contentDigest: "0".repeat(64),
          contentLength: 0,
        },
        after: {
          file: "Daily/2026-08-29.md",
          contentDigest: "1".repeat(64),
          contentLength: 1,
        },
        locations: [{ line: 0 }],
      }],
    } : {}),
    confirmation,
    globalCheck: {
      status: outcome === "uncertain" ? "unavailable" : "confirmed",
      runningClockIds: [],
    },
    ...(code ? { result: createWriteResult(code, { action }) } : {}),
  });
}

function mutation(intentId: string, action: MutationAction): ExecutionMutationIntent {
  const plan = {
    intentId,
    action,
    stages: Object.freeze([]),
    expectedRunningClockIds: Object.freeze([]),
    settingsVersion: 1,
    zoneId: "UTC",
    previewToken: `preview-${intentId}`,
  } as MutationPlan;
  const expectation = {
    intentId,
    action,
    planItems: Object.freeze([]),
    clocks: Object.freeze([]),
    expectedRunningClockIds: Object.freeze([]),
    settingsVersion: 1,
    zoneId: "UTC",
    indexComplete: true,
    time: Object.freeze({
      wallEpochMs: 10_000,
      monotonicMs: 1_000,
      maximumDriftMs: 5_000,
      maximumQueueDelayMs: 1_000,
      discontinuity: false,
    }),
    previewToken: plan.previewToken,
    expectationToken: `expectation-${intentId}`,
  } as MutationExpectation;
  return Object.freeze({
    intentId,
    action,
    prepare: () => ({ kind: "prepared", mutation: { plan, expectation } }),
  });
}

function harness(input: {
  states: readonly ExecutionClockIndexState[];
  receipts?: readonly CommitReceipt[];
  data?: PluginDataDocument;
  epochMs?: number;
}) {
  const reader = new ScriptedClockReader(input.states);
  const committer = new ScriptedCommitter(input.receipts ?? []);
  const port = new ToggleSavePort(input.data ?? pluginData());
  const store = new PluginDataStore(port);
  const clock = new ManualSystemClock(input.epochMs ?? 10_000, "UTC", 1_000);
  const snapshots: string[] = [];
  const coordinator = new ExecutionCoordinator({
    clock,
    clockReader: reader,
    committer,
    pluginData: store,
    publish: (snapshot) => snapshots.push(snapshot.status),
  });
  return { coordinator, reader, committer, port, store, clock, snapshots };
}

test("TC-UP-CLK-04-001 startup scans and restores without a Markdown commit", async () => {
  const runtime = harness({ states: [active()], data: pluginData({ task: 500 }) });
  await runtime.coordinator.start();
  assert.equal(runtime.reader.scans, 1);
  assert.equal(runtime.committer.attempts.length, 0);
  assert.equal(runtime.store.data.taskPomoStartEpochMs, 500);
});

test("concurrent lifecycle starts share one scan and one result", async () => {
  const runtime = harness({ states: [idle()] });
  const first = runtime.coordinator.start();
  const second = runtime.coordinator.start();
  assert.strictEqual(second, first);
  const [firstSnapshot, secondSnapshot] = await Promise.all([first, second]);
  assert.strictEqual(secondSnapshot, firstSnapshot);
  assert.equal(runtime.reader.scans, 1);
  assert.equal(runtime.port.saveCount, 0);
});

test("a confirmed no-op stays inside the FIFO and never enters the committer", async () => {
  const runtime = harness({ states: [active(), active(undefined, undefined, undefined, 2)] });
  await runtime.coordinator.start();
  const outcome = await runtime.coordinator.dispatchMutation({
    intentId: "already-focused",
    action: "clock-in",
    prepare: () => ({ kind: "confirmed-no-op" }),
  });
  assert.equal(outcome.outcome, "already-applied");
  assert.equal(outcome.code, undefined);
  assert.equal(outcome.snapshot.clocks.kind, "active");
  assert.equal(runtime.committer.attempts.length, 0);
  assert.equal(runtime.reader.scans, 3);
});

test("a no-op loses authority when the confirmed CLOCK state changes", async () => {
  const runtime = harness({ states: [active(), active(), idle(3)] });
  await runtime.coordinator.start();
  const outcome = await runtime.coordinator.dispatchMutation({
    intentId: "stale-no-op",
    action: "clock-in",
    prepare: () => ({ kind: "confirmed-no-op" }),
  });
  assert.equal(outcome.outcome, "rejected");
  assert.equal(outcome.code, "action-no-longer-applicable");
  assert.equal(outcome.snapshot.clocks.kind, "idle");
  assert.equal(runtime.committer.attempts.length, 0);
});

test("TC-UP-CLK-01-001 Clock In commits once then publishes the confirmed CLOCK", async () => {
  const runtime = harness({
    states: [idle(), idle(2), active("task-a", 10_000, CLOCK_A, 3)],
    receipts: [commitReceipt("clock-in-a", "clock-in")],
  });
  await runtime.coordinator.start();
  const outcome = await runtime.coordinator.dispatchMutation(mutation("clock-in-a", "clock-in"));
  assert.equal(outcome.snapshot.clocks.kind, "active");
  assert.equal(runtime.committer.attempts.length, 1);
  assert.equal(runtime.store.data.taskPomoStartEpochMs, 10_000);
});

test("one activation intent is committed at most once across duplicate dispatchers", async () => {
  const runtime = harness({
    states: [idle(), idle(2), active("task-a", 10_000, CLOCK_A, 3)],
    receipts: [commitReceipt("duplicate-clock-in", "clock-in")],
  });
  await runtime.coordinator.start();
  const intent = mutation("duplicate-clock-in", "clock-in");
  const first = runtime.coordinator.dispatchMutation(intent);
  const duplicate = runtime.coordinator.dispatchMutation(intent);
  const outcomes = await Promise.all([first, duplicate]);
  assert.strictEqual(outcomes[1], outcomes[0]);
  assert.equal(runtime.committer.attempts.length, 1);
});

test("TC-UP-EXE-11-001 standalone-first same-tick ordering ends with CLOCK-only POMO", async () => {
  const runtime = harness({
    states: [idle(), idle(2), idle(3), idle(4), active("task-a", 10_000, CLOCK_A, 5)],
    receipts: [commitReceipt("same-tick-clock", "clock-in")],
  });
  await runtime.coordinator.start();
  const standalone = runtime.coordinator.startStandalonePomo("same-tick-pomo");
  const clockIn = runtime.coordinator.dispatchMutation(mutation("same-tick-clock", "clock-in"));
  await Promise.all([standalone, clockIn]);
  assert.deepEqual(
    [runtime.store.data.taskPomoStartEpochMs, runtime.store.data.standalonePomoStartEpochMs],
    [10_000, null],
  );
});

test("TC-UP-EXE-11-002 CLOCK-first same-tick ordering rejects standalone persistence", async () => {
  const runtime = harness({
    states: [idle(), idle(2), active("task-a", 10_000, CLOCK_A, 3), active("task-a", 10_000, CLOCK_A, 4)],
    receipts: [commitReceipt("clock-first", "clock-in")],
  });
  await runtime.coordinator.start();
  const clockIn = runtime.coordinator.dispatchMutation(mutation("clock-first", "clock-in"));
  const standalone = runtime.coordinator.startStandalonePomo("pomo-second");
  const [, pomoOutcome] = await Promise.all([clockIn, standalone]);
  assert.equal(pomoOutcome.outcome, "rejected");
  assert.deepEqual(
    [runtime.store.data.taskPomoStartEpochMs, runtime.store.data.standalonePomoStartEpochMs],
    [10_000, null],
  );
});

test("a rejected Clock In preserves a persisted standalone POMO", async () => {
  const runtime = harness({
    states: [idle(), idle(2), idle(3)],
    receipts: [commitReceipt("failed-clock", "clock-in", "rejected", "action-no-longer-applicable")],
    data: pluginData({ standalone: 500 }),
  });
  await runtime.coordinator.start();
  const outcome = await runtime.coordinator.dispatchMutation(mutation("failed-clock", "clock-in"));
  assert.equal(outcome.outcome, "rejected");
  assert.equal(runtime.store.data.standalonePomoStartEpochMs, 500);
  assert.equal(runtime.store.data.taskPomoStartEpochMs, null);
});

test("TC-UP-CLK-02-001 a confirmed switch preserves the original task POMO", async () => {
  const runtime = harness({
    states: [active(), active("task-a", 1_000, CLOCK_A, 2), active("task-b", 10_000, CLOCK_B, 3)],
    receipts: [commitReceipt("switch-b", "switch-task")],
    data: pluginData({ task: 500 }),
  });
  await runtime.coordinator.start();
  await runtime.coordinator.dispatchMutation(mutation("switch-b", "switch-task"));
  assert.equal(runtime.store.data.taskPomoStartEpochMs, 500);
});

test("TC-UP-CLK-02-002 one switch preparation receives one paired transition sample", async () => {
  const runtime = harness({
    states: [active(), active("task-a", 1_000, CLOCK_A, 2), active("task-b", 10_000, CLOCK_B, 3)],
    receipts: [commitReceipt("sampled-switch", "switch-task")],
    data: pluginData({ task: 500 }),
  });
  await runtime.coordinator.start();
  const intent = mutation("sampled-switch", "switch-task");
  const samples: Array<readonly [number, number]> = [];
  await runtime.coordinator.dispatchMutation({
    ...intent,
    prepare: (context) => {
      samples.push([context.sample.wallEpochMs, context.sample.monotonicMs]);
      return intent.prepare(context);
    },
  });
  assert.deepEqual(samples, [[10_000, 1_000]]);
});

test("TC-UP-CLK-02-003 rapid switches enter the committer in global FIFO order", async () => {
  const runtime = harness({
    states: [
      active(),
      active("task-a", 1_000, CLOCK_A, 2),
      active("task-b", 10_000, CLOCK_B, 3),
      active("task-b", 10_000, CLOCK_B, 4),
      active("task-c", 10_000, CLOCK_A, 5),
    ],
    receipts: [
      commitReceipt("switch-b-fifo", "switch-task"),
      commitReceipt("switch-c-fifo", "switch-task"),
    ],
    data: pluginData({ task: 500 }),
  });
  await runtime.coordinator.start();
  await Promise.all([
    runtime.coordinator.dispatchMutation(mutation("switch-b-fifo", "switch-task")),
    runtime.coordinator.dispatchMutation(mutation("switch-c-fifo", "switch-task")),
  ]);
  assert.deepEqual(runtime.committer.attempts.map(({ plan }) => plan.intentId), ["switch-b-fifo", "switch-c-fifo"]);
});

test("TC-UP-CLK-02-004 a partial cross-file switch publishes safe Idle and clears task POMO", async () => {
  const runtime = harness({
    states: [active(), active("task-a", 1_000, CLOCK_A, 2), idle(3)],
    receipts: [commitReceipt("partial-switch", "switch-task", "partial-safe", "partial-switch")],
    data: pluginData({ task: 500 }),
  });
  await runtime.coordinator.start();
  const outcome = await runtime.coordinator.dispatchMutation(mutation("partial-switch", "switch-task"));
  assert.equal(outcome.outcome, "partial-safe");
  assert.equal(outcome.snapshot.clocks.kind, "idle");
  assert.equal(runtime.store.data.taskPomoStartEpochMs, null);
});

test("TC-UP-CLK-03-001 Clock Out clears task POMO only after confirmed Idle", async () => {
  const runtime = harness({
    states: [active(), active("task-a", 1_000, CLOCK_A, 2), idle(3)],
    receipts: [commitReceipt("clock-out", "clock-out")],
    data: pluginData({ task: 500 }),
  });
  await runtime.coordinator.start();
  await runtime.coordinator.dispatchMutation(mutation("clock-out", "clock-out"));
  assert.equal(runtime.store.data.taskPomoStartEpochMs, null);
});

test("TC-UP-CLK-03-002 global Clock Out from Idle is confirmed without a Markdown stage", async () => {
  const runtime = harness({
    states: [idle(), idle(2), idle(3)],
    receipts: [commitReceipt("idle-clock-out", "clock-out")],
  });
  await runtime.coordinator.start();
  const outcome = await runtime.coordinator.dispatchMutation(mutation("idle-clock-out", "clock-out"));
  assert.equal(outcome.outcome, "already-applied");
  assert.equal(runtime.committer.attempts[0]?.plan.stages.length, 0);
  assert.equal(outcome.snapshot.clocks.kind, "idle");
});

test("TC-UP-CLK-03-003 an externally closed target stays idempotent and does not create POMO", async () => {
  const runtime = harness({
    states: [idle(), idle(2), idle(3)],
    receipts: [commitReceipt("externally-closed", "clock-out")],
  });
  await runtime.coordinator.start();
  const beforeSaves = runtime.port.saveCount;
  const outcome = await runtime.coordinator.dispatchMutation(mutation("externally-closed", "clock-out"));
  assert.equal(outcome.outcome, "already-applied");
  assert.equal(runtime.port.saveCount, beforeSaves);
});

test("TC-UP-CLK-05-001 completing another task leaves the focused POMO intact", async () => {
  const runtime = harness({
    states: [active(), active("task-a", 1_000, CLOCK_A, 2), active("task-a", 1_000, CLOCK_A, 3)],
    receipts: [commitReceipt("complete-b", "complete")],
    data: pluginData({ task: 500 }),
  });
  await runtime.coordinator.start();
  await runtime.coordinator.dispatchMutation(mutation("complete-b", "complete"));
  assert.equal(runtime.store.data.taskPomoStartEpochMs, 500);
});

test("TC-UP-CLK-05-002 completing the focused task clears POMO after confirmed Idle", async () => {
  const runtime = harness({
    states: [active(), active("task-a", 1_000, CLOCK_A, 2), idle(3)],
    receipts: [commitReceipt("complete-focused", "complete")],
    data: pluginData({ task: 500 }),
  });
  await runtime.coordinator.start();
  await runtime.coordinator.dispatchMutation(mutation("complete-focused", "complete"));
  assert.equal(runtime.store.data.taskPomoStartEpochMs, null);
});

test("TC-UP-CLK-05-003 rejected Complete preserves the focused task and POMO", async () => {
  const runtime = harness({
    states: [active(), active("task-a", 1_000, CLOCK_A, 2), active("task-a", 1_000, CLOCK_A, 3)],
    receipts: [commitReceipt("complete-rejected", "complete", "rejected", "action-no-longer-applicable")],
    data: pluginData({ task: 500 }),
  });
  await runtime.coordinator.start();
  const outcome = await runtime.coordinator.dispatchMutation(mutation("complete-rejected", "complete"));
  assert.equal(outcome.outcome, "rejected");
  assert.equal(runtime.store.data.taskPomoStartEpochMs, 500);
  assert.equal(outcome.snapshot.clocks.kind, "active");
});

test("TC-UP-CLK-05-004 a mismatched Complete receipt enters reconciliation", async () => {
  const runtime = harness({
    states: [active(), active("task-a", 1_000, CLOCK_A, 2), idle(3)],
    receipts: [commitReceipt("wrong-complete", "complete")],
    data: pluginData({ task: 500 }),
  });
  await runtime.coordinator.start();
  const outcome = await runtime.coordinator.dispatchMutation(mutation("expected-complete", "complete"));
  assert.equal(outcome.outcome, "uncertain");
  assert.equal(outcome.snapshot.status, "reconciling");
});

test("TC-UP-CLK-05-005 Execution Complete reports no spiral completion anchor", async () => {
  const runtime = harness({
    states: [active(), active("task-a", 1_000, CLOCK_A, 2), idle(3)],
    receipts: [commitReceipt("complete-without-anchor", "complete")],
    data: pluginData({ task: 500 }),
  });
  await runtime.coordinator.start();
  const outcome = await runtime.coordinator.dispatchMutation(mutation("complete-without-anchor", "complete"));
  assert.equal(outcome.receipt?.semanticChanges.includes("completion-anchor-inserted"), false);
});

test("TC-UP-CLK-02-005 uncertain switch results block later writes without retry", async () => {
  const runtime = harness({
    states: [idle(), idle(2), idle(3)],
    receipts: [commitReceipt("uncertain", "switch-task", "uncertain", "write-outcome-uncertain")],
  });
  await runtime.coordinator.start();
  const first = await runtime.coordinator.dispatchMutation(mutation("uncertain", "switch-task"));
  const second = await runtime.coordinator.dispatchMutation(mutation("blocked-later", "clock-in"));
  assert.equal(first.snapshot.status, "reconciling");
  assert.equal(second.code, "write-outcome-uncertain");
  assert.equal(runtime.committer.attempts.length, 1);
});

test("multiple and potential CLOCK states block ordinary writes before prepare or commit", async () => {
  for (const code of ["multiple-running-clocks", "potential-running-clock"] as const) {
    const runtime = harness({ states: [degraded(code), degraded(code, 2)] });
    await runtime.coordinator.start();
    let preparations = 0;
    const intent = mutation(`blocked-${code}`, "clock-in");
    const outcome = await runtime.coordinator.dispatchMutation({
      ...intent,
      prepare: (context) => {
        preparations += 1;
        return intent.prepare(context);
      },
    });
    assert.equal(outcome.code, code);
    assert.equal(preparations, 0);
    assert.equal(runtime.committer.attempts.length, 0);
  }
});

test("Timing Repair actions require the exact acknowledged preview", async () => {
  const runtime = harness({ states: [degraded("multiple-running-clocks"), degraded("multiple-running-clocks", 2)] });
  await runtime.coordinator.start();
  const outcome = await runtime.coordinator.dispatchMutation(mutation("repair", "repair-overlap"));
  assert.equal(outcome.code, "repair-confirmation-required");
  assert.equal(runtime.committer.attempts.length, 0);
});

test("Enable performs a read-only scan before one confirmed plugin-data save", async () => {
  const runtime = harness({ states: [idle(), idle(2)], data: pluginData({ enabled: false }) });
  await runtime.coordinator.start();
  const outcome = await runtime.coordinator.enableExecution("enable");
  assert.equal(outcome.outcome, "applied");
  assert.equal(runtime.store.data.settings.executionEnabled, true);
  assert.equal(runtime.committer.attempts.length, 0);
});

test("Disable confirms CLOCK close before one save clears POMOs and persists off", async () => {
  const runtime = harness({
    states: [active(), active("task-a", 1_000, CLOCK_A, 2), idle(3)],
    receipts: [commitReceipt("disable", "clock-out")],
    data: pluginData({ task: 500 }),
  });
  await runtime.coordinator.start();
  const beforeSaves = runtime.port.saveCount;
  const close = mutation("disable", "clock-out");
  const outcome = await runtime.coordinator.disableExecution({
    intentId: "disable",
    prepareClose: close.prepare,
  });
  assert.equal(outcome.snapshot.clocks.kind, "idle");
  assert.equal(runtime.store.data.settings.executionEnabled, false);
  assert.deepEqual(
    [runtime.store.data.taskPomoStartEpochMs, runtime.store.data.standalonePomoStartEpochMs],
    [null, null],
  );
  assert.equal(runtime.port.saveCount - beforeSaves, 1);
  assert.equal(outcome.outcome, "applied");
});

test("TC-UP-CLK-03-005 a post-Clock-Out POMO save failure warns without retrying Markdown", async () => {
  const runtime = harness({
    states: [active(), active("task-a", 1_000, CLOCK_A, 2), idle(3)],
    receipts: [commitReceipt("warning-clock-out", "clock-out")],
    data: pluginData({ task: 500 }),
  });
  await runtime.coordinator.start();
  runtime.port.failSaves = true;
  const outcome = await runtime.coordinator.dispatchMutation(mutation("warning-clock-out", "clock-out"));
  assert.equal(outcome.outcome, "already-applied");
  assert.equal(outcome.pluginDataWarning, true);
  assert.equal(outcome.code, "plugin-data-failed");
  assert.equal(runtime.committer.attempts.length, 1);
});

test("an unclassified standalone POMO save failure blocks later session transitions", async () => {
  const runtime = harness({ states: [idle(), idle(2)] });
  await runtime.coordinator.start();
  runtime.port.failSaves = true;
  const failed = await runtime.coordinator.startStandalonePomo("pomo-save-failed");
  const later = await runtime.coordinator.startStandalonePomo("pomo-later");
  assert.equal(failed.outcome, "uncertain");
  assert.equal(failed.code, "plugin-data-failed");
  assert.equal(later.code, "plugin-data-failed");
});

test("a mismatched committer receipt is treated as uncertain after the host call", async () => {
  const runtime = harness({
    states: [idle(), idle(2), idle(3)],
    receipts: [commitReceipt("other-intent", "clock-in")],
  });
  await runtime.coordinator.start();
  const outcome = await runtime.coordinator.dispatchMutation(mutation("expected-intent", "clock-in"));
  assert.equal(outcome.outcome, "uncertain");
  assert.equal(outcome.code, "write-outcome-uncertain");
  assert.equal(outcome.snapshot.status, "reconciling");
});

test("TC-UP-CLK-03-004 a wall-clock discontinuity freezes Clock Out until explicit recovery", async () => {
  const runtime = harness({ states: [active(), active("task-a", 1_000, CLOCK_A, 2)], data: pluginData({ task: 500 }) });
  await runtime.coordinator.start();
  runtime.clock.advanceMonotonicBy(1_000);
  runtime.clock.setWallTime(30_000);
  const outcome = await runtime.coordinator.dispatchMutation(mutation("time-blocked", "clock-out"));
  assert.equal(outcome.code, "time-review-required");
  assert.equal(runtime.committer.attempts.length, 0);
});

test("a recovery action is rejected before prepare when no time review is pending", async () => {
  const runtime = harness({ states: [active(), active("task-a", 1_000, CLOCK_A, 2)], data: pluginData({ task: 500 }) });
  await runtime.coordinator.start();
  const outcome = await runtime.coordinator.dispatchMutation(mutation("premature-recovery", "use-system-time"));
  assert.equal(outcome.code, "action-no-longer-applicable");
  assert.equal(runtime.committer.attempts.length, 0);
});

test("a future restored CLOCK blocks writes and cannot offer measured-elapsed recovery", async () => {
  const runtime = harness({
    states: [active("task-a", 20_000), active("task-a", 20_000, CLOCK_A, 2)],
    data: pluginData({ task: 20_000 }),
    epochMs: 10_000,
  });
  const started = await runtime.coordinator.start();
  assert.equal(started.code, "time-review-required");
  assert.equal(started.writeBlocked, true);
  const outcome = await runtime.coordinator.dispatchMutation(mutation("no-measured-recovery", "keep-measured-time"));
  assert.equal(outcome.code, "action-no-longer-applicable");
  assert.equal(runtime.committer.attempts.length, 0);
});

test("standalone keep-measured recovery rebases plugin data without Markdown", async () => {
  const runtime = harness({ states: [idle(), idle(2)], data: pluginData({ standalone: 500 }) });
  await runtime.coordinator.start();
  runtime.clock.advanceMonotonicBy(1_000);
  runtime.clock.setWallTime(30_000);
  const outcome = await runtime.coordinator.recoverStandalonePomo("pomo-keep", "keep-measured");
  assert.equal(outcome.outcome, "applied");
  assert.equal(runtime.store.data.standalonePomoStartEpochMs, 20_500);
  assert.equal(runtime.committer.attempts.length, 0);
});

test("standalone stop-at-trusted recovery clears POMO without Markdown", async () => {
  const runtime = harness({ states: [idle(), idle(2)], data: pluginData({ standalone: 500 }) });
  await runtime.coordinator.start();
  runtime.clock.advanceMonotonicBy(1_000);
  runtime.clock.setWallTime(30_000);
  const outcome = await runtime.coordinator.recoverStandalonePomo("pomo-stop", "stop-at-trusted");
  assert.equal(outcome.outcome, "applied");
  assert.equal(runtime.store.data.standalonePomoStartEpochMs, null);
  assert.equal(runtime.committer.attempts.length, 0);
});

test("ordinary standalone controls stay blocked while time review is pending", async () => {
  const runtime = harness({ states: [idle(), idle(2)], data: pluginData({ standalone: 500 }) });
  await runtime.coordinator.start();
  runtime.clock.advanceMonotonicBy(1_000);
  runtime.clock.setWallTime(30_000);
  const start = await runtime.coordinator.startStandalonePomo("pomo-restart-during-review");
  const stop = await runtime.coordinator.stopStandalonePomo("pomo-stop-during-review");
  assert.equal(start.code, "time-review-required");
  assert.equal(stop.code, "time-review-required");
  assert.equal(runtime.store.data.standalonePomoStartEpochMs, 500);
  assert.equal(runtime.port.saveCount, 0);
});

test("future standalone reload permits use-system but not invented measured elapsed", async () => {
  const runtime = harness({
    states: [idle(), idle(2), idle(3)],
    data: pluginData({ standalone: 20_000 }),
    epochMs: 10_000,
  });
  const started = await runtime.coordinator.start();
  assert.equal(started.code, "time-review-required");
  const measured = await runtime.coordinator.recoverStandalonePomo("future-measured", "keep-measured");
  assert.equal(measured.code, "action-no-longer-applicable");
  const accepted = await runtime.coordinator.recoverStandalonePomo("future-system", "use-system-time");
  assert.equal(accepted.outcome, "already-applied");
  assert.equal(accepted.snapshot.writeBlocked, false);
  assert.equal(runtime.store.data.standalonePomoStartEpochMs, 20_000);
});

test("unload rejects queued work before it can enter the host committer", async () => {
  const runtime = harness({ states: [idle()] });
  await runtime.coordinator.start();
  const firstStop = runtime.coordinator.stop();
  const secondStop = runtime.coordinator.stop();
  assert.strictEqual(secondStop, firstStop);
  await firstStop;
  const outcome = await runtime.coordinator.dispatchMutation(mutation("after-stop", "clock-in"));
  assert.equal(outcome.code, "runtime-stopping");
  assert.equal(runtime.committer.attempts.length, 0);
});

test("an entered commit settles on unload without stale publication or a false rejection", async () => {
  const reader = new ScriptedClockReader([idle(), idle(2)]);
  const committer = new BlockingCommitter(commitReceipt("in-flight", "clock-in", "applied"));
  const port = new ToggleSavePort(pluginData());
  const store = new PluginDataStore(port);
  const coordinator = new ExecutionCoordinator({
    clock: new ManualSystemClock(10_000, "UTC", 1_000),
    clockReader: reader,
    committer,
    pluginData: store,
  });
  await coordinator.start();
  const command = coordinator.dispatchMutation(mutation("in-flight", "clock-in"));
  await committer.entered;
  const stopped = coordinator.stop();
  committer.settle();
  const outcome = await command;
  await stopped;
  assert.equal(outcome.outcome, "applied");
  assert.equal(outcome.receipt?.intentId, "in-flight");
  assert.equal(outcome.code, "runtime-stopping");
  assert.equal(committer.attempts, 1);
  assert.equal(reader.scans, 2);
  assert.equal(port.saveCount, 0);
  assert.equal(coordinator.snapshot.status, "stopped");
});
