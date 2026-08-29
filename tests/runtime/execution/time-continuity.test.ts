import assert from "node:assert/strict";
import test from "node:test";

import { ExecutionTicker, TimeContinuity } from "../../../src/runtime/execution/time-continuity";
import { ManualSystemClock } from "../../../src/runtime/system-clock";

test("paired samples advance wall and monotonic time together during ordinary time", () => {
  const clock = new ManualSystemClock(1_000, "UTC", 50);
  clock.advanceBy(250);
  assert.deepEqual(clock.sample(), { wallEpochMs: 1_250, monotonicMs: 300, timeZone: "UTC" });
});

test("manual timers use monotonic deadlines across wall-clock jumps", () => {
  const clock = new ManualSystemClock(1_000, "UTC", 50);
  let fired = 0;
  clock.setTimeout(() => { fired += 1; }, 1_000);
  clock.setWallTime(30_000);
  assert.equal(fired, 0);
  clock.advanceMonotonicBy(999);
  assert.equal(fired, 0);
  assert.equal(clock.now(), 30_000);
  clock.advanceMonotonicBy(1);
  assert.equal(fired, 1);
  assert.equal(clock.now(), 30_000);
});

test("time continuity pauses on wall and monotonic divergence", () => {
  const clock = new ManualSystemClock(10_000, "UTC", 1_000);
  const continuity = new TimeContinuity(clock);
  assert.equal(continuity.observe().kind, "trusted");
  clock.advanceMonotonicBy(1_000);
  clock.setWallTime(30_000);
  const state = continuity.observe();
  assert.equal(state.kind, "time-review-required");
  if (state.kind === "time-review-required") {
    assert.equal(state.reason, "wall-monotonic-divergence");
    assert.equal(state.measuredWallEpochMs, 11_000);
  }
});

test("time continuity detects backwards wall time and preserves the pending review", () => {
  const clock = new ManualSystemClock(10_000, "UTC", 1_000);
  const continuity = new TimeContinuity(clock);
  continuity.observe();
  clock.advanceMonotonicBy(100);
  clock.setWallTime(9_000);
  const first = continuity.observe();
  clock.setWallTime(20_000);
  assert.strictEqual(continuity.observe(), first);
  assert.equal(first.kind === "time-review-required" ? first.reason : undefined, "wall-backwards");
});

test("three explicit recovery choices select measured system or last-trusted time", () => {
  for (const [choice, expected] of [
    ["keep-measured", 11_000],
    ["use-system-time", 30_000],
    ["stop-at-trusted", 10_000],
  ] as const) {
    const clock = new ManualSystemClock(10_000, "UTC", 1_000);
    const continuity = new TimeContinuity(clock);
    continuity.observe();
    clock.advanceMonotonicBy(1_000);
    clock.setWallTime(30_000);
    continuity.observe();
    assert.equal(continuity.resolve(choice).wallEpochMs, expected);
  }
});

test("a future active start after restart requires review without measured elapsed", () => {
  const clock = new ManualSystemClock(10_000, "UTC", 1_000);
  const continuity = new TimeContinuity(clock);
  const state = continuity.restore(clock.sample(), 20_000);
  assert.equal(state.kind === "time-review-required" ? state.reason : undefined, "restored-start-in-future");
  assert.equal(continuity.canResolve("keep-measured"), false);
  assert.equal(continuity.canResolve("use-system-time"), true);
  assert.throws(() => continuity.previewResolution("keep-measured"), /unavailable after process restart/);
});

test("TC-UP-PER-02-001 ticks elapsed presentation every second", () => {
  const clock = new ManualSystemClock(0, "UTC");
  const ticks: number[] = [];
  const ticker = new ExecutionTicker(clock, {
    onTick: (sample) => ticks.push(sample.wallEpochMs),
    onRefresh: () => undefined,
  });
  ticker.start();
  clock.advanceBy(3_000);
  assert.deepEqual(ticks, [1_000, 2_000, 3_000]);
  ticker.stop();
});

test("TC-UP-PER-02-002 refreshes authoritative facts every 15 seconds", () => {
  const clock = new ManualSystemClock(0, "UTC");
  const scopes: string[] = [];
  const ticker = new ExecutionTicker(clock, {
    onTick: () => undefined,
    onRefresh: (scope) => scopes.push(scope),
  });
  ticker.start();
  clock.advanceBy(14_000);
  assert.deepEqual(scopes, ["startup-all-logbooks"]);
  clock.advanceBy(1_000);
  assert.deepEqual(scopes, ["startup-all-logbooks", "relevant-tasks"]);
  ticker.stop();
});

test("TC-UP-PER-02-003 performs one full startup scan then relevant refreshes", () => {
  const clock = new ManualSystemClock(0, "UTC");
  const scopes: string[] = [];
  const ticker = new ExecutionTicker(clock, {
    onTick: () => undefined,
    onRefresh: (scope) => scopes.push(scope),
  });
  ticker.start();
  clock.advanceBy(30_000);
  assert.deepEqual(scopes, ["startup-all-logbooks", "relevant-tasks", "relevant-tasks"]);
  ticker.stop();
});

test("TC-UP-PER-02-004 stop cancels future timing work", () => {
  const clock = new ManualSystemClock(0, "UTC");
  let ticks = 0;
  const ticker = new ExecutionTicker(clock, {
    onTick: () => { ticks += 1; },
    onRefresh: () => undefined,
  });
  ticker.start();
  clock.advanceBy(1_000);
  ticker.stop();
  clock.advanceBy(10_000);
  assert.equal(ticks, 1);
});

test("stop from a tick callback cannot reschedule the ticker", () => {
  const clock = new ManualSystemClock(0, "UTC");
  let ticks = 0;
  let ticker: ExecutionTicker;
  ticker = new ExecutionTicker(clock, {
    onTick: () => {
      ticks += 1;
      ticker.stop();
    },
    onRefresh: () => undefined,
  });
  ticker.start();
  clock.advanceBy(10_000);
  assert.equal(ticks, 1);
  assert.equal(ticker.running, false);
});

test("stop from a threshold tick suppresses the same-cycle authoritative refresh", () => {
  const clock = new ManualSystemClock(0, "UTC");
  const scopes: string[] = [];
  let ticker: ExecutionTicker;
  ticker = new ExecutionTicker(clock, {
    onTick: () => ticker.stop(),
    onRefresh: (scope) => scopes.push(scope),
  }, 15_000, 15_000);
  ticker.start();
  clock.advanceBy(15_000);
  assert.deepEqual(scopes, ["startup-all-logbooks"]);
});

test("a callback failure leaves no false-running ticker state", () => {
  const startupClock = new ManualSystemClock(0, "UTC");
  const startup = new ExecutionTicker(startupClock, {
    onTick: () => undefined,
    onRefresh: () => { throw new Error("startup failure"); },
  });
  assert.throws(() => startup.start(), /startup failure/);
  assert.equal(startup.running, false);
  assert.equal(startupClock.pendingTimerCount(), 0);

  const tickClock = new ManualSystemClock(0, "UTC");
  const tick = new ExecutionTicker(tickClock, {
    onTick: () => { throw new Error("tick failure"); },
    onRefresh: () => undefined,
  });
  tick.start();
  assert.throws(() => tickClock.advanceBy(1_000), /tick failure/);
  assert.equal(tick.running, false);
  assert.equal(tickClock.pendingTimerCount(), 0);
});

test("TC-UP-PER-02-005 per-second POMO ticks do not query authoritative sources", () => {
  const clock = new ManualSystemClock(0, "UTC");
  let refreshes = 0;
  let ticks = 0;
  const ticker = new ExecutionTicker(clock, {
    onTick: () => { ticks += 1; },
    onRefresh: () => { refreshes += 1; },
  });
  ticker.start();
  clock.advanceBy(10_000);
  assert.equal(ticks, 10);
  assert.equal(refreshes, 1);
  ticker.stop();
});
