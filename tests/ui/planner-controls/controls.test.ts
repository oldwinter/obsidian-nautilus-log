import assert from "node:assert/strict";
import test from "node:test";

import {
  FORBIDDEN_LATER_MAIN_PLANNER_CONTROLS,
  bindPlannerProgressTarget,
  createMemoryPlannerCollapseStore,
  createPlannerControls,
  createPlannerDebugStore,
  dispatchPlannerProgress,
  plannerProgressPreview,
  type PlannerProgressTarget,
} from "../../../src/ui/planner/controls.ts";

function target(overrides: Partial<PlannerProgressTarget> = {}): PlannerProgressTarget {
  return Object.freeze({
    authoritative: true,
    blockId: "nl-task",
    dayRelation: "today",
    executionEligible: true,
    itemId: "task",
    kind: "flexible-task",
    path: "Journal/2026-08-28.md",
    progress: Object.freeze({ present: true, rawPercent: 0 }),
    sourceOrder: 1,
    status: "open",
    title: "Draft",
    ...overrides,
  });
}

test("TC-UP-CTL-01-001 completed visibility starts shown and remains independent per planner", () => {
  const first = createPlannerControls({ instanceId: "first" });
  const second = createPlannerControls({ instanceId: "second" });
  assert.equal(first.state.showCompleted, true);
  assert.equal(second.state.showCompleted, true);
  first.toggleCompleted();
  assert.equal(first.state.showCompleted, false);
  assert.equal(second.state.showCompleted, true);
  first.destroy();
  second.destroy();
});

test("TC-UP-CTL-03-001 collapse state is keyed by renderer identity and only same identity restores it", () => {
  const collapseStore = createMemoryPlannerCollapseStore();
  const first = createPlannerControls({ instanceId: "planner-a", collapseStore });
  first.toggleCollapsed();
  first.destroy();
  const restored = createPlannerControls({ instanceId: "planner-a", collapseStore });
  const independent = createPlannerControls({ instanceId: "planner-b", collapseStore });
  assert.equal(restored.state.collapsed, true);
  assert.equal(independent.state.collapsed, false);
  restored.destroy();
  independent.destroy();
});

test("TC-UP-CTL-03-001 failed collapse persistence leaves confirmed presentation unchanged", () => {
  const controls = createPlannerControls({
    instanceId: "failing-store",
    collapseStore: {
      load: () => false,
      save: () => { throw new Error("storage failed"); },
    },
  });
  assert.throws(() => controls.toggleCollapsed(), /storage failed/);
  assert.equal(controls.state.collapsed, false);
  controls.destroy();
});

test("TC-UP-CTL-02-001 playback control rejects repeat starts until finish", () => {
  const controls = createPlannerControls({ instanceId: "playback" });
  assert.equal(controls.startPlayback(), true);
  assert.equal(controls.state.playbackRunning, true);
  assert.equal(controls.startPlayback(), false);
  assert.equal(controls.finishPlayback(), true);
  assert.equal(controls.state.playbackRunning, false);
  controls.destroy();
});

test("TC-UP-CTL-04-001 raw progress boundaries advance, complete, clear, reopen, and conflict", () => {
  const cases = [
    [target({ progress: { present: false } }), { outcome: "advanced", percent: 10 }],
    [target({ progress: { present: true, rawPercent: 0 } }), { outcome: "advanced", percent: 10 }],
    [target({ progress: { present: true, rawPercent: 25 } }), { outcome: "advanced", percent: 35 }],
    [target({ progress: { present: true, rawPercent: 85 } }), { outcome: "advanced", percent: 95 }],
    [target({ progress: { present: true, rawPercent: 90 } }), { outcome: "completed", percent: 100 }],
    [target({ progress: { present: true, rawPercent: 95 } }), { outcome: "cleared" }],
    [target({ progress: { present: true, rawPercent: 100 } }), { outcome: "cleared" }],
    [target({ progress: { present: true, rawPercent: 105 } }), { outcome: "cleared" }],
    [target({ status: "done", executionEligible: false, progress: { present: false } }), {
      outcome: "reopened",
      percent: 10,
    }],
    [target({ status: "done", executionEligible: false, progress: { present: true, rawPercent: 20 } }), {
      outcome: "conflict",
      reason: "done-with-progress",
    }],
  ] as const;
  for (const [input, expected] of cases) assert.deepEqual(plannerProgressPreview(input), expected);
  assert.equal(plannerProgressPreview(target({ progress: { present: true, rawPercent: -1 } })), null);
  assert.equal(plannerProgressPreview(target({ progress: { present: true, rawPercent: 0.5 } })), null);
});

test("TC-UP-CTL-04-001 progress dispatch emits one explicit intent and never mutates source", () => {
  const sourceTarget = target({ progress: { present: true, rawPercent: 40 } });
  const before = structuredClone(sourceTarget);
  const dispatched: unknown[] = [];
  assert.equal(dispatchPlannerProgress(sourceTarget, (value) => dispatched.push(value), () => "intent-1"), true);
  assert.equal(dispatched.length, 1);
  assert.deepEqual(sourceTarget, before);
  assert.deepEqual(dispatched[0], {
    intent: {
      intentId: "intent-1",
      type: "advance-or-reopen-progress",
      target: {
        blockId: "nl-task",
        itemId: "task",
        path: "Journal/2026-08-28.md",
        sourceOrder: 1,
      },
    },
    preview: { outcome: "advanced", percent: 50 },
    target: sourceTarget,
  });
});

test("TC-UP-CTL-04-001 DONE with retained progress dispatches a conflict preview without guessing", () => {
  const dispatched: unknown[] = [];
  assert.equal(dispatchPlannerProgress(target({
    status: "done",
    executionEligible: false,
    progress: { present: true, rawPercent: 20 },
  }), (value) => dispatched.push(value), () => "intent-conflict"), true);
  assert.deepEqual((dispatched[0] as { preview: unknown }).preview, {
    outcome: "conflict",
    reason: "done-with-progress",
  });
});

test("TC-UP-CTL-04-001 unknown production progress still blocks ineligible open tasks", () => {
  const unknown = { present: "unknown", projectedPercent: 30 } as const;
  assert.equal(plannerProgressPreview(target({ progress: unknown, executionEligible: false })), null);
  assert.deepEqual(plannerProgressPreview(target({ progress: unknown })), { outcome: "pending" });
  assert.deepEqual(plannerProgressPreview(target({
    progress: unknown,
    status: "done",
    executionEligible: false,
  })), { outcome: "pending" });
});

test("TC-UP-CTL-04-001 non-today, stale, fixed, plain, and ineligible targets dispatch nothing", () => {
  const invalid = [
    target({ dayRelation: "past" }),
    target({ dayRelation: "future" }),
    target({ authoritative: false }),
    target({ kind: "fixed-event" }),
    target({ status: "plain" }),
    target({ executionEligible: false }),
  ];
  for (const candidate of invalid) {
    assert.equal(dispatchPlannerProgress(candidate, () => assert.fail("unexpected dispatch")), false);
  }
});

test("TC-UP-CTL-05-001 debug state is shared, memory-only, and gated from ordinary planners", () => {
  const debugStore = createPlannerDebugStore();
  const debug = createPlannerControls({ instanceId: "debug", debugControl: true, debugStore });
  const observer = createPlannerControls({ instanceId: "observer", debugStore });
  assert.equal(observer.toggleDebug(), false);
  assert.equal(debug.toggleDebug(), true);
  assert.equal(debug.state.debugEnabled, true);
  assert.equal(observer.state.debugEnabled, true);
  debug.destroy();
  observer.destroy();
  assert.equal(createPlannerDebugStore().enabled, false);
});

test("TC-UP-DRF-06-001 v1.0.2 control surface explicitly excludes Tidy and Undo", () => {
  assert.deepEqual(FORBIDDEN_LATER_MAIN_PLANNER_CONTROLS, ["tidy", "undo"]);
});

test("TC-OBS-A11Y-001-004 progress pointer and shared keyboard activation dispatch equally", () => {
  class FakeTarget extends EventTarget {
    readonly tagName = "g";
    readonly attributes = new Map<string, string>();
    setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  }
  const element = new FakeTarget();
  const dispatched: unknown[] = [];
  const unbind = bindPlannerProgressTarget(
    element as unknown as SVGElement,
    () => target(),
    (progress) => dispatched.push(progress),
    () => `intent-${dispatched.length + 1}`,
  );
  for (const key of ["Enter", " ", "Spacebar"]) {
    const event = new Event("keydown", { cancelable: true });
    Object.defineProperties(event, { key: { value: key }, repeat: { value: false } });
    assert.equal(element.dispatchEvent(event), false);
  }
  element.dispatchEvent(new Event("click"));
  const repeat = new Event("keydown", { cancelable: true });
  Object.defineProperties(repeat, { key: { value: "Enter" }, repeat: { value: true } });
  element.dispatchEvent(repeat);
  assert.equal(dispatched.length, 4);
  assert.equal(element.attributes.get("role"), "button");
  unbind();
  element.dispatchEvent(new Event("click"));
  assert.equal(dispatched.length, 4);
});

test("TC-OBS-A11Y-001-004 nonactionable progress targets expose information without activation", () => {
  class FakeTarget extends EventTarget {
    readonly tagName = "g";
    readonly attributes = new Map<string, string>();
    setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  }
  const element = new FakeTarget();
  const unbind = bindPlannerProgressTarget(
    element as unknown as SVGElement,
    () => target({ kind: "fixed-event" }),
    () => assert.fail("nonactionable target dispatched"),
  );
  const key = new Event("keydown", { cancelable: true });
  Object.defineProperties(key, { key: { value: "Enter" }, repeat: { value: false } });
  assert.equal(element.dispatchEvent(key), true);
  assert.equal(key.defaultPrevented, false);
  element.dispatchEvent(new Event("click"));
  assert.equal(element.attributes.get("role"), "img");
  assert.equal(element.attributes.get("tabindex"), "0");
  unbind();
});
