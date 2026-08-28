import assert from "node:assert/strict";
import test from "node:test";

import { parseGrammarV1 } from "../../../src/core/grammar-v1.ts";
import type { InlineSegment, PlanItemCandidate } from "../../../src/core/model.ts";
import {
  schedulePlan,
  type ScheduleResult,
} from "../../../src/core/scheduler.ts";
import { event, frozenItems, task } from "./fixtures.ts";

function ranges<TSource>(result: ScheduleResult<TSource>) {
  return result.plannedSlots.map((slot) => [
    slot.task.sourceOrder,
    slot.startMinutes,
    slot.endMinutes,
  ]);
}

test("UP-SCH-01/02 places whole tasks greedily in input source order", () => {
  const result = schedulePlan({
    startMinutes: 300,
    endMinutes: 600,
    nowMinutes: 300,
    items: frozenItems([
      task(9, 120),
      event(8, 420, 480),
      task(2, 90),
      task(1, 60),
    ]),
  });

  assert.deepEqual(ranges(result), [
    [9, 300, 420],
    [2, 480, 570],
  ]);
  assert.deepEqual(result.overflowTasks.map((entry) => entry.task.sourceOrder), [1]);
  assert.equal(result.fixedMinutes, 60);
});

test("UP-SCH-04 clips, sorts, and merges fixed reservations before placement", () => {
  const result = schedulePlan({
    startMinutes: 300,
    endMinutes: 600,
    nowMinutes: 330,
    items: frozenItems([
      event(0, 580, 700),
      event(1, 350, 420),
      event(2, 300, 360),
      event(3, 420, 450),
      event(4, 500, 500),
      event(5, 450, 500, "done"),
      task(6, 80),
    ]),
  });

  assert.deepEqual(result.fixedIntervals, [
    { kind: "fixed", startMinutes: 330, endMinutes: 450 },
    { kind: "fixed", startMinutes: 580, endMinutes: 600 },
  ]);
  assert.deepEqual(ranges(result), [[6, 450, 530]]);
  assert.equal(result.fixedMinutes, 140);
  assert.deepEqual(result.intervals.map((interval) => [
    interval.kind,
    interval.startMinutes,
    interval.endMinutes,
  ]), [
    ["fixed", 330, 450],
    ["planned", 450, 530],
    ["fixed", 580, 600],
  ]);
});

test("UP-SCH-04 preserves original fixed-event identity and marks only strict unfinished overlaps", () => {
  const result = schedulePlan({
    startMinutes: 300,
    endMinutes: 450,
    nowMinutes: 300,
    items: frozenItems([
      event(0, 280, 360),
      event(1, 350, 420),
      event(2, 420, 450),
      event(3, 340, 370, "done"),
      event(4, 100, 200),
    ]),
  });

  assert.deepEqual(result.fixedEvents.map((entry) => [
    entry.event.sourceOrder,
    entry.startMinutes,
    entry.endMinutes,
    entry.conflict,
  ]), [
    [0, 300, 360, true],
    [1, 350, 420, true],
    [2, 420, 450, false],
    [3, 340, 370, false],
  ]);
  assert.equal(Object.isFrozen(result.fixedEvents), true);
  assert.equal(Object.isFrozen(result.fixedEvents[0]!.event), true);
});

test("UP-SCH-02/03 keeps atomic tasks intact and cascades Overflow without backfill", () => {
  const result = schedulePlan({
    startMinutes: 300,
    endMinutes: 420,
    nowMinutes: 300,
    items: frozenItems([
      event(0, 330, 360),
      event(1, 390, 420),
      task(2, 45, "open", "Too big"),
      task(3, 20, "open", "Could backfill"),
    ]),
  });

  assert.deepEqual(result.plannedSlots, []);
  assert.deepEqual(result.overflowTasks.map((entry) => [
    entry.task.label,
    entry.durationMinutes,
  ]), [
    ["Too big", 45],
    ["Could backfill", 20],
  ]);
});

test("UP-SCH-01/03 handles exact boundaries, cursor clipping, and invalid days", () => {
  const exact = schedulePlan({
    startMinutes: 300,
    endMinutes: 420,
    nowMinutes: 200,
    items: frozenItems([task(0, 60), event(1, 360, 390), task(2, 30)]),
  });
  assert.deepEqual(ranges(exact), [[0, 300, 360], [2, 390, 420]]);

  const exhausted = schedulePlan({
    startMinutes: 300,
    endMinutes: 420,
    nowMinutes: 500,
    items: frozenItems([task(0, 30), task(1, 0), task(2, 30, "done")]),
  });
  assert.deepEqual(exhausted.plannedSlots, []);
  assert.deepEqual(exhausted.overflowTasks.map((entry) => entry.task.sourceOrder), [0]);
  assert.equal(exhausted.cursorMinutes, 420);

  const invalidItems = frozenItems([task(0, 0, "done"), event(1, 300, 330), task(2, 30)]);
  const invalid = schedulePlan({
    startMinutes: 420,
    endMinutes: 300,
    nowMinutes: 300,
    items: invalidItems,
  });
  assert.equal(invalid.validDay, false);
  assert.equal(invalid.cursorMinutes, null);
  assert.deepEqual(invalid.plannedSlots, []);
  assert.deepEqual(invalid.fixedIntervals, []);
  assert.deepEqual(invalid.overflowTasks.map((entry) => entry.task.sourceOrder), [0, 2]);
});

test("UP-SCH-03/04 integrates parser warnings, overnight truncation, and invalid ranges", () => {
  const semantic = (text: string): InlineSegment => ({ kind: "semantic", text });
  const candidate = (sourceOrder: number, text: string): PlanItemCandidate<string> => ({
    source: `line-${sourceOrder}`,
    sourceOrder,
    status: "open",
    segments: [semantic(text)],
  });
  const parsed = parseGrammarV1([
    candidate(0, "Same 09:00-09:00"),
    candidate(1, "Overnight 23:00-01:00"),
    candidate(2, "Invalid 24:00-01:00 30m"),
    candidate(3, "Partial 10m d33%"),
  ]);
  const result = schedulePlan({
    startMinutes: 1320,
    endMinutes: 1440,
    nowMinutes: 1320,
    items: parsed.items,
  });

  assert.deepEqual(parsed.diagnostics.map((entry) => entry.code), [
    "same-time",
    "overnight-truncated",
    "invalid-time-range",
  ]);
  assert.deepEqual(result.fixedIntervals, [
    { kind: "fixed", startMinutes: 1380, endMinutes: 1440 },
  ]);
  assert.deepEqual(result.plannedSlots.map((slot) => [slot.task.label, slot.startMinutes, slot.endMinutes]), [
    ["Invalid 24:00-01:00", 1320, 1350],
    ["Partial", 1350, 1357],
  ]);
  assert.equal(result.plannedSlots[1]!.durationMinutes, 7);
});

test("UP-SCH-01/07 preserves output order and half-open current-bucket behavior", async () => {
  const { isCurrentMinute } = await import("../../../src/core/day.ts");
  const result = schedulePlan({
    startMinutes: 300,
    endMinutes: 450,
    nowMinutes: 300,
    items: frozenItems([task(12, 30), task(4, 30), event(1, 390, 420)]),
  });

  assert.deepEqual(result.plannedSlots.map((slot) => slot.task.sourceOrder), [12, 4]);
  assert.equal(isCurrentMinute(result.plannedSlots[0]!, 300), true);
  assert.equal(isCurrentMinute(result.plannedSlots[0]!, 330), false);
  assert.equal(isCurrentMinute(event(9, 300, 330, "done"), 315), false);
});
