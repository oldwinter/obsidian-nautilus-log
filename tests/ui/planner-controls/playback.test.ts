import assert from "node:assert/strict";
import test from "node:test";

import {
  PLANNER_PLAYBACK_DURATION_MILLISECONDS,
  createPlannerPlayback,
  type PlannerAnimationScheduler,
  type PlannerPlaybackController,
  type PlannerPlaybackFrame,
} from "../../../src/ui/planner/playback.ts";

function fakeScheduler() {
  let now = 1_000;
  let sequence = 0;
  const callbacks = new Map<number, () => void>();
  const scheduler: PlannerAnimationScheduler = {
    now: () => now,
    requestFrame(callback) {
      sequence += 1;
      callbacks.set(sequence, callback);
      return sequence;
    },
    cancelFrame(handle) {
      callbacks.delete(handle);
    },
  };
  return {
    scheduler,
    step(milliseconds: number) {
      now += milliseconds;
      const pending = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pending) callback();
    },
    pending: () => callbacks.size,
  };
}

test("TC-UP-CTL-02-001 playback projects the complete day over exactly six seconds", () => {
  const clock = fakeScheduler();
  const frames: PlannerPlaybackFrame[] = [];
  const finishes: string[] = [];
  const playback = createPlannerPlayback({
    scheduler: clock.scheduler,
    onFrame: (frame) => frames.push(frame),
    onFinish: (reason) => finishes.push(reason),
  });
  assert.equal(playback.start({ startMinutes: 300, endMinutes: 1_440 }), true);
  assert.deepEqual(frames[0], { elapsedMilliseconds: 0, minute: 300, progress: 0 });
  clock.step(PLANNER_PLAYBACK_DURATION_MILLISECONDS / 2);
  assert.equal(frames.at(-1)?.minute, 870);
  assert.equal(frames.at(-1)?.progress, 0.5);
  clock.step(PLANNER_PLAYBACK_DURATION_MILLISECONDS / 2);
  assert.equal(frames.at(-1)?.minute, 1_440);
  assert.equal(frames.at(-1)?.progress, 1);
  assert.deepEqual(finishes, ["completed"]);
  assert.equal(playback.running, false);
});

test("TC-UP-CTL-02-001 reduced motion removes playback duration and delay", () => {
  const clock = fakeScheduler();
  const frames: PlannerPlaybackFrame[] = [];
  const finishes: string[] = [];
  const playback = createPlannerPlayback({
    scheduler: clock.scheduler,
    reducedMotion: true,
    onFrame: (frame) => frames.push(frame),
    onFinish: (reason) => finishes.push(reason),
  });
  assert.equal(playback.start({ startMinutes: 300, endMinutes: 1_440 }), true);
  assert.deepEqual(frames.map((frame) => frame.progress), [0, 1]);
  assert.deepEqual(finishes, ["completed"]);
  assert.equal(clock.pending(), 0);
  assert.equal(playback.running, false);
});

test("TC-UP-CTL-02-001 hidden planner cancels playback and admits no hidden frames", () => {
  const clock = fakeScheduler();
  const frames: PlannerPlaybackFrame[] = [];
  const finishes: string[] = [];
  const playback = createPlannerPlayback({
    scheduler: clock.scheduler,
    onFrame: (frame) => frames.push(frame),
    onFinish: (reason) => finishes.push(reason),
  });
  playback.start({ startMinutes: 300, endMinutes: 1_440 });
  playback.setVisible(false);
  clock.step(1_000);
  assert.deepEqual(frames.map((frame) => frame.progress), [0]);
  assert.deepEqual(finishes, ["hidden"]);
  assert.equal(clock.pending(), 0);
});

test("TC-UP-CTL-02-002 onStart cancellation and destruction are reentrancy-safe", () => {
  for (const action of ["cancel", "destroy"] as const) {
    const clock = fakeScheduler();
    const frames: PlannerPlaybackFrame[] = [];
    const finishes: string[] = [];
    let playback: PlannerPlaybackController;
    playback = createPlannerPlayback({
      scheduler: clock.scheduler,
      onStart: () => {
        if (action === "cancel") playback.cancel();
        else playback.destroy();
      },
      onFrame: (frame) => frames.push(frame),
      onFinish: (reason) => finishes.push(reason),
    });
    assert.equal(playback.start({ startMinutes: 300, endMinutes: 1_440 }), true);
    assert.deepEqual(frames, []);
    assert.deepEqual(finishes, ["cancelled"]);
    assert.equal(playback.running, false);
    assert.equal(clock.pending(), 0);
  }
});

test("TC-UP-CTL-02-002 onFrame cancellation cannot schedule a later frame", () => {
  const clock = fakeScheduler();
  const frames: PlannerPlaybackFrame[] = [];
  let playback: PlannerPlaybackController;
  playback = createPlannerPlayback({
    scheduler: clock.scheduler,
    onFrame: (frame) => {
      frames.push(frame);
      playback.cancel();
    },
  });
  assert.equal(playback.start({ startMinutes: 300, endMinutes: 1_440 }), true);
  assert.deepEqual(frames.map((frame) => frame.progress), [0]);
  assert.equal(playback.running, false);
  assert.equal(clock.pending(), 0);
});

test("TC-UP-CTL-02-002 a cancelled run cannot inject frames into an onFinish restart", () => {
  const clock = fakeScheduler();
  const frames: PlannerPlaybackFrame[] = [];
  let starts = 0;
  let playback: PlannerPlaybackController;
  const bounds = { startMinutes: 300, endMinutes: 1_440 };
  playback = createPlannerPlayback({
    scheduler: clock.scheduler,
    onStart: () => {
      starts += 1;
      if (starts === 1) playback.cancel();
    },
    onFrame: (frame) => frames.push(frame),
    onFinish: () => {
      if (starts === 1) playback.start(bounds);
    },
  });
  assert.equal(playback.start(bounds), true);
  assert.equal(starts, 2);
  assert.deepEqual(frames.map((frame) => frame.progress), [0]);
  assert.equal(playback.running, true);
  assert.equal(clock.pending(), 1);
  playback.destroy();
});
