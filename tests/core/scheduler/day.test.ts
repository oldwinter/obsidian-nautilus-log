import assert from "node:assert/strict";
import test from "node:test";

import {
  calendarDayBounds,
  projectDay,
  projectPlaybackMinute,
  relateLogicalDay,
} from "../../../src/core/day.ts";
import { fixtureLocalMidnight } from "./fixtures.ts";

const yesterday = Object.freeze({ year: 2026, month: 8, day: 27 });
const today = Object.freeze({ year: 2026, month: 8, day: 28 });
const tomorrow = Object.freeze({ year: 2026, month: 8, day: 29 });

test("UP-DAY-01/02/03 projects today, past, future, and other without a clock read", () => {
  assert.equal(relateLogicalDay(today, today), "today");
  assert.equal(relateLogicalDay(yesterday, today), "past");
  assert.equal(relateLogicalDay(tomorrow, today), "future");
  assert.equal(relateLogicalDay(undefined, today), "other");

  const todayState = projectDay({
    displayedDate: today,
    today,
    startMinutes: 300,
    endMinutes: 1260,
    nowMinutes: 720,
  });
  assert.deepEqual(todayState, {
    relation: "today",
    scheduleFromMinutes: 720,
    capacityFromMinutes: 720,
    elapsedUntilMinutes: 720,
    showNowNeedle: true,
    showBurning: true,
    availableInteractive: true,
    taskInteractive: true,
    playbackActive: false,
  });

  const past = projectDay({
    displayedDate: yesterday,
    today,
    startMinutes: 300,
    endMinutes: 1260,
    nowMinutes: 720,
  });
  assert.deepEqual(past, {
    relation: "past",
    scheduleFromMinutes: 300,
    capacityFromMinutes: 1260,
    elapsedUntilMinutes: 1260,
    showNowNeedle: false,
    showBurning: false,
    availableInteractive: false,
    taskInteractive: false,
    playbackActive: false,
  });

  for (const displayedDate of [tomorrow, undefined]) {
    const state = projectDay({
      ...(displayedDate ? { displayedDate } : {}),
      today,
      startMinutes: 300,
      endMinutes: 1260,
      nowMinutes: 720,
    });
    assert.equal(state.scheduleFromMinutes, 300);
    assert.equal(state.capacityFromMinutes, 300);
    assert.equal(state.elapsedUntilMinutes, null);
    assert.equal(state.availableInteractive, true);
    assert.equal(state.taskInteractive, false);
  }
});

test("UP-DAY-04 projects six-second playback and resets to relation state at the end", () => {
  assert.equal(projectPlaybackMinute({
    startMinutes: 300,
    endMinutes: 1260,
    elapsedMilliseconds: 0,
  }), 300);
  assert.equal(projectPlaybackMinute({
    startMinutes: 300,
    endMinutes: 1260,
    elapsedMilliseconds: 3000,
  }), 780);
  assert.equal(projectPlaybackMinute({
    startMinutes: 300,
    endMinutes: 1260,
    elapsedMilliseconds: 6000,
  }), null);

  const playback = projectDay({
    displayedDate: yesterday,
    today,
    startMinutes: 300,
    endMinutes: 1260,
    nowMinutes: 720,
    playbackMinutes: 780,
  });
  assert.deepEqual(playback, {
    relation: "past",
    scheduleFromMinutes: 780,
    capacityFromMinutes: 780,
    elapsedUntilMinutes: 780,
    showNowNeedle: true,
    showBurning: true,
    availableInteractive: true,
    taskInteractive: false,
    playbackActive: true,
  });
});

test("UP-DAY-01/UP-SCH-07 suppresses today's needle and burning outside the half-open day", () => {
  for (const nowMinutes of [299, 1260, 1400]) {
    const state = projectDay({
      displayedDate: today,
      today,
      startMinutes: 300,
      endMinutes: 1260,
      nowMinutes,
    });
    assert.equal(state.showNowNeedle, false, String(nowMinutes));
    assert.equal(state.showBurning, false, String(nowMinutes));
  }
  const start = projectDay({
    displayedDate: today,
    today,
    startMinutes: 300,
    endMinutes: 1260,
    nowMinutes: 300,
  });
  assert.equal(start.showNowNeedle, true);
  assert.equal(start.showBurning, true);
});

test("UP-DAY shared calendar bounds cover UTC, Shanghai, and New York 23/24/25-hour days", () => {
  const hours = (date: { readonly year: number; readonly month: number; readonly day: number }, zone: string) => {
    const bounds = calendarDayBounds(date, zone, fixtureLocalMidnight);
    return (bounds.endEpochMilliseconds - bounds.startEpochMilliseconds) / 3_600_000;
  };

  assert.equal(hours({ year: 2026, month: 2, day: 1 }, "UTC"), 24);
  assert.equal(hours({ year: 2026, month: 2, day: 1 }, "Asia/Shanghai"), 24);
  assert.equal(hours({ year: 2026, month: 2, day: 1 }, "America/New_York"), 24);
  assert.equal(hours({ year: 2026, month: 3, day: 8 }, "America/New_York"), 23);
  assert.equal(hours({ year: 2026, month: 11, day: 1 }, "America/New_York"), 25);
});

test("day projections reject invalid bounds and do not mutate inputs", () => {
  const input = Object.freeze({
    displayedDate: today,
    today,
    startMinutes: 1260,
    endMinutes: 300,
    nowMinutes: 720,
  });
  assert.throws(() => projectDay(input), RangeError);
  assert.throws(
    () => calendarDayBounds({ year: 2026, month: 2, day: 30 }, "UTC", fixtureLocalMidnight),
    RangeError,
  );
  assert.throws(() => calendarDayBounds(today, "Not/AZone", fixtureLocalMidnight), RangeError);
});
