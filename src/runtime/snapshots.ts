import type { LogicalDate } from "../core/day";
import { normalizeVaultRelativePath } from "../workspace/text-access";

export type DeepReadonly<T> = T extends (...arguments_: never[]) => unknown
  ? never
  : T extends readonly (infer TItem)[]
    ? readonly DeepReadonly<TItem>[]
    : T extends object
      ? { readonly [TKey in keyof T]: DeepReadonly<T[TKey]> }
      : T;

export interface ProjectionRevisionInput {
  readonly generation: number;
  readonly path: string;
  readonly sourceFingerprint: string | null;
  readonly settingsVersion: number;
  readonly logicalDate: LogicalDate;
  readonly minuteBucket: number;
  readonly timeZone: string;
  readonly grammarVersion: string;
}

export interface ProjectionRevision extends ProjectionRevisionInput {}

export type RuntimeDiagnosticRetry = "event" | "explicit" | "reload" | "none";
export type RuntimeDiagnosticContextValue = string | number | boolean | null;

export interface RuntimeDiagnostic {
  readonly code: string;
  readonly retry: RuntimeDiagnosticRetry;
  readonly context?: Readonly<Record<string, RuntimeDiagnosticContextValue>>;
}

export interface RuntimeOverLimit {
  readonly kind: string;
  readonly actual: number;
  readonly limit: number;
}

export type SnapshotStaleReason =
  | "invalidated"
  | "superseded"
  | "read-failed"
  | "cancelled";

interface RuntimeSnapshotBase {
  readonly revision: ProjectionRevision;
  readonly mutationCapability: null;
  readonly diagnostic?: RuntimeDiagnostic;
}

export interface LoadingRuntimeSnapshot extends RuntimeSnapshotBase {
  readonly state: "loading";
  readonly authoritative: false;
}

export interface ConfirmedRuntimeSnapshot<TProjection> extends RuntimeSnapshotBase {
  readonly state: "confirmed";
  readonly authoritative: true;
  readonly projection: DeepReadonly<TProjection>;
}

export interface StaleRuntimeSnapshot extends RuntimeSnapshotBase {
  readonly state: "stale";
  readonly authoritative: false;
  readonly reason: SnapshotStaleReason;
}

export interface MissingRuntimeSnapshot extends RuntimeSnapshotBase {
  readonly state: "missing";
  readonly authoritative: false;
}

export interface OverLimitRuntimeSnapshot extends RuntimeSnapshotBase {
  readonly state: "over-limit";
  readonly authoritative: false;
  readonly overLimit: Readonly<RuntimeOverLimit>;
}

export interface ErrorRuntimeSnapshot extends RuntimeSnapshotBase {
  readonly state: "error";
  readonly authoritative: false;
  readonly diagnostic: RuntimeDiagnostic;
}

export interface HiddenRuntimeSnapshot extends RuntimeSnapshotBase {
  readonly state: "hidden";
  readonly authoritative: false;
  readonly dirty: boolean;
}

export type RuntimeSnapshot<TProjection = unknown> =
  | LoadingRuntimeSnapshot
  | ConfirmedRuntimeSnapshot<TProjection>
  | StaleRuntimeSnapshot
  | MissingRuntimeSnapshot
  | OverLimitRuntimeSnapshot
  | ErrorRuntimeSnapshot
  | HiddenRuntimeSnapshot;

type SnapshotInputBase = {
  readonly revision: ProjectionRevisionInput;
  readonly diagnostic?: RuntimeDiagnostic;
};

export type RuntimeSnapshotInput<TProjection> =
  | (SnapshotInputBase & {
      readonly state: "loading";
    })
  | (SnapshotInputBase & {
      readonly state: "confirmed";
      readonly projection: TProjection;
    })
  | (SnapshotInputBase & {
      readonly state: "stale";
      readonly reason: SnapshotStaleReason;
    })
  | (SnapshotInputBase & {
      readonly state: "missing";
    })
  | (SnapshotInputBase & {
      readonly state: "over-limit";
      readonly overLimit: RuntimeOverLimit;
    })
  | {
      readonly state: "error";
      readonly revision: ProjectionRevisionInput;
      readonly diagnostic: RuntimeDiagnostic;
    }
  | (SnapshotInputBase & {
      readonly state: "hidden";
      readonly dirty: boolean;
    });

const RAW_SOURCE_FIELDS = new Set([
  "sourceText",
  "firstLineText",
  "segmentIndex",
  "fromOffset",
  "toOffset",
]);
const DIAGNOSTIC_RETRIES = new Set<RuntimeDiagnosticRetry>([
  "event",
  "explicit",
  "reload",
  "none",
]);

function assertNonemptyString(value: string, name: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function assertSafeInteger(value: number, name: string, minimum?: number): void {
  if (!Number.isSafeInteger(value) || (minimum !== undefined && value < minimum)) {
    throw new RangeError(`${name} must be a safe integer${minimum === undefined ? "" : ` >= ${minimum}`}`);
  }
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function copyLogicalDate(date: LogicalDate): LogicalDate {
  if (
    date === null
    || typeof date !== "object"
    || !Number.isInteger(date.year)
    || date.year < 1
    || date.year > 9_999
    || !Number.isInteger(date.month)
    || date.month < 1
    || date.month > 12
    || !Number.isInteger(date.day)
    || date.day < 1
    || date.day > daysInMonth(date.year, date.month)
  ) {
    throw new RangeError("logicalDate must be a valid calendar date");
  }
  return Object.freeze({ year: date.year, month: date.month, day: date.day });
}

export function createProjectionRevision(input: ProjectionRevisionInput): ProjectionRevision {
  assertSafeInteger(input.generation, "generation", 0);
  assertSafeInteger(input.settingsVersion, "settingsVersion", 0);
  assertSafeInteger(input.minuteBucket, "minuteBucket");
  if (input.sourceFingerprint !== null) {
    assertNonemptyString(input.sourceFingerprint, "sourceFingerprint");
  }
  assertNonemptyString(input.timeZone, "timeZone");
  assertNonemptyString(input.grammarVersion, "grammarVersion");
  return Object.freeze({
    generation: input.generation,
    path: normalizeVaultRelativePath(input.path),
    sourceFingerprint: input.sourceFingerprint,
    settingsVersion: input.settingsVersion,
    logicalDate: copyLogicalDate(input.logicalDate),
    minuteBucket: input.minuteBucket,
    timeZone: input.timeZone,
    grammarVersion: input.grammarVersion,
  });
}

export function isRevisionNewer(
  candidate: ProjectionRevision,
  current: ProjectionRevision,
): boolean {
  return candidate.generation > current.generation;
}

function clonePlainValue(
  value: unknown,
  seen: WeakMap<object, unknown>,
  fieldPath: string,
): unknown {
  if (value === null || value === undefined) return value;
  if (["string", "number", "boolean", "bigint"].includes(typeof value)) return value;
  if (typeof value === "symbol" || typeof value === "function") {
    throw new TypeError(`Snapshot payload ${fieldPath} must contain data only`);
  }

  const source = value as object;
  const existing = seen.get(source);
  if (existing !== undefined) return existing;
  const prototype = Object.getPrototypeOf(source) as object | null;
  if (prototype !== Object.prototype && prototype !== null && !Array.isArray(source)) {
    throw new TypeError(`Snapshot payload ${fieldPath} must contain plain objects and arrays only`);
  }

  if (Array.isArray(source)) {
    const clone: unknown[] = [];
    seen.set(source, clone);
    for (const [index, item] of source.entries()) {
      clone.push(clonePlainValue(item, seen, `${fieldPath}[${index}]`));
    }
    return Object.freeze(clone);
  }

  const clone = Object.create(prototype) as Record<string, unknown>;
  seen.set(source, clone);
  for (const propertyKey of Reflect.ownKeys(source)) {
    if (typeof propertyKey !== "string") {
      throw new TypeError(`Snapshot payload ${fieldPath} must not contain symbol keys`);
    }
    if (RAW_SOURCE_FIELDS.has(propertyKey)) {
      throw new TypeError(`Snapshot payload ${fieldPath}.${propertyKey} exposes source material`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(source, propertyKey);
    if (!descriptor || !("value" in descriptor)) {
      throw new TypeError(`Snapshot payload ${fieldPath}.${propertyKey} must be a data property`);
    }
    Object.defineProperty(clone, propertyKey, {
      configurable: false,
      enumerable: descriptor.enumerable ?? false,
      value: clonePlainValue(descriptor.value, seen, `${fieldPath}.${propertyKey}`),
      writable: false,
    });
  }
  return Object.freeze(clone);
}

export function deepImmutableCopy<T>(value: T): DeepReadonly<T> {
  return clonePlainValue(value, new WeakMap(), "root") as DeepReadonly<T>;
}

function diagnosticFields(
  diagnostic: RuntimeDiagnostic | undefined,
): { readonly diagnostic?: RuntimeDiagnostic } {
  if (!diagnostic) return {};
  assertNonemptyString(diagnostic.code, "diagnostic.code");
  if (!DIAGNOSTIC_RETRIES.has(diagnostic.retry)) {
    throw new TypeError("diagnostic.retry is invalid");
  }
  if (diagnostic.context !== undefined) {
    for (const [key, value] of Object.entries(diagnostic.context)) {
      assertNonemptyString(key, "diagnostic.context key");
      if (
        value !== null
        && typeof value !== "string"
        && typeof value !== "boolean"
        && (typeof value !== "number" || !Number.isFinite(value))
      ) {
        throw new TypeError(`diagnostic.context.${key} must be a finite scalar`);
      }
    }
  }
  return { diagnostic: deepImmutableCopy(diagnostic) };
}

export function createRuntimeSnapshot<TProjection>(
  input: RuntimeSnapshotInput<TProjection>,
): RuntimeSnapshot<TProjection> {
  const revision = createProjectionRevision(input.revision);
  const base = {
    revision,
    mutationCapability: null,
    ...diagnosticFields(input.diagnostic),
  } as const;

  switch (input.state) {
    case "loading":
      return Object.freeze({ ...base, state: "loading", authoritative: false });
    case "confirmed":
      return Object.freeze({
        ...base,
        state: "confirmed",
        authoritative: true,
        projection: deepImmutableCopy(input.projection),
      });
    case "stale":
      return Object.freeze({
        ...base,
        state: "stale",
        authoritative: false,
        reason: input.reason,
      });
    case "missing":
      return Object.freeze({ ...base, state: "missing", authoritative: false });
    case "over-limit":
      assertNonemptyString(input.overLimit.kind, "overLimit.kind");
      assertSafeInteger(input.overLimit.actual, "overLimit.actual", 0);
      assertSafeInteger(input.overLimit.limit, "overLimit.limit", 0);
      return Object.freeze({
        ...base,
        state: "over-limit",
        authoritative: false,
        overLimit: Object.freeze({ ...input.overLimit }),
      });
    case "error":
      return Object.freeze({
        ...base,
        state: "error",
        authoritative: false,
        diagnostic: diagnosticFields(input.diagnostic).diagnostic!,
      });
    case "hidden":
      return Object.freeze({
        ...base,
        state: "hidden",
        authoritative: false,
        dirty: input.dirty,
      });
  }
}

export function loadingSnapshot(revision: ProjectionRevisionInput): LoadingRuntimeSnapshot {
  return createRuntimeSnapshot({ state: "loading", revision }) as LoadingRuntimeSnapshot;
}

export function confirmedSnapshot<TProjection>(
  revision: ProjectionRevisionInput,
  projection: TProjection,
  diagnostic?: RuntimeDiagnostic,
): ConfirmedRuntimeSnapshot<TProjection> {
  return createRuntimeSnapshot({
    state: "confirmed",
    revision,
    projection,
    ...(diagnostic ? { diagnostic } : {}),
  }) as ConfirmedRuntimeSnapshot<TProjection>;
}

export function missingSnapshot(
  revision: ProjectionRevisionInput,
  diagnostic?: RuntimeDiagnostic,
): MissingRuntimeSnapshot {
  return createRuntimeSnapshot({
    state: "missing",
    revision,
    ...(diagnostic ? { diagnostic } : {}),
  }) as MissingRuntimeSnapshot;
}

export function overLimitSnapshot(
  revision: ProjectionRevisionInput,
  overLimit: RuntimeOverLimit,
  diagnostic?: RuntimeDiagnostic,
): OverLimitRuntimeSnapshot {
  return createRuntimeSnapshot({
    state: "over-limit",
    revision,
    overLimit,
    ...(diagnostic ? { diagnostic } : {}),
  }) as OverLimitRuntimeSnapshot;
}

export function errorSnapshot(
  revision: ProjectionRevisionInput,
  diagnostic: RuntimeDiagnostic,
): ErrorRuntimeSnapshot {
  return createRuntimeSnapshot({
    state: "error",
    revision,
    diagnostic,
  }) as ErrorRuntimeSnapshot;
}

export function hiddenSnapshot(
  revision: ProjectionRevisionInput,
  dirty = true,
): HiddenRuntimeSnapshot {
  return createRuntimeSnapshot({
    state: "hidden",
    revision,
    dirty,
  }) as HiddenRuntimeSnapshot;
}

export function staleSnapshot<TProjection>(
  snapshot: RuntimeSnapshot<TProjection>,
  revision: ProjectionRevisionInput = snapshot.revision,
  reason: SnapshotStaleReason = "invalidated",
): StaleRuntimeSnapshot {
  const nextRevision = createProjectionRevision(revision);
  if (nextRevision.generation < snapshot.revision.generation) {
    throw new RangeError("A stale snapshot cannot move to an older generation");
  }
  return createRuntimeSnapshot({
    state: "stale",
    revision: nextRevision,
    reason,
  }) as StaleRuntimeSnapshot;
}
