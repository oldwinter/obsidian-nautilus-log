import { parseGrammar } from "../core/grammar-v1";
import type {
  GrammarParseResult,
  GrammarV1Settings,
  PlanItemCandidate,
} from "../core/model";
import type {
  DailyNoteConfiguration,
  DailyNotePathResolution,
  LogicalDate,
} from "./daily-notes";
import { resolveDailyNotePath } from "./daily-notes";
import type {
  PrimaryPlanResolution,
  WorkspacePlanItemSource,
} from "./primary-plan-resolver";
import { resolvePrimaryPlan } from "./primary-plan-resolver";
import type { SourceVersion } from "./source-version";
import { createSourceVersion, utf8ByteLength } from "./source-version";
import type { TextAccess } from "./text-access";

export interface WorkspaceReadLimits {
  readonly maxActiveNoteBytes: number;
  readonly maxPlanRegionBytes: number;
  readonly maxPlanItems: number;
  readonly maxPlanItemBytes: number;
  readonly maxListDepth: number;
}

export const DEFAULT_WORKSPACE_READ_LIMITS: WorkspaceReadLimits = Object.freeze({
  maxActiveNoteBytes: 2 * 1024 * 1024,
  maxPlanRegionBytes: 1024 * 1024,
  maxPlanItems: 1_000,
  maxPlanItemBytes: 16 * 1024,
  maxListDepth: 16,
});

export interface WorkspacePlanReadOptions {
  readonly limits?: Partial<WorkspaceReadLimits>;
  readonly signal?: AbortSignal;
}

export type WorkspaceInputLimitKind =
  | "active-note-bytes"
  | "plan-region-bytes"
  | "plan-items"
  | "plan-item-bytes"
  | "list-depth";

export interface WorkspacePlanReadSuccess {
  readonly ok: true;
  readonly path: string;
  readonly sourceText: string;
  readonly sourceVersion: SourceVersion;
  readonly primaryPlan: PrimaryPlanResolution;
  readonly candidates: readonly PlanItemCandidate<WorkspacePlanItemSource>[];
  readonly grammar: GrammarParseResult<WorkspacePlanItemSource>;
}

export interface WorkspacePlanResolutionFailure {
  readonly ok: false;
  readonly reason: "daily-note-resolution";
  readonly resolution: Extract<DailyNotePathResolution, { readonly ok: false }>;
}

export interface WorkspacePlanMissingSource {
  readonly ok: false;
  readonly reason: "missing-source";
  readonly path: string;
}

export interface WorkspacePlanInputLimit {
  readonly ok: false;
  readonly reason: "input-limit";
  readonly path: string;
  readonly kind: WorkspaceInputLimitKind;
  readonly actual: number;
  readonly limit: number;
}

export interface WorkspacePlanReadFailure {
  readonly ok: false;
  readonly reason: "source-read-failed" | "cancelled";
  readonly path: string;
}

export type WorkspacePlanReadResult =
  | WorkspacePlanReadSuccess
  | WorkspacePlanResolutionFailure
  | WorkspacePlanMissingSource
  | WorkspacePlanInputLimit
  | WorkspacePlanReadFailure;

function normalizeLimits(overrides: Partial<WorkspaceReadLimits> | undefined): WorkspaceReadLimits {
  const limits = { ...DEFAULT_WORKSPACE_READ_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a nonnegative safe integer`);
    }
  }
  return Object.freeze(limits);
}

function limitFailure(
  path: string,
  kind: WorkspaceInputLimitKind,
  actual: number,
  limit: number,
): WorkspacePlanInputLimit {
  return Object.freeze({ ok: false, reason: "input-limit", path, kind, actual, limit });
}

export async function readWorkspacePlan(
  access: TextAccess,
  logicalDate: LogicalDate,
  configuration: DailyNoteConfiguration | undefined,
  settings: GrammarV1Settings = {},
  options: WorkspacePlanReadOptions = {},
): Promise<WorkspacePlanReadResult> {
  const pathResolution = resolveDailyNotePath(logicalDate, configuration);
  if (!pathResolution.ok) {
    return Object.freeze({
      ok: false as const,
      reason: "daily-note-resolution" as const,
      resolution: pathResolution,
    });
  }

  const limits = normalizeLimits(options.limits);
  if (options.signal?.aborted) {
    return Object.freeze({ ok: false, reason: "cancelled", path: pathResolution.path });
  }
  let sourceText: string | undefined;
  try {
    sourceText = await access.readText(pathResolution.path, options.signal);
  } catch (error) {
    const reason = options.signal?.aborted || (error instanceof DOMException && error.name === "AbortError")
      ? "cancelled"
      : "source-read-failed";
    return Object.freeze({ ok: false, reason, path: pathResolution.path });
  }
  if (options.signal?.aborted) {
    return Object.freeze({ ok: false, reason: "cancelled", path: pathResolution.path });
  }
  if (sourceText === undefined) {
    return Object.freeze({
      ok: false as const,
      reason: "missing-source" as const,
      path: pathResolution.path,
    });
  }

  const noteBytes = utf8ByteLength(sourceText);
  if (noteBytes > limits.maxActiveNoteBytes) {
    return limitFailure(pathResolution.path, "active-note-bytes", noteBytes, limits.maxActiveNoteBytes);
  }

  const sourceVersion = await createSourceVersion(pathResolution.path, sourceText);
  if (options.signal?.aborted) {
    return Object.freeze({ ok: false, reason: "cancelled", path: pathResolution.path });
  }
  const primaryPlan = resolvePrimaryPlan(sourceVersion, sourceText, limits);
  if (primaryPlan.limitExceeded) {
    return limitFailure(
      pathResolution.path,
      primaryPlan.limitExceeded.kind,
      primaryPlan.limitExceeded.actual,
      primaryPlan.limitExceeded.limit,
    );
  }
  if (options.signal?.aborted) {
    return Object.freeze({ ok: false, reason: "cancelled", path: pathResolution.path });
  }
  const grammar = parseGrammar({
    version: primaryPlan.region?.version ?? "unsupported",
    candidates: primaryPlan.candidates,
    settings,
  });
  return Object.freeze({
    ok: true as const,
    path: pathResolution.path,
    sourceText,
    sourceVersion,
    primaryPlan,
    candidates: primaryPlan.candidates,
    grammar,
  });
}
