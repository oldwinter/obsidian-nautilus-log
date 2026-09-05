import assert from "node:assert/strict";
import test from "node:test";

import { executionPopoverPlacement } from "../../../src/ui/execution/panel-layout";

test("execution popover fits a narrow viewport without horizontal overflow", () => {
  const placement = executionPopoverPlacement({
    viewportWidth: 220,
    viewportHeight: 640,
    trigger: { left: 176, right: 210, top: 8, bottom: 42 },
    contentHeight: 420,
  });
  assert.equal(placement.width, 196);
  assert.equal(placement.left, 12);
  assert.equal(placement.left + placement.width, 208);
});

test("execution popover prefers the trigger edge and clamps to the viewport", () => {
  const placement = executionPopoverPlacement({
    viewportWidth: 900,
    viewportHeight: 700,
    trigger: { left: 820, right: 854, top: 46, bottom: 80 },
    contentHeight: 300,
  });
  assert.equal(placement.width, 420);
  assert.equal(placement.left, 434);
  assert.equal(placement.top, 88);
});

test("execution popover moves above the trigger when the lower edge is crowded", () => {
  const placement = executionPopoverPlacement({
    viewportWidth: 900,
    viewportHeight: 500,
    trigger: { left: 500, right: 534, top: 430, bottom: 470 },
    contentHeight: 240,
  });
  assert.equal(placement.top, 182);
});
