import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPlannerSpiralModel,
  fitPlannerRailLabel,
  plannerRailLabelMaxWidth,
} from "../../../src/ui/planner/spiral.ts";
import { BOUNDS, plannerProjection } from "./fixtures.ts";

test("TC-UP-VIS-01-001 wide Spiral-first model exposes all semantic tones and rails", () => {
  const model = buildPlannerSpiralModel(plannerProjection(), BOUNDS, {
    mode: "wide",
    showCompleted: true,
  });
  assert.ok(model.items.some(({ tone }) => tone === "task"));
  assert.ok(model.items.some(({ tone }) => tone === "urgent"));
  assert.ok(model.items.some(({ tone }) => tone === "event"));
  assert.ok(model.items.some(({ tone }) => tone === "completed"));
  assert.equal(model.labels.length, model.items.length);
  assert.ok(model.items.every(({ path }) => path.startsWith("M ")));
});

test("TC-UP-VIS-07-004 rail geometry preserves complete measured Latin and CJK label widths", () => {
  const measurements = new Map([
    ["Deep work proposal with a long Latin label", 286],
    ["urgent 发布前检查与长中文标题", 224],
  ]);
  const model = buildPlannerSpiralModel(plannerProjection(), BOUNDS, {
    mode: "wide",
    showCompleted: true,
    measureLabel: (label) => measurements.get(label) ?? 80,
  });
  for (const [title, width] of measurements) {
    const label = model.labels.find((entry) => entry.timelineItem.title === title);
    assert.equal(label?.box.width, width);
    assert.equal(label?.timelineItem.title, title);
  }
});

test("TC-UP-VIS-07-005 constrained wide rails fit Latin and CJK text without changing full accessible titles", () => {
  const measure = (label: string) => [...label].length * 8;
  assert.equal(plannerRailLabelMaxWidth(521), 120);
  assert.equal(plannerRailLabelMaxWidth(900), 309.5);
  assert.equal(fitPlannerRailLabel("A long Latin planning label", 120, measure), "A long Latin p…");
  assert.equal(fitPlannerRailLabel("发布前检查与长中文标题", 72, measure), "发布前检查与长中…");

  const model = buildPlannerSpiralModel(plannerProjection(), BOUNDS, {
    mode: "wide",
    showCompleted: true,
    measureLabel: measure,
    labelMaxWidth: plannerRailLabelMaxWidth(521),
  });
  const fitted = model.labels.filter(({ visibleText }) => visibleText.endsWith("…"));
  assert.ok(fitted.length >= 2);
  for (const label of fitted) {
    assert.ok(measure(label.visibleText) <= 120);
    assert.ok(label.timelineItem.title.length > label.visibleText.length);
    assert.match(label.timelineItem.ariaLabel, new RegExp(label.timelineItem.title));
  }
});

test("TC-UP-VIS-04-001 today/future expose slots and past exposes no slot targets", () => {
  const today = buildPlannerSpiralModel(plannerProjection("today"), BOUNDS, {
    mode: "wide",
    showCompleted: true,
  });
  const future = buildPlannerSpiralModel(plannerProjection("future"), BOUNDS, {
    mode: "wide",
    showCompleted: true,
  });
  const past = buildPlannerSpiralModel(plannerProjection("past"), BOUNDS, {
    mode: "wide",
    showCompleted: true,
  });
  assert.ok(today.availableSlots.length > 0);
  assert.ok(future.availableSlots.length > 0);
  assert.equal(past.availableSlots.length, 0);
});

test("TC-UP-VIS-04-002 explicit past-day playback reveals slots at its simulated cursor", () => {
  const playback = buildPlannerSpiralModel(plannerProjection("past"), BOUNDS, {
    mode: "wide",
    showCompleted: true,
    playbackMinute: 13 * 60,
  });
  assert.ok(playback.availableSlots.length > 0);
  assert.ok(playback.availableSlots.every(({ endMinutes }) => endMinutes > 13 * 60));
});

test("TC-UP-VIS-06-001 current task uses half-open today-only boundaries", () => {
  const today = buildPlannerSpiralModel(plannerProjection("today"), BOUNDS, {
    mode: "wide",
    showCompleted: true,
  });
  const future = buildPlannerSpiralModel(plannerProjection("future"), BOUNDS, {
    mode: "wide",
    showCompleted: true,
  });
  assert.equal(today.items.filter(({ current }) => current).length, 1);
  assert.equal(future.items.some(({ current }) => current), false);
});

test("TC-UP-CMP-01-002 compact mounts no external labels or hover model", () => {
  const compact = buildPlannerSpiralModel(plannerProjection(), BOUNDS, {
    mode: "compact",
    showCompleted: true,
  });
  assert.equal(compact.labels.length, 0);
  assert.equal(compact.mode, "compact");
  assert.ok(compact.items.length > 0, "textual Schedule still receives every item");
});

test("UP-VIS-05 completed visibility removes completed slices without altering projection", () => {
  const projection = plannerProjection();
  const visible = buildPlannerSpiralModel(projection, BOUNDS, { mode: "wide", showCompleted: true });
  const hidden = buildPlannerSpiralModel(projection, BOUNDS, { mode: "wide", showCompleted: false });
  assert.ok(visible.items.some(({ completed }) => completed));
  assert.equal(hidden.items.some(({ completed }) => completed), false);
  assert.equal(projection.items.filter(({ status }) => status === "done").length, 2);
});
