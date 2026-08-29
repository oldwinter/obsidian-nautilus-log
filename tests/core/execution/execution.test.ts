import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  decideExecutionCommand,
  type ExecutionClockFact,
  type ExecutionDecisionContext,
  type ExecutionTaskFact,
} from "../../../src/core/execution.ts";

const NOW = Date.UTC(2026, 7, 29, 10, 0, 0, 0);
const OWNER_A = "nl-11111111-1111-4111-8111-111111111111";
const OWNER_B = "nl-22222222-2222-4222-8222-222222222222";
const PLAN_NEW = "nl-33333333-3333-4333-8333-333333333333";
const CLOCK_A = "nl-clock-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLOCK_NEW = "nl-clock-bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CLOCK_ASSIGNED = "nl-clock-cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function task(overrides: Partial<ExecutionTaskFact> = {}): ExecutionTaskFact {
  return {
    path: "Daily/2026-08-29.md",
    ownerId: OWNER_A,
    kind: "flexible-task",
    status: "open",
    executionEligible: true,
    progress: { kind: "absent" },
    ...overrides,
  };
}

function clock(overrides: Partial<ExecutionClockFact> = {}): ExecutionClockFact {
  return {
    path: "Daily/2026-08-29.md",
    ownerId: OWNER_A,
    clockId: CLOCK_A,
    startEpochMs: NOW - 30 * 60_000,
    ...overrides,
  };
}

function context(overrides: Partial<ExecutionDecisionContext> = {}): ExecutionDecisionContext {
  return {
    clocks: { kind: "idle" },
    nowEpochMs: NOW,
    offsetMinutes: 480,
    generated: {
      planItemId: PLAN_NEW,
      openedClockId: CLOCK_NEW,
      closedClockId: CLOCK_ASSIGNED,
    },
    ...overrides,
  };
}

test("TC-UP-CLK-01-001 pure decision starts one CLOCK for an eligible task", () => {
  const decision = decideExecutionCommand({ type: "clock-in", target: task() }, context());
  assert.deepEqual(decision, {
    kind: "start",
    action: "clock-in",
    start: {
      target: task(),
      clockId: CLOCK_NEW,
      startEpochMs: NOW,
      offsetMinutes: 480,
    },
  });
  assert.ok(Object.isFrozen(decision));
  assert.ok(decision.kind === "start" && Object.isFrozen(decision.start.target.progress));
});

test("TC-UP-CLK-02-001 switch closes before opening at one transition instant", () => {
  const current = clock();
  const target = task({ path: "Daily/Other.md", ownerId: OWNER_B });
  const decision = decideExecutionCommand(
    { type: "clock-in", target },
    context({ clocks: { kind: "active", clock: current } }),
  );
  assert.equal(decision.kind, "switch");
  if (decision.kind !== "switch") return;
  assert.equal(decision.transitionEpochMs, NOW);
  assert.equal(decision.close.endEpochMs, NOW);
  assert.equal(decision.start.startEpochMs, NOW);
  assert.equal(decision.close.clock.clockId, CLOCK_A);
  assert.equal(decision.start.target.ownerId, OWNER_B);
});

test("TC-UP-CLK-01-003 reselecting the focused owner is a no-op", () => {
  const decision = decideExecutionCommand(
    { type: "clock-in", target: task() },
    context({ clocks: { kind: "active", clock: clock() } }),
  );
  assert.deepEqual(decision, {
    kind: "no-op",
    action: "clock-in",
    reason: "already-focused",
  });
});

test("TC-UP-CLK-03-001 Clock Out closes the active CLOCK and Idle is a no-op", () => {
  const active = decideExecutionCommand(
    { type: "clock-out" },
    context({ clocks: { kind: "active", clock: clock() } }),
  );
  assert.equal(active.kind, "stop");
  if (active.kind === "stop") {
    assert.equal(active.close.clock.clockId, CLOCK_A);
    assert.equal(active.close.endEpochMs, NOW);
  }
  assert.deepEqual(decideExecutionCommand({ type: "clock-out" }, context()), {
    kind: "no-op",
    action: "clock-out",
    reason: "already-idle",
  });
});

test("legacy idless CLOCK close requires and binds one generated identity", () => {
  const legacy = clock({ clockId: undefined, legacyStartOffsetMinutes: 480 });
  const missing = decideExecutionCommand(
    { type: "clock-out" },
    context({ clocks: { kind: "active", clock: legacy }, generated: {} }),
  );
  assert.deepEqual(missing, { kind: "rejected", code: "missing-generated-identity" });
  const prepared = decideExecutionCommand(
    { type: "clock-out" },
    context({ clocks: { kind: "active", clock: legacy } }),
  );
  assert.equal(prepared.kind, "stop");
  if (prepared.kind === "stop") assert.equal(prepared.close.assignedClockId, CLOCK_ASSIGNED);
});

test("a switch cannot reuse one generated identity for close and open", () => {
  const legacy = clock({ clockId: undefined });
  const decision = decideExecutionCommand(
    { type: "clock-in", target: task({ ownerId: OWNER_B }) },
    context({
      clocks: { kind: "active", clock: legacy },
      generated: { openedClockId: CLOCK_NEW, closedClockId: CLOCK_NEW },
    }),
  );
  assert.deepEqual(decision, { kind: "rejected", code: "generated-identity-collision" });
});

test("TC-UP-CLK-05-001..002 Complete closes only the focused task CLOCK", () => {
  const focused = decideExecutionCommand(
    { type: "complete", target: task() },
    context({ clocks: { kind: "active", clock: clock() } }),
  );
  assert.equal(focused.kind, "complete");
  if (focused.kind === "complete") assert.equal(focused.close?.clock.clockId, CLOCK_A);

  const other = decideExecutionCommand(
    { type: "complete", target: task({ ownerId: OWNER_B }) },
    context({ clocks: { kind: "active", clock: clock() } }),
  );
  assert.equal(other.kind, "complete");
  if (other.kind === "complete") assert.equal(other.close, undefined);
});

test("anonymous tasks require one generated owner identity", () => {
  const anonymous = task({ ownerId: undefined });
  const missing = decideExecutionCommand(
    { type: "clock-in", target: anonymous },
    context({ generated: { openedClockId: CLOCK_NEW } }),
  );
  assert.deepEqual(missing, { kind: "rejected", code: "missing-generated-identity" });
  const prepared = decideExecutionCommand({ type: "clock-in", target: anonymous }, context());
  assert.equal(prepared.kind, "start");
  if (prepared.kind === "start") assert.equal(prepared.start.assignedOwnerId, PLAN_NEW);
});

test("plain, done, fixed, and otherwise ineligible tasks never produce an execution write", () => {
  const targets: ExecutionTaskFact[] = [
    task({ status: "plain" }),
    task({ status: "done" }),
    task({ kind: "fixed-event", executionEligible: false }),
    task({ executionEligible: false }),
  ];
  for (const target of targets) {
    assert.deepEqual(
      decideExecutionCommand({ type: "clock-in", target }, context()),
      { kind: "rejected", code: "task-not-executable" },
    );
  }
});

test("degraded CLOCK facts reject every Markdown-affecting command before decision", () => {
  const degraded = context({
    clocks: { kind: "degraded", code: "potential-running-clock" },
  });
  assert.deepEqual(
    decideExecutionCommand({ type: "clock-in", target: task() }, degraded),
    { kind: "rejected", code: "clock-state-degraded" },
  );
  assert.deepEqual(
    decideExecutionCommand({ type: "complete", target: task() }, degraded),
    { kind: "rejected", code: "clock-state-degraded" },
  );
});

test("progress advances, completes with a focused close, and reopens exact states", () => {
  const advanced = decideExecutionCommand(
    {
      type: "advance-or-reopen-progress",
      target: task({ progress: { kind: "known", percent: 20 } }),
      logicalMinute: 600,
    },
    context(),
  );
  assert.equal(advanced.kind, "advance-progress");
  if (advanced.kind === "advance-progress") assert.equal(advanced.close, undefined);

  const completed = decideExecutionCommand(
    {
      type: "advance-or-reopen-progress",
      target: task({ progress: { kind: "known", percent: 90 } }),
      logicalMinute: 601,
    },
    context({ clocks: { kind: "active", clock: clock() } }),
  );
  assert.equal(completed.kind, "advance-progress");
  if (completed.kind === "advance-progress") assert.equal(completed.close?.endEpochMs, NOW);

  const reopened = decideExecutionCommand(
    {
      type: "advance-or-reopen-progress",
      target: task({ status: "done", executionEligible: false }),
      logicalMinute: 602,
    },
    context(),
  );
  assert.equal(reopened.kind, "reopen-progress");
});

test("unknown and done-with-progress facts reject instead of guessing", () => {
  for (const target of [
    task({ progress: { kind: "unknown" } }),
    task({ status: "done", executionEligible: false, progress: { kind: "known", percent: 100 } }),
  ]) {
    assert.deepEqual(
      decideExecutionCommand({
        type: "advance-or-reopen-progress",
        target,
        logicalMinute: 600,
      }, context()),
      { kind: "rejected", code: "progress-conflict" },
    );
  }
});

test("TC-UP-CLK-06-001 Delete requires the exact current CLOCK and confirmation", () => {
  const target = clock();
  const current = context({ clocks: { kind: "active", clock: target } });
  assert.deepEqual(
    decideExecutionCommand({ type: "delete-clock", target }, current),
    { kind: "rejected", code: "delete-confirmation-required" },
  );
  const confirmation = {
    firstActivationEpochMs: NOW - 1_000,
    secondActivationEpochMs: NOW,
    firstTargetKey: CLOCK_A,
    secondTargetKey: CLOCK_A,
  };
  const decision = decideExecutionCommand({ type: "delete-clock", target, confirmation }, current);
  assert.equal(decision.kind, "delete");
  assert.ok(decision.kind === "delete" && Object.isFrozen(decision.confirmation));
  const stale = decideExecutionCommand(
    { type: "delete-clock", target: clock({ startEpochMs: NOW - 60_000 }), confirmation },
    current,
  );
  assert.deepEqual(stale, { kind: "rejected", code: "target-not-current" });
});

test("decision inputs are copied and invalid time facts fail closed", () => {
  const mutableProgress = { kind: "absent" } as {
    kind: "absent" | "known";
    percent?: number;
  };
  const mutable = task({ progress: mutableProgress });
  const decision = decideExecutionCommand({ type: "clock-in", target: mutable }, context());
  mutableProgress.kind = "known";
  mutableProgress.percent = 70;
  assert.ok(decision.kind === "start" && decision.start.target.progress.kind === "absent");
  assert.throws(
    () => decideExecutionCommand({ type: "clock-in", target: task() }, context({ nowEpochMs: 1.5 })),
    /safe integer/,
  );
  assert.throws(
    () => decideExecutionCommand({
      type: "advance-or-reopen-progress",
      target: task(),
      logicalMinute: 1_440,
    }, context()),
    /local day/,
  );
});

test("pure command decisions contain no direct global clock or host dependency", async () => {
  const source = await readFile("src/core/execution.ts", "utf8");
  assert.doesNotMatch(source, /\bDate\.(?:now|UTC)|new Date|performance\.|setTimeout|from ["']obsidian["']/);
});
