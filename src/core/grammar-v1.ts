import type { ParserDiagnostic, ParserDiagnosticCode } from "./diagnostics";
import type {
  FixedEvent,
  FlexibleTask,
  GrammarParseResult,
  GrammarV1Settings,
  ParseGrammarInput,
  PlanItem,
  PlanItemCandidate,
  PlanItemStatus,
  PlanItemTokens,
  TokenLocation,
} from "./model";
import { addRemoval, renderLabel } from "./parser/projection";
import {
  findCompletionAnchor,
  findDuration,
  findProgress,
  findTimeRange,
  findUrgentTrigger,
} from "./parser/tokens";
import { removeUnicodeWhitespace } from "./parser/whitespace";

export const GRAMMAR_V1 = "v1" as const;

interface NormalizedGrammarV1Settings {
  readonly defaultDurationMinutes: number;
  readonly urgentTrigger: string;
}

function freezeLocation(location: TokenLocation): TokenLocation {
  return Object.freeze({ ...location });
}

function diagnostic<TSource>(
  code: ParserDiagnosticCode,
  candidate: PlanItemCandidate<TSource>,
  token?: TokenLocation,
): ParserDiagnostic<TSource> {
  return Object.freeze({
    code,
    severity: "warning" as const,
    source: candidate.source,
    sourceOrder: candidate.sourceOrder,
    ...(token ? { token: freezeLocation(token) } : {}),
  });
}

function normalizeDefaultDuration(value: unknown): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 5 && value <= 60
    ? value
    : 15;
}

function normalizeUrgentTrigger(value: string | undefined): string {
  return removeUnicodeWhitespace(value ?? "");
}

function remainingDuration(durationMinutes: number, progressPercent: number): number {
  return Math.floor(durationMinutes * (100 - progressPercent) / 100 + 0.5);
}

function freezeTokens(tokens: PlanItemTokens): PlanItemTokens {
  const frozen: PlanItemTokens = {
    ...(tokens.timeRange ? { timeRange: freezeLocation(tokens.timeRange) } : {}),
    ...(tokens.duration ? { duration: freezeLocation(tokens.duration) } : {}),
    ...(tokens.progress ? { progress: freezeLocation(tokens.progress) } : {}),
    ...(tokens.completionAnchor
      ? { completionAnchor: freezeLocation(tokens.completionAnchor) }
      : {}),
  };
  return Object.freeze(frozen);
}

function parseCandidate<TSource>(
  candidate: PlanItemCandidate<TSource>,
  settings: NormalizedGrammarV1Settings,
): {
  readonly item?: PlanItem<TSource>;
  readonly diagnostics: readonly ParserDiagnostic<TSource>[];
} {
  if (candidate.status === "foreign") return { diagnostics: [] };

  const diagnostics: ParserDiagnostic<TSource>[] = [];
  const removals = new Map<number, TokenLocation[]>();
  const range = findTimeRange(candidate.segments, removals);
  if (range) {
    if (range.valid) {
      addRemoval(removals, range.location);
      if (range.warning) diagnostics.push(diagnostic(range.warning, candidate, range.location));
    } else {
      diagnostics.push(diagnostic("invalid-time-range", candidate, range.location));
    }
  }

  const duration = findDuration(candidate.segments, removals);
  if (duration) addRemoval(removals, duration.location);
  const durationMinutes = duration?.minutes ?? settings.defaultDurationMinutes;

  const progress = findProgress(candidate.segments, removals);
  if (progress) addRemoval(removals, progress.location);
  const progressPercent = progress?.percent ?? 0;

  const completion = candidate.status === "done" && range?.valid !== true
    ? findCompletionAnchor(candidate.segments, removals)
    : undefined;
  if (completion) addRemoval(removals, completion.location);

  const urgentLocation = range?.valid === true
    ? undefined
    : findUrgentTrigger(candidate.segments, settings.urgentTrigger, removals);
  const label = renderLabel(candidate.segments, removals);
  if (label.length === 0) {
    diagnostics.push(diagnostic("empty-plan-item", candidate));
    return { diagnostics: Object.freeze(diagnostics) };
  }

  const tokens = freezeTokens({
    ...(range ? { timeRange: range.location } : {}),
    ...(duration ? { duration: duration.location } : {}),
    ...(progress ? { progress: progress.location } : {}),
    ...(completion ? { completionAnchor: completion.location } : {}),
  });
  const base = {
    source: candidate.source,
    sourceOrder: candidate.sourceOrder,
    status: candidate.status satisfies PlanItemStatus,
    label,
    durationMinutes,
    progressPercent,
    remainingDurationMinutes: remainingDuration(durationMinutes, progressPercent),
    urgent: urgentLocation !== undefined,
    tokens,
  };

  let item: PlanItem<TSource>;
  if (range?.valid === true) {
    const fixedEvent: FixedEvent<TSource> = {
      ...base,
      kind: "fixed-event",
      executionEligible: false,
      startMinutes: range.startMinutes,
      endMinutes: range.endMinutes,
    };
    item = Object.freeze(fixedEvent);
  } else {
    const flexibleTask: FlexibleTask<TSource> = {
      ...base,
      kind: "flexible-task",
      executionEligible: candidate.status === "open",
      ...(completion ? { completionAnchorMinutes: completion.minutes } : {}),
    };
    item = Object.freeze(flexibleTask);
  }
  return { item, diagnostics: Object.freeze(diagnostics) };
}

function frozenResult<TSource>(
  version: string,
  supported: boolean,
  items: readonly PlanItem<TSource>[],
  diagnostics: readonly ParserDiagnostic<TSource>[],
): GrammarParseResult<TSource> {
  return Object.freeze({
    version,
    supported,
    items: Object.freeze([...items]),
    diagnostics: Object.freeze([...diagnostics]),
  });
}

export function parseGrammarV1<TSource>(
  candidates: readonly PlanItemCandidate<TSource>[],
  settings: GrammarV1Settings = {},
): GrammarParseResult<TSource> {
  const normalizedSettings = {
    defaultDurationMinutes: normalizeDefaultDuration(settings.defaultDurationMinutes),
    urgentTrigger: normalizeUrgentTrigger(settings.urgentTrigger),
  };
  const items: PlanItem<TSource>[] = [];
  const diagnostics: ParserDiagnostic<TSource>[] = [];
  for (const candidate of candidates) {
    const parsed = parseCandidate(candidate, normalizedSettings);
    if (parsed.item) items.push(parsed.item);
    diagnostics.push(...parsed.diagnostics);
  }
  return frozenResult(GRAMMAR_V1, true, items, diagnostics);
}

export function parseGrammar<TSource>(
  input: ParseGrammarInput<TSource>,
): GrammarParseResult<TSource> {
  if (input.version !== GRAMMAR_V1) {
    return frozenResult(input.version, false, [], []);
  }
  return parseGrammarV1(input.candidates, input.settings);
}
