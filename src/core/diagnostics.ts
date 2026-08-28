import type { TokenLocation } from "./model";

export const PARSER_DIAGNOSTIC_CODES = [
  "invalid-time-range",
  "same-time",
  "overnight-truncated",
  "empty-plan-item",
] as const;

export type ParserDiagnosticCode = (typeof PARSER_DIAGNOSTIC_CODES)[number];

export interface ParserDiagnostic<TSource = unknown> {
  readonly code: ParserDiagnosticCode;
  readonly severity: "warning";
  readonly source: TSource;
  readonly sourceOrder: number;
  readonly token?: TokenLocation;
}
