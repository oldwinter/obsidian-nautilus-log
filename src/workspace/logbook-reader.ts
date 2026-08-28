import {
  parseClockText,
  type ClockParseResult,
  type ParseClockOptions,
} from "./clock-parser";
import { markdownHtmlBlockStart } from "./plan-region";

export interface PlanItemLogbookSource {
  readonly path: string;
  readonly itemFromOffset: number;
  readonly itemToOffset: number;
  readonly ownerId?: string;
}

export interface LogbookDrawer {
  readonly path: string;
  readonly fromOffset: number;
  readonly toOffset: number;
  readonly text: string;
}

export interface LogbookClock {
  readonly path: string;
  readonly fromOffset: number;
  readonly toOffset: number;
  readonly text: string;
  readonly ownerId?: string;
  readonly parsed: ClockParseResult;
}

export interface LogbookReadResult {
  readonly complete: boolean;
  readonly reason?: "clock-record-limit";
  readonly kind: "none" | "accepted" | "ambiguous";
  readonly drawers: readonly LogbookDrawer[];
  readonly clocks: readonly LogbookClock[];
  readonly diagnostics: readonly LogbookDiagnostic[];
}

export interface LogbookReadOptions extends ParseClockOptions {
  readonly maxClockRecords?: number;
}

export interface LogbookDiagnostic {
  readonly code: "duplicate-logbook";
  readonly path: string;
  readonly fromOffset: number;
  readonly toOffset: number;
}

interface PhysicalLine {
  readonly start: number;
  readonly end: number;
  readonly content: string;
}

interface ListNode {
  readonly indent: number;
  readonly contentIndent: number;
  readonly kind: "owner" | "drawer" | "other";
  readonly drawer?: LogbookDrawer;
}

const LIST_ITEM = /^([ \t]*)([-+*])([ \t]+)(.*)$/;
const CHECKBOX = /^\[[^\]]\](?:[ \t]+|$)/;
const DRAWER_TEXT = /^logbook:{1,2}$/i;

interface HtmlBlockState {
  readonly closePattern?: RegExp;
  readonly endsOnBlank: boolean;
}

function linesInRange(source: string, fromOffset: number, toOffset: number): readonly PhysicalLine[] {
  const lines: PhysicalLine[] = [];
  let start = fromOffset;
  while (start < toOffset) {
    let end = start;
    while (end < toOffset && source.charCodeAt(end) !== 10 && source.charCodeAt(end) !== 13) end += 1;
    lines.push({ start, end, content: source.slice(start, end) });
    if (end >= toOffset) break;
    start = end + 1;
    if (source.charCodeAt(end) === 13 && source.charCodeAt(start) === 10) start += 1;
  }
  return lines;
}

function indentationWidth(indent: string): number {
  let width = 0;
  for (const character of indent) {
    width = character === "\t" ? width + (4 - width % 4) : width + 1;
  }
  return width;
}

function semanticBounds(line: PhysicalLine, prefixLength: number): {
  readonly fromOffset: number;
  readonly toOffset: number;
  readonly text: string;
} {
  const raw = line.content.slice(prefixLength);
  const leading = /^[ \t]*/.exec(raw)![0].length;
  const trailing = /[ \t]*$/.exec(raw)![0].length;
  const fromOffset = line.start + prefixLength + leading;
  const toOffset = line.end - trailing;
  return { fromOffset, toOffset, text: line.content.slice(prefixLength + leading, line.content.length - trailing) };
}

function fenceMarker(content: string): {
  readonly marker: "`" | "~";
  readonly length: number;
  readonly remainder: string;
} | undefined {
  const match = /^[ \t]*(?:[-+*][ \t]+)?(`{3,}|~{3,})(.*)$/.exec(content);
  if (!match) return undefined;
  const run = match[1]!;
  return { marker: run[0] as "`" | "~", length: run.length, remainder: match[2]! };
}

export function readLogbook(
  source: string,
  owner: PlanItemLogbookSource,
  options: LogbookReadOptions = {},
): LogbookReadResult {
  if (
    owner.itemFromOffset < 0
    || owner.itemToOffset < owner.itemFromOffset
    || owner.itemToOffset > source.length
  ) {
    throw new RangeError("Plan Item LOGBOOK range is outside the source text");
  }
  const maxClockRecords = options.maxClockRecords ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(maxClockRecords) || maxClockRecords < 0) {
    throw new RangeError("maxClockRecords must be a nonnegative safe integer");
  }
  const lines = linesInRange(source, owner.itemFromOffset, owner.itemToOffset);
  const first = lines[0];
  const firstMatch = first ? LIST_ITEM.exec(first.content) : null;
  if (!first || !firstMatch) {
    return Object.freeze({
      complete: true,
      kind: "none" as const,
      drawers: Object.freeze([]),
      clocks: Object.freeze([]),
      diagnostics: Object.freeze([]),
    });
  }

  const stack: ListNode[] = [{
    indent: indentationWidth(firstMatch[1]!),
    contentIndent: indentationWidth(firstMatch[1]! + firstMatch[2]! + firstMatch[3]!),
    kind: "owner",
  }];
  const drawers: LogbookDrawer[] = [];
  const clocks: LogbookClock[] = [];
  let fence: { readonly marker: "`" | "~"; readonly length: number } | undefined;
  let htmlBlock: HtmlBlockState | undefined;
  let indentedCodeAt: number | undefined;
  let separatedByBlank = false;
  let overLimit = false;

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    const lineIndent = indentationWidth(/^([ \t]*)/.exec(line.content)![1]!);
    const blank = /^[ \t]*$/.test(line.content);
    const marker = fenceMarker(line.content);
    if (fence) {
      if (
        marker
        && marker.marker === fence.marker
        && marker.length >= fence.length
        && /^[ \t]*$/.test(marker.remainder)
      ) {
        fence = undefined;
      }
      continue;
    }
    if (htmlBlock) {
      if (htmlBlock.endsOnBlank && /^[ \t]*$/.test(line.content)) htmlBlock = undefined;
      else if (htmlBlock.closePattern?.test(line.content)) htmlBlock = undefined;
      continue;
    }
    if (indentedCodeAt !== undefined) {
      if (blank) {
        separatedByBlank = true;
        continue;
      }
      if (lineIndent >= indentedCodeAt) continue;
      indentedCodeAt = undefined;
    }

    if (blank) {
      separatedByBlank = true;
      continue;
    }

    const match = LIST_ITEM.exec(line.content);
    while (stack.length > 0 && lineIndent < stack[stack.length - 1]!.contentIndent) stack.pop();
    const parent = stack[stack.length - 1];
    if (separatedByBlank && parent && lineIndent >= parent.contentIndent + 4) {
      indentedCodeAt = parent.contentIndent + 4;
      separatedByBlank = false;
      continue;
    }

    if (marker && (marker.marker !== "`" || !marker.remainder.includes("`"))) {
      fence = marker;
      separatedByBlank = false;
      continue;
    }
    const htmlStart = markdownHtmlBlockStart(line.content);
    if (htmlStart) {
      if (htmlStart.endsOnBlank || !htmlStart.closedOnOpeningLine) {
        htmlBlock = {
          ...(htmlStart.closePattern ? { closePattern: htmlStart.closePattern } : {}),
          endsOnBlank: htmlStart.endsOnBlank,
        };
      }
      separatedByBlank = false;
      continue;
    }

    if (!match) {
      separatedByBlank = false;
      continue;
    }
    const indent = indentationWidth(match[1]!);
    separatedByBlank = false;
    const prefixLength = match[1]!.length + match[2]!.length + match[3]!.length;
    const semantic = semanticBounds(line, prefixLength);
    const hasCheckbox = CHECKBOX.test(semantic.text);

    let node: ListNode;
    if (parent?.kind === "owner" && !hasCheckbox && DRAWER_TEXT.test(semantic.text)) {
      const drawer = Object.freeze({ path: owner.path, ...semantic });
      drawers.push(drawer);
      node = {
        indent,
        contentIndent: indentationWidth(match[1]! + match[2]! + match[3]!),
        kind: "drawer",
        drawer,
      };
    } else {
      node = {
        indent,
        contentIndent: indentationWidth(match[1]! + match[2]! + match[3]!),
        kind: "other",
      };
      if (parent?.kind === "drawer" && !hasCheckbox) {
        const parsed = parseClockText(semantic.text, options);
        if (parsed.kind !== "not-clock") {
          if (clocks.length >= maxClockRecords) {
            overLimit = true;
            break;
          }
          clocks.push(Object.freeze({
            path: owner.path,
            ...semantic,
            ...(owner.ownerId ? { ownerId: owner.ownerId } : {}),
            parsed,
          }));
        }
      }
    }
    stack.push(node);
  }

  const kind = drawers.length === 0 ? "none" : drawers.length === 1 ? "accepted" : "ambiguous";
  const diagnostics: LogbookDiagnostic[] = drawers.length < 2
    ? []
    : drawers.slice(1).map((drawer) => Object.freeze({
        code: "duplicate-logbook" as const,
        path: drawer.path,
        fromOffset: drawer.fromOffset,
        toOffset: drawer.toOffset,
      }));
  return Object.freeze({
    complete: !overLimit,
    ...(overLimit ? { reason: "clock-record-limit" as const } : {}),
    kind,
    drawers: Object.freeze(drawers),
    clocks: Object.freeze(overLimit ? [] : clocks),
    diagnostics: Object.freeze(diagnostics),
  });
}
