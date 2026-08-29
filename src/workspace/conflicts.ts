import { MUTATION_ACTIONS, type MutationAction } from "./mutations";
import { normalizeVaultRelativePath } from "./text-access";

const MAX_SAFE_CONFLICT_SOURCES = 16;
const MAX_SAFE_SOURCE_PATH_LENGTH = 1_024;

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

function isSafeVaultPath(value: unknown): value is string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAX_SAFE_SOURCE_PATH_LENGTH
    || /[\0\r\n]/.test(value)
  ) return false;
  try {
    return normalizeVaultRelativePath(value) === value;
  } catch {
    return false;
  }
}

function assertNonnegativeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a nonnegative safe integer`);
  }
}

function freezeLocation(location: SafeSourceLocation): SafeSourceLocation {
  if (!isSafeVaultPath(location.path)) throw new TypeError("source path must be a bounded normalized vault-relative path");
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
  if ((input.sources?.length ?? 0) > MAX_SAFE_CONFLICT_SOURCES) {
    throw new RangeError(`Conflict context may identify at most ${MAX_SAFE_CONFLICT_SOURCES} sources`);
  }

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function isSafeLocation(value: unknown): value is SafeSourceLocation {
  if (!isRecord(value) || !hasOnlyKeys(value, ["path", "line", "identitySuffix"])) return false;
  return isSafeVaultPath(value.path)
    && (!hasOwn(value, "line") || (Number.isSafeInteger(value.line) && (value.line as number) >= 0))
    && (!hasOwn(value, "identitySuffix")
      || (typeof value.identitySuffix === "string" && /^[A-Za-z0-9-]{1,16}$/.test(value.identitySuffix)));
}

function hasOptionalNonnegativeInteger(value: Record<string, unknown>, key: string): boolean {
  return !hasOwn(value, key) || (Number.isSafeInteger(value[key]) && (value[key] as number) >= 0);
}

function isSafeContext(value: unknown): value is SafeConflictContext {
  if (!isRecord(value) || !hasOnlyKeys(value, ["action", "sources", "count", "actual", "limit", "stage"])) {
    return false;
  }
  return (!hasOwn(value, "action")
      || (typeof value.action === "string" && (MUTATION_ACTIONS as readonly string[]).includes(value.action)))
    && Array.isArray(value.sources)
    && value.sources.length <= MAX_SAFE_CONFLICT_SOURCES
    && value.sources.every(isSafeLocation)
    && hasOptionalNonnegativeInteger(value, "count")
    && hasOptionalNonnegativeInteger(value, "actual")
    && hasOptionalNonnegativeInteger(value, "limit")
    && hasOptionalNonnegativeInteger(value, "stage");
}

export function isWriteResult(value: unknown): value is WriteResult {
  return isRecord(value)
    && hasOnlyKeys(value, ["code", "context"])
    && isWriteResultCode(value.code)
    && isSafeContext(value.context);
}

export const isCommitConflict = isWriteResult;
