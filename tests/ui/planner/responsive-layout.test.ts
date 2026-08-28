import assert from "node:assert/strict";
import test from "node:test";

import {
  PLANNER_COMPACT_MAX_WIDTH,
  PLANNER_WIDE_MIN_WIDTH,
  plannerContainerWidth,
  plannerLayoutForWidth,
} from "../../../src/ui/planner/responsive-layout.ts";

test("TC-OBS-VIS-001-001 exact 519/520/521 container gates use one breakpoint", () => {
  assert.equal(PLANNER_COMPACT_MAX_WIDTH, 520);
  assert.equal(PLANNER_WIDE_MIN_WIDTH, 521);
  assert.equal(plannerLayoutForWidth(519).mode, "compact");
  assert.equal(plannerLayoutForWidth(520).mode, "compact");
  assert.equal(plannerLayoutForWidth(521).mode, "wide");
  assert.equal(plannerLayoutForWidth(521).containerWidth, 521);
});

test("TC-OBS-VIS-001-002 DOM measurement removes container padding before applying the gate", () => {
  const element = {
    clientWidth: 544,
    ownerDocument: {
      defaultView: {
        getComputedStyle: () => ({ paddingLeft: "12px", paddingRight: "12px" }),
      },
    },
  } as unknown as HTMLElement;
  assert.equal(plannerContainerWidth(element), 520);
  assert.equal(plannerLayoutForWidth(plannerContainerWidth(element)).mode, "compact");
});

test("TC-UP-CMP-01-001 compact replaces rails and hover with Overview and Schedule", () => {
  const compact = plannerLayoutForWidth(320);
  assert.equal(compact.showWideHeader, false);
  assert.equal(compact.showExternalLabels, false);
  assert.equal(compact.mountHoverSurface, false);
  assert.equal(compact.showCompactOverview, true);
  assert.equal(compact.showCompactSchedule, true);
  assert.equal(compact.narrow, true);
});

test("TC-UP-CMP-02-001 compact Schedule defaults open in main and folded in sidebar", () => {
  assert.equal(plannerLayoutForWidth(500, "main").scheduleInitiallyOpen, true);
  assert.equal(plannerLayoutForWidth(500, "sidebar").scheduleInitiallyOpen, false);
});

test("TC-UP-CMP-03-001 replica contexts reserve no visible planner surface", () => {
  const replica = plannerLayoutForWidth(900, "replica");
  assert.equal(replica.suppressSurface, true);
  assert.equal(replica.showWideHeader, false);
  assert.equal(replica.showExternalLabels, false);
});
