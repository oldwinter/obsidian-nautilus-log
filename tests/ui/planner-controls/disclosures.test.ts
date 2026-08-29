import assert from "node:assert/strict";
import test from "node:test";

import {
  createPlannerDisclosures,
  initialPlannerDisclosureState,
} from "../../../src/ui/planner/disclosures.ts";

test("TC-OBS-VIS-002-001 disclosure controller defaults folded before responsive policy is applied", () => {
  assert.deepEqual(initialPlannerDisclosureState(), {
    overflow: false,
    overview: false,
    schedule: false,
    warnings: false,
  });
  const disclosures = createPlannerDisclosures();
  disclosures.toggle("overview");
  assert.deepEqual(disclosures.state, {
    overflow: false,
    overview: true,
    schedule: false,
    warnings: false,
  });
});

test("TC-OBS-A11Y-001-001 disclosure changes publish stable complete state", () => {
  const disclosures = createPlannerDisclosures();
  const states: unknown[] = [];
  const unsubscribe = disclosures.subscribe((state) => states.push(state));
  assert.equal(disclosures.setOpen("schedule", true), true);
  assert.equal(disclosures.setOpen("schedule", true), false);
  assert.equal(disclosures.closeAll(), true);
  assert.deepEqual(states, [
    { overflow: false, overview: false, schedule: true, warnings: false },
    { overflow: false, overview: false, schedule: false, warnings: false },
  ]);
  unsubscribe();
});
