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

export const SEMANTIC_CHANGES = Object.freeze([
  "plan-region-inserted",
  "plan-region-migrated",
  "plan-item-identity-assigned",
  "plan-item-identity-repaired",
  "clock-identity-repaired",
  "progress-inserted",
  "progress-updated",
  "progress-removed",
  "task-reopened",
  "task-completed",
  "completion-anchor-inserted",
  "completion-anchor-removed",
  "logbook-inserted",
  "clock-opened",
  "clock-closed",
  "clock-deleted",
  "legacy-clock-normalized",
  "clock-rebased",
] as const);

export const SUPPORTED_MIGRATION_SOURCE_VERSIONS: readonly string[] = Object.freeze([]);

export type SemanticChange = (typeof SEMANTIC_CHANGES)[number];

export interface InitializePlanOperation {
  readonly kind: "initialize-plan";
  readonly insertionOffset: number;
  readonly lineEnding: "\n" | "\r\n";
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
  /** SHA-256 of the complete normalized preview plan, excluding this field. */
  readonly previewToken: string;
}

export type MutationPlanInput = Omit<MutationPlan, "previewToken"> & {
  readonly previewToken?: string;
};

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

function assertMutationPlan(input: MutationPlanInput): void {
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
    if (typeof stage.confirmationRequired !== "boolean") {
      throw new TypeError("stage confirmationRequired must be boolean");
    }
    if (stage.operations.length === 0) throw new TypeError("A mutation stage must contain an operation");
    const allowed = ACTION_OPERATION_KINDS[input.action];
    for (const operation of stage.operations) {
      if (!allowed.includes(operation.kind)) {
        throw new TypeError(`${input.action} cannot carry a ${operation.kind} operation`);
      }
      if (operation.kind === "initialize-plan") {
        assertSafeInteger("initialize insertionOffset", operation.insertionOffset);
        if (!(["\n", "\r\n"] as const).includes(operation.lineEnding)) {
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
    return mutationPlanPreviewTokenMatches(input);
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

const SHA256_ROUND_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotateRight(value: number, count: number): number {
  return value >>> count | value << (32 - count);
}

function sha256Hex(value: string): string {
  const input = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const bytes = new Uint8Array(paddedLength);
  bytes.set(input);
  bytes[input.length] = 0x80;
  const bitLength = input.length * 8;
  const view = new DataView(bytes.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  const state = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let offset = 0; offset < bytes.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) words[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const before15 = words[index - 15]!;
      const before2 = words[index - 2]!;
      const sigma0 = rotateRight(before15, 7) ^ rotateRight(before15, 18) ^ before15 >>> 3;
      const sigma1 = rotateRight(before2, 17) ^ rotateRight(before2, 19) ^ before2 >>> 10;
      words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0;
    }

    let a = state[0]!;
    let b = state[1]!;
    let c = state[2]!;
    let d = state[3]!;
    let e = state[4]!;
    let f = state[5]!;
    let g = state[6]!;
    let h = state[7]!;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = e & f ^ ~e & g;
      const temporary1 = (h + sum1 + choose + SHA256_ROUND_CONSTANTS[index]! + words[index]!) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = a & b ^ a & c ^ b & c;
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    state[0] = (state[0]! + a) >>> 0;
    state[1] = (state[1]! + b) >>> 0;
    state[2] = (state[2]! + c) >>> 0;
    state[3] = (state[3]! + d) >>> 0;
    state[4] = (state[4]! + e) >>> 0;
    state[5] = (state[5]! + f) >>> 0;
    state[6] = (state[6]! + g) >>> 0;
    state[7] = (state[7]! + h) >>> 0;
  }
  return Array.from(state, (word) => word.toString(16).padStart(8, "0")).join("");
}

function canonicalPreviewValue(value: unknown, omitPreviewToken = false): string {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Mutation previews cannot contain non-finite numbers");
    return Object.is(value, -0) ? "-0" : String(value);
  }
  if (Array.isArray(value)) return `[${value.map((entry) => canonicalPreviewValue(entry)).join(",")}]`;
  if (typeof value !== "object") throw new TypeError("Mutation previews contain unsupported values");
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined && (!omitPreviewToken || key !== "previewToken"))
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalPreviewValue(record[key])}`).join(",")}}`;
}

export function createMutationPreviewToken(plan: MutationPlanInput): string {
  return `sha256:${sha256Hex(canonicalPreviewValue(plan, true))}`;
}

export function createCanonicalPreviewToken(value: unknown): string {
  return `sha256:${sha256Hex(canonicalPreviewValue(value))}`;
}

export function isMutationPreviewToken(value: unknown): value is string {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

export function mutationPlanPreviewTokenMatches(plan: MutationPlan): boolean {
  return isMutationPreviewToken(plan.previewToken)
    && createMutationPreviewToken(plan) === plan.previewToken;
}

export function createMutationPlan(input: MutationPlanInput): MutationPlan {
  assertMutationPlan(input);
  const stages = input.stages.map((stage) => Object.freeze({
    path: stage.path,
    operations: Object.freeze(stage.operations.map((operation) => frozenClone(operation))),
    confirmationRequired: stage.confirmationRequired,
  }));
  const normalized = {
    ...input,
    stages: Object.freeze(stages),
    expectedRunningClockIds: Object.freeze([...input.expectedRunningClockIds].sort()),
  };
  const previewToken = createMutationPreviewToken(normalized);
  if (input.previewToken !== undefined && input.previewToken !== previewToken) {
    throw new TypeError("Mutation plan no longer matches its confirmed preview token");
  }
  return Object.freeze({ ...normalized, previewToken });
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
