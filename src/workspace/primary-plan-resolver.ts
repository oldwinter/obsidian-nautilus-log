import type { InlineSegment, PlanItemCandidate, TokenLocation } from "../core/model";
import {
  iteratePhysicalLines,
  markdownHtmlBlockStart,
  scanPrimaryPlanRegion,
  type PhysicalLine,
  type PlanRegionDiagnostic,
  type PrimaryPlanRegion,
} from "./plan-region";
import {
  sourceVersionMatches,
  utf8ByteLength,
  type SourceSpan,
  type SourceVersion,
} from "./source-version";

export interface PrimaryPlanLimits {
  readonly maxPlanRegionBytes: number;
  readonly maxPlanItems: number;
  readonly maxPlanItemBytes: number;
  readonly maxListDepth: number;
}

export type PrimaryPlanLimitKind =
  | "plan-region-bytes"
  | "plan-items"
  | "plan-item-bytes"
  | "list-depth";

export interface PrimaryPlanLimitExceeded {
  readonly kind: PrimaryPlanLimitKind;
  readonly actual: number;
  readonly limit: number;
}

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
  readonly maximumListDepth: number;
  readonly limitExceeded?: PrimaryPlanLimitExceeded;
}

interface MutableDirectItem {
  readonly line: PhysicalLine;
  readonly bulletEndOffset: number;
  itemEndOffset: number;
  itemEndLine: PhysicalLine;
}

interface ListContext {
  readonly indent: number;
  readonly contentIndent: number;
  readonly depth: number;
  readonly rootItem?: MutableDirectItem;
}

interface DirectItemsResolution {
  readonly items: readonly MutableDirectItem[];
  readonly maximumListDepth: number;
  readonly limitExceeded?: PrimaryPlanLimitExceeded;
}

interface HtmlBlockState {
  readonly closePattern?: RegExp;
  readonly endsOnBlank: boolean;
  readonly inItem: boolean;
}

interface ProjectedInline {
  readonly segment: InlineSegment;
  readonly source: InlineSegmentSource;
}

const LIST_PATTERN = /^([ \t]*)([-+*]|[0-9]{1,9}[.)])([ \t]+)(.*)$/;

function indentationWidth(text: string): number {
  let width = 0;
  for (const character of text) {
    width = character === "\t" ? width + (4 - width % 4) : width + 1;
  }
  return width;
}

function isThematicBreak(text: string): boolean {
  const match = /^ {0,3}([^\S\r\n]*)([*_-])(?:[^\S\r\n]*\2){2,}[^\S\r\n]*$/.exec(text);
  return match !== null;
}

function rootItem(contexts: readonly ListContext[]): MutableDirectItem | undefined {
  return contexts.find((context) => context.rootItem)?.rootItem;
}

function* linesInRegion(content: string, region: PrimaryPlanRegion): Iterable<PhysicalLine> {
  for (const line of iteratePhysicalLines(content)) {
    if (
      line.fromOffset >= region.contentSpan.fromOffset
      && line.fromOffset < region.contentSpan.toOffset
    ) yield line;
    if (line.fromOffset >= region.contentSpan.toOffset) return;
  }
}

function directItems(
  content: string,
  region: PrimaryPlanRegion,
  limits: Pick<PrimaryPlanLimits, "maxPlanItems" | "maxListDepth">,
): DirectItemsResolution {
  const items: MutableDirectItem[] = [];
  const contexts: ListContext[] = [];
  let maximumListDepth = 0;
  let separatedByBlank = false;
  let fenceCharacter: "`" | "~" | undefined;
  let fenceLength = 0;
  let fenceInItem = false;
  let htmlBlock: HtmlBlockState | undefined;
  let indentedCodeAt: number | undefined;
  let indentedCodeInItem = false;

  const limitExceeded = (
    kind: PrimaryPlanLimitKind,
    actual: number,
    limit: number,
  ): DirectItemsResolution => Object.freeze({
    items: Object.freeze([]),
    maximumListDepth,
    limitExceeded: Object.freeze({ kind, actual, limit }),
  });

  const extendItem = (line: PhysicalLine): void => {
    const item = rootItem(contexts);
    if (item && line.text.length > 0) {
      item.itemEndOffset = line.toOffset;
      item.itemEndLine = line;
    }
  };

  const structurallyAttached = (line: PhysicalLine): boolean => {
    const root = contexts.find((context) => context.rootItem);
    return root !== undefined && indentationWidth(/^([ \t]*)/.exec(line.text)![1]!) >= root.contentIndent;
  };

  const attachedToAnyList = (line: PhysicalLine): boolean => {
    const root = contexts[0];
    return root !== undefined && indentationWidth(/^([ \t]*)/.exec(line.text)![1]!) >= root.contentIndent;
  };

  const blockAttachedToAnyList = (line: PhysicalLine): boolean => {
    const root = contexts[0];
    if (!root) return false;
    const indent = indentationWidth(/^([ \t]*)/.exec(line.text)![1]!);
    return indent >= root.contentIndent && indent <= root.contentIndent + 3;
  };

  for (const line of linesInRegion(content, region)) {
    if (fenceCharacter) {
      if (fenceInItem) extendItem(line);
      const close = /^([ \t]*)(`+|~+)[ \t]*$/.exec(line.text);
      if (
        close
        && (fenceInItem || /^ {0,3}$/.test(close[1]!))
        && close[2]![0] === fenceCharacter
        && close[2]!.length >= fenceLength
      ) {
        fenceCharacter = undefined;
        fenceLength = 0;
        fenceInItem = false;
      }
      continue;
    }

    if (htmlBlock) {
      if (htmlBlock.endsOnBlank && /^[ \t]*$/.test(line.text)) {
        htmlBlock = undefined;
        separatedByBlank = true;
        continue;
      }
      if (htmlBlock.inItem) extendItem(line);
      if (htmlBlock.closePattern?.test(line.text)) htmlBlock = undefined;
      continue;
    }

    const blank = /^[ \t]*$/.test(line.text);
    const lineIndent = indentationWidth(/^([ \t]*)/.exec(line.text)![1]!);
    if (indentedCodeAt !== undefined) {
      if (blank) {
        separatedByBlank = true;
        continue;
      }
      if (lineIndent >= indentedCodeAt) {
        if (indentedCodeInItem) extendItem(line);
        continue;
      }
      indentedCodeAt = undefined;
      indentedCodeInItem = false;
    }
    if (blank) {
      separatedByBlank = true;
      continue;
    }
    let codeParentIndex = contexts.length - 1;
    while (codeParentIndex >= 0 && lineIndent < contexts[codeParentIndex]!.contentIndent) {
      codeParentIndex -= 1;
    }
    const codeParent = contexts[codeParentIndex];
    if (separatedByBlank && codeParent && lineIndent >= codeParent.contentIndent + 4) {
      indentedCodeAt = codeParent.contentIndent + 4;
      indentedCodeInItem = rootItem(contexts) !== undefined;
      if (indentedCodeInItem) extendItem(line);
      separatedByBlank = false;
      continue;
    }
    if (!codeParent && lineIndent >= 4) {
      indentedCodeAt = 4;
      separatedByBlank = false;
      continue;
    }

    const fence = /^([ \t]*)(`{3,}|~{3,})(.*)$/.exec(line.text);
    if (fence && !(fence[2]![0] === "`" && fence[3]!.includes("`"))) {
      const attachedToList = blockAttachedToAnyList(line);
      if (!attachedToList && !/^ {0,3}$/.test(fence[1]!)) {
        contexts.length = 0;
        separatedByBlank = false;
        continue;
      }
      const attached = structurallyAttached(line);
      if (!attachedToList) contexts.length = 0;
      if (attached) extendItem(line);
      fenceCharacter = fence[2]![0] as "`" | "~";
      fenceLength = fence[2]!.length;
      fenceInItem = attached;
      separatedByBlank = false;
      continue;
    }

    const htmlStart = markdownHtmlBlockStart(line.text);
    if (htmlStart) {
      const attachedToList = blockAttachedToAnyList(line);
      const attached = structurallyAttached(line);
      if (!attachedToList) contexts.length = 0;
      if (attached) extendItem(line);
      if (htmlStart.endsOnBlank || !htmlStart.closedOnOpeningLine) {
        htmlBlock = {
          ...(htmlStart.closePattern ? { closePattern: htmlStart.closePattern } : {}),
          endsOnBlank: htmlStart.endsOnBlank,
          inItem: attached,
        };
      }
      separatedByBlank = false;
      continue;
    }

    const list = LIST_PATTERN.exec(line.text);
    if (list) {
      if (isThematicBreak(line.text)) {
        const indent = indentationWidth(list[1]!);
        while (contexts.length > 0 && indent < contexts[contexts.length - 1]!.contentIndent) {
          contexts.pop();
        }
        if (rootItem(contexts)) extendItem(line);
        else if (contexts.length === 0) contexts.length = 0;
        separatedByBlank = false;
        continue;
      }
      const indent = indentationWidth(list[1]!);
      while (contexts.length > 0 && indent < contexts[contexts.length - 1]!.contentIndent) {
        contexts.pop();
      }
      const parent = contexts[contexts.length - 1];
      if (!parent && (!/^ {0,3}$/.test(list[1]!) || indent > 3)) {
        contexts.length = 0;
        separatedByBlank = false;
        continue;
      }
      if (parent?.rootItem) extendItem(line);
      const unordered = list[2] === "-" || list[2] === "+" || list[2] === "*";
      const listFence = /^(`{3,}|~{3,})(.*)$/.exec(list[4]!);
      if (listFence && !(listFence[1]![0] === "`" && listFence[2]!.includes("`"))) {
        const depth = (parent?.depth ?? 0) + 1;
        maximumListDepth = Math.max(maximumListDepth, depth);
        if (maximumListDepth > limits.maxListDepth) {
          return limitExceeded("list-depth", maximumListDepth, limits.maxListDepth);
        }
        contexts.push({
          indent,
          contentIndent: indentationWidth(list[1]! + list[2]! + list[3]!),
          depth,
          ...(parent?.rootItem ? { rootItem: parent.rootItem } : {}),
        });
        fenceCharacter = listFence[1]![0] as "`" | "~";
        fenceLength = listFence[1]!.length;
        fenceInItem = parent?.rootItem !== undefined;
        separatedByBlank = false;
        continue;
      }
      let item: MutableDirectItem | undefined;
      if (!parent && unordered) {
        item = {
          line,
          bulletEndOffset: line.fromOffset + list[1]!.length + list[2]!.length + list[3]!.length,
          itemEndOffset: line.toOffset,
          itemEndLine: line,
        };
        items.push(item);
        if (items.length > limits.maxPlanItems) {
          return limitExceeded("plan-items", items.length, limits.maxPlanItems);
        }
      }
      const depth = (parent?.depth ?? 0) + 1;
      maximumListDepth = Math.max(maximumListDepth, depth);
      if (maximumListDepth > limits.maxListDepth) {
        return limitExceeded("list-depth", maximumListDepth, limits.maxListDepth);
      }
      contexts.push({
        indent,
        contentIndent: indentationWidth(list[1]! + list[2]! + list[3]!),
        depth,
        ...(parent?.rootItem ? { rootItem: parent.rootItem } : item ? { rootItem: item } : {}),
      });
      separatedByBlank = false;
      continue;
    }

    if (structurallyAttached(line)) {
      extendItem(line);
      separatedByBlank = false;
      continue;
    }
    if (attachedToAnyList(line)) {
      separatedByBlank = false;
      continue;
    }
    if (
      rootItem(contexts)
      && !separatedByBlank
      && !/^ {0,3}(?:>|#{1,6}(?:[ \t]+|$))/.test(line.text)
    ) {
      extendItem(line);
      continue;
    }
    if (
      contexts.length > 0
      && !separatedByBlank
      && !/^ {0,3}(?:>|#{1,6}(?:[ \t]+|$))/.test(line.text)
    ) {
      continue;
    }
    contexts.length = 0;
    separatedByBlank = false;
  }

  return Object.freeze({
    items: Object.freeze(items),
    maximumListDepth,
  });
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

  const isEscaped = (offset: number): boolean => {
    let backslashes = 0;
    for (let index = offset - 1; index >= fromOffset && content[index] === "\\"; index -= 1) {
      backslashes += 1;
    }
    return backslashes % 2 === 1;
  };

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
    let depth = 1;
    for (let index = start; index < limit; index += 1) {
      if (isEscaped(index)) continue;
      if (content[index] === "[") depth += 1;
      else if (content[index] === "]") {
        depth -= 1;
        if (depth === 0) return index;
      }
    }
    return -1;
  };

  const delimiterCanOpenOrClose = (
    offset: number,
    length: number,
    underscore: boolean,
  ): { readonly canOpen: boolean; readonly canClose: boolean } => {
    const before = content[offset - 1];
    const after = content[offset + length];
    const beforeWhitespace = before === undefined || /\s/u.test(before);
    const afterWhitespace = after === undefined || /\s/u.test(after);
    const beforePunctuation = before !== undefined && /[\p{P}\p{S}]/u.test(before);
    const afterPunctuation = after !== undefined && /[\p{P}\p{S}]/u.test(after);
    const leftFlanking = !afterWhitespace
      && (!afterPunctuation || beforeWhitespace || beforePunctuation);
    const rightFlanking = !beforeWhitespace
      && (!beforePunctuation || afterWhitespace || afterPunctuation);
    return {
      canOpen: leftFlanking && (!underscore || !rightFlanking || beforePunctuation),
      canClose: rightFlanking && (!underscore || !leftFlanking || afterPunctuation),
    };
  };

  const findClosingDelimiter = (
    delimiter: string,
    start: number,
    limit: number,
  ): number => {
    let closing = content.indexOf(delimiter, start);
    while (closing >= 0 && closing + delimiter.length <= limit) {
      if (
        !isEscaped(closing)
        && content[closing - 1] !== delimiter[0]
        && content[closing + delimiter.length] !== delimiter[0]
        && delimiterCanOpenOrClose(
          closing,
          delimiter.length,
          delimiter.startsWith("_"),
        ).canClose
      ) return closing;
      closing = content.indexOf(delimiter, closing + 1);
    }
    return -1;
  };

  const findClosingParenthesis = (start: number, limit: number): number => {
    let depth = 1;
    for (let index = start; index < limit; index += 1) {
      if (content[index] === "\\") {
        index += 1;
        continue;
      }
      if (content[index] === "(") depth += 1;
      else if (content[index] === ")") {
        depth -= 1;
        if (depth === 0) return index;
      }
    }
    return -1;
  };

  const findClosingCodeDelimiter = (
    delimiter: string,
    start: number,
    limit: number,
  ): number => {
    let closing = content.indexOf(delimiter, start);
    while (closing >= 0 && closing + delimiter.length <= limit) {
      if (
        !isEscaped(closing)
        && content[closing - 1] !== "`"
        && content[closing + delimiter.length] !== "`"
      ) return closing;
      closing = content.indexOf(delimiter, closing + delimiter.length);
    }
    return -1;
  };

  const rawHtmlTag = (text: string): boolean => /^<\/?[A-Za-z][A-Za-z0-9-]*(?:[ \t\r\n]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t\r\n]*=[ \t\r\n]*(?:[^ \t\r\n"'=<>`]+|'[^']*'|"[^"]*"))?)*[ \t\r\n]*\/?>$/.test(text)
    || /^<\?(?:[^?]|\?(?!>))*\?>$/.test(text)
    || /^<![A-Z]+(?:[ \t\r\n]+[^>]*)?>$/.test(text)
    || /^<!\[CDATA\[[\s\S]*\]\]>$/.test(text);

  const autolink = (text: string): boolean => /^[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*$/.test(text)
    || /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(text);

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
      if (content.startsWith("<!--", index)) {
        const commentEnd = content.indexOf("-->", index + 4);
        const hiddenEnd = commentEnd >= 0 && commentEnd + 3 <= end
          ? commentEnd + 3
          : end;
        flush(index);
        push("hidden", index, hiddenEnd);
        index = hiddenEnd;
        plainStart = index;
        continue;
      }

      const embed = content.startsWith("![[", index) && !isEscaped(index);
      const wiki = !embed && content.startsWith("[[", index) && !isEscaped(index);
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

      const image = content.startsWith("![", index) && !isEscaped(index);
      const link = !image && content[index] === "[" && !isEscaped(index);
      if (image || link) {
        const labelStart = index + (image ? 2 : 1);
        const labelEnd = findClosingBracket(labelStart, end);
        if (labelEnd >= 0 && content[labelEnd + 1] === "(") {
          const destinationEnd = findClosingParenthesis(labelEnd + 2, end);
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

      if (content[index] === "`" && !isEscaped(index)) {
        let delimiterLength = 1;
        while (content[index + delimiterLength] === "`") delimiterLength += 1;
        const delimiter = "`".repeat(delimiterLength);
        const closing = findClosingCodeDelimiter(delimiter, index + delimiterLength, end);
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
          const angleText = content.slice(index, tagEnd + 1);
          const label = content.slice(index + 1, tagEnd);
          if (rawHtmlTag(angleText) || autolink(label)) {
            flush(index);
            if (autolink(label)) {
              push("hidden", index, index + 1);
              push(participating ? "semantic" : "display-only", index + 1, tagEnd);
              push("hidden", tagEnd, tagEnd + 1);
            } else {
              push("hidden", index, tagEnd + 1);
            }
            index = tagEnd + 1;
            plainStart = index;
            continue;
          }
        }
      }

      let delimiter: string | undefined;
      if (content[index] === "*" || content[index] === "_") {
        let delimiterLength = 1;
        while (content[index + delimiterLength] === content[index]) delimiterLength += 1;
        delimiter = content.slice(index, index + delimiterLength);
      } else if (content.startsWith("==", index)) {
        delimiter = "==";
      }
      const standardEmphasis = delimiter !== undefined && delimiter !== "==";
      const validOpener = delimiter !== undefined && (
        !standardEmphasis
        || delimiterCanOpenOrClose(
          index,
          delimiter.length,
          delimiter.startsWith("_"),
        ).canOpen
      );
      if (delimiter && validOpener) {
        const closing = standardEmphasis
          ? findClosingDelimiter(delimiter, index + delimiter.length, end)
          : content.indexOf(delimiter, index + delimiter.length);
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

function normalizePrimaryPlanLimits(limits: Partial<PrimaryPlanLimits> | undefined): PrimaryPlanLimits {
  const normalized: PrimaryPlanLimits = {
    maxPlanRegionBytes: limits?.maxPlanRegionBytes ?? Number.MAX_SAFE_INTEGER,
    maxPlanItems: limits?.maxPlanItems ?? Number.MAX_SAFE_INTEGER,
    maxPlanItemBytes: limits?.maxPlanItemBytes ?? Number.MAX_SAFE_INTEGER,
    maxListDepth: limits?.maxListDepth ?? Number.MAX_SAFE_INTEGER,
  };
  for (const [name, value] of Object.entries(normalized)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a nonnegative safe integer`);
    }
  }
  return Object.freeze(normalized);
}

export function resolvePrimaryPlan(
  version: SourceVersion,
  content: string,
  limitOverrides?: Partial<PrimaryPlanLimits>,
): PrimaryPlanResolution {
  const limits = normalizePrimaryPlanLimits(limitOverrides);
  const scan = scanPrimaryPlanRegion(content);
  if (!scan.region) {
    return Object.freeze({
      candidates: Object.freeze([]),
      diagnostics: scan.diagnostics,
      maximumListDepth: 0,
    });
  }

  const regionBytes = utf8ByteLength(content.slice(
    scan.region.contentSpan.fromOffset,
    scan.region.contentSpan.toOffset,
  ));
  if (regionBytes > limits.maxPlanRegionBytes) {
    return Object.freeze({
      region: scan.region,
      candidates: Object.freeze([]),
      diagnostics: scan.diagnostics,
      maximumListDepth: 0,
      limitExceeded: Object.freeze({
        kind: "plan-region-bytes" as const,
        actual: regionBytes,
        limit: limits.maxPlanRegionBytes,
      }),
    });
  }

  const candidates: PlanItemCandidate<WorkspacePlanItemSource>[] = [];
  const structural = directItems(content, scan.region, limits);
  if (structural.limitExceeded) {
    return Object.freeze({
      region: scan.region,
      candidates: Object.freeze([]),
      diagnostics: scan.diagnostics,
      maximumListDepth: structural.maximumListDepth,
      limitExceeded: structural.limitExceeded,
    });
  }
  for (const item of structural.items) {
    const itemBytes = utf8ByteLength(content.slice(item.line.fromOffset, item.itemEndOffset));
    if (itemBytes > limits.maxPlanItemBytes) {
      return Object.freeze({
        region: scan.region,
        candidates: Object.freeze([]),
        diagnostics: scan.diagnostics,
        maximumListDepth: structural.maximumListDepth,
        limitExceeded: Object.freeze({
          kind: "plan-item-bytes" as const,
          actual: itemBytes,
          limit: limits.maxPlanItemBytes,
        }),
      });
    }
    const candidate = candidateFromItem(version, content, scan.region, item, candidates.length);
    if (candidate) candidates.push(candidate);
  }
  return Object.freeze({
    region: scan.region,
    candidates: Object.freeze(candidates),
    diagnostics: scan.diagnostics,
    maximumListDepth: structural.maximumListDepth,
  });
}

export async function tokenSourceSpan(
  content: string,
  source: WorkspacePlanItemSource,
  location: TokenLocation,
): Promise<SourceSpan> {
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
  if (!await sourceVersionMatches(source.version, source.version.file, content)) {
    throw new RangeError("Token source text does not match the projected source snapshot digest.");
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
