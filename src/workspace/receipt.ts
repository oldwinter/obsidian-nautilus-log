import type { WriteResult } from "./conflicts";
import { createWriteResult, isWriteResult } from "./conflicts";
import {
  MUTATION_ACTIONS,
  SEMANTIC_CHANGES,
  type MutationAction,
  type SemanticChange,
} from "./mutations";
import type { SourceVersion } from "./source-version";

export const COMMIT_OUTCOMES = Object.freeze([
  "applied",
  "already-applied",
  "rejected",
  "conflict",
  "failed-no-change",
  "uncertain",
  "partial-safe",
  "invariant-broken",
] as const);

export type CommitOutcome = (typeof COMMIT_OUTCOMES)[number];

export const SOURCE_WRITE_PRIMITIVES = Object.freeze([
  "editor",
  "vault-process",
] as const);

export type SourceWritePrimitive = (typeof SOURCE_WRITE_PRIMITIVES)[number];

export const SOURCE_UNDO_SEMANTICS = Object.freeze([
  "single-native-step",
  "not-guaranteed",
] as const);

export type SourceUndoSemantics = (typeof SOURCE_UNDO_SEMANTICS)[number];

export interface SourceReceiptLocation {
  /** Zero-based physical line in the confirmed post-transform source. */
  readonly line: number;
}

export interface SourceReceipt {
  readonly path: string;
  readonly primitive: SourceWritePrimitive;
  readonly before: SourceVersion;
  readonly after: SourceVersion;
  readonly changed: boolean;
  readonly undo: SourceUndoSemantics;
  readonly locations: readonly SourceReceiptLocation[];
}

export interface SourceReceiptInput {
  readonly path: string;
  readonly primitive: SourceWritePrimitive;
  readonly before: SourceVersion;
  readonly after: SourceVersion;
  readonly undo?: SourceUndoSemantics;
  readonly locations: readonly SourceReceiptLocation[];
}

export const RESULTING_IDENTITY_KINDS = Object.freeze([
  "plan-item",
  "clock",
] as const);

export type ResultingIdentityKind = (typeof RESULTING_IDENTITY_KINDS)[number];

export interface ResultingIdentity {
  readonly kind: ResultingIdentityKind;
  readonly id: string;
  readonly path: string;
  readonly line?: number;
}

export const CONFIRMATION_STATUSES = Object.freeze([
  "confirmed",
  "confirmed-no-change",
  "partial",
  "unconfirmed",
  "invariant-broken",
  "not-required",
] as const);

export type ConfirmationStatus = (typeof CONFIRMATION_STATUSES)[number];

export const GLOBAL_CHECK_STATUSES = Object.freeze([
  "confirmed",
  "not-required",
  "unavailable",
  "violated",
] as const);

export type GlobalCheckStatus = (typeof GLOBAL_CHECK_STATUSES)[number];

export interface GlobalCheckReceipt {
  readonly status: GlobalCheckStatus;
  readonly runningClockIds: readonly string[];
}

export interface CommitReceipt {
  readonly intentId: string;
  readonly action: MutationAction;
  readonly outcome: CommitOutcome;
  readonly sources: readonly SourceReceipt[];
  readonly semanticChanges: readonly SemanticChange[];
  readonly resultingIdentities: readonly ResultingIdentity[];
  readonly confirmation: ConfirmationStatus;
  readonly globalCheck: GlobalCheckReceipt;
  readonly result?: WriteResult;
}

export interface CommitReceiptInput {
  readonly intentId: string;
  readonly action: MutationAction;
  readonly outcome: CommitOutcome;
  readonly sources?: readonly SourceReceiptInput[];
  readonly semanticChanges?: readonly SemanticChange[];
  readonly resultingIdentities?: readonly ResultingIdentity[];
  readonly confirmation: ConfirmationStatus;
  readonly globalCheck: GlobalCheckReceipt;
  readonly result?: WriteResult;
}

function assertNonempty(name: string, value: string): void {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0")) {
    throw new TypeError(`${name} must be a non-empty safe string`);
  }
}

function assertNonnegativeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative safe integer`);
  }
}

function freezeVersion(version: SourceVersion): SourceVersion {
  assertNonempty("source version file", version.file);
  if (!/^[0-9a-f]{64}$/.test(version.contentDigest)) {
    throw new TypeError("Source version digest must be a lowercase SHA-256 digest");
  }
  assertNonnegativeInteger("source contentLength", version.contentLength);
  return Object.freeze({
    file: version.file,
    contentDigest: version.contentDigest,
    contentLength: version.contentLength,
  });
}

function versionsDiffer(before: SourceVersion, after: SourceVersion): boolean {
  return before.file !== after.file
    || before.contentDigest !== after.contentDigest
    || before.contentLength !== after.contentLength;
}

export function isCommitOutcome(value: unknown): value is CommitOutcome {
  return typeof value === "string" && (COMMIT_OUTCOMES as readonly string[]).includes(value);
}

export function isSourceWritePrimitive(value: unknown): value is SourceWritePrimitive {
  return typeof value === "string" && (SOURCE_WRITE_PRIMITIVES as readonly string[]).includes(value);
}

export function createSourceReceipt(input: SourceReceiptInput): SourceReceipt {
  assertNonempty("source receipt path", input.path);
  if (!isSourceWritePrimitive(input.primitive)) {
    throw new TypeError(`Unsupported source write primitive: ${String(input.primitive)}`);
  }

  const before = freezeVersion(input.before);
  const after = freezeVersion(input.after);
  if (before.file !== input.path || after.file !== input.path) {
    throw new TypeError("Source receipt path must match both source versions");
  }

  const expectedUndo: SourceUndoSemantics = input.primitive === "editor"
    ? "single-native-step"
    : "not-guaranteed";
  const undo = input.undo ?? expectedUndo;
  if (undo !== expectedUndo) {
    throw new TypeError(`${input.primitive} source receipts must use ${expectedUndo} undo semantics`);
  }
  const locations = Object.freeze(input.locations.map((location) => {
    if (!Number.isSafeInteger(location.line) || location.line < 0) {
      throw new TypeError("Source receipt locations require nonnegative physical lines");
    }
    return Object.freeze({ line: location.line });
  }));
  if (new Set(locations.map(({ line }) => line)).size !== locations.length) {
    throw new TypeError("Source receipt locations must be unique");
  }
  const changed = versionsDiffer(before, after);
  if (changed !== (locations.length > 0)) {
    throw new TypeError("Source receipt locations must identify every changed source and no unchanged source");
  }

  return Object.freeze({
    path: input.path,
    primitive: input.primitive,
    before,
    after,
    changed,
    undo,
    locations,
  });
}

function freezeIdentity(identity: ResultingIdentity): ResultingIdentity {
  if (!(RESULTING_IDENTITY_KINDS as readonly string[]).includes(identity.kind)) {
    throw new TypeError(`Unsupported resulting identity kind: ${String(identity.kind)}`);
  }
  assertNonempty("resulting identity", identity.id);
  assertNonempty("resulting identity path", identity.path);
  if (identity.line !== undefined) assertNonnegativeInteger("resulting identity line", identity.line);
  return Object.freeze({
    kind: identity.kind,
    id: identity.id,
    path: identity.path,
    ...(identity.line === undefined ? {} : { line: identity.line }),
  });
}

function freezeGlobalCheck(check: GlobalCheckReceipt): GlobalCheckReceipt {
  if (!(GLOBAL_CHECK_STATUSES as readonly string[]).includes(check.status)) {
    throw new TypeError(`Unsupported global check status: ${String(check.status)}`);
  }
  for (const id of check.runningClockIds) assertNonempty("running CLOCK identity", id);
  return Object.freeze({
    status: check.status,
    runningClockIds: Object.freeze([...check.runningClockIds].sort()),
  });
}

function assertOutcomeConsistency(receipt: {
  readonly outcome: CommitOutcome;
  readonly sources: readonly SourceReceipt[];
  readonly semanticChanges: readonly SemanticChange[];
  readonly confirmation: ConfirmationStatus;
  readonly globalCheck: GlobalCheckReceipt;
}): void {
  const anyChanged = receipt.sources.some((source) => source.changed);
  if (["already-applied", "rejected", "conflict", "failed-no-change"].includes(receipt.outcome)) {
    if (anyChanged || receipt.semanticChanges.length > 0) {
      throw new TypeError(`${receipt.outcome} receipts must report zero source changes`);
    }
  }
  if (receipt.outcome === "applied" && !anyChanged) {
    throw new TypeError("applied receipts require at least one changed source");
  }
  if ((receipt.outcome === "applied" || receipt.outcome === "already-applied")
    && receipt.confirmation !== "confirmed") {
    throw new TypeError(`${receipt.outcome} receipts require confirmed postconditions`);
  }
  if (receipt.outcome === "failed-no-change" && receipt.confirmation !== "confirmed-no-change") {
    throw new TypeError("failed-no-change receipts require confirmed-no-change confirmation");
  }
  if (receipt.outcome === "partial-safe" && receipt.confirmation !== "partial") {
    throw new TypeError("partial-safe receipts require partial confirmation");
  }
  if (receipt.outcome === "uncertain" && receipt.confirmation !== "unconfirmed") {
    throw new TypeError("uncertain receipts require unconfirmed confirmation");
  }
  if (receipt.outcome === "invariant-broken"
    && receipt.confirmation !== "invariant-broken"
    && receipt.globalCheck.status !== "violated") {
    throw new TypeError("invariant-broken receipts require failed confirmation or a violated global check");
  }
}

export function createCommitReceipt(input: CommitReceiptInput): CommitReceipt {
  assertNonempty("intentId", input.intentId);
  if (!(MUTATION_ACTIONS as readonly string[]).includes(input.action)) {
    throw new TypeError(`Unsupported receipt action: ${String(input.action)}`);
  }
  if (!isCommitOutcome(input.outcome)) {
    throw new TypeError(`Unsupported commit outcome: ${String(input.outcome)}`);
  }
  if (!(CONFIRMATION_STATUSES as readonly string[]).includes(input.confirmation)) {
    throw new TypeError(`Unsupported confirmation status: ${String(input.confirmation)}`);
  }
  if (input.result !== undefined && !isWriteResult(input.result)) {
    throw new TypeError("Commit result detail must contain a stable write result code");
  }

  const sources = Object.freeze((input.sources ?? []).map((source) => createSourceReceipt(source)));
  const paths = new Set<string>();
  for (const source of sources) {
    if (paths.has(source.path)) throw new TypeError(`Commit receipt contains duplicate source: ${source.path}`);
    paths.add(source.path);
  }
  const semanticChanges = Object.freeze([...(input.semanticChanges ?? [])]);
  if (!semanticChanges.every((change) => (SEMANTIC_CHANGES as readonly string[]).includes(change))) {
    throw new TypeError("Commit receipt contains an unsupported semantic change");
  }
  const resultingIdentities = Object.freeze((input.resultingIdentities ?? []).map(freezeIdentity));
  const globalCheck = freezeGlobalCheck(input.globalCheck);
  const result = input.result === undefined
    ? undefined
    : createWriteResult(input.result.code, input.result.context);
  assertOutcomeConsistency({
    outcome: input.outcome,
    sources,
    semanticChanges,
    confirmation: input.confirmation,
    globalCheck,
  });

  return Object.freeze({
    intentId: input.intentId,
    action: input.action,
    outcome: input.outcome,
    sources,
    semanticChanges,
    resultingIdentities,
    confirmation: input.confirmation,
    globalCheck,
    ...(result === undefined ? {} : { result }),
  });
}

export function isCommitReceipt(value: unknown): value is CommitReceipt {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "intentId",
    "action",
    "outcome",
    "sources",
    "semanticChanges",
    "resultingIdentities",
    "confirmation",
    "globalCheck",
    "result",
  ])) return false;
  if (
    !isSafeString(value.intentId)
    || typeof value.action !== "string"
    || !(MUTATION_ACTIONS as readonly string[]).includes(value.action)
    || !isCommitOutcome(value.outcome)
    || !Array.isArray(value.sources)
    || !value.sources.every(isSourceReceipt)
    || new Set(value.sources.map((source) => source.path)).size !== value.sources.length
    || !Array.isArray(value.semanticChanges)
    || !value.semanticChanges.every((change) =>
      typeof change === "string" && (SEMANTIC_CHANGES as readonly string[]).includes(change))
    || !Array.isArray(value.resultingIdentities)
    || !value.resultingIdentities.every(isResultingIdentity)
    || typeof value.confirmation !== "string"
    || !(CONFIRMATION_STATUSES as readonly string[]).includes(value.confirmation)
    || !isGlobalCheck(value.globalCheck)
    || (hasOwn(value, "result") && !isWriteResult(value.result))
  ) return false;
  try {
    assertOutcomeConsistency({
      outcome: value.outcome,
      sources: value.sources,
      semanticChanges: value.semanticChanges,
      confirmation: value.confirmation as ConfirmationStatus,
      globalCheck: value.globalCheck,
    });
    return true;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isSafeString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !value.includes("\0");
}

function isNonnegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isSourceVersion(value: unknown): value is SourceVersion {
  return isRecord(value)
    && hasOnlyKeys(value, ["file", "contentDigest", "contentLength"])
    && isSafeString(value.file)
    && typeof value.contentDigest === "string"
    && /^[0-9a-f]{64}$/.test(value.contentDigest)
    && isNonnegativeInteger(value.contentLength);
}

function isSourceReceipt(value: unknown): value is SourceReceipt {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    "path", "primitive", "before", "after", "changed", "undo", "locations",
  ])) return false;
  if (
    !isSafeString(value.path)
    || !isSourceWritePrimitive(value.primitive)
    || !isSourceVersion(value.before)
    || !isSourceVersion(value.after)
    || value.before.file !== value.path
    || value.after.file !== value.path
    || typeof value.changed !== "boolean"
    || !Array.isArray(value.locations)
    || !value.locations.every((location) => isRecord(location)
      && hasOnlyKeys(location, ["line"])
      && isNonnegativeInteger(location.line))
    || new Set(value.locations.map((location) => (location as SourceReceiptLocation).line)).size !== value.locations.length
  ) return false;
  const expectedUndo: SourceUndoSemantics = value.primitive === "editor"
    ? "single-native-step"
    : "not-guaranteed";
  return value.undo === expectedUndo
    && value.changed === versionsDiffer(value.before, value.after)
    && value.changed === (value.locations.length > 0);
}

function isResultingIdentity(value: unknown): value is ResultingIdentity {
  return isRecord(value)
    && hasOnlyKeys(value, ["kind", "id", "path", "line"])
    && typeof value.kind === "string"
    && (RESULTING_IDENTITY_KINDS as readonly string[]).includes(value.kind)
    && isSafeString(value.id)
    && isSafeString(value.path)
    && (!hasOwn(value, "line") || isNonnegativeInteger(value.line));
}

function isGlobalCheck(value: unknown): value is GlobalCheckReceipt {
  return isRecord(value)
    && hasOnlyKeys(value, ["status", "runningClockIds"])
    && typeof value.status === "string"
    && (GLOBAL_CHECK_STATUSES as readonly string[]).includes(value.status)
    && Array.isArray(value.runningClockIds)
    && value.runningClockIds.every(isSafeString);
}

export function receiptChangedSources(receipt: CommitReceipt): readonly SourceReceipt[] {
  return Object.freeze(receipt.sources.filter((source) => source.changed));
}
