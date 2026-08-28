import type { SourceSpan } from "./source-version";

export const PLAN_OPEN_MARKER_V1 = "<!-- nautilus-log:plan/v1 -->";
export const PLAN_CLOSE_MARKER = "<!-- /nautilus-log:plan -->";

export interface MarkdownHtmlBlockStart {
  readonly closePattern?: RegExp;
  readonly endsOnBlank: boolean;
  readonly closedOnOpeningLine: boolean;
}

const HTML_TYPE_ONE_OPEN = /^[ \t]*<(pre|script|style|textarea)(?:[ \t/>]|$)/i;
const HTML_TYPE_SIX_OPEN = /^[ \t]*<(address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t/>]|$)/i;
const HTML_TYPE_SEVEN = /^[ \t]*<\/?[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[^<>]*)?\/?>[ \t]*$/;

export function markdownHtmlBlockStart(text: string): MarkdownHtmlBlockStart | undefined {
  if (/^[ \t]*<!--/.test(text)) {
    return { closePattern: /-->/, endsOnBlank: false, closedOnOpeningLine: text.includes("-->") };
  }
  if (/^[ \t]*<\?/.test(text)) {
    return { closePattern: /\?>/, endsOnBlank: false, closedOnOpeningLine: text.includes("?>") };
  }
  if (/^[ \t]*<!\[CDATA\[/.test(text)) {
    return { closePattern: /\]\]>/, endsOnBlank: false, closedOnOpeningLine: text.includes("]]>") };
  }
  if (/^[ \t]*<![A-Z]/.test(text)) {
    return { closePattern: />/, endsOnBlank: false, closedOnOpeningLine: text.includes(">") };
  }
  const typeOne = HTML_TYPE_ONE_OPEN.exec(text);
  if (typeOne) {
    const closePattern = new RegExp(`</${typeOne[1]!.toLowerCase()}[ \\t]*>`, "i");
    return { closePattern, endsOnBlank: false, closedOnOpeningLine: closePattern.test(text) };
  }
  if (HTML_TYPE_SIX_OPEN.test(text) || HTML_TYPE_SEVEN.test(text)) {
    return { endsOnBlank: true, closedOnOpeningLine: false };
  }
  return undefined;
}

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

export function* iteratePhysicalLines(content: string): Iterable<PhysicalLine> {
  let fromOffset = 0;
  let lineNumber = 0;
  while (fromOffset < content.length) {
    let toOffset = fromOffset;
    while (toOffset < content.length && content[toOffset] !== "\n" && content[toOffset] !== "\r") {
      toOffset += 1;
    }
    let toOffsetWithEnding = toOffset;
    if (content[toOffsetWithEnding] === "\r") toOffsetWithEnding += 1;
    if (content[toOffsetWithEnding] === "\n") toOffsetWithEnding += 1;
    yield Object.freeze({
      text: content.slice(fromOffset, toOffset),
      lineNumber,
      fromOffset,
      toOffset,
      toOffsetWithEnding,
    });
    lineNumber += 1;
    fromOffset = toOffsetWithEnding;
  }
  if (content.length === 0 || /(?:\r\n|\r|\n)$/.test(content)) {
    yield Object.freeze({
      text: "",
      lineNumber,
      fromOffset: content.length,
      toOffset: content.length,
      toOffsetWithEnding: content.length,
    });
  }
}

export function physicalLines(content: string): readonly PhysicalLine[] {
  return Object.freeze([...iteratePhysicalLines(content)]);
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

  let index = 0;
  for (const line of iteratePhysicalLines(content)) {
    const allowBom = index === 0;
    index += 1;
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
    const listFence = /^ {0,3}(?:[-+*]|[0-9]{1,9}[.)])[ \t]+(`{3,}|~{3,})(.*)$/.exec(line.text);
    if (listFence && !(listFence[1]![0] === "`" && listFence[2]!.includes("`"))) {
      fenceCharacter = listFence[1]![0] as "`" | "~";
      fenceLength = listFence[1]!.length;
      continue;
    }

    const marker = markerOnLine(content, line, allowBom);
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
