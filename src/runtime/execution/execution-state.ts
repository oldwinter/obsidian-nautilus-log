import type { ExecutionClockIndexState } from "./clock-index";

export type ExecutionReadyState =
  | { readonly kind: "idle" }
  | {
      readonly kind: "active" | "forgotten";
      readonly ownerId: string;
      readonly clockId?: string;
      readonly startEpochMs: number;
      readonly elapsedMs: number;
      readonly taskPomoStartEpochMs: number;
    }
  | {
      readonly kind: "degraded";
      readonly code: Extract<ExecutionClockIndexState, { kind: "degraded" }>["code"];
      readonly count: number;
    };

function boundedElapsed(nowEpochMs: number, startEpochMs: number): number {
  if (!Number.isFinite(nowEpochMs) || !Number.isFinite(startEpochMs)) {
    throw new TypeError("Elapsed time inputs must be finite");
  }
  return Math.max(0, nowEpochMs - startEpochMs);
}

export function isForgotten(
  startEpochMs: number,
  nowEpochMs: number,
  thresholdMinutes: number,
): boolean {
  if (!Number.isFinite(thresholdMinutes) || thresholdMinutes < 0) {
    throw new RangeError("forgotten threshold must be finite and nonnegative");
  }
  return thresholdMinutes > 0
    && boundedElapsed(nowEpochMs, startEpochMs) >= thresholdMinutes * 60_000;
}

export function projectExecutionState(
  clocks: ExecutionClockIndexState,
  nowEpochMs: number,
  taskPomoStartEpochMs: number | null,
  forgottenThresholdMinutes: number,
): ExecutionReadyState {
  if (clocks.kind === "idle") return Object.freeze({ kind: "idle" });
  if (clocks.kind === "degraded") {
    return Object.freeze({ kind: "degraded", code: clocks.code, count: clocks.count });
  }
  const elapsedMs = boundedElapsed(nowEpochMs, clocks.startEpochMs);
  return Object.freeze({
    kind: isForgotten(clocks.startEpochMs, nowEpochMs, forgottenThresholdMinutes)
      ? "forgotten"
      : "active",
    ownerId: clocks.ownerId,
    ...(clocks.clock.clockId ? { clockId: clocks.clock.clockId } : {}),
    startEpochMs: clocks.startEpochMs,
    elapsedMs,
    taskPomoStartEpochMs: taskPomoStartEpochMs ?? clocks.startEpochMs,
  });
}

export interface RecentTaskFact {
  readonly ownerId: string;
  readonly endEpochMs: number;
  readonly ownerState: "todo" | "done" | "ineligible" | "missing";
}

export interface RecentTaskProjection {
  readonly ownerId: string;
  readonly latestEndEpochMs: number;
  readonly minutesRemaining: number;
}

export function projectRecentTasks(
  facts: readonly RecentTaskFact[],
  nowEpochMs: number,
  retentionMinutes: number,
  focusedOwnerId?: string,
): readonly RecentTaskProjection[] {
  if (!Number.isFinite(retentionMinutes) || retentionMinutes < 0) {
    throw new RangeError("recent retention must be finite and nonnegative");
  }
  if (retentionMinutes === 0) return Object.freeze([]);
  const retentionMs = retentionMinutes * 60_000;
  const latest = new Map<string, number>();
  for (const fact of facts) {
    if (fact.ownerState !== "todo" || fact.ownerId === focusedOwnerId) continue;
    const age = nowEpochMs - fact.endEpochMs;
    if (!Number.isFinite(fact.endEpochMs) || age < 0 || age >= retentionMs) continue;
    latest.set(fact.ownerId, Math.max(latest.get(fact.ownerId) ?? -Infinity, fact.endEpochMs));
  }
  return Object.freeze([...latest.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([ownerId, latestEndEpochMs]) => Object.freeze({
      ownerId,
      latestEndEpochMs,
      minutesRemaining: Math.ceil((retentionMs - (nowEpochMs - latestEndEpochMs)) / 60_000),
    })));
}

export interface DeleteClockArm {
  readonly targetKey: string;
  readonly armedAtEpochMs: number;
}

export class DeleteClockConfirmationController {
  readonly #windowMs: number;
  #arm: DeleteClockArm | undefined;

  constructor(windowMs = 2_500) {
    if (!Number.isFinite(windowMs) || windowMs <= 0) {
      throw new RangeError("delete confirmation window must be positive");
    }
    this.#windowMs = windowMs;
  }

  get armed(): DeleteClockArm | undefined {
    return this.#arm;
  }

  activate(targetKey: string, nowEpochMs: number): "armed" | "confirmed" {
    if (targetKey.length === 0 || !Number.isFinite(nowEpochMs)) {
      throw new TypeError("delete confirmation requires a target and finite time");
    }
    const current = this.#arm;
    if (current
      && current.targetKey === targetKey
      && nowEpochMs >= current.armedAtEpochMs
      && nowEpochMs - current.armedAtEpochMs <= this.#windowMs) {
      this.#arm = undefined;
      return "confirmed";
    }
    this.#arm = Object.freeze({ targetKey, armedAtEpochMs: nowEpochMs });
    return "armed";
  }

  clear(): void {
    this.#arm = undefined;
  }
}
