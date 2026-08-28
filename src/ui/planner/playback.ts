export const PLANNER_PLAYBACK_DURATION_MILLISECONDS = 6_000;

export interface PlannerPlaybackBounds {
  readonly endMinutes: number;
  readonly startMinutes: number;
}

export interface PlannerPlaybackFrame {
  readonly elapsedMilliseconds: number;
  readonly minute: number;
  readonly progress: number;
}

export type PlannerPlaybackFinishReason = "cancelled" | "completed" | "hidden";

export interface PlannerAnimationScheduler {
  now(): number;
  requestFrame(callback: () => void): number;
  cancelFrame(handle: number): void;
}

export interface PlannerPlaybackOptions {
  readonly scheduler?: PlannerAnimationScheduler;
  readonly reducedMotion?: boolean;
  readonly onFinish?: (reason: PlannerPlaybackFinishReason) => void;
  readonly onFrame: (frame: PlannerPlaybackFrame) => void;
  readonly onStart?: () => void;
}

export interface PlannerPlaybackController {
  readonly running: boolean;
  readonly reducedMotion: boolean;
  start(bounds: PlannerPlaybackBounds): boolean;
  cancel(reason?: PlannerPlaybackFinishReason): boolean;
  setReducedMotion(reducedMotion: boolean): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}

function browserScheduler(): PlannerAnimationScheduler {
  return Object.freeze({
    now: () => performance.now(),
    requestFrame: (callback: () => void) => requestAnimationFrame(callback),
    cancelFrame: (handle: number) => cancelAnimationFrame(handle),
  });
}

function validateBounds(bounds: PlannerPlaybackBounds): PlannerPlaybackBounds {
  if (!Number.isFinite(bounds.startMinutes) || !Number.isFinite(bounds.endMinutes)
    || bounds.startMinutes < 0 || bounds.endMinutes > 24 * 60
    || bounds.endMinutes <= bounds.startMinutes) {
    throw new RangeError("Planner playback requires valid same-day bounds");
  }
  return Object.freeze({ ...bounds });
}

export function createPlannerPlayback(options: PlannerPlaybackOptions): PlannerPlaybackController {
  const scheduler = options.scheduler ?? browserScheduler();
  let reducedMotion = options.reducedMotion ?? false;
  let visible = true;
  let destroyed = false;
  let startedAt: number | null = null;
  let bounds: PlannerPlaybackBounds | null = null;
  let frameHandle: number | null = null;
  let runSequence = 0;
  let activeRun = 0;

  const running = (): boolean => startedAt !== null;
  const clearFrame = (): void => {
    if (frameHandle === null) return;
    const handle = frameHandle;
    frameHandle = null;
    scheduler.cancelFrame(handle);
  };
  const frameFor = (
    activeBounds: PlannerPlaybackBounds,
    progress: number,
    elapsedMilliseconds: number,
  ): PlannerPlaybackFrame => {
    return Object.freeze({
      elapsedMilliseconds,
      minute: activeBounds.startMinutes
        + (activeBounds.endMinutes - activeBounds.startMinutes) * progress,
      progress,
    });
  };
  const finish = (reason: PlannerPlaybackFinishReason): boolean => {
    if (!running()) return false;
    const handle = frameHandle;
    frameHandle = null;
    startedAt = null;
    bounds = null;
    activeRun = 0;
    if (handle !== null) scheduler.cancelFrame(handle);
    options.onFinish?.(reason);
    return true;
  };
  const isActiveRun = (
    run: number,
    activeStartedAt: number,
    activeBounds: PlannerPlaybackBounds,
  ): boolean => !destroyed && visible && activeRun === run
    && startedAt === activeStartedAt && bounds === activeBounds;
  const tick = (run: number): void => {
    frameHandle = null;
    if (destroyed || !visible || activeRun !== run || startedAt === null || bounds === null) return;
    const activeStartedAt = startedAt;
    const activeBounds = bounds;
    const currentTime = scheduler.now();
    if (!isActiveRun(run, activeStartedAt, activeBounds)) return;
    const elapsed = Math.max(0, currentTime - activeStartedAt);
    const progress = Math.min(1, elapsed / PLANNER_PLAYBACK_DURATION_MILLISECONDS);
    options.onFrame(frameFor(activeBounds, progress, elapsed));
    if (!isActiveRun(run, activeStartedAt, activeBounds)) return;
    if (progress >= 1) {
      finish("completed");
      return;
    }
    const handle = scheduler.requestFrame(() => tick(run));
    if (!isActiveRun(run, activeStartedAt, activeBounds)) {
      scheduler.cancelFrame(handle);
      return;
    }
    frameHandle = handle;
  };
  const finishReducedMotion = (
    run: number,
    activeStartedAt: number,
    activeBounds: PlannerPlaybackBounds,
  ): void => {
    options.onFrame(frameFor(activeBounds, 1, 0));
    if (!isActiveRun(run, activeStartedAt, activeBounds)) return;
    finish("completed");
  };

  return Object.freeze({
    get running() {
      return running();
    },
    get reducedMotion() {
      return reducedMotion;
    },
    start(nextBounds: PlannerPlaybackBounds) {
      if (destroyed || !visible || running()) return false;
      const activeBounds = validateBounds(nextBounds);
      runSequence += 1;
      activeRun = runSequence;
      const run = activeRun;
      bounds = activeBounds;
      startedAt = 0;
      const startTime = scheduler.now();
      if (!isActiveRun(run, 0, activeBounds)) return true;
      startedAt = startTime;
      const activeStartedAt = startedAt;
      options.onStart?.();
      if (!isActiveRun(run, activeStartedAt, activeBounds)) return true;
      options.onFrame(frameFor(activeBounds, 0, 0));
      if (!isActiveRun(run, activeStartedAt, activeBounds)) return true;
      if (reducedMotion) {
        finishReducedMotion(run, activeStartedAt, activeBounds);
      } else {
        const handle = scheduler.requestFrame(() => tick(run));
        if (!isActiveRun(run, activeStartedAt, activeBounds)) {
          scheduler.cancelFrame(handle);
          return true;
        }
        frameHandle = handle;
      }
      return true;
    },
    cancel(reason: PlannerPlaybackFinishReason = "cancelled") {
      return finish(reason);
    },
    setReducedMotion(next: boolean) {
      if (destroyed || next === reducedMotion) return;
      reducedMotion = next;
      if (reducedMotion && startedAt !== null && bounds !== null) {
        finishReducedMotion(activeRun, startedAt, bounds);
      }
    },
    setVisible(next: boolean) {
      if (destroyed || next === visible) return;
      visible = next;
      if (!visible) finish("hidden");
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      finish("cancelled");
      clearFrame();
    },
  });
}
