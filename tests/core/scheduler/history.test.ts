import assert from "node:assert/strict";
import test from "node:test";

import { calendarDayBounds } from "../../../src/core/day.ts";
import {
  clipEpochIntervalToDay,
  clipEpochIntervalsToDay,
  sumClippedEpochMilliseconds,
} from "../../../src/core/history.ts";
import { fixtureLocalMidnight } from "./fixtures.ts";

test("history evidence primitive clips cross-midnight intervals on 23/24/25-hour days", () => {
  for (const [date, zone, expectedHours] of [
    [{ year: 2026, month: 2, day: 1 }, "UTC", 24],
    [{ year: 2026, month: 2, day: 1 }, "Asia/Shanghai", 24],
    [{ year: 2026, month: 2, day: 1 }, "America/New_York", 24],
    [{ year: 2026, month: 3, day: 8 }, "America/New_York", 23],
    [{ year: 2026, month: 11, day: 1 }, "America/New_York", 25],
  ] as const) {
    const bounds = calendarDayBounds(date, zone, fixtureLocalMidnight);
    const hour = 3_600_000;
    const interval = Object.freeze({
      startEpochMilliseconds: bounds.startEpochMilliseconds - hour,
      endEpochMilliseconds: bounds.endEpochMilliseconds + hour,
    });
    assert.deepEqual(clipEpochIntervalToDay(interval, bounds), {
      startEpochMilliseconds: bounds.startEpochMilliseconds,
      endEpochMilliseconds: bounds.endEpochMilliseconds,
    });
    assert.equal(sumClippedEpochMilliseconds([interval], bounds), expectedHours * hour);
  }
});

test("historical clipping is half-open, input ordered, immutable, and rejects invalid intervals", () => {
  const bounds = calendarDayBounds(
    { year: 2026, month: 8, day: 28 },
    "Asia/Shanghai",
    fixtureLocalMidnight,
  );
  const hour = 3_600_000;
  const intervals = Object.freeze([
    Object.freeze({
      startEpochMilliseconds: bounds.startEpochMilliseconds - hour,
      endEpochMilliseconds: bounds.startEpochMilliseconds,
    }),
    Object.freeze({
      startEpochMilliseconds: bounds.endEpochMilliseconds - hour,
      endEpochMilliseconds: bounds.endEpochMilliseconds + hour,
    }),
    Object.freeze({
      startEpochMilliseconds: bounds.startEpochMilliseconds + hour,
      endEpochMilliseconds: bounds.startEpochMilliseconds + 2 * hour,
    }),
    Object.freeze({
      startEpochMilliseconds: Number.NaN,
      endEpochMilliseconds: bounds.endEpochMilliseconds,
    }),
  ]);
  const before = structuredClone(intervals);
  const clipped = clipEpochIntervalsToDay(intervals, bounds);

  assert.deepEqual(clipped, [
    {
      startEpochMilliseconds: bounds.endEpochMilliseconds - hour,
      endEpochMilliseconds: bounds.endEpochMilliseconds,
    },
    {
      startEpochMilliseconds: bounds.startEpochMilliseconds + hour,
      endEpochMilliseconds: bounds.startEpochMilliseconds + 2 * hour,
    },
  ]);
  assert.equal(Object.isFrozen(clipped), true);
  assert.equal(Object.isFrozen(clipped[0]), true);
  assert.deepEqual(intervals, before);
});
