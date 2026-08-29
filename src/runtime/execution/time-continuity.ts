import type { ClockSample, PairedSystemClock, TimerHandle } from "../system-clock";

export type TimeDiscontinuityReason =
  | "wall-backwards"
  | "monotonic-backwards"
  | "wall-monotonic-divergence"
  | "restored-start-in-future";

export type TimeRecoveryChoice = "keep-measured" | "use-system-time" | "stop-at-trusted";

export interface TrustedTimeState {
  readonly kind: "trusted";
  readonly sample: ClockSample;
}

export interface TimeReviewRequiredState {
  readonly kind: "time-review-required";
  readonly reason: TimeDiscontinuityReason;
  readonly lastTrusted: ClockSample;
  readonly observed: ClockSample;
  readonly measuredWallEpochMs: number;
  readonly divergenceMs: number;
  readonly measuredElapsedAvailable: boolean;
}

export type TimeContinuityState = TrustedTimeState | TimeReviewRequiredState;

function freezeSample(sample: ClockSample): ClockSample {
  if (!Number.isFinite(sample.wallEpochMs)
    || !Number.isFinite(sample.monotonicMs)
    || sample.monotonicMs < 0
    || sample.timeZone.length === 0) {
    throw new TypeError("Clock sample is invalid");
  }
  return Object.freeze({ ...sample });
}

export class TimeContinuity {
  readonly #clock: PairedSystemClock;
  readonly #maximumDivergenceMs: number;
  #state: TimeContinuityState | undefined;

  constructor(clock: PairedSystemClock, maximumDivergenceMs = 5_000) {
    if (!Number.isFinite(maximumDivergenceMs) || maximumDivergenceMs < 0) {
      throw new RangeError("maximumDivergenceMs must be finite and nonnegative");
    }
    this.#clock = clock;
    this.#maximumDivergenceMs = maximumDivergenceMs;
  }

  get state(): TimeContinuityState | undefined {
    return this.#state;
  }

  observe(sample = this.#clock.sample()): TimeContinuityState {
    const observed = freezeSample(sample);
    if (this.#state?.kind === "time-review-required") return this.#state;
    if (!this.#state) {
      this.#state = Object.freeze({ kind: "trusted", sample: observed });
      return this.#state;
    }

    const lastTrusted = this.#state.sample;
    const monotonicElapsed = observed.monotonicMs - lastTrusted.monotonicMs;
    const measuredWallEpochMs = lastTrusted.wallEpochMs + Math.max(0, monotonicElapsed);
    const divergenceMs = observed.wallEpochMs - measuredWallEpochMs;
    const reason = monotonicElapsed < 0
      ? "monotonic-backwards"
      : observed.wallEpochMs < lastTrusted.wallEpochMs
        ? "wall-backwards"
        : Math.abs(divergenceMs) > this.#maximumDivergenceMs
          ? "wall-monotonic-divergence"
          : undefined;

    if (reason) {
      this.#state = Object.freeze({
        kind: "time-review-required",
        reason,
        lastTrusted,
        observed,
        measuredWallEpochMs,
        divergenceMs,
        measuredElapsedAvailable: true,
      });
    } else {
      this.#state = Object.freeze({ kind: "trusted", sample: observed });
    }
    return this.#state;
  }

  previewResolution(choice: TimeRecoveryChoice): ClockSample {
    if (this.#state?.kind !== "time-review-required") {
      throw new Error("No time discontinuity is awaiting review");
    }
    const review = this.#state;
    if (choice === "keep-measured" && !review.measuredElapsedAvailable) {
      throw new Error("Measured elapsed is unavailable after process restart");
    }
    const selected = choice === "keep-measured"
      ? { ...review.observed, wallEpochMs: review.measuredWallEpochMs }
      : choice === "use-system-time"
        ? review.observed
        : review.lastTrusted;
    return freezeSample(selected);
  }

  resolve(choice: TimeRecoveryChoice): ClockSample {
    const sample = this.previewResolution(choice);
    this.#state = Object.freeze({ kind: "trusted", sample });
    return sample;
  }

  reanchor(sample = this.#clock.sample()): ClockSample {
    const anchored = freezeSample(sample);
    this.#state = Object.freeze({ kind: "trusted", sample: anchored });
    return anchored;
  }

  restore(sample: ClockSample, activeStartEpochMs?: number): TimeContinuityState {
    const anchored = this.reanchor(sample);
    if (activeStartEpochMs === undefined) return this.#state!;
    if (!Number.isFinite(activeStartEpochMs)) throw new TypeError("Restored start must be finite");
    if (activeStartEpochMs <= anchored.wallEpochMs) return this.#state!;
    this.#state = Object.freeze({
      kind: "time-review-required",
      reason: "restored-start-in-future",
      lastTrusted: anchored,
      observed: anchored,
      measuredWallEpochMs: anchored.wallEpochMs,
      divergenceMs: activeStartEpochMs - anchored.wallEpochMs,
      measuredElapsedAvailable: false,
    });
    return this.#state;
  }

  canResolve(choice: TimeRecoveryChoice): boolean {
    return this.#state?.kind === "time-review-required"
      && (choice !== "keep-measured" || this.#state.measuredElapsedAvailable);
  }
}

export type RefreshScope = "startup-all-logbooks" | "relevant-tasks";

export interface ExecutionTickerCallbacks {
  readonly onTick: (sample: ClockSample) => void;
  readonly onRefresh: (scope: RefreshScope, sample: ClockSample) => void;
}

export class ExecutionTicker {
  readonly #clock: PairedSystemClock;
  readonly #callbacks: ExecutionTickerCallbacks;
  readonly #tickMilliseconds: number;
  readonly #refreshMilliseconds: number;
  #timer: TimerHandle | undefined;
  #active = false;
  #lastRefreshMonotonicMs = 0;

  constructor(
    clock: PairedSystemClock,
    callbacks: ExecutionTickerCallbacks,
    tickMilliseconds = 1_000,
    refreshMilliseconds = 15_000,
  ) {
    if (!Number.isFinite(tickMilliseconds) || tickMilliseconds <= 0) {
      throw new RangeError("tickMilliseconds must be positive");
    }
    if (!Number.isFinite(refreshMilliseconds) || refreshMilliseconds < tickMilliseconds) {
      throw new RangeError("refreshMilliseconds must be at least one tick");
    }
    this.#clock = clock;
    this.#callbacks = callbacks;
    this.#tickMilliseconds = tickMilliseconds;
    this.#refreshMilliseconds = refreshMilliseconds;
  }

  get running(): boolean {
    return this.#active;
  }

  start(): void {
    if (this.#active) return;
    this.#active = true;
    const sample = this.#clock.sample();
    this.#lastRefreshMonotonicMs = sample.monotonicMs;
    try {
      this.#callbacks.onRefresh("startup-all-logbooks", sample);
      if (this.#active) this.#schedule();
    } catch (error) {
      this.#active = false;
      throw error;
    }
  }

  stop(): void {
    if (!this.#active) return;
    this.#active = false;
    if (this.#timer !== undefined) this.#clock.clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #schedule(): void {
    this.#timer = this.#clock.setTimeout(() => {
      this.#timer = undefined;
      const sample = this.#clock.sample();
      try {
        this.#callbacks.onTick(sample);
        if (this.#active
          && sample.monotonicMs - this.#lastRefreshMonotonicMs >= this.#refreshMilliseconds) {
          this.#lastRefreshMonotonicMs = sample.monotonicMs;
          this.#callbacks.onRefresh("relevant-tasks", sample);
        }
      } catch (error) {
        this.#active = false;
        throw error;
      }
      if (this.#active) this.#schedule();
    }, this.#tickMilliseconds);
  }
}
