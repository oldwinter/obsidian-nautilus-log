import assert from "node:assert/strict";
import test from "node:test";

import {
  DeleteClockConfirmationController,
  isForgotten,
  projectExecutionState,
  projectRecentTasks,
} from "../../../src/runtime/execution/execution-state";
import type { ActiveClockIndexState } from "../../../src/runtime/execution/clock-index";
import type { IndexedClockSource } from "../../../src/workspace/identity-index";

const CLOCK = Object.freeze({
  path: "Daily.md",
  fromOffset: 0,
  toOffset: 1,
  text: "x",
  ownerId: "task-a",
  clockId: "clock-a",
  scope: "accepted-logbook",
  parsed: Object.freeze({
    kind: "record",
    record: Object.freeze({ format: "canonical", state: "running", startEpochMs: 1_000, clockId: "clock-a" }),
    diagnostics: Object.freeze([]),
  }),
}) as IndexedClockSource;

const ACTIVE: ActiveClockIndexState = Object.freeze({
  kind: "active",
  generation: 1,
  clock: CLOCK,
  ownerId: "task-a",
  startEpochMs: 1_000,
});

test("TC-UP-CLK-01-001 one eligible CLOCK projects one focused task", () => {
  const state = projectExecutionState(ACTIVE, 2_000, null, 120);
  assert.deepEqual(state.kind === "active" ? [state.ownerId, state.elapsedMs] : [], ["task-a", 1_000]);
});

test("TC-UP-CLK-01-002 active projection adopts CLOCK start for a missing task POMO", () => {
  const state = projectExecutionState(ACTIVE, 2_000, null, 120);
  assert.equal(state.kind === "active" ? state.taskPomoStartEpochMs : undefined, 1_000);
});

test("TC-UP-CLK-01-003 active projection preserves an earlier task POMO across a switch", () => {
  const state = projectExecutionState(ACTIVE, 2_000, 500, 120);
  assert.equal(state.kind === "active" ? state.taskPomoStartEpochMs : undefined, 500);
});

test("TC-UP-CLK-01-004 idle projection exposes no focused identity", () => {
  assert.deepEqual(projectExecutionState({ kind: "idle", generation: 1 }, 2_000, null, 120), { kind: "idle" });
});

test("TC-UP-CLK-01-005 degraded projection exposes only a stable safe code and count", () => {
  const state = projectExecutionState({ kind: "degraded", generation: 1, code: "multiple-running-clocks", count: 2, clocks: [] }, 2_000, null, 120);
  assert.deepEqual(state, { kind: "degraded", code: "multiple-running-clocks", count: 2 });
});

test("TC-UP-CLK-06-001 first delete activation only arms confirmation", () => {
  const controller = new DeleteClockConfirmationController();
  assert.equal(controller.activate("clock-a", 1_000), "armed");
});

test("TC-UP-CLK-06-002 second activation of the same CLOCK within 2500 ms confirms", () => {
  const controller = new DeleteClockConfirmationController();
  controller.activate("clock-a", 1_000);
  assert.equal(controller.activate("clock-a", 3_500), "confirmed");
});

test("TC-UP-CLK-06-003 confirmation expires after 2500 ms", () => {
  const controller = new DeleteClockConfirmationController();
  controller.activate("clock-a", 1_000);
  assert.equal(controller.activate("clock-a", 3_501), "armed");
});

test("TC-UP-CLK-06-004 a changed CLOCK target re-arms instead of deleting", () => {
  const controller = new DeleteClockConfirmationController();
  controller.activate("clock-a", 1_000);
  assert.equal(controller.activate("clock-b", 1_100), "armed");
  assert.equal(controller.armed?.targetKey, "clock-b");
});

test("TC-UP-CLK-06-005 explicit clear removes transient delete authority", () => {
  const controller = new DeleteClockConfirmationController();
  controller.activate("clock-a", 1_000);
  controller.clear();
  assert.equal(controller.activate("clock-a", 1_100), "armed");
});

test("TC-UP-CLK-07-001 Recent keeps one newest closed session per unfinished task", () => {
  const recent = projectRecentTasks([
    { ownerId: "a", endEpochMs: 8_000, ownerState: "todo" },
    { ownerId: "a", endEpochMs: 9_000, ownerState: "todo" },
  ], 10_000, 1);
  assert.deepEqual(recent.map((entry) => entry.latestEndEpochMs), [9_000]);
});

test("TC-UP-CLK-07-002 Recent is newest-first and reports ceil minutes remaining", () => {
  const recent = projectRecentTasks([
    { ownerId: "a", endEpochMs: 9_000, ownerState: "todo" },
    { ownerId: "b", endEpochMs: 9_500, ownerState: "todo" },
  ], 10_000, 1);
  assert.deepEqual(recent.map(({ ownerId, minutesRemaining }) => [ownerId, minutesRemaining]), [["b", 1], ["a", 1]]);
});

test("TC-UP-CLK-07-003 Recent excludes the exact retention boundary", () => {
  assert.deepEqual(projectRecentTasks([{ ownerId: "a", endEpochMs: 0, ownerState: "todo" }], 60_000, 1), []);
});

test("TC-UP-CLK-07-004 zero retention disables Recent", () => {
  assert.deepEqual(projectRecentTasks([{ ownerId: "a", endEpochMs: 9_000, ownerState: "todo" }], 10_000, 0), []);
});

test("TC-UP-CLK-07-005 Recent excludes DONE ineligible missing and focused tasks", () => {
  const recent = projectRecentTasks([
    { ownerId: "done", endEpochMs: 9_000, ownerState: "done" },
    { ownerId: "ineligible", endEpochMs: 9_000, ownerState: "ineligible" },
    { ownerId: "missing", endEpochMs: 9_000, ownerState: "missing" },
    { ownerId: "focused", endEpochMs: 9_000, ownerState: "todo" },
  ], 10_000, 1, "focused");
  assert.deepEqual(recent, []);
});

test("TC-UP-CLK-09-001 forgotten warning starts at the configured threshold", () => {
  assert.equal(isForgotten(0, 60_000, 1), true);
});

test("TC-UP-CLK-09-002 forgotten warning stays off below the threshold", () => {
  assert.equal(isForgotten(0, 59_999, 1), false);
});

test("TC-UP-CLK-09-003 zero disables forgotten warning", () => {
  assert.equal(isForgotten(0, 999_999, 0), false);
});

test("TC-UP-CLK-09-004 forgotten projection preserves elapsed time", () => {
  const state = projectExecutionState(ACTIVE, 61_000, null, 1);
  assert.deepEqual(state.kind === "forgotten" ? [state.elapsedMs, state.ownerId] : [], [60_000, "task-a"]);
});

test("TC-UP-CLK-09-005 backwards display time clamps elapsed without stopping", () => {
  const state = projectExecutionState(ACTIVE, 500, null, 1);
  assert.deepEqual(state.kind === "active" ? state.elapsedMs : undefined, 0);
});
