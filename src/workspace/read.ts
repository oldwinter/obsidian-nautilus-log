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
import { createSourceVersion } from "./source-version";
import type { TextAccess } from "./text-access";

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

export type WorkspacePlanReadResult =
  | WorkspacePlanReadSuccess
  | WorkspacePlanResolutionFailure
  | WorkspacePlanMissingSource;

export async function readWorkspacePlan(
  access: TextAccess,
  logicalDate: LogicalDate,
  configuration: DailyNoteConfiguration | undefined,
  settings: GrammarV1Settings = {},
): Promise<WorkspacePlanReadResult> {
  const pathResolution = resolveDailyNotePath(logicalDate, configuration);
  if (!pathResolution.ok) {
    return Object.freeze({
      ok: false as const,
      reason: "daily-note-resolution" as const,
      resolution: pathResolution,
    });
  }

  const sourceText = await access.readText(pathResolution.path);
  if (sourceText === undefined) {
    return Object.freeze({
      ok: false as const,
      reason: "missing-source" as const,
      path: pathResolution.path,
    });
  }

  const sourceVersion = await createSourceVersion(pathResolution.path, sourceText);
  const primaryPlan = resolvePrimaryPlan(sourceVersion, sourceText);
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
