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

  const running = (): boolean => startedAt !== null;
  const clearFrame = (): void => {
    if (frameHandle === null) return;
    scheduler.cancelFrame(frameHandle);
    frameHandle = null;
  };
  const frameFor = (progress: number, elapsedMilliseconds: number): PlannerPlaybackFrame => {
    const activeBounds = bounds!;
    return Object.freeze({
      elapsedMilliseconds,
      minute: activeBounds.startMinutes
        + (activeBounds.endMinutes - activeBounds.startMinutes) * progress,
      progress,
    });
  };
  const finish = (reason: PlannerPlaybackFinishReason): boolean => {
    if (!running()) return false;
    clearFrame();
    startedAt = null;
    bounds = null;
    options.onFinish?.(reason);
    return true;
  };
  const tick = (): void => {
    frameHandle = null;
    if (destroyed || !visible || startedAt === null || bounds === null) return;
    const elapsed = Math.max(0, scheduler.now() - startedAt);
    const progress = Math.min(1, elapsed / PLANNER_PLAYBACK_DURATION_MILLISECONDS);
    options.onFrame(frameFor(progress, elapsed));
    if (progress >= 1) {
      finish("completed");
      return;
    }
    frameHandle = scheduler.requestFrame(tick);
  };
  const finishReducedMotion = (): void => {
    options.onFrame(frameFor(1, 0));
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
      bounds = validateBounds(nextBounds);
      startedAt = scheduler.now();
      options.onStart?.();
      options.onFrame(frameFor(0, 0));
      if (reducedMotion) {
        finishReducedMotion();
      } else {
        frameHandle = scheduler.requestFrame(tick);
      }
      return true;
    },
    cancel(reason: PlannerPlaybackFinishReason = "cancelled") {
      return finish(reason);
    },
    setReducedMotion(next: boolean) {
      if (destroyed || next === reducedMotion) return;
      reducedMotion = next;
      if (reducedMotion && running()) finishReducedMotion();
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
