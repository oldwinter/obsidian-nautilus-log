import assert from "node:assert/strict";
import test from "node:test";

import {
  formatClockMinute,
  formatDuration,
  plannerOverflow,
  plannerWarnings,
} from "../../../src/ui/planner/diagnostics.ts";
import { plannerProjection } from "./fixtures.ts";

test("TC-UP-ERR-01-001 schedule warnings retain affected rows and exact warning meaning", () => {
  const warnings = plannerWarnings(plannerProjection());
  assert.deepEqual(warnings.map(({ message }) => message), [
    "Overnight events display only through 24:00",
    "Start and end are the same",
  ]);
  assert.equal(warnings[0]?.title, "Ends at midnight");
});

test("TC-UP-ERR-02-001 overflow keeps titles and durations while conflicts remain visual-only", () => {
  const projection = plannerProjection();
  const overflow = plannerOverflow(projection);
  assert.ok(overflow.some(({ title }) => title === "Large overflow task remains visible"));
  assert.ok(overflow.every(({ durationMinutes }) => durationMinutes > 0));
  assert.equal(plannerWarnings(projection).some(({ message }) => /conflict/i.test(message)), false);
  assert.equal(projection.schedule.fixedEvents.filter(({ conflict }) => conflict).length, 2);
});

test("planner time and duration copy preserves 24:00", () => {
  assert.equal(formatClockMinute(24 * 60), "24:00");
  assert.equal(formatDuration(135), "2h 15m");
});
