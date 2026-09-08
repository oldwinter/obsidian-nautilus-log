import assert from "node:assert/strict";
import test from "node:test";

import { RefreshCoordinator } from "../../../src/runtime/refresh.ts";
import {
  createZonedLocalTimeResolver,
  ManualSystemClock,
  RealSystemClock,
  zonedTimeParts,
} from "../../../src/runtime/system-clock.ts";

test("UP-INS-04 resolves local dates and minutes across zones and DST boundaries", () => {
  const beforeSpring = zonedTimeParts(Date.UTC(2026, 2, 8, 6, 59), "America/New_York");
  const afterSpring = zonedTimeParts(Date.UTC(2026, 2, 8, 7, 0), "America/New_York");
  assert.deepEqual(
    [beforeSpring.dateKey, beforeSpring.hour, beforeSpring.minute, beforeSpring.minuteOfDay],
    ["2026-03-08", 1, 59, 119],
  );
  assert.deepEqual(
    [afterSpring.dateKey, afterSpring.hour, afterSpring.minute, afterSpring.minuteOfDay],
    ["2026-03-08", 3, 0, 180],
  );

  const firstFallHour = zonedTimeParts(Date.UTC(2026, 10, 1, 5, 30), "America/New_York");
  const secondFallHour = zonedTimeParts(Date.UTC(2026, 10, 1, 6, 30), "America/New_York");
  assert.equal(firstFallHour.minuteOfDay, 90);
  assert.equal(secondFallHour.minuteOfDay, 90);

  const shanghai = zonedTimeParts(Date.UTC(2026, 7, 28, 16, 5), "Asia/Shanghai");
  assert.deepEqual(
    [shanghai.dateKey, shanghai.hour, shanghai.minute, shanghai.minuteOfDay],
    ["2026-08-29", 0, 5, 5],
  );
  assert.throws(() => zonedTimeParts(0, "Not/AZone"), RangeError);
  assert.throws(() => zonedTimeParts(Number.NaN, "UTC"), RangeError);
});

test("offset-free local times resolve uniquely and reject DST folds and gaps", () => {
  const shanghai = createZonedLocalTimeResolver("Asia/Shanghai");
  assert.deepEqual(shanghai.resolve({
    year: 2026,
    month: 8,
    day: 29,
    hour: 8,
    minute: 10,
  }), {
    kind: "unique",
    epochMs: Date.UTC(2026, 7, 29, 0, 10),
  });

  const newYork = createZonedLocalTimeResolver("America/New_York");
  assert.deepEqual(newYork.resolve({
    year: 2026,
    month: 11,
    day: 1,
    hour: 1,
    minute: 30,
  }), { kind: "ambiguous" });
  assert.deepEqual(newYork.resolve({
    year: 2026,
    month: 3,
    day: 8,
    hour: 2,
    minute: 30,
  }), { kind: "nonexistent" });
  assert.deepEqual(newYork.resolve({
    year: 2026,
    month: 2,
    day: 30,
    hour: 12,
    minute: 0,
  }), { kind: "invalid" });
});

test("UP-INS-04 manual clock changes zones and fires equal timers deterministically", () => {
  const clock = new ManualSystemClock(Date.UTC(2026, 7, 28, 16, 0), "UTC");
  const fired: string[] = [];
  const cancelled = clock.setTimeout(() => fired.push("cancelled"), 10);
  clock.setTimeout(() => fired.push("first"), 10);
  clock.setTimeout(() => fired.push("second"), 10);
  clock.clearTimeout(cancelled);

  assert.equal(clock.pendingTimerCount(), 2);
  clock.advanceBy(9);
  assert.deepEqual(fired, []);
  clock.advanceBy(1);
  assert.deepEqual(fired, ["first", "second"]);
  assert.deepEqual(
    [clock.totalScheduledTimerCount, clock.totalClearedTimerCount, clock.totalFiredTimerCount],
    [3, 1, 2],
  );
  assert.equal(clock.pendingTimerCount(), 0);

  clock.setTimeZone("Asia/Shanghai");
  assert.equal(clock.timeZone(), "Asia/Shanghai");
  assert.equal(zonedTimeParts(clock.now(), clock.timeZone()).dateKey, "2026-08-29");
  assert.throws(() => clock.advanceBy(-1), RangeError);
  assert.throws(() => clock.setTimeZone("invalid"), RangeError);

  const realClock = new RealSystemClock();
  assert.equal(Number.isFinite(realClock.now()), true);
  assert.equal(typeof realClock.timeZone(), "string");
});

test("UP-INS-04 editor refresh is trailing at 150 ms and capped at 500 ms", () => {
  const clock = new ManualSystemClock();
  const refreshedAt: number[] = [];
  const refresh = new RefreshCoordinator(clock, () => refreshedAt.push(clock.now()));

  refresh.schedule("editor");
  for (let elapsed = 100; elapsed <= 400; elapsed += 100) {
    clock.advanceBy(100);
    refresh.schedule("editor");
    assert.equal(clock.pendingTimerCount(), 1);
  }
  clock.advanceBy(99);
  assert.deepEqual(refreshedAt, []);
  refresh.schedule("editor");
  assert.equal(clock.pendingTimerCount(), 1);
  clock.advanceBy(1);
  assert.deepEqual(refreshedAt, [500]);
  assert.equal(clock.pendingTimerCount(), 0);

  refresh.schedule("editor");
  clock.advanceBy(149);
  assert.deepEqual(refreshedAt, [500]);
  clock.advanceBy(1);
  assert.deepEqual(refreshedAt, [500, 650]);
});

test("UP-INS-04 vault refresh is trailing at 250 ms and editor timing wins mixed bursts", () => {
  const clock = new ManualSystemClock();
  const refreshedAt: number[] = [];
  const refresh = new RefreshCoordinator(clock, () => refreshedAt.push(clock.now()));

  refresh.schedule("vault");
  clock.advanceBy(200);
  refresh.schedule("vault");
  clock.advanceBy(249);
  assert.deepEqual(refreshedAt, []);
  clock.advanceBy(1);
  assert.deepEqual(refreshedAt, [450]);

  refresh.schedule("editor");
  clock.advanceBy(100);
  refresh.schedule("vault");
  clock.advanceBy(149);
  assert.deepEqual(refreshedAt, [450]);
  clock.advanceBy(1);
  assert.deepEqual(refreshedAt, [450, 700]);
});

test("UP-INS-04 immediate refresh bypasses and replaces queued debounce", () => {
  const clock = new ManualSystemClock();
  const refreshedAt: number[] = [];
  const refresh = new RefreshCoordinator(clock, () => refreshedAt.push(clock.now()));

  refresh.schedule("vault");
  clock.advanceBy(50);
  refresh.schedule("immediate");
  assert.deepEqual(refreshedAt, [50]);
  assert.equal(clock.pendingTimerCount(), 0);
  clock.advanceBy(500);
  assert.deepEqual(refreshedAt, [50]);
});

test("OBS-LIFE-001 serializes an async dirty follow-up without duplicate callbacks", async () => {
  const clock = new ManualSystemClock();
  let releaseFirst: (() => void) | undefined;
  let active = 0;
  let maximumActive = 0;
  let calls = 0;
  let firstCallbackResult: Promise<void> | undefined;
  const firstRefresh = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const refresh = new RefreshCoordinator(clock, () => {
    calls += 1;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    if (calls === 1) {
      firstCallbackResult = firstRefresh.finally(() => {
        active -= 1;
      });
      return firstCallbackResult;
    }
    active -= 1;
  });

  refresh.schedule("immediate");
  refresh.schedule("editor");
  refresh.schedule("editor");
  assert.equal(calls, 1);
  assert.equal(clock.pendingTimerCount(), 1);
  clock.advanceBy(150);
  assert.equal(calls, 1);
  assert.equal(clock.pendingTimerCount(), 0);

  assert.ok(releaseFirst);
  releaseFirst();
  assert.ok(firstCallbackResult);
  await firstCallbackResult;
  assert.equal(clock.pendingTimerCount(), 1);
  clock.advanceBy(0);
  assert.equal(calls, 2);
  assert.equal(maximumActive, 1);
  assert.equal(clock.pendingTimerCount(), 0);
});

test("UP-INS-05/OBS-LIFE-001 cancel suppresses an async dirty follow-up", async () => {
  const clock = new ManualSystemClock();
  let releaseFirst: (() => void) | undefined;
  let firstCallbackResult: Promise<void> | undefined;
  let calls = 0;
  const firstRefresh = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const refresh = new RefreshCoordinator(clock, () => {
    calls += 1;
    if (calls === 1) {
      firstCallbackResult = firstRefresh;
      return firstCallbackResult;
    }
  });

  refresh.schedule("immediate");
  refresh.schedule("editor");
  assert.equal(clock.pendingTimerCount(), 1);
  refresh.cancel();
  assert.equal(clock.pendingTimerCount(), 0);

  assert.ok(releaseFirst);
  releaseFirst();
  assert.ok(firstCallbackResult);
  await firstCallbackResult;
  await Promise.resolve();
  clock.advanceBy(1_000);
  assert.equal(calls, 1);
  assert.equal(clock.pendingTimerCount(), 0);
});

test("UP-INS-05/OBS-LIFE-001 cancel is idempotent and leak-free across 100 bursts", () => {
  const clock = new ManualSystemClock();
  let calls = 0;
  const refresh = new RefreshCoordinator(clock, () => {
    calls += 1;
  });

  for (let cycle = 0; cycle < 100; cycle += 1) {
    refresh.schedule(cycle % 2 === 0 ? "editor" : "vault");
    refresh.schedule("editor");
    assert.equal(clock.pendingTimerCount(), 1);
    refresh.cancel();
    refresh.cancel();
    assert.equal(clock.pendingTimerCount(), 0);
  }
  clock.advanceBy(1_000);
  assert.equal(calls, 0);

  refresh.schedule("immediate");
  assert.equal(calls, 1);
  assert.equal(clock.pendingTimerCount(), 0);
});
