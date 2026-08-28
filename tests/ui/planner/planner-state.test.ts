import assert from "node:assert/strict";
import test from "node:test";

import {
  initialPlannerPresentationState,
  normalizeStateForLayout,
  plannerPlaybackMinute,
  reducePlannerPresentationState,
} from "../../../src/ui/planner/planner-state.ts";

test("UP-VIS-05 presentation state is immutable and local to a view", () => {
  const initial = initialPlannerPresentationState("main");
  const completedHidden = reducePlannerPresentationState(initial, { type: "toggle-completed" });
  const collapsed = reducePlannerPresentationState(completedHidden, { type: "toggle-collapse" });
  assert.equal(initial.showCompleted, true);
  assert.equal(completedHidden.showCompleted, false);
  assert.equal(collapsed.collapsed, true);
  assert.equal(Object.isFrozen(collapsed), true);
});

test("UP-CMP-02 layout transitions reset compact disclosure defaults by host context", () => {
  const state = initialPlannerPresentationState("sidebar");
  const compact = normalizeStateForLayout(state, "wide", "compact", "sidebar");
  assert.equal(compact.scheduleOpen, false);
  assert.equal(compact.overviewOpen, false);
});

test("UP-VIS-02 playback advances deterministically and finishes at six seconds", () => {
  const started = reducePlannerPresentationState(initialPlannerPresentationState("main"), {
    type: "start-playback",
    now: 1_000,
  });
  assert.equal(plannerPlaybackMinute(started, 1_000, 300, 1_440), 300);
  assert.equal(plannerPlaybackMinute(started, 4_000, 300, 1_440), 870);
  assert.equal(plannerPlaybackMinute(started, 7_000, 300, 1_440), null);
});
