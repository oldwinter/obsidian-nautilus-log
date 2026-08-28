import type { ParserDiagnostic } from "./diagnostics";

export type PlanItemStatus = "plain" | "open" | "done";
export type CandidateStatus = PlanItemStatus | "foreign";
export type PlanItemKind = "fixed-event" | "flexible-task";
export type InlineSegmentKind = "semantic" | "display-only" | "hidden";

export interface InlineSegment {
  readonly kind: InlineSegmentKind;
  readonly text: string;
}

export interface PlanItemCandidate<TSource = unknown> {
  readonly source: TSource;
  readonly sourceOrder: number;
  readonly status: CandidateStatus;
  readonly segments: readonly InlineSegment[];
}

export interface GrammarV1Settings {
  readonly defaultDurationMinutes?: unknown;
  readonly urgentTrigger?: string;
}

export interface TokenLocation {
  readonly segmentIndex: number;
  readonly fromOffset: number;
  readonly toOffset: number;
}

export interface PlanItemTokens {
  readonly timeRange?: TokenLocation;
  readonly duration?: TokenLocation;
  readonly progress?: TokenLocation;
  readonly completionAnchor?: TokenLocation;
}

interface PlanItemBase<TSource> {
  readonly kind: PlanItemKind;
  readonly source: TSource;
  readonly sourceOrder: number;
  readonly status: PlanItemStatus;
  readonly label: string;
  readonly durationMinutes: number;
  readonly progressPercent: number;
  readonly remainingDurationMinutes: number;
  readonly urgent: boolean;
  readonly executionEligible: boolean;
  readonly tokens: PlanItemTokens;
}

export interface FixedEvent<TSource = unknown> extends PlanItemBase<TSource> {
  readonly kind: "fixed-event";
  readonly startMinutes: number;
  readonly endMinutes: number;
}

export interface FlexibleTask<TSource = unknown> extends PlanItemBase<TSource> {
  readonly kind: "flexible-task";
  readonly completionAnchorMinutes?: number;
}

export type PlanItem<TSource = unknown> = FixedEvent<TSource> | FlexibleTask<TSource>;

export interface GrammarParseResult<TSource = unknown> {
  readonly version: string;
  readonly supported: boolean;
  readonly items: readonly PlanItem<TSource>[];
  readonly diagnostics: readonly ParserDiagnostic<TSource>[];
}

export interface ParseGrammarInput<TSource = unknown> {
  readonly version: string;
  readonly candidates: readonly PlanItemCandidate<TSource>[];
  readonly settings?: GrammarV1Settings;
}
