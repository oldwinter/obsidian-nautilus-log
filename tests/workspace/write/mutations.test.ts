import assert from "node:assert/strict";
import test from "node:test";

import {
  applyAllowedByteEdits,
  createMutationPlan,
  deleteConfirmationIsCurrent,
} from "../../../src/workspace/mutations.ts";

test("TC-OBS-SAFE-001-001 strict byte edits preserve every byte outside the allowlist", () => {
  const before = "\uFEFFfront\r\n* [ ] [[Task|label]] #tag [due:: 2026-08-28]  ^id\r\n\tchild\r\n";
  const fromOffset = before.indexOf("[ ]");
  const applied = applyAllowedByteEdits(before, [{
    fromOffset,
    toOffset: fromOffset + 3,
    expected: "[ ]",
    replacement: "[x]",
    semanticChange: "task-completed",
  }]);
  assert.equal(
    applied.text,
    "\uFEFFfront\r\n* [x] [[Task|label]] #tag [due:: 2026-08-28]  ^id\r\n\tchild\r\n",
  );
  assert.deepEqual(applied.semanticChanges, ["task-completed"]);
});

test("TC-OBS-SAFE-001-002 allowlist rejects stale or overlapping edits without producing bytes", () => {
  const before = "0123456789";
  assert.throws(() => applyAllowedByteEdits(before, [{
    fromOffset: 2,
    toOffset: 4,
    expected: "stale",
    replacement: "xx",
    semanticChange: "progress-updated",
  }]), /expected source/);
  assert.throws(() => applyAllowedByteEdits(before, [{
    fromOffset: 2,
    toOffset: 6,
    expected: "2345",
    replacement: "a",
    semanticChange: "progress-updated",
  }, {
    fromOffset: 4,
    toOffset: 7,
    expected: "456",
    replacement: "b",
    semanticChange: "progress-updated",
  }]), /overlapping/);
  assert.equal(before, "0123456789");
});

test("UP-CLK-06 delete confirmation binds the same exact CLOCK within 2.5 seconds", () => {
  assert.equal(deleteConfirmationIsCurrent({
    firstActivationEpochMs: 1_000,
    secondActivationEpochMs: 3_500,
    firstTargetKey: "nl-clock-a",
    secondTargetKey: "nl-clock-a",
  }), true);
  assert.equal(deleteConfirmationIsCurrent({
    firstActivationEpochMs: 1_000,
    secondActivationEpochMs: 3_501,
    firstTargetKey: "nl-clock-a",
    secondTargetKey: "nl-clock-a",
  }), false);
  assert.equal(deleteConfirmationIsCurrent({
    firstActivationEpochMs: 1_000,
    secondActivationEpochMs: 1_001,
    firstTargetKey: "nl-clock-a",
    secondTargetKey: "nl-clock-b",
  }), false);
});

test("switch plans require one shared transition instant and at most two ordered stages", () => {
  assert.throws(() => createMutationPlan({
    intentId: "intent-switch",
    action: "switch-task",
    stages: [{
      path: "today.md",
      confirmationRequired: true,
      operations: [{
        kind: "clock-out",
        target: { kind: "clock", id: "nl-clock-old" },
        close: { clockId: "nl-clock-old", endEpochMs: 1, offsetMinutes: 0 },
      }],
    }],
    expectedRunningClockIds: ["nl-clock-old"],
    settingsVersion: 1,
    zoneId: "UTC",
  }), /transition instant/);

  const plan = createMutationPlan({
    intentId: "intent-switch",
    action: "switch-task",
    stages: [{
      path: "a.md",
      confirmationRequired: true,
      operations: [{
        kind: "clock-out",
        target: { kind: "clock", id: "nl-clock-old" },
        close: { clockId: "nl-clock-old", endEpochMs: 1, offsetMinutes: 0 },
      }],
    }, {
      path: "b.md",
      confirmationRequired: true,
      operations: [{
        kind: "clock-in",
        target: { kind: "plan-item", id: "task-b" },
        clock: { clockId: "nl-clock-new", startEpochMs: 1, offsetMinutes: 0 },
      }],
    }],
    expectedRunningClockIds: ["nl-clock-old"],
    settingsVersion: 1,
    zoneId: "UTC",
    transitionEpochMs: 1,
  });
  assert.equal(plan.transitionEpochMs, 1);
  assert.equal(plan.stages.length, 2);
  assert.equal(Object.isFrozen(plan.stages), true);
});

test("single-target actions reject smuggled extra operations while empty global Clock Out is representable", () => {
  assert.throws(() => createMutationPlan({
    intentId: "multi-complete",
    action: "complete",
    stages: [{
      path: "today.md",
      confirmationRequired: false,
      operations: [
        { kind: "complete", target: { kind: "plan-item", id: "task-a" } },
        { kind: "complete", target: { kind: "plan-item", id: "task-b" } },
      ],
    }],
    expectedRunningClockIds: [],
    settingsVersion: 1,
    zoneId: "UTC",
  }), /exactly one stage and one operation/);

  const noActive = createMutationPlan({
    intentId: "global-clock-out-idle",
    action: "clock-out",
    stages: [],
    expectedRunningClockIds: [],
    settingsVersion: 1,
    zoneId: "UTC",
  });
  assert.equal(noActive.stages.length, 0);
});

test("Mutation Plans deep-clone and freeze nested operation facts", () => {
  const close = { clockId: "nl-clock-old", endEpochMs: 10, offsetMinutes: 0 };
  const input = {
    intentId: "frozen-plan",
    action: "clock-out" as const,
    stages: [{
      path: "today.md",
      confirmationRequired: false,
      operations: [{ kind: "clock-out" as const, target: { kind: "clock" as const, id: "nl-clock-old" }, close }],
    }],
    expectedRunningClockIds: ["nl-clock-old"],
    settingsVersion: 1,
    zoneId: "UTC",
  };
  const frozen = createMutationPlan(input);
  close.endEpochMs = 99;
  assert.equal((frozen.stages[0]!.operations[0] as { readonly close: { readonly endEpochMs: number } }).close.endEpochMs, 10);
  assert.equal(Object.isFrozen(frozen.stages[0]!.operations[0]), true);
  assert.equal(Object.isFrozen((frozen.stages[0]!.operations[0] as { readonly target: object }).target), true);
});
