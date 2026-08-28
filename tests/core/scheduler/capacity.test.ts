import assert from "node:assert/strict";
import test from "node:test";

import { calculateCapacity } from "../../../src/core/capacity.ts";
import { event, frozenItems, task } from "./fixtures.ts";

test("UP-SCH-05 applies the exact current and full-day capacity formulas", () => {
  const result = calculateCapacity({
    startMinutes: 300,
    endMinutes: 600,
    nowMinutes: 330,
    items: frozenItems([
      event(0, 300, 360),
      event(1, 350, 420),
      event(2, 580, 700),
      event(3, 450, 480, "done"),
      task(4, 80),
      task(5, 45),
      task(6, 30, "done"),
      task(7, 0),
    ]),
  });

  assert.deepEqual({
    availableMinutes: result.availableMinutes,
    demandMinutes: result.demandMinutes,
    overloadMinutes: result.overloadMinutes,
    slackMinutes: result.slackMinutes,
    unplacedMinutes: result.unplacedMinutes,
    fixedMinutes: result.fixedMinutes,
    totalFixedMinutes: result.totalFixedMinutes,
    totalAvailableMinutes: result.totalAvailableMinutes,
  }, {
    availableMinutes: 160,
    demandMinutes: 125,
    overloadMinutes: 0,
    slackMinutes: 35,
    unplacedMinutes: 0,
    fixedMinutes: 110,
    totalFixedMinutes: 170,
    totalAvailableMinutes: 130,
  });
});

test("UP-SCH-03/05 distinguishes arithmetic overload from actual atomic failure", () => {
  const overload = calculateCapacity({
    startMinutes: 300,
    endMinutes: 360,
    nowMinutes: 300,
    items: frozenItems([task(0, 45), task(1, 30)]),
  });
  assert.deepEqual([
    overload.availableMinutes,
    overload.demandMinutes,
    overload.overloadMinutes,
    overload.slackMinutes,
    overload.unplacedMinutes,
  ], [60, 75, 15, 0, 30]);
  assert.equal(overload.status, "overload");

  const fragmented = calculateCapacity({
    startMinutes: 300,
    endMinutes: 420,
    nowMinutes: 300,
    items: frozenItems([
      event(0, 330, 360),
      event(1, 390, 420),
      task(2, 45),
    ]),
  });
  assert.deepEqual([
    fragmented.availableMinutes,
    fragmented.demandMinutes,
    fragmented.overloadMinutes,
    fragmented.slackMinutes,
    fragmented.unplacedMinutes,
  ], [60, 45, 0, 15, 45]);
  assert.equal(fragmented.status, "no-fitting-slot");
});

test("UP-SCH-06 exposes deterministic metric order, precedence, and percentage", () => {
  const result = calculateCapacity({
    startMinutes: 300,
    endMinutes: 360,
    nowMinutes: 300,
    items: frozenItems([task(0, 75)]),
  });
  assert.equal(result.plannedPercent, 125);
  assert.deepEqual(result.metrics.map((metric) => metric.kind), [
    "planned",
    "overload",
    "available",
    "events",
  ]);

  const noAvailable = calculateCapacity({
    startMinutes: 300,
    endMinutes: 360,
    nowMinutes: 360,
    items: frozenItems([task(0, 15)]),
  });
  assert.equal(noAvailable.plannedPercent, null);

  const bothZero = calculateCapacity({
    startMinutes: 300,
    endMinutes: 360,
    nowMinutes: 360,
    items: frozenItems([]),
  });
  assert.equal(bothZero.plannedPercent, 0);
  assert.equal(bothZero.status, "remaining");
});

test("UP-SCH-07 identifies the exact half-open burning capacity bucket", () => {
  const items = frozenItems([
    event(0, 330, 360),
    event(1, 360, 390, "done"),
    task(2, 15),
  ]);
  const atEvent = calculateCapacity({
    startMinutes: 300,
    endMinutes: 420,
    nowMinutes: 330,
    items,
  });
  assert.equal(atEvent.burningBucket, "events");
  assert.deepEqual(atEvent.metrics.filter((entry) => entry.burning).map((entry) => entry.kind), [
    "events",
  ]);

  const atEventEnd = calculateCapacity({
    startMinutes: 300,
    endMinutes: 420,
    nowMinutes: 360,
    items,
  });
  assert.equal(atEventEnd.burningBucket, "available");
  assert.deepEqual(atEventEnd.metrics.filter((entry) => entry.burning).map((entry) => entry.kind), [
    "available",
  ]);

  const beforeDay = calculateCapacity({
    startMinutes: 300,
    endMinutes: 420,
    nowMinutes: 299,
    items,
  });
  assert.equal(beforeDay.burningBucket, null);
  assert.deepEqual(beforeDay.metrics.filter((entry) => entry.burning), []);

  const afterDay = calculateCapacity({
    startMinutes: 300,
    endMinutes: 420,
    nowMinutes: 420,
    items,
  });
  assert.equal(afterDay.burningBucket, null);
});
