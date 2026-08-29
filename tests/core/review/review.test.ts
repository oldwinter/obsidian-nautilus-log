import assert from "node:assert/strict";
import test from "node:test";

import type { CalendarDayBounds } from "../../../src/core/day.ts";
import {
  projectCompletedHistory,
  projectPastUnplanned,
  projectReview,
  type ReviewClock,
  type ReviewTask,
} from "../../../src/core/review.ts";

const HOUR = 60 * 60_000;
const MINUTE = 60_000;
const DAY_START = Date.UTC(2026, 2, 8, 8);

function day(durationHours = 24): CalendarDayBounds {
  return Object.freeze({
    date: Object.freeze({ year: 2026, month: 3, day: 8 }),
    timeZone: "America/Los_Angeles",
    startEpochMilliseconds: DAY_START,
    endEpochMilliseconds: DAY_START + durationHours * HOUR,
  });
}

function task(
  key: string,
  input: Partial<ReviewTask> = {},
): ReviewTask {
  return Object.freeze({
    key,
    ownerId: `owner-${key}`,
    sourceOrder: Number(key.replace(/\D/g, "")) || 0,
    direct: true,
    kind: "flexible-task",
    status: "open",
    label: key,
    plannedMinutes: 30,
    ...input,
  });
}

function closed(
  ownerId: string,
  startEpochMilliseconds: number,
  endEpochMilliseconds: number,
  clockId?: string,
): ReviewClock {
  return Object.freeze({
    state: "closed",
    ownerId,
    startEpochMilliseconds,
    endEpochMilliseconds,
    ...(clockId ? { clockId } : {}),
  });
}

function running(ownerId: string, startEpochMilliseconds: number): ReviewClock {
  return Object.freeze({ state: "running", ownerId, startEpochMilliseconds });
}

test("TC-UP-EXE-02-001..005 Review admits only direct flexible TODO and DONE tasks", () => {
  const tasks = [
    task("open-1"),
    task("done-2", { status: "done" }),
    task("fixed-3", {
      kind: "fixed-event",
      status: "open",
      fixedInterval: {
        startEpochMilliseconds: DAY_START + HOUR,
        endEpochMilliseconds: DAY_START + 2 * HOUR,
      },
    }),
    task("nested-4", { direct: false }),
    task("plain-5", { status: "plain" }),
  ];
  const projection = projectReview({
    tasks,
    clocks: [],
    day: day(),
    nowEpochMilliseconds: DAY_START + 8 * HOUR,
  });
  assert.deepEqual(projection.rows.map((row) => row.task.key), ["open-1", "done-2"]);
  assert.deepEqual(projection.rows.map((row) => row.state), ["not-started", "not-tracked"]);
  assert.equal(projection.summary.total, 2);
  assert.equal(projection.summary.completed, 1);
});

test("TC-UP-EXE-09-001..005 produces all five exact Review row states", () => {
  const tasks = [
    task("not-started-1"),
    task("live-2"),
    task("paused-3"),
    task("not-tracked-4", { status: "done" }),
    task("compared-5", { status: "done", plannedMinutes: 20 }),
  ];
  const clocks: ReviewClock[] = [
    running("owner-live-2", DAY_START + HOUR),
    closed("owner-live-2", DAY_START + 30 * MINUTE, DAY_START + 45 * MINUTE),
    closed("owner-paused-3", DAY_START + HOUR, DAY_START + 2 * HOUR),
    running("owner-not-tracked-4", DAY_START + HOUR),
    closed("owner-compared-5", DAY_START + HOUR, DAY_START + HOUR + 25 * MINUTE),
  ];
  const projection = projectReview({
    tasks,
    clocks,
    day: day(),
    nowEpochMilliseconds: DAY_START + 2 * HOUR,
  });
  assert.deepEqual(projection.rows.map((row) => row.state), [
    "not-started",
    "live",
    "paused",
    "not-tracked",
    "compared",
  ]);
  assert.equal(projection.rows[1]?.actualMinutes, 75);
  assert.equal(projection.rows[2]?.actualMinutes, 60);
  assert.equal(projection.rows[3]?.actualMinutes, null, "DONE ignores an open CLOCK");
  assert.equal(projection.rows[4]?.varianceMinutes, 5);
  assert.deepEqual(projection.summary, {
    total: 5,
    completed: 2,
    compared: 1,
    plannedMinutes: 20,
    actualMinutes: 25,
    varianceMinutes: 5,
  });
});

test("Review preserves positive, zero, and negative compared variance", () => {
  const tasks = [
    task("positive-1", { status: "done", plannedMinutes: 20 }),
    task("zero-2", { status: "done", plannedMinutes: 30 }),
    task("negative-3", { status: "done", plannedMinutes: 40 }),
  ];
  const clocks = [
    closed("owner-positive-1", DAY_START, DAY_START + 30 * MINUTE),
    closed("owner-zero-2", DAY_START, DAY_START + 30 * MINUTE),
    closed("owner-negative-3", DAY_START, DAY_START + 30 * MINUTE),
  ];
  const projection = projectReview({ tasks, clocks, day: day(), nowEpochMilliseconds: DAY_START + HOUR });
  assert.deepEqual(projection.rows.map((row) => row.varianceMinutes), [10, 0, -10]);
  assert.equal(projection.summary.varianceMinutes, 0);
});

test("Review classifies from the once-floored task total and the presence of a running CLOCK", () => {
  const subMinuteDone = task("sub-minute-1", { status: "done" });
  const justStarted = task("just-started-2");
  const clocks = [
    closed(subMinuteDone.ownerId!, DAY_START, DAY_START + 59_999),
    closed(justStarted.ownerId!, DAY_START, DAY_START + MINUTE),
    running(justStarted.ownerId!, DAY_START + HOUR),
  ];
  const projection = projectReview({
    tasks: [subMinuteDone, justStarted],
    clocks,
    day: day(),
    nowEpochMilliseconds: DAY_START + HOUR,
  });
  assert.equal(projection.rows[0]?.state, "not-tracked", "sub-minute DONE Actual floors to zero");
  assert.equal(projection.rows[0]?.actualMinutes, null);
  assert.equal(projection.rows[1]?.state, "live", "a valid running CLOCK makes positive TODO Actual live");
  assert.equal(projection.rows[1]?.actualMinutes, 1);
});

test("distinct valid sessions are retained even when an external edit reuses a CLOCK ID", () => {
  const done = task("duplicate-id-1", { status: "done" });
  const clocks = [
    closed(done.ownerId!, DAY_START, DAY_START + 10 * MINUTE, "same-clock"),
    closed(done.ownerId!, DAY_START + 20 * MINUTE, DAY_START + 40 * MINUTE, "same-clock"),
  ];
  const projection = projectReview({
    tasks: [done],
    clocks,
    day: day(),
    nowEpochMilliseconds: DAY_START + HOUR,
  });
  assert.equal(projection.rows[0]?.actualMinutes, 30);
});

test("TC-UP-HIS-01-001..003 clips closed sessions on 23/24/25-hour local days and floors once", () => {
  for (const durationHours of [23, 24, 25]) {
    const bounds = day(durationHours);
    const done = task(`dst-${durationHours}`, { status: "done", plannedMinutes: 15 });
    const owner = done.ownerId!;
    const clocks = [
      closed(owner, bounds.startEpochMilliseconds - 30_000, bounds.startEpochMilliseconds + 30_000),
      closed(owner, bounds.startEpochMilliseconds + 30_000, bounds.startEpochMilliseconds + 60_000),
      closed(owner, bounds.endEpochMilliseconds - 30_000, bounds.endEpochMilliseconds + 30_000),
      running(owner, bounds.startEpochMilliseconds),
    ];
    const projection = projectReview({
      tasks: [done],
      clocks,
      day: bounds,
      nowEpochMilliseconds: bounds.endEpochMilliseconds,
    });
    assert.equal(projection.rows[0]?.actualMilliseconds, 90_000, `${durationHours}h milliseconds`);
    assert.equal(projection.rows[0]?.actualMinutes, 1, `${durationHours}h floor once`);
    assert.equal(projection.rows[0]?.state, "compared");
  }
});

test("TC-UP-HIS-01 and TC-UP-HIS-02 condense Actual sessions and prefer an explicit anchor", () => {
  const bounds = day();
  const anchored = task("anchored-1", {
    status: "done",
    plannedMinutes: 20,
    completionAnchorEpochMilliseconds: DAY_START + 10 * HOUR,
  });
  const latest = task("latest-2", { status: "done", plannedMinutes: 10 });
  const clocks = [
    closed(anchored.ownerId!, DAY_START + HOUR, DAY_START + 2 * HOUR),
    closed(anchored.ownerId!, DAY_START + 4 * HOUR, DAY_START + 4 * HOUR + 30 * MINUTE),
    closed(latest.ownerId!, DAY_START + 6 * HOUR, DAY_START + 6 * HOUR + 20 * MINUTE),
  ];
  const slices = projectCompletedHistory([anchored, latest], clocks, bounds);
  assert.equal(slices.length, 2);
  assert.deepEqual(
    slices.map((slice) => ({ key: slice.task.key, source: slice.source, duration: slice.durationMinutes })),
    [
      { key: "latest-2", source: "actual", duration: 20 },
      { key: "anchored-1", source: "actual", duration: 90 },
    ],
  );
  const anchoredSlice = slices.find((slice) => slice.task.key === "anchored-1")!;
  assert.equal(anchoredSlice.endEpochMilliseconds, DAY_START + 10 * HOUR);
  assert.equal(anchoredSlice.startEpochMilliseconds, DAY_START + 8.5 * HOUR);
  const latestSlice = slices.find((slice) => slice.task.key === "latest-2")!;
  assert.equal(latestSlice.endEpochMilliseconds, DAY_START + 6 * HOUR + 20 * MINUTE);
});

test("TC-UP-HIS-03-001..003 uses Planned only with an explicit anchor", () => {
  const anchored = task("planned-1", {
    status: "done",
    plannedMinutes: 45,
    completionAnchorEpochMilliseconds: DAY_START + 4 * HOUR,
  });
  const noAnchor = task("none-2", { status: "done", plannedMinutes: 45 });
  const malformed: ReviewClock = Object.freeze({ state: "malformed", ownerId: anchored.ownerId });
  const slices = projectCompletedHistory([anchored, noAnchor], [malformed], day());
  assert.equal(slices.length, 1);
  assert.equal(slices[0]?.task.key, "planned-1");
  assert.equal(slices[0]?.source, "planned");
  assert.equal(slices[0]?.durationMinutes, 45);
  assert.equal(slices[0]?.startEpochMilliseconds, DAY_START + 3.25 * HOUR);

  const crossesMidnight = task("crosses-midnight-3", {
    status: "done",
    plannedMinutes: 60,
    completionAnchorEpochMilliseconds: DAY_START + 10 * MINUTE,
  });
  const crossingSlice = projectCompletedHistory([crossesMidnight], [], day())[0];
  assert.equal(crossingSlice?.startEpochMilliseconds, DAY_START - 50 * MINUTE);
  assert.equal(
    crossingSlice!.endEpochMilliseconds - crossingSlice!.startEpochMilliseconds,
    crossingSlice!.durationMinutes * MINUTE,
    "the completion anchor does not shorten a history slice at midnight",
  );
});

test("TC-UP-HIS-04-001..003 keeps completed fixed-event time independent of CLOCK Actual", () => {
  const fixed = task("fixed-1", {
    kind: "fixed-event",
    status: "done",
    plannedMinutes: 15,
    fixedInterval: {
      startEpochMilliseconds: DAY_START + 3 * HOUR,
      endEpochMilliseconds: DAY_START + 5 * HOUR,
    },
  });
  const clocks = [closed(fixed.ownerId!, DAY_START, DAY_START + 8 * HOUR)];
  const slices = projectCompletedHistory([fixed], clocks, day());
  assert.equal(slices.length, 1);
  assert.equal(slices[0]?.source, "fixed-event");
  assert.equal(slices[0]?.durationMinutes, 120);
  assert.equal(slices[0]?.startEpochMilliseconds, DAY_START + 3 * HOUR);
  assert.equal(slices[0]?.endEpochMilliseconds, DAY_START + 5 * HOUR);
});

test("TC-UP-HIS-05-001..003 subtracts recorded work and splits unplanned gaps at hour boundaries", () => {
  const bounds = day();
  const fixed = [{ startEpochMilliseconds: DAY_START, endEpochMilliseconds: DAY_START + 30 * MINUTE }];
  const scheduled = [{
    startEpochMilliseconds: DAY_START + 90 * MINUTE,
    endEpochMilliseconds: DAY_START + 2 * HOUR,
  }];
  const completedHistory = [{
    startEpochMilliseconds: DAY_START + 2 * HOUR,
    endEpochMilliseconds: DAY_START + 150 * MINUTE,
  }];
  const projected = projectPastUnplanned({
    day: bounds,
    nowEpochMilliseconds: DAY_START + 3 * HOUR,
    fixed,
    scheduled,
    completedHistory,
    hourBoundariesEpochMilliseconds: [DAY_START + HOUR, DAY_START + 2 * HOUR, DAY_START + 3 * HOUR],
  });
  assert.deepEqual(projected, [
    { startEpochMilliseconds: DAY_START + 30 * MINUTE, endEpochMilliseconds: DAY_START + HOUR },
    { startEpochMilliseconds: DAY_START + HOUR, endEpochMilliseconds: DAY_START + 90 * MINUTE },
    { startEpochMilliseconds: DAY_START + 150 * MINUTE, endEpochMilliseconds: DAY_START + 3 * HOUR },
  ]);

  const hiddenCompleted = projectPastUnplanned({
    day: bounds,
    nowEpochMilliseconds: DAY_START + 3 * HOUR,
    fixed,
    scheduled,
    completedHistory,
  });
  assert.equal(
    hiddenCompleted.some((interval) => interval.startEpochMilliseconds < DAY_START + 150 * MINUTE
      && interval.endEpochMilliseconds > DAY_START + 2 * HOUR),
    false,
    "completed history remains occupied even when a surface hides its row",
  );
});

test("malformed and potential running CLOCKs diagnose without fabricating Actual", () => {
  const open = task("diagnostic-1");
  const projection = projectReview({
    tasks: [open],
    clocks: [
      { state: "malformed", ownerId: open.ownerId },
      { state: "potential-running", ownerId: open.ownerId },
    ],
    day: day(),
    nowEpochMilliseconds: DAY_START + HOUR,
  });
  assert.equal(projection.rows[0]?.state, "not-started");
  assert.equal(projection.rows[0]?.actualMinutes, null);
  assert.equal(projection.rows[0]?.malformedClockCount, 1);
  assert.equal(projection.rows[0]?.potentialRunning, true);
  assert.deepEqual(projection.diagnostics, { malformedClocks: 1, potentialRunningClocks: 1 });
});
