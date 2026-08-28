import type { InlineSegment, PlanItemCandidate, TokenLocation } from "../core/model";
import {
  physicalLines,
  scanPrimaryPlanRegion,
  type PhysicalLine,
  type PlanRegionDiagnostic,
  type PrimaryPlanRegion,
} from "./plan-region";
import type { SourceSpan, SourceVersion } from "./source-version";

export interface InlineSegmentSource {
  readonly kind: InlineSegment["kind"];
  readonly span: SourceSpan;
  readonly sourceOffsets: readonly number[];
}

export interface WorkspacePlanItemSource {
  readonly version: SourceVersion;
  readonly regionSpan: SourceSpan;
  readonly itemSpan: SourceSpan;
  readonly firstLineSpan: SourceSpan;
  readonly contentSpan: SourceSpan;
  readonly firstLineText: string;
  readonly checkboxSpan?: SourceSpan;
  readonly blockIdSpan?: SourceSpan;
  readonly blockId?: string;
  readonly segmentSources: readonly InlineSegmentSource[];
}

export interface PrimaryPlanResolution {
  readonly region?: PrimaryPlanRegion;
  readonly candidates: readonly PlanItemCandidate<WorkspacePlanItemSource>[];
  readonly diagnostics: readonly PlanRegionDiagnostic[];
}

interface MutableDirectItem {
  readonly line: PhysicalLine;
  readonly bulletEndOffset: number;
  itemEndOffset: number;
  itemEndLine: PhysicalLine;
}

interface ListContext {
  readonly indent: number;
  readonly item?: MutableDirectItem;
}

interface ProjectedInline {
  readonly segment: InlineSegment;
  readonly source: InlineSegmentSource;
}

const DIRECT_LIST_PATTERN = /^( {0,3})([-+*]|[0-9]{1,9}[.)])([ \t]+)(.*)$/;
const HTML_BLOCK_OPEN = /^ {0,3}<(address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|pre|script|search|section|style|summary|table|tbody|td|textarea|tfoot|th|thead|title|tr|track|ul)(?:[ \t/>]|$)/i;

function leadingSpaces(text: string): number {
  const match = /^( *)/.exec(text);
  return match?.[1]?.length ?? 0;
}

function linesInRegion(content: string, region: PrimaryPlanRegion): readonly PhysicalLine[] {
  return physicalLines(content).filter((line) =>
    line.fromOffset >= region.contentSpan.fromOffset
      && line.fromOffset < region.contentSpan.toOffset
  );
}

function directItems(content: string, region: PrimaryPlanRegion): readonly MutableDirectItem[] {
  const items: MutableDirectItem[] = [];
  let context: ListContext | undefined;
  let fenceCharacter: "`" | "~" | undefined;
  let fenceLength = 0;
  let fenceInItem = false;
  let htmlTag: string | undefined;
  let htmlInItem = false;

  const extendItem = (line: PhysicalLine): void => {
    if (context?.item && line.text.length > 0) {
      context.item.itemEndOffset = line.toOffset;
      context.item.itemEndLine = line;
    }
  };

  for (const line of linesInRegion(content, region)) {
    if (fenceCharacter) {
      if (fenceInItem) extendItem(line);
      const close = /^ {0,3}(`+|~+)[ \t]*$/.exec(line.text);
      if (close && close[1]![0] === fenceCharacter && close[1]!.length >= fenceLength) {
        fenceCharacter = undefined;
        fenceLength = 0;
        fenceInItem = false;
      }
      continue;
    }

    if (htmlTag) {
      if (htmlInItem) extendItem(line);
      const closesBlock = htmlTag === "--"
        ? line.text.includes("-->")
        : htmlTag === "?"
          ? line.text.includes("?>")
          : htmlTag === "![CDATA["
            ? line.text.includes("]]>")
            : htmlTag === "!"
              ? line.text.includes(">")
              : new RegExp(`</${htmlTag}[ \\t]*>`, "i").test(line.text);
      if (closesBlock) {
        htmlTag = undefined;
        htmlInItem = false;
      }
      continue;
    }

    const fence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line.text);
    if (fence && !(fence[1]![0] === "`" && fence[2]!.includes("`"))) {
      const attached = context !== undefined && leadingSpaces(line.text) > context.indent;
      if (!attached) context = undefined;
      if (attached) extendItem(line);
      fenceCharacter = fence[1]![0] as "`" | "~";
      fenceLength = fence[1]!.length;
      fenceInItem = attached;
      continue;
    }

    if (/^ {0,3}<!--/.test(line.text)) {
      const attached = context !== undefined && leadingSpaces(line.text) > context.indent;
      if (!attached) context = undefined;
      if (attached) extendItem(line);
      if (!line.text.includes("-->")) {
        htmlTag = "--";
        htmlInItem = attached;
      }
      continue;
    }
    const specialHtml = /^ {0,3}<(?:(\?)|(!\[CDATA\[)|(![A-Z]))/.exec(line.text);
    if (specialHtml) {
      const attached = context !== undefined && leadingSpaces(line.text) > context.indent;
      if (!attached) context = undefined;
      if (attached) extendItem(line);
      const blockKind = specialHtml[1] ? "?" : specialHtml[2] ? "![CDATA[" : "!";
      const closesInline = blockKind === "?"
        ? line.text.includes("?>")
        : blockKind === "![CDATA["
          ? line.text.includes("]]>")
          : line.text.includes(">");
      if (!closesInline) {
        htmlTag = blockKind;
        htmlInItem = attached;
      }
      continue;
    }
    const html = HTML_BLOCK_OPEN.exec(line.text);
    if (html) {
      const attached = context !== undefined && leadingSpaces(line.text) > context.indent;
      if (!attached) context = undefined;
      if (attached) extendItem(line);
      const tag = html[1]!.toLowerCase();
      if (!new RegExp(`</${tag}[ \\t]*>`, "i").test(line.text)) {
        htmlTag = tag;
        htmlInItem = attached;
      }
      continue;
    }

    if (/^[ \t]*$/.test(line.text)) continue;

    const list = DIRECT_LIST_PATTERN.exec(line.text);
    if (list) {
      const indent = list[1]!.length;
      if (context && indent > context.indent) {
        extendItem(line);
        continue;
      }

      const unordered = list[2] === "-" || list[2] === "+" || list[2] === "*";
      let item: MutableDirectItem | undefined;
      if (unordered) {
        item = {
          line,
          bulletEndOffset: line.fromOffset + list[1]!.length + list[2]!.length + list[3]!.length,
          itemEndOffset: line.toOffset,
          itemEndLine: line,
        };
        items.push(item);
      }
      context = { indent, ...(item ? { item } : {}) };
      continue;
    }

    if (context && (line.text.startsWith("\t") || leadingSpaces(line.text) > context.indent)) {
      extendItem(line);
      continue;
    }
    context = undefined;
  }

  return Object.freeze(items);
}

function sourceOffsets(fromOffset: number, length: number): readonly number[] {
  return Object.freeze(Array.from({ length: length + 1 }, (_, index) => fromOffset + index));
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

function itemSpan(item: MutableDirectItem): SourceSpan {
  return Object.freeze({
    fromOffset: item.line.fromOffset,
    toOffset: item.itemEndOffset,
    fromLine: item.line.lineNumber,
    fromColumn: 0,
    toLine: item.itemEndLine.lineNumber,
    toColumn: item.itemEndOffset - item.itemEndLine.fromOffset,
  });
}

function projectInline(
  content: string,
  line: PhysicalLine,
  fromOffset: number,
  toOffset: number,
): readonly ProjectedInline[] {
  const projected: ProjectedInline[] = [];

  const push = (
    kind: InlineSegment["kind"],
    start: number,
    end: number,
  ): void => {
    if (end <= start) return;
    const text = content.slice(start, end);
    projected.push(Object.freeze({
      segment: Object.freeze({ kind, text }),
      source: Object.freeze({
        kind,
        span: spanOnLine(line, start, end),
        sourceOffsets: sourceOffsets(start, text.length),
      }),
    }));
  };

  const findClosingBracket = (start: number, limit: number): number => {
    for (let index = start; index < limit; index += 1) {
      if (content[index] === "]" && content[index - 1] !== "\\") return index;
    }
    return -1;
  };

  const walk = (
    start: number,
    end: number,
    participating: boolean,
  ): void => {
    let plainStart = start;
    const flush = (at: number): void => {
      push(participating ? "semantic" : "display-only", plainStart, at);
    };

    let index = start;
    while (index < end) {
      const commentEnd = content.startsWith("<!--", index)
        ? content.indexOf("-->", index + 4)
        : -1;
      if (commentEnd >= 0 && commentEnd + 3 <= end) {
        flush(index);
        push("hidden", index, commentEnd + 3);
        index = commentEnd + 3;
        plainStart = index;
        continue;
      }

      const embed = content.startsWith("![[", index);
      const wiki = !embed && content.startsWith("[[", index);
      if (embed || wiki) {
        const prefixLength = embed ? 3 : 2;
        const closing = content.indexOf("]]", index + prefixLength);
        if (closing >= 0 && closing + 2 <= end) {
          flush(index);
          const insideStart = index + prefixLength;
          const separator = content.indexOf("|", insideStart);
          const hasAlias = separator >= 0 && separator < closing;
          const labelStart = hasAlias ? separator + 1 : insideStart;
          push("hidden", index, labelStart);
          push(embed || !participating ? "display-only" : "semantic", labelStart, closing);
          push("hidden", closing, closing + 2);
          index = closing + 2;
          plainStart = index;
          continue;
        }
      }

      const image = content.startsWith("![", index);
      const link = !image && content[index] === "[";
      if (image || link) {
        const labelStart = index + (image ? 2 : 1);
        const labelEnd = findClosingBracket(labelStart, end);
        if (labelEnd >= 0 && content[labelEnd + 1] === "(") {
          const destinationEnd = content.indexOf(")", labelEnd + 2);
          if (destinationEnd >= 0 && destinationEnd < end) {
            flush(index);
            push("hidden", index, labelStart);
            walk(labelStart, labelEnd, participating && !image);
            push("hidden", labelEnd, destinationEnd + 1);
            index = destinationEnd + 1;
            plainStart = index;
            continue;
          }
        }
      }

      if (content[index] === "`" ) {
        let delimiterLength = 1;
        while (content[index + delimiterLength] === "`") delimiterLength += 1;
        const delimiter = "`".repeat(delimiterLength);
        const closing = content.indexOf(delimiter, index + delimiterLength);
        if (closing >= 0 && closing + delimiterLength <= end) {
          flush(index);
          push("hidden", index, index + delimiterLength);
          push("display-only", index + delimiterLength, closing);
          push("hidden", closing, closing + delimiterLength);
          index = closing + delimiterLength;
          plainStart = index;
          continue;
        }
      }

      if (content[index] === "<") {
        const tagEnd = content.indexOf(">", index + 1);
        if (tagEnd >= 0 && tagEnd < end) {
          flush(index);
          push("hidden", index, tagEnd + 1);
          index = tagEnd + 1;
          plainStart = index;
          continue;
        }
      }

      const delimiter = content.startsWith("**", index) || content.startsWith("__", index)
        || content.startsWith("==", index)
        ? content.slice(index, index + 2)
        : content[index] === "*" || content[index] === "_"
          ? content[index]!
          : undefined;
      if (delimiter) {
        const closing = content.indexOf(delimiter, index + delimiter.length);
        const innerStart = index + delimiter.length;
        if (
          closing > innerStart
          && !/\s/u.test(content[innerStart]!)
          && !/\s/u.test(content[closing - 1]!)
        ) {
          flush(index);
          push("hidden", index, innerStart);
          walk(innerStart, closing, participating);
          push("hidden", closing, closing + delimiter.length);
          index = closing + delimiter.length;
          plainStart = index;
          continue;
        }
      }
      index += 1;
    }
    flush(end);
  };

  walk(fromOffset, toOffset, true);
  return Object.freeze(projected);
}

function candidateFromItem(
  version: SourceVersion,
  content: string,
  region: PrimaryPlanRegion,
  item: MutableDirectItem,
  sourceOrder: number,
): PlanItemCandidate<WorkspacePlanItemSource> | undefined {
  const firstLine = item.line.text;
  let contentStart = item.bulletEndOffset;
  let status: "plain" | "open" | "done" = "plain";
  let checkboxSpan: SourceSpan | undefined;

  const afterBullet = content.slice(contentStart, item.line.toOffset);
  const checkbox = /^\[([^\]])\](?:[ \t]+|$)/.exec(afterBullet);
  if (checkbox) {
    if (checkbox[1] !== " " && checkbox[1] !== "x" && checkbox[1] !== "X") return undefined;
    status = checkbox[1] === " " ? "open" : "done";
    checkboxSpan = spanOnLine(item.line, contentStart, contentStart + 3);
    contentStart += checkbox[0].length;
  }

  const horizontalTrimmedEnd = (() => {
    let offset = item.line.toOffset;
    while (offset > contentStart && (content[offset - 1] === " " || content[offset - 1] === "\t")) {
      offset -= 1;
    }
    return offset;
  })();
  const trimmed = content.slice(contentStart, horizontalTrimmedEnd);
  const terminalId = /[ \t]+\^([A-Za-z0-9-]+)$/.exec(trimmed);
  const blockId = terminalId?.[1];
  const blockIdFrom = terminalId
    ? contentStart + terminalId.index + terminalId[0].length - terminalId[1]!.length - 1
    : undefined;
  const contentEnd = terminalId ? contentStart + terminalId.index : horizontalTrimmedEnd;
  const projection = projectInline(content, item.line, contentStart, contentEnd);
  const segmentSources = Object.freeze(projection.map(({ source }) => source));
  const source: WorkspacePlanItemSource = Object.freeze({
    version,
    regionSpan: region.contentSpan,
    itemSpan: itemSpan(item),
    firstLineSpan: spanOnLine(item.line, item.line.fromOffset, item.line.toOffset),
    contentSpan: spanOnLine(item.line, contentStart, contentEnd),
    firstLineText: firstLine,
    ...(checkboxSpan ? { checkboxSpan } : {}),
    ...(blockIdFrom !== undefined && blockId
      ? {
          blockId,
          blockIdSpan: spanOnLine(item.line, blockIdFrom, blockIdFrom + blockId.length + 1),
        }
      : {}),
    segmentSources,
  });
  return Object.freeze({
    source,
    sourceOrder,
    status,
    segments: Object.freeze(projection.map(({ segment }) => segment)),
  });
}

export function resolvePrimaryPlan(
  version: SourceVersion,
  content: string,
): PrimaryPlanResolution {
  const scan = scanPrimaryPlanRegion(content);
  if (!scan.region) {
    return Object.freeze({
      candidates: Object.freeze([]),
      diagnostics: scan.diagnostics,
    });
  }

  const candidates: PlanItemCandidate<WorkspacePlanItemSource>[] = [];
  for (const item of directItems(content, scan.region)) {
    const candidate = candidateFromItem(version, content, scan.region, item, candidates.length);
    if (candidate) candidates.push(candidate);
  }
  return Object.freeze({
    region: scan.region,
    candidates: Object.freeze(candidates),
    diagnostics: scan.diagnostics,
  });
}

export function tokenSourceSpan(
  content: string,
  source: WorkspacePlanItemSource,
  location: TokenLocation,
): SourceSpan {
  const segment = source.segmentSources[location.segmentIndex];
  const fromOffset = segment?.sourceOffsets[location.fromOffset];
  const toOffset = segment?.sourceOffsets[location.toOffset];
  if (
    !segment
    || fromOffset === undefined
    || toOffset === undefined
    || location.fromOffset < 0
    || location.toOffset < location.fromOffset
  ) {
    throw new RangeError("Token location is outside its projected source segment.");
  }
  if (content.length !== source.version.contentLength) {
    throw new RangeError("Token source text does not match the projected source length.");
  }
  return Object.freeze({
    fromOffset,
    toOffset,
    fromLine: segment.span.fromLine,
    fromColumn: segment.span.fromColumn + (fromOffset - segment.span.fromOffset),
    toLine: segment.span.toLine,
    toColumn: segment.span.fromColumn + (toOffset - segment.span.fromOffset),
  });
}
