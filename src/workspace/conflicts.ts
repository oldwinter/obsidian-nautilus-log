import { MUTATION_ACTIONS, type MutationAction } from "./mutations";

export const WRITE_RESULT_CODES = Object.freeze([
  "action-no-longer-applicable",
  "anonymous-source-changed",
  "plan-item-not-found",
  "identity-collision",
  "source-conflict",
  "logbook-ambiguous",
  "clock-has-attached-content",
  "multiple-running-clocks",
  "potential-running-clock",
  "clock-owner-invalid",
  "ambiguous-local-time",
  "nonexistent-local-time",
  "clock-discontinuity",
  "write-failed-no-change",
  "write-outcome-uncertain",
  "partial-switch",
  "plugin-data-failed",
  "write-invariant-broken",
  "source-over-limit",
] as const);

export type WriteResultCode = (typeof WRITE_RESULT_CODES)[number];

export interface SafeSourceLocation {
  readonly path: string;
  readonly line?: number;
  readonly identitySuffix?: string;
}

/**
 * Deliberately closed metadata for notices and routine logs. Source excerpts,
 * arbitrary messages, thrown values, and full identities are not representable.
 */
export interface SafeConflictContext {
  readonly action?: MutationAction;
  readonly sources: readonly SafeSourceLocation[];
  readonly count?: number;
  readonly actual?: number;
  readonly limit?: number;
  readonly stage?: number;
}

export interface SafeConflictContextInput {
  readonly action?: MutationAction;
  readonly sources?: readonly SafeSourceLocation[];
  readonly count?: number;
  readonly actual?: number;
  readonly limit?: number;
  readonly stage?: number;
}

export interface WriteResult {
  readonly code: WriteResultCode;
  readonly context: SafeConflictContext;
}

export type CommitConflict = WriteResult;

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

function freezeLocation(location: SafeSourceLocation): SafeSourceLocation {
  assertNonempty("source path", location.path);
  if (location.line !== undefined) assertNonnegativeInteger("source line", location.line);
  if (location.identitySuffix !== undefined) {
    if (!/^[A-Za-z0-9-]{1,16}$/.test(location.identitySuffix)) {
      throw new TypeError("identitySuffix must contain 1-16 safe identity characters");
    }
  }

  return Object.freeze({
    path: location.path,
    ...(location.line === undefined ? {} : { line: location.line }),
    ...(location.identitySuffix === undefined ? {} : { identitySuffix: location.identitySuffix }),
  });
}

export function isWriteResultCode(value: unknown): value is WriteResultCode {
  return typeof value === "string" && (WRITE_RESULT_CODES as readonly string[]).includes(value);
}

export function createSafeConflictContext(
  input: SafeConflictContextInput = {},
): SafeConflictContext {
  if (input.action !== undefined && !(MUTATION_ACTIONS as readonly string[]).includes(input.action)) {
    throw new TypeError(`Unsupported mutation action: ${String(input.action)}`);
  }
  if (input.count !== undefined) assertNonnegativeInteger("count", input.count);
  if (input.actual !== undefined) assertNonnegativeInteger("actual", input.actual);
  if (input.limit !== undefined) assertNonnegativeInteger("limit", input.limit);
  if (input.stage !== undefined) assertNonnegativeInteger("stage", input.stage);

  return Object.freeze({
    ...(input.action === undefined ? {} : { action: input.action }),
    sources: Object.freeze((input.sources ?? []).map(freezeLocation)),
    ...(input.count === undefined ? {} : { count: input.count }),
    ...(input.actual === undefined ? {} : { actual: input.actual }),
    ...(input.limit === undefined ? {} : { limit: input.limit }),
    ...(input.stage === undefined ? {} : { stage: input.stage }),
  });
}

export function createWriteResult(
  code: WriteResultCode,
  context: SafeConflictContextInput = {},
): WriteResult {
  if (!isWriteResultCode(code)) throw new TypeError(`Unsupported write result code: ${String(code)}`);
  return Object.freeze({ code, context: createSafeConflictContext(context) });
}

export const createCommitConflict = createWriteResult;

export function isWriteResult(value: unknown): value is WriteResult {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<WriteResult>;
  return isWriteResultCode(candidate.code)
    && typeof candidate.context === "object"
    && candidate.context !== null
    && Array.isArray(candidate.context.sources);
}

export const isCommitConflict = isWriteResult;
