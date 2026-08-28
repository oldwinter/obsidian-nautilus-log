import type { SourceSpan } from "./source-version";
import type { ClockSelector, PlanItemSelector } from "./expectation";

export const MUTATION_ACTIONS = Object.freeze([
  "initialize-plan",
  "migrate-plan",
  "assign-plan-item-identity",
  "repair-plan-item-identity",
  "repair-clock-identity",
  "advance-progress",
  "reopen-progress",
  "clock-in",
  "switch-task",
  "clock-out",
  "complete",
  "delete-clock",
  "normalize-legacy-clock",
  "repair-overlap",
  "repair-done-owner-clock",
  "keep-measured-time",
  "use-system-time",
  "stop-at-trusted-time",
] as const);

export type MutationAction = (typeof MUTATION_ACTIONS)[number];

export const SUPPORTED_MIGRATION_SOURCE_VERSIONS: readonly string[] = Object.freeze([]);

export type SemanticChange =
  | "plan-region-inserted"
  | "plan-region-migrated"
  | "plan-item-identity-assigned"
  | "plan-item-identity-repaired"
  | "clock-identity-repaired"
  | "progress-inserted"
  | "progress-updated"
  | "progress-removed"
  | "task-reopened"
  | "task-completed"
  | "completion-anchor-inserted"
  | "completion-anchor-removed"
  | "logbook-inserted"
  | "clock-opened"
  | "clock-closed"
  | "clock-deleted"
  | "legacy-clock-normalized"
  | "clock-rebased";

export interface InitializePlanOperation {
  readonly kind: "initialize-plan";
  readonly insertionOffset: number;
  readonly lineEnding: "\n" | "\r\n" | "\r";
  readonly expectedSource: string;
}

export interface MigratePlanOperation {
  readonly kind: "migrate-plan";
  readonly span: SourceSpan;
  readonly expectedRegion: string;
  readonly replacementRegion: string;
  readonly expectedOldVersion: string;
  readonly expectedPlanItemIds: readonly string[];
  readonly expectedClassifications: readonly MigratePlanItemClassification[];
}

export interface MigratePlanItemClassification {
  readonly id: string;
  readonly kind: "flexible-task" | "fixed-event";
  readonly status: "plain" | "open" | "done";
}

export interface AssignPlanItemIdentityOperation {
  readonly kind: "assign-plan-item-identity";
  readonly target: PlanItemSelector;
  readonly newId: string;
}

export interface RepairPlanItemIdentityOperation {
  readonly kind: "repair-plan-item-identity";
  readonly target: PlanItemSelector & { readonly id: string };
  readonly newId: string;
}

export interface RepairClockIdentityOperation {
  readonly kind: "repair-clock-identity";
  readonly target: ClockSelector & { readonly id: string };
  readonly newId: string;
}

export interface AdvanceProgressOperation {
  readonly kind: "advance-progress";
  readonly target: PlanItemSelector;
  readonly logicalMinute: number;
  readonly generatedPlanItemId?: string;
  readonly closeClock?: CloseClockFacts;
}

export interface ReopenProgressOperation {
  readonly kind: "reopen-progress";
  readonly target: PlanItemSelector;
  readonly generatedPlanItemId?: string;
}

export interface OpenClockFacts {
  readonly clockId: string;
  readonly startEpochMs: number;
  readonly offsetMinutes: number;
}

export interface CloseClockFacts {
  readonly clockId?: string;
  readonly assignedClockId?: string;
  readonly endEpochMs: number;
  readonly offsetMinutes: number;
  readonly legacyStartOffsetMinutes?: number;
}

export interface ClockInOperation {
  readonly kind: "clock-in";
  readonly target: PlanItemSelector;
  readonly generatedPlanItemId?: string;
  readonly clock: OpenClockFacts;
}

export interface ClockOutOperation {
  readonly kind: "clock-out";
  readonly target: ClockSelector;
  readonly close: CloseClockFacts;
}

export interface CompleteOperation {
  readonly kind: "complete";
  readonly target: PlanItemSelector;
  readonly generatedPlanItemId?: string;
  readonly closeClock?: CloseClockFacts;
}

export interface DeleteClockConfirmation {
  readonly firstActivationEpochMs: number;
  readonly secondActivationEpochMs: number;
  readonly firstTargetKey: string;
  readonly secondTargetKey: string;
}

export interface DeleteClockOperation {
  readonly kind: "delete-clock";
  readonly target: ClockSelector;
  readonly confirmation: DeleteClockConfirmation;
}

export interface NormalizeLegacyClockOperation {
  readonly kind: "normalize-legacy-clock";
  readonly target: ClockSelector;
  readonly clockId: string;
  readonly startEpochMs: number;
  readonly startOffsetMinutes: number;
  readonly foldCandidates?: readonly {
    readonly epochMs: number;
    readonly offsetMinutes: number;
  }[];
  readonly endFoldCandidates?: readonly {
    readonly epochMs: number;
    readonly offsetMinutes: number;
  }[];
  readonly endEpochMs?: number;
  readonly endOffsetMinutes?: number;
}

export interface RebaseClockOperation {
  readonly kind: "rebase-clock";
  readonly target: ClockSelector & { readonly id: string };
  readonly startEpochMs: number;
  readonly offsetMinutes: number;
}

export type FileMutationOperation =
  | InitializePlanOperation
  | MigratePlanOperation
  | AssignPlanItemIdentityOperation
  | RepairPlanItemIdentityOperation
  | RepairClockIdentityOperation
  | AdvanceProgressOperation
  | ReopenProgressOperation
  | ClockInOperation
  | ClockOutOperation
  | CompleteOperation
  | DeleteClockOperation
  | NormalizeLegacyClockOperation
  | RebaseClockOperation;

export interface MutationStage {
  readonly path: string;
  readonly operations: readonly FileMutationOperation[];
  readonly confirmationRequired: boolean;
}

export interface MutationPlan {
  readonly intentId: string;
  readonly action: MutationAction;
  readonly stages: readonly MutationStage[];
  readonly expectedRunningClockIds: readonly string[];
  readonly settingsVersion: number;
  readonly zoneId: string;
  readonly transitionEpochMs?: number;
}

export interface ByteEdit {
  readonly fromOffset: number;
  readonly toOffset: number;
  readonly expected: string;
  readonly replacement: string;
  readonly semanticChange: SemanticChange;
}

export interface AppliedByteEdits {
  readonly text: string;
  readonly semanticChanges: readonly SemanticChange[];
}

const ACTION_OPERATION_KINDS: Readonly<Record<MutationAction, readonly FileMutationOperation["kind"][]>> = Object.freeze({
  "initialize-plan": ["initialize-plan"],
  "migrate-plan": ["migrate-plan"],
  "assign-plan-item-identity": ["assign-plan-item-identity"],
  "repair-plan-item-identity": ["repair-plan-item-identity"],
  "repair-clock-identity": ["repair-clock-identity"],
  "advance-progress": ["advance-progress"],
  "reopen-progress": ["reopen-progress"],
  "clock-in": ["clock-in"],
  "switch-task": ["clock-out", "clock-in"],
  "clock-out": ["clock-out"],
  "complete": ["complete"],
  "delete-clock": ["delete-clock"],
  "normalize-legacy-clock": ["normalize-legacy-clock"],
  "repair-overlap": ["clock-out"],
  "repair-done-owner-clock": ["clock-out"],
  "keep-measured-time": ["rebase-clock"],
  "use-system-time": [],
  "stop-at-trusted-time": ["clock-out"],
});

const PREVIEW_CONFIRMATION_ACTIONS: readonly MutationAction[] = Object.freeze([
  "initialize-plan",
  "migrate-plan",
  "repair-plan-item-identity",
  "repair-clock-identity",
  "normalize-legacy-clock",
  "repair-overlap",
  "repair-done-owner-clock",
]);

function assertSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative safe integer`);
  }
}

function assertNonempty(name: string, value: string): void {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function assertMutationPlan(input: MutationPlan): void {
  assertNonempty("intentId", input.intentId);
  assertNonempty("zoneId", input.zoneId);
  assertSafeInteger("settingsVersion", input.settingsVersion);
  if (!MUTATION_ACTIONS.includes(input.action)) throw new TypeError(`Unsupported mutation action: ${input.action}`);
  if (input.stages.length === 0 && input.action !== "use-system-time" && input.action !== "clock-out") {
    throw new TypeError("A Markdown mutation plan must contain at least one stage");
  }
  if (input.action === "use-system-time" && input.stages.length !== 0) {
    throw new TypeError("A read-only recovery action cannot contain mutation stages");
  }
  if (input.action === "clock-out" && input.stages.length === 0 && input.expectedRunningClockIds.length !== 0) {
    throw new TypeError("An empty Clock Out plan requires an empty running-CLOCK set");
  }
  if (input.action === "switch-task" && input.stages.length > 2) {
    throw new TypeError("A task switch may contain only the close and open stages");
  }
  if (input.action === "switch-task" && input.transitionEpochMs === undefined) {
    throw new TypeError("A task switch requires one shared transition instant");
  }
  const stages = input.stages.map((stage) => {
    assertNonempty("stage path", stage.path);
    if (stage.operations.length === 0) throw new TypeError("A mutation stage must contain an operation");
    const allowed = ACTION_OPERATION_KINDS[input.action];
    for (const operation of stage.operations) {
      if (!allowed.includes(operation.kind)) {
        throw new TypeError(`${input.action} cannot carry a ${operation.kind} operation`);
      }
      if (operation.kind === "initialize-plan") {
        assertSafeInteger("initialize insertionOffset", operation.insertionOffset);
        if (!(["\n", "\r\n", "\r"] as const).includes(operation.lineEnding)) {
          throw new TypeError("Initialize requires one recognized Markdown line ending");
        }
      }
      if (operation.kind === "migrate-plan") {
        assertNonempty("migrate expectedOldVersion", operation.expectedOldVersion);
        if (!SUPPORTED_MIGRATION_SOURCE_VERSIONS.includes(operation.expectedOldVersion)) {
          throw new TypeError(`Unsupported migration source grammar: ${operation.expectedOldVersion}`);
        }
        const ids = [...operation.expectedPlanItemIds].sort();
        const classificationIds = operation.expectedClassifications.map(({ id }) => id).sort();
        if (new Set(ids).size !== ids.length || ids.join("\0") !== classificationIds.join("\0")) {
          throw new TypeError("Migrate preview classifications must match its unique Plan Item IDs");
        }
      }
      if (operation.kind === "normalize-legacy-clock") {
        if ((operation.endEpochMs === undefined) !== (operation.endOffsetMinutes === undefined)) {
          throw new TypeError("Closed legacy normalization requires both end instant and end offset");
        }
        if (operation.endFoldCandidates !== undefined && operation.endEpochMs === undefined) {
          throw new TypeError("End fold candidates require a closed legacy endpoint");
        }
      }
      if ("target" in operation && operation.target.kind === "clock") {
        if (operation.target.fromOffset !== undefined) {
          assertSafeInteger("anonymous CLOCK fromOffset", operation.target.fromOffset);
          if (operation.target.id !== undefined) {
            throw new TypeError("Identified CLOCK selectors cannot carry an anonymous locator");
          }
        }
      }
    }
    return Object.freeze({
      path: stage.path,
      operations: Object.freeze([...stage.operations]),
      confirmationRequired: stage.confirmationRequired,
    });
  });
  if (new Set(stages.map((stage) => stage.path)).size !== stages.length) {
    throw new TypeError("All operations for one source must be combined in one atomic stage");
  }
  const operationCount = stages.reduce((count, stage) => count + stage.operations.length, 0);
  if (
    PREVIEW_CONFIRMATION_ACTIONS.includes(input.action)
    && stages.some((stage) => !stage.confirmationRequired)
  ) {
    throw new TypeError(`${input.action} requires an explicitly confirmed preview`);
  }
  const multiRecordRepair = input.action === "repair-overlap" || input.action === "repair-done-owner-clock";
  if (
    input.action !== "switch-task"
    && input.action !== "use-system-time"
    && !(input.action === "clock-out" && operationCount === 0)
    && !multiRecordRepair
    && (stages.length !== 1 || operationCount !== 1)
  ) {
    throw new TypeError(`${input.action} requires exactly one stage and one operation`);
  }
  if (input.action === "switch-task") {
    const operations = stages.flatMap((stage) => stage.operations);
    const closes = operations.filter((operation): operation is ClockOutOperation => operation.kind === "clock-out");
    const opens = operations.filter((operation): operation is ClockInOperation => operation.kind === "clock-in");
    if (closes.length !== 1 || opens.length !== 1) {
      throw new TypeError("A task switch requires exactly one close followed by one open");
    }
    if (
      closes[0]!.close.endEpochMs !== input.transitionEpochMs
      || opens[0]!.clock.startEpochMs !== input.transitionEpochMs
    ) throw new TypeError("A task switch must use its shared transition instant for both endpoints");
    const kinds = operations.map((operation) => operation.kind).join("\0");
    if (kinds !== "clock-out\0clock-in") throw new TypeError("A task switch must close before it opens");
  }
}

export function mutationPlanIsValid(input: MutationPlan): boolean {
  try {
    assertMutationPlan(input);
    return true;
  } catch {
    return false;
  }
}

function frozenClone<T>(value: T): T {
  if (Array.isArray(value)) return Object.freeze(value.map((entry) => frozenClone(entry))) as T;
  if (value !== null && typeof value === "object") {
    const clone = Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, frozenClone(entry)]));
    return Object.freeze(clone) as T;
  }
  return value;
}

export function createMutationPlan(input: MutationPlan): MutationPlan {
  assertMutationPlan(input);
  const stages = input.stages.map((stage) => Object.freeze({
    path: stage.path,
    operations: Object.freeze(stage.operations.map((operation) => frozenClone(operation))),
    confirmationRequired: stage.confirmationRequired,
  }));
  return Object.freeze({
    ...input,
    stages: Object.freeze(stages),
    expectedRunningClockIds: Object.freeze([...input.expectedRunningClockIds].sort()),
  });
}

export function applyAllowedByteEdits(source: string, edits: readonly ByteEdit[]): AppliedByteEdits {
  const descending = [...edits].sort((left, right) =>
    right.fromOffset - left.fromOffset || right.toOffset - left.toOffset,
  );
  let previousFrom = source.length + 1;
  let transformed = source;
  const semanticChanges: SemanticChange[] = [];
  for (const edit of descending) {
    assertSafeInteger("edit.fromOffset", edit.fromOffset);
    assertSafeInteger("edit.toOffset", edit.toOffset);
    if (edit.toOffset < edit.fromOffset || edit.toOffset > source.length) {
      throw new RangeError("Byte edit is outside the source text");
    }
    if (edit.toOffset > previousFrom) throw new RangeError("Byte edit allowlist contains overlapping spans");
    if (source.slice(edit.fromOffset, edit.toOffset) !== edit.expected) {
      throw new Error("Byte edit expected source does not match current text");
    }
    transformed = transformed.slice(0, edit.fromOffset) + edit.replacement + transformed.slice(edit.toOffset);
    previousFrom = edit.fromOffset;
    semanticChanges.push(edit.semanticChange);
  }

  let reconstructed = "";
  let cursor = 0;
  for (const edit of [...descending].reverse()) {
    reconstructed += source.slice(cursor, edit.fromOffset) + edit.replacement;
    cursor = edit.toOffset;
  }
  reconstructed += source.slice(cursor);
  if (reconstructed !== transformed) throw new Error("Byte edit allowlist reconstruction mismatch");
  return Object.freeze({
    text: transformed,
    semanticChanges: Object.freeze(semanticChanges.reverse()),
  });
}

export function deleteConfirmationIsCurrent(
  confirmation: DeleteClockConfirmation,
  maximumDelayMs = 2_500,
): boolean {
  return confirmation.firstTargetKey === confirmation.secondTargetKey
    && Number.isFinite(confirmation.firstActivationEpochMs)
    && Number.isFinite(confirmation.secondActivationEpochMs)
    && confirmation.secondActivationEpochMs >= confirmation.firstActivationEpochMs
    && confirmation.secondActivationEpochMs - confirmation.firstActivationEpochMs <= maximumDelayMs;
}

export function isNoMarkdownAction(action: MutationAction): boolean {
  return action === "use-system-time";
}
