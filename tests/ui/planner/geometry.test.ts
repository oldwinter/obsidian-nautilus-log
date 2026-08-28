import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHourTicks,
  createSpiralGeometry,
  placeRailLabels,
  placeTooltip,
  rectanglesOverlap,
  spiralViewBox,
  spiralAngle,
  spiralBandPath,
  spiralRadius,
} from "../../../src/ui/planner/geometry.ts";
import { BOUNDS } from "./fixtures.ts";

test("TC-UP-VIS-02-001 deterministic spiral pairs 12-hour angles at distinct depth", () => {
  const geometry = createSpiralGeometry(BOUNDS);
  assert.equal(spiralAngle(5 * 60, geometry), -90);
  assert.equal(spiralAngle(17 * 60, geometry), 270);
  assert.ok(spiralRadius(17 * 60, geometry) > spiralRadius(5 * 60, geometry));
  assert.equal(
    spiralBandPath(13 * 60, 14 * 60, geometry),
    spiralBandPath(13 * 60, 14 * 60, geometry),
  );
});

test("TC-UP-VIS-02-002 the configured 24:00 end is labelled 0", () => {
  const ticks = buildHourTicks(createSpiralGeometry(BOUNDS));
  assert.equal(ticks.at(-1)?.minute, 24 * 60);
  assert.equal(ticks.at(-1)?.label, "0");
});

test("TC-UP-VIS-07-001 rail labels remain collision-free and deterministic", () => {
  const geometry = createSpiralGeometry(BOUNDS);
  const labels = Array.from({ length: 22 }, (_, index) => ({
    id: `dense-${index}`,
    minute: 600 + index,
    anchor: { x: index % 2 === 0 ? 180 : 420, y: 190 + index % 3 },
    width: 110 + index % 4 * 8,
    height: 16,
  }));
  const first = placeRailLabels(labels, geometry);
  const second = placeRailLabels(labels, geometry);
  assert.deepEqual(first, second);
  for (let left = 0; left < first.length; left += 1) {
    for (let right = left + 1; right < first.length; right += 1) {
      assert.equal(rectanglesOverlap(first[left]!.box, first[right]!.box, 3), false);
    }
  }
  assert.ok(first.some(({ track }) => track >= 3), "dense labels move farther outward");
});

test("TC-UP-VIS-07-002 equal-height tie order differs by side", () => {
  const geometry = createSpiralGeometry(BOUNDS);
  const placements = placeRailLabels([
    { id: "left-early", minute: 600, anchor: { x: 100, y: 200 }, width: 60, height: 14 },
    { id: "left-late", minute: 700, anchor: { x: 100, y: 200 }, width: 60, height: 14 },
    { id: "right-early", minute: 600, anchor: { x: 500, y: 200 }, width: 60, height: 14 },
    { id: "right-late", minute: 700, anchor: { x: 500, y: 200 }, width: 60, height: 14 },
  ], geometry);
  const ids = placements.map(({ id }) => id);
  assert.ok(ids.indexOf("left-late") < ids.indexOf("left-early"));
  assert.ok(ids.indexOf("right-early") < ids.indexOf("right-late"));
});

test("TC-UP-VIS-07-003 long Latin and CJK rail labels remain inside the deterministic DOM viewBox", () => {
  const geometry = createSpiralGeometry(BOUNDS);
  const inputs = [
    { id: "latin-left", minute: 780, anchor: { x: 120, y: 120 }, width: 286, height: 16 },
    { id: "cjk-left", minute: 810, anchor: { x: 125, y: 145 }, width: 224, height: 16 },
    { id: "latin-right", minute: 840, anchor: { x: 480, y: 170 }, width: 302, height: 16 },
    { id: "cjk-right", minute: 870, anchor: { x: 475, y: 195 }, width: 238, height: 16 },
  ] as const;
  const first = placeRailLabels(inputs, geometry);
  const second = placeRailLabels(inputs, geometry);
  const viewBox = spiralViewBox(geometry, first);
  assert.deepEqual(first, second);
  assert.deepEqual(viewBox, spiralViewBox(geometry, second));
  assert.deepEqual(new Set(first.map(({ side }) => side)), new Set(["left", "right"]));
  for (const placement of first) {
    assert.ok(placement.box.x >= viewBox.x);
    assert.ok(placement.box.x + placement.box.width <= viewBox.x + viewBox.width);
    assert.ok(placement.connectorEnd.x >= viewBox.x);
    assert.ok(placement.connectorEnd.x <= viewBox.x + viewBox.width);
    assert.ok(placement.anchor.x >= viewBox.x);
    assert.ok(placement.anchor.x <= viewBox.x + viewBox.width);
  }
});

test("TC-UP-VIS-03-001 tooltip flips and shifts inside a 12px viewport margin", () => {
  const placement = placeTooltip({
    anchor: { x: 2, y: 2, width: 20, height: 20 },
    tooltipWidth: 180,
    tooltipHeight: 72,
    viewportWidth: 320,
    viewportHeight: 240,
  });
  assert.ok(placement.x >= 12);
  assert.ok(placement.y >= 12);
  assert.ok(placement.x + 180 <= 308);
  assert.ok(placement.y + 72 <= 228);
  assert.notEqual(placement.side, "top");
});
