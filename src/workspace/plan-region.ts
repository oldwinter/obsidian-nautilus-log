import type { SourceSpan } from "./source-version";

export const PLAN_OPEN_MARKER_V1 = "<!-- nautilus-log:plan/v1 -->";
export const PLAN_CLOSE_MARKER = "<!-- /nautilus-log:plan -->";

export type PlanRegionDiagnosticCode =
  | "unsupported-plan-version"
  | "unclosed-plan-region"
  | "nested-plan-region"
  | "duplicate-plan-region";

export interface PlanRegionDiagnostic {
  readonly code: PlanRegionDiagnosticCode;
  readonly markerSpan: SourceSpan;
  readonly version?: string;
}

export interface PrimaryPlanRegion {
  readonly version: "v1";
  readonly contentSpan: SourceSpan;
  readonly openingMarkerSpan: SourceSpan;
  readonly closingMarkerSpan: SourceSpan;
}

export interface PlanRegionScanResult {
  readonly region?: PrimaryPlanRegion;
  readonly diagnostics: readonly PlanRegionDiagnostic[];
}

export interface PhysicalLine {
  readonly text: string;
  readonly lineNumber: number;
  readonly fromOffset: number;
  readonly toOffset: number;
  readonly toOffsetWithEnding: number;
}

type Marker =
  | {
      readonly kind: "open";
      readonly version: string;
      readonly span: SourceSpan;
      readonly line: PhysicalLine;
    }
  | {
      readonly kind: "close";
      readonly span: SourceSpan;
      readonly line: PhysicalLine;
    };

export function physicalLines(content: string): readonly PhysicalLine[] {
  const lines: PhysicalLine[] = [];
  let fromOffset = 0;
  while (fromOffset < content.length) {
    let toOffset = fromOffset;
    while (toOffset < content.length && content[toOffset] !== "\n" && content[toOffset] !== "\r") {
      toOffset += 1;
    }
    let toOffsetWithEnding = toOffset;
    if (content[toOffsetWithEnding] === "\r") toOffsetWithEnding += 1;
    if (content[toOffsetWithEnding] === "\n") toOffsetWithEnding += 1;
    lines.push(Object.freeze({
      text: content.slice(fromOffset, toOffset),
      lineNumber: lines.length,
      fromOffset,
      toOffset,
      toOffsetWithEnding,
    }));
    fromOffset = toOffsetWithEnding;
  }
  if (content.length === 0 || /(?:\r\n|\r|\n)$/.test(content)) {
    lines.push(Object.freeze({
      text: "",
      lineNumber: lines.length,
      fromOffset: content.length,
      toOffset: content.length,
      toOffsetWithEnding: content.length,
    }));
  }
  return Object.freeze(lines);
}

function spanOnLine(line: PhysicalLine, fromOffset: number, toOffset: number): SourceSpan {
  return Object.freeze({
    fromOffset,
    toOffset,
    fromLine: line.lineNumber,
    fromColumn: fromOffset - line.fromOffset,
    toLine: line.lineNumber,
    toColumn: toOffset - line.fromOffset,
  });
}

function markerOnLine(content: string, line: PhysicalLine, allowBom: boolean): Marker | undefined {
  const hasBom = allowBom && line.text.startsWith("\uFEFF");
  const text = hasBom ? line.text.slice(1) : line.text;
  const markerOffset = line.fromOffset + (hasBom ? 1 : 0);
  const open = /^<!-- nautilus-log:plan\/v([0-9]+) -->[ \t]*$/.exec(text);
  if (open) {
    const markerLength = `<!-- nautilus-log:plan/v${open[1]!} -->`.length;
    return Object.freeze({
      kind: "open",
      version: open[1]!,
      span: spanOnLine(line, markerOffset, markerOffset + markerLength),
      line,
    });
  }
  if (/^<!-- \/nautilus-log:plan -->[ \t]*$/.test(text)) {
    return Object.freeze({
      kind: "close",
      span: spanOnLine(line, markerOffset, markerOffset + PLAN_CLOSE_MARKER.length),
      line,
    });
  }
  return undefined;
}

function markersOutsideFences(content: string): readonly Marker[] {
  const markers: Marker[] = [];
  let fenceCharacter: "`" | "~" | undefined;
  let fenceLength = 0;

  for (const [index, line] of physicalLines(content).entries()) {
    if (fenceCharacter) {
      const close = /^ {0,3}(`+|~+)[ \t]*$/.exec(line.text);
      if (close && close[1]![0] === fenceCharacter && close[1]!.length >= fenceLength) {
        fenceCharacter = undefined;
        fenceLength = 0;
      }
      continue;
    }

    const openFence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.text);
    if (openFence && !(openFence[1]![0] === "`" && openFence[2]!.includes("`"))) {
      fenceCharacter = openFence[1]![0] as "`" | "~";
      fenceLength = openFence[1]!.length;
      continue;
    }

    const marker = markerOnLine(content, line, index === 0);
    if (marker) markers.push(marker);
  }
  return Object.freeze(markers);
}

function diagnostic(
  code: PlanRegionDiagnosticCode,
  marker: Marker,
): PlanRegionDiagnostic {
  return Object.freeze({
    code,
    markerSpan: marker.span,
    ...(marker.kind === "open" ? { version: marker.version } : {}),
  });
}

export function scanPrimaryPlanRegion(content: string): PlanRegionScanResult {
  const markers = markersOutsideFences(content);
  const firstOpeningIndex = markers.findIndex((marker) => marker.kind === "open");
  if (firstOpeningIndex < 0) {
    return Object.freeze({ diagnostics: Object.freeze([]) });
  }

  const diagnostics: PlanRegionDiagnostic[] = [];
  const opening = markers[firstOpeningIndex]!;
  if (opening.kind !== "open") throw new Error("unreachable marker state");
  const supported = opening.version === "1";
  if (!supported) diagnostics.push(diagnostic("unsupported-plan-version", opening));
  const next = markers[firstOpeningIndex + 1];
  let region: PrimaryPlanRegion | undefined;
  let duplicateScanIndex = markers.length;

  if (!next) {
    diagnostics.push(diagnostic("unclosed-plan-region", opening));
  } else if (next.kind === "open") {
    diagnostics.push(diagnostic("nested-plan-region", next));
  } else {
    duplicateScanIndex = firstOpeningIndex + 2;
    if (supported) {
      region = Object.freeze({
        version: "v1" as const,
        contentSpan: Object.freeze({
          fromOffset: opening.line.toOffsetWithEnding,
          toOffset: next.line.fromOffset,
          fromLine: opening.line.lineNumber + 1,
          fromColumn: 0,
          toLine: next.line.lineNumber,
          toColumn: 0,
        }),
        openingMarkerSpan: opening.span,
        closingMarkerSpan: next.span,
      });
    }
  }

  while (duplicateScanIndex < markers.length) {
    const laterOpening = markers[duplicateScanIndex];
    if (laterOpening?.kind !== "open") {
      duplicateScanIndex += 1;
      continue;
    }
    const laterClose = markers[duplicateScanIndex + 1];
    if (laterClose?.kind === "close") {
      diagnostics.push(diagnostic("duplicate-plan-region", laterOpening));
      duplicateScanIndex += 2;
    } else {
      duplicateScanIndex += 1;
    }
  }

  return Object.freeze({
    ...(region ? { region } : {}),
    diagnostics: Object.freeze(diagnostics),
  });
}
