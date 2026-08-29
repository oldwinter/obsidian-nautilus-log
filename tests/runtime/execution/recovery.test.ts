import assert from "node:assert/strict";
import test from "node:test";

import {
  acknowledgeTimingRepair,
  createTimingRepairPreview,
  timingRepairIsAcknowledged,
  type TimingRepairTarget,
} from "../../../src/runtime/execution/recovery";
import type { ExecutionClockIndexState } from "../../../src/runtime/execution/clock-index";
import {
  createMutationExpectation,
  expectationMatchesPlan,
  type MutationExpectation,
} from "../../../src/workspace/expectation";
import {
  createMutationPlan,
  createMutationPreviewToken,
  type MutationPlan,
} from "../../../src/workspace/mutations";

const DEGRADED: ExecutionClockIndexState = Object.freeze({
  kind: "degraded",
  generation: 1,
  code: "multiple-running-clocks",
  count: 2,
  clocks: Object.freeze([]),
});

const CLOCK_ID = "nl-clock-aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function repair(paths: readonly string[] = ["Daily/A.md"], confirmationRequired = true): {
  readonly plan: MutationPlan;
  readonly expectation: MutationExpectation;
} {
  const validPlan = createMutationPlan({
    intentId: "repair-overlap",
    action: "repair-overlap",
    stages: paths.map((path) => ({
      path,
      operations: [{
        kind: "clock-out",
        target: { kind: "clock", id: CLOCK_ID },
        close: { clockId: CLOCK_ID, endEpochMs: 1_000, offsetMinutes: 0 },
      }],
      confirmationRequired: true,
    })),
    expectedRunningClockIds: [CLOCK_ID],
    settingsVersion: 7,
    zoneId: "UTC",
  });
  const unconfirmedPlan = {
    ...validPlan,
    stages: Object.freeze(validPlan.stages.map((stage) => Object.freeze({
      ...stage,
      confirmationRequired: false,
    }))),
  };
  const plan: MutationPlan = confirmationRequired ? validPlan : Object.freeze({
    ...unconfirmedPlan,
    previewToken: createMutationPreviewToken(unconfirmedPlan),
  });
  const expectation = createMutationExpectation({
    intentId: plan.intentId,
    action: plan.action,
    planItems: [],
    clocks: [],
    expectedRunningClockIds: [CLOCK_ID],
    settingsVersion: plan.settingsVersion,
    zoneId: plan.zoneId,
    indexComplete: true,
    time: {
      wallEpochMs: 1_000,
      monotonicMs: 1_000,
      maximumDriftMs: 5_000,
      maximumQueueDelayMs: 1_000,
      discontinuity: false,
    },
    previewToken: plan.previewToken,
  });
  return { plan, expectation };
}

function target(path = "Daily/A.md", fromOffset = 0, toOffset = 3): TimingRepairTarget {
  return Object.freeze({
    path,
    fromOffset,
    toOffset,
    expectedText: "old".slice(0, toOffset - fromOffset),
    replacementText: "new",
  });
}

test("Timing Repair requires degraded state and supported confirmed stages", () => {
  const mutation = repair();
  assert.throws(() => createTimingRepairPreview(
    { kind: "idle", generation: 1 },
    mutation.plan,
    mutation.expectation,
    [target()],
  ), /degraded/);
  const unconfirmed = repair(["Daily/A.md"], false);
  assert.throws(() => createTimingRepairPreview(
    DEGRADED,
    unconfirmed.plan,
    unconfirmed.expectation,
    [target()],
  ), /valid plan/);
});

test("Timing Repair preview covers every planned file and rejects overlapping spans", () => {
  const mutation = repair(["Daily/A.md", "Daily/B.md"]);
  assert.throws(() => createTimingRepairPreview(
    DEGRADED,
    mutation.plan,
    mutation.expectation,
    [target()],
  ), /cover exactly/);

  const preview = createTimingRepairPreview(DEGRADED, mutation.plan, mutation.expectation, [
    target("Daily/B.md"),
    target("Daily/A.md"),
  ]);
  assert.deepEqual(preview.targets.map(({ path }) => path), ["Daily/A.md", "Daily/B.md"]);

  const first = repair();
  assert.throws(() => createTimingRepairPreview(DEGRADED, first.plan, first.expectation, [
    target("Daily/A.md", 0, 3),
    target("Daily/A.md", 2, 3),
  ]), /must not overlap/);
});

test("Timing Repair acknowledgment binds the exact frozen preview token", () => {
  const mutation = repair();
  const preview = createTimingRepairPreview(DEGRADED, mutation.plan, mutation.expectation, [target()]);
  const changedPreview = createTimingRepairPreview(
    DEGRADED,
    mutation.plan,
    mutation.expectation,
    [target("Daily/A.md", 1, 3)],
  );
  assert.notEqual(changedPreview.confirmationToken, preview.confirmationToken);
  assert.equal(timingRepairIsAcknowledged(preview), false);
  assert.throws(() => acknowledgeTimingRepair(preview, "stale-token"), /does not match/);
  const acknowledged = acknowledgeTimingRepair(preview, preview.confirmationToken);
  assert.notStrictEqual(acknowledged, preview);
  assert.equal(timingRepairIsAcknowledged(preview), false);
  assert.equal(timingRepairIsAcknowledged(acknowledged), true);
  assert.equal(expectationMatchesPlan(acknowledged.expectation, acknowledged.plan), true);
  assert.equal(Object.isFrozen(preview.targets), true);
  assert.equal(Object.isFrozen(preview.targets[0]), true);
});
