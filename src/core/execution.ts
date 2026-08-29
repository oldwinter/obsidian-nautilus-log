export type ExecutionTaskStatus = "open" | "done" | "plain";

export type ExecutionProgressFact =
  | { readonly kind: "absent" }
  | { readonly kind: "known"; readonly percent: number }
  | { readonly kind: "unknown" };

export interface ExecutionTaskFact {
  readonly path: string;
  readonly ownerId?: string;
  readonly kind: "flexible-task" | "fixed-event";
  readonly status: ExecutionTaskStatus;
  readonly executionEligible: boolean;
  readonly progress: ExecutionProgressFact;
}

export interface ExecutionClockFact {
  readonly path: string;
  readonly ownerId: string;
  readonly clockId?: string;
  readonly startEpochMs: number;
  readonly legacyStartOffsetMinutes?: number;
}

export type ExecutionClockFactState =
  | { readonly kind: "idle" }
  | { readonly kind: "active"; readonly clock: ExecutionClockFact }
  | {
      readonly kind: "degraded";
      readonly code:
        | "clock-index-unavailable"
        | "multiple-running-clocks"
        | "potential-running-clock"
        | "clock-owner-invalid"
        | "stale-clock-session";
    };

export interface ExecutionGeneratedIdentities {
  readonly planItemId?: string;
  readonly openedClockId?: string;
  readonly closedClockId?: string;
}

export interface ExecutionDecisionContext {
  readonly clocks: ExecutionClockFactState;
  readonly nowEpochMs: number;
  readonly offsetMinutes: number;
  readonly generated: ExecutionGeneratedIdentities;
}

export interface DeleteClockConfirmationFact {
  readonly firstActivationEpochMs: number;
  readonly secondActivationEpochMs: number;
  readonly firstTargetKey: string;
  readonly secondTargetKey: string;
}

export type ExecutionDecisionIntent =
  | { readonly type: "clock-in"; readonly target: ExecutionTaskFact }
  | { readonly type: "clock-out" }
  | { readonly type: "complete"; readonly target: ExecutionTaskFact }
  | {
      readonly type: "delete-clock";
      readonly target: ExecutionClockFact;
      readonly confirmation?: DeleteClockConfirmationFact;
    }
  | {
      readonly type: "advance-or-reopen-progress";
      readonly target: ExecutionTaskFact;
      readonly logicalMinute: number;
    };

export type ExecutionDecisionRejectionCode =
  | "clock-state-degraded"
  | "delete-confirmation-required"
  | "generated-identity-collision"
  | "missing-generated-identity"
  | "progress-conflict"
  | "task-not-executable"
  | "target-not-current";

export interface ExecutionCloseDecision {
  readonly clock: ExecutionClockFact;
  readonly assignedClockId?: string;
  readonly endEpochMs: number;
  readonly offsetMinutes: number;
}

export interface ExecutionStartDecision {
  readonly target: ExecutionTaskFact;
  readonly assignedOwnerId?: string;
  readonly clockId: string;
  readonly startEpochMs: number;
  readonly offsetMinutes: number;
}

export type ExecutionCommandDecision =
  | { readonly kind: "rejected"; readonly code: ExecutionDecisionRejectionCode }
  | {
      readonly kind: "no-op";
      readonly action: "clock-in" | "clock-out";
      readonly reason: "already-focused" | "already-idle";
    }
  | { readonly kind: "start"; readonly action: "clock-in"; readonly start: ExecutionStartDecision }
  | {
      readonly kind: "switch";
      readonly action: "switch-task";
      readonly close: ExecutionCloseDecision;
      readonly start: ExecutionStartDecision;
      readonly transitionEpochMs: number;
    }
  | { readonly kind: "stop"; readonly action: "clock-out"; readonly close: ExecutionCloseDecision }
  | {
      readonly kind: "complete";
      readonly action: "complete";
      readonly target: ExecutionTaskFact;
      readonly assignedOwnerId?: string;
      readonly close?: ExecutionCloseDecision;
    }
  | {
      readonly kind: "delete";
      readonly action: "delete-clock";
      readonly target: ExecutionClockFact;
      readonly confirmation: DeleteClockConfirmationFact;
    }
  | {
      readonly kind: "advance-progress";
      readonly action: "advance-progress";
      readonly target: ExecutionTaskFact;
      readonly assignedOwnerId?: string;
      readonly logicalMinute: number;
      readonly close?: ExecutionCloseDecision;
    }
  | {
      readonly kind: "reopen-progress";
      readonly action: "reopen-progress";
      readonly target: ExecutionTaskFact;
      readonly assignedOwnerId?: string;
    };

function assertSafeString(value: string, label: string): void {
  if (typeof value !== "string" || value.length === 0 || /[\0\r\n]/.test(value)) {
    throw new TypeError(`${label} must be a non-empty safe string`);
  }
}

function assertEpoch(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer`);
}

function assertOffset(value: number): void {
  if (!Number.isInteger(value) || value < -14 * 60 || value > 14 * 60) {
    throw new RangeError("offsetMinutes must be an integer UTC offset");
  }
}

function copyProgress(progress: ExecutionProgressFact): ExecutionProgressFact {
  if (progress.kind === "absent" || progress.kind === "unknown") {
    return Object.freeze({ kind: progress.kind });
  }
  if (!Number.isInteger(progress.percent) || progress.percent < 0) {
    throw new RangeError("progress percent must be a nonnegative integer");
  }
  return Object.freeze({ kind: "known", percent: progress.percent });
}

function copyTask(task: ExecutionTaskFact): ExecutionTaskFact {
  assertSafeString(task.path, "task path");
  if (task.ownerId !== undefined) assertSafeString(task.ownerId, "task ownerId");
  if (task.kind !== "flexible-task" && task.kind !== "fixed-event") {
    throw new TypeError("task kind is invalid");
  }
  if (task.status !== "open" && task.status !== "done" && task.status !== "plain") {
    throw new TypeError("task status is invalid");
  }
  if (typeof task.executionEligible !== "boolean") {
    throw new TypeError("task executionEligible must be boolean");
  }
  return Object.freeze({
    path: task.path,
    ...(task.ownerId === undefined ? {} : { ownerId: task.ownerId }),
    kind: task.kind,
    status: task.status,
    executionEligible: task.executionEligible,
    progress: copyProgress(task.progress),
  });
}

function copyClock(clock: ExecutionClockFact): ExecutionClockFact {
  assertSafeString(clock.path, "clock path");
  assertSafeString(clock.ownerId, "clock ownerId");
  if (clock.clockId !== undefined) assertSafeString(clock.clockId, "clock clockId");
  assertEpoch(clock.startEpochMs, "clock startEpochMs");
  if (clock.legacyStartOffsetMinutes !== undefined) {
    assertOffset(clock.legacyStartOffsetMinutes);
  }
  return Object.freeze({
    path: clock.path,
    ownerId: clock.ownerId,
    ...(clock.clockId === undefined ? {} : { clockId: clock.clockId }),
    startEpochMs: clock.startEpochMs,
    ...(clock.legacyStartOffsetMinutes === undefined
      ? {}
      : { legacyStartOffsetMinutes: clock.legacyStartOffsetMinutes }),
  });
}

function rejected(code: ExecutionDecisionRejectionCode): ExecutionCommandDecision {
  return Object.freeze({ kind: "rejected", code });
}

function eligibleTask(task: ExecutionTaskFact): boolean {
  return task.kind === "flexible-task" && task.status === "open" && task.executionEligible;
}

function assignedOwnerId(
  task: ExecutionTaskFact,
  generated: ExecutionGeneratedIdentities,
): string | undefined | null {
  if (task.ownerId !== undefined) return undefined;
  if (generated.planItemId === undefined) return null;
  assertSafeString(generated.planItemId, "generated planItemId");
  return generated.planItemId;
}

function closeDecision(
  clockInput: ExecutionClockFact,
  context: ExecutionDecisionContext,
): ExecutionCloseDecision | null {
  const clock = copyClock(clockInput);
  let assignedClockId: string | undefined;
  if (clock.clockId === undefined) {
    if (context.generated.closedClockId === undefined) return null;
    assertSafeString(context.generated.closedClockId, "generated closedClockId");
    assignedClockId = context.generated.closedClockId;
  }
  return Object.freeze({
    clock,
    ...(assignedClockId === undefined ? {} : { assignedClockId }),
    endEpochMs: context.nowEpochMs,
    offsetMinutes: context.offsetMinutes,
  });
}

function startDecision(
  target: ExecutionTaskFact,
  context: ExecutionDecisionContext,
): ExecutionStartDecision | null {
  const ownerId = assignedOwnerId(target, context.generated);
  if (ownerId === null || context.generated.openedClockId === undefined) return null;
  assertSafeString(context.generated.openedClockId, "generated openedClockId");
  return Object.freeze({
    target,
    ...(ownerId === undefined ? {} : { assignedOwnerId: ownerId }),
    clockId: context.generated.openedClockId,
    startEpochMs: context.nowEpochMs,
    offsetMinutes: context.offsetMinutes,
  });
}

function copyConfirmation(confirmation: DeleteClockConfirmationFact): DeleteClockConfirmationFact {
  assertEpoch(confirmation.firstActivationEpochMs, "firstActivationEpochMs");
  assertEpoch(confirmation.secondActivationEpochMs, "secondActivationEpochMs");
  assertSafeString(confirmation.firstTargetKey, "firstTargetKey");
  assertSafeString(confirmation.secondTargetKey, "secondTargetKey");
  return Object.freeze({ ...confirmation });
}

function activeClock(context: ExecutionDecisionContext): ExecutionClockFact | undefined {
  return context.clocks.kind === "active" ? copyClock(context.clocks.clock) : undefined;
}

function validateContext(context: ExecutionDecisionContext): void {
  assertEpoch(context.nowEpochMs, "nowEpochMs");
  assertOffset(context.offsetMinutes);
  if (context.clocks.kind !== "idle"
    && context.clocks.kind !== "active"
    && context.clocks.kind !== "degraded") {
    throw new TypeError("clock state is invalid");
  }
  if (context.clocks.kind === "active") copyClock(context.clocks.clock);
}

export function decideExecutionCommand(
  intent: ExecutionDecisionIntent,
  context: ExecutionDecisionContext,
): ExecutionCommandDecision {
  validateContext(context);
  if (context.clocks.kind === "degraded") return rejected("clock-state-degraded");

  if (intent.type === "clock-out") {
    const active = activeClock(context);
    if (!active) {
      return Object.freeze({ kind: "no-op", action: "clock-out", reason: "already-idle" });
    }
    const close = closeDecision(active, context);
    return close
      ? Object.freeze({ kind: "stop", action: "clock-out", close })
      : rejected("missing-generated-identity");
  }

  if (intent.type === "delete-clock") {
    const target = copyClock(intent.target);
    const active = activeClock(context);
    const matches = active !== undefined
      && active.path === target.path
      && active.ownerId === target.ownerId
      && active.clockId === target.clockId
      && active.startEpochMs === target.startEpochMs;
    if (!matches) return rejected("target-not-current");
    if (!intent.confirmation) return rejected("delete-confirmation-required");
    return Object.freeze({
      kind: "delete",
      action: "delete-clock",
      target,
      confirmation: copyConfirmation(intent.confirmation),
    });
  }

  const target = copyTask(intent.target);
  if (intent.type === "advance-or-reopen-progress") {
    if (!Number.isInteger(intent.logicalMinute)
      || intent.logicalMinute < 0
      || intent.logicalMinute >= 24 * 60) {
      throw new RangeError("logicalMinute must be within the local day");
    }
    if (target.kind !== "flexible-task") return rejected("task-not-executable");
    const ownerId = assignedOwnerId(target, context.generated);
    if (ownerId === null) return rejected("missing-generated-identity");
    if (target.status === "done") {
      if (target.progress.kind !== "absent") return rejected("progress-conflict");
      return Object.freeze({
        kind: "reopen-progress",
        action: "reopen-progress",
        target,
        ...(ownerId === undefined ? {} : { assignedOwnerId: ownerId }),
      });
    }
    if (!eligibleTask(target) || target.progress.kind === "unknown") {
      return rejected(target.progress.kind === "unknown" ? "progress-conflict" : "task-not-executable");
    }
    let close: ExecutionCloseDecision | undefined;
    const active = activeClock(context);
    const completes = target.progress.kind === "known" && target.progress.percent + 10 === 100;
    if (completes && active !== undefined && active.ownerId === (target.ownerId ?? ownerId)) {
      const prepared = closeDecision(active, context);
      if (!prepared) return rejected("missing-generated-identity");
      close = prepared;
    }
    return Object.freeze({
      kind: "advance-progress",
      action: "advance-progress",
      target,
      ...(ownerId === undefined ? {} : { assignedOwnerId: ownerId }),
      logicalMinute: intent.logicalMinute,
      ...(close === undefined ? {} : { close }),
    });
  }

  if (!eligibleTask(target)) return rejected("task-not-executable");
  const ownerId = assignedOwnerId(target, context.generated);
  if (ownerId === null) return rejected("missing-generated-identity");
  const active = activeClock(context);

  if (intent.type === "complete") {
    let close: ExecutionCloseDecision | undefined;
    if (active !== undefined && active.ownerId === (target.ownerId ?? ownerId)) {
      const prepared = closeDecision(active, context);
      if (!prepared) return rejected("missing-generated-identity");
      close = prepared;
    }
    return Object.freeze({
      kind: "complete",
      action: "complete",
      target,
      ...(ownerId === undefined ? {} : { assignedOwnerId: ownerId }),
      ...(close === undefined ? {} : { close }),
    });
  }

  if (active?.ownerId === (target.ownerId ?? ownerId)) {
    return Object.freeze({ kind: "no-op", action: "clock-in", reason: "already-focused" });
  }
  const start = startDecision(target, context);
  if (!start) return rejected("missing-generated-identity");
  if (!active) return Object.freeze({ kind: "start", action: "clock-in", start });
  const close = closeDecision(active, context);
  if (!close) return rejected("missing-generated-identity");
  if (close.assignedClockId !== undefined && close.assignedClockId === start.clockId) {
    return rejected("generated-identity-collision");
  }
  return Object.freeze({
    kind: "switch",
    action: "switch-task",
    close,
    start,
    transitionEpochMs: context.nowEpochMs,
  });
}
