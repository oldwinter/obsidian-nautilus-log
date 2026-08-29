import type {
  IndexedClockSource,
  WorkspaceIndex,
  WorkspaceIndexIncompleteReason,
  WorkspaceIndexSnapshot,
} from "../../workspace/identity-index";

export type ClockOwnerState = "eligible" | "done" | "ineligible" | "missing" | "collision" | "stale";

export interface ClockOwnerResolution {
  readonly state: ClockOwnerState;
  readonly ownerId?: string;
}

export type ClockOwnerResolver = (
  clock: IndexedClockSource,
) => ClockOwnerResolution | Promise<ClockOwnerResolution>;

export type ExecutionClockDiagnosticCode =
  | "clock-index-unavailable"
  | "multiple-running-clocks"
  | "potential-running-clock"
  | "clock-owner-invalid"
  | "stale-clock-session";

export interface IdleClockIndexState {
  readonly kind: "idle";
  readonly generation: number;
}

export interface ActiveClockIndexState {
  readonly kind: "active";
  readonly generation: number;
  readonly clock: IndexedClockSource;
  readonly ownerId: string;
  readonly startEpochMs: number;
}

export interface DegradedClockIndexState {
  readonly kind: "degraded";
  readonly generation: number;
  readonly code: ExecutionClockDiagnosticCode;
  readonly count: number;
  readonly reason?: WorkspaceIndexIncompleteReason;
  readonly clocks: readonly IndexedClockSource[];
}

export type ExecutionClockIndexState =
  | IdleClockIndexState
  | ActiveClockIndexState
  | DegradedClockIndexState;

function degraded(
  snapshot: WorkspaceIndexSnapshot,
  code: ExecutionClockDiagnosticCode,
  clocks: readonly IndexedClockSource[],
  reason?: WorkspaceIndexIncompleteReason,
): DegradedClockIndexState {
  return Object.freeze({
    kind: "degraded",
    generation: snapshot.generation,
    code,
    count: clocks.length,
    ...(reason ? { reason } : {}),
    clocks: Object.freeze([...clocks]),
  });
}

export async function projectClockIndex(
  snapshot: WorkspaceIndexSnapshot,
  resolveOwner: ClockOwnerResolver,
): Promise<ExecutionClockIndexState> {
  if (!snapshot.complete) {
    return degraded(snapshot, "clock-index-unavailable", [], snapshot.reason ?? "not-built");
  }
  if (snapshot.potentialRunning.length > 0) {
    return degraded(snapshot, "potential-running-clock", snapshot.potentialRunning);
  }
  if (snapshot.running.length > 1) {
    return degraded(snapshot, "multiple-running-clocks", snapshot.running);
  }
  const clock = snapshot.running[0];
  if (!clock) return Object.freeze({ kind: "idle", generation: snapshot.generation });

  const owner = await resolveOwner(clock);
  if (owner.state === "stale") return degraded(snapshot, "stale-clock-session", [clock]);
  if (owner.state !== "eligible" || !owner.ownerId) {
    return degraded(snapshot, "clock-owner-invalid", [clock]);
  }
  if (clock.parsed.kind !== "record" || clock.parsed.record.state !== "running") {
    return degraded(snapshot, "potential-running-clock", [clock]);
  }
  return Object.freeze({
    kind: "active",
    generation: snapshot.generation,
    clock,
    ownerId: owner.ownerId,
    startEpochMs: clock.parsed.record.startEpochMs,
  });
}

export class ExecutionClockIndex {
  readonly #index: WorkspaceIndex;
  readonly #resolveOwner: ClockOwnerResolver;

  constructor(index: WorkspaceIndex, resolveOwner: ClockOwnerResolver) {
    this.#index = index;
    this.#resolveOwner = resolveOwner;
  }

  async scan(signal?: AbortSignal): Promise<ExecutionClockIndexState> {
    await this.#index.rebuild(signal);
    return projectClockIndex(this.#index.safetySnapshot, this.#resolveOwner);
  }

  current(): Promise<ExecutionClockIndexState> {
    return projectClockIndex(this.#index.safetySnapshot, this.#resolveOwner);
  }
}
