import { parseGrammar } from "../core/grammar-v1";
import {
  isCanonicalClockId,
  parseClockText,
  type ClockParseResult,
  type ParseClockOptions,
} from "./clock-parser";
import { readLogbook, type LogbookClock } from "./logbook-reader";
import { markdownHtmlBlockStart } from "./plan-region";
import { resolvePrimaryPlan } from "./primary-plan-resolver";
import {
  createSourceVersion,
  utf8ByteLengthCooperative,
  type AsyncCheckpoint,
  type SourceVersion,
} from "./source-version";
import type { SourceChange, TextAccess } from "./text-access";

export type { SourceChange } from "./text-access";

export type WorkspaceIndexTextAccess = Pick<TextAccess, "listMarkdownPaths" | "readText" | "onChange">;

export interface WorkspaceIndexLimits {
  readonly maxMarkdownFiles: number;
  readonly maxMarkdownBytes: number;
  readonly maxBlockIds: number;
  readonly maxClockRecords: number;
}

export const DEFAULT_WORKSPACE_INDEX_LIMITS: WorkspaceIndexLimits = Object.freeze({
  maxMarkdownFiles: 20_000,
  maxMarkdownBytes: 2_147_483_648,
  maxBlockIds: 100_000,
  maxClockRecords: 25_000,
});

export interface BlockIdLocation {
  readonly id: string;
  readonly path: string;
  readonly fromOffset: number;
  readonly toOffset: number;
  readonly line: number;
  readonly column: number;
}

export type IdentityLookup =
  | { readonly kind: "missing" }
  | { readonly kind: "unique"; readonly location: BlockIdLocation }
  | { readonly kind: "collision"; readonly locations: readonly BlockIdLocation[] }
  | { readonly kind: "unavailable"; readonly reason: WorkspaceIndexIncompleteReason };

export interface IdentityLookupIndex {
  lookup(id: string): IdentityLookup;
}

export type WorkspaceIndexIncompleteReason =
  | "not-built"
  | "source-changed"
  | "cancelled"
  | "source-read-failed"
  | "markdown-file-limit"
  | "markdown-byte-limit"
  | "block-id-limit"
  | "clock-record-limit"
  | "structured-input-limit";

export interface IndexedClockSource {
  readonly path: string;
  readonly fromOffset: number;
  readonly toOffset: number;
  readonly text: string;
  readonly ownerId?: string;
  readonly clockId?: string;
  readonly scope: "canonical-global" | "accepted-logbook";
  readonly parsed: ClockParseResult;
}

export interface WorkspaceIndexSnapshot {
  readonly generation: number;
  readonly complete: boolean;
  readonly reason?: WorkspaceIndexIncompleteReason;
  readonly markdownFiles: number;
  readonly markdownBytes: number;
  readonly blockIds: number;
  readonly clocks: readonly IndexedClockSource[];
  readonly running: readonly IndexedClockSource[];
  readonly potentialRunning: readonly IndexedClockSource[];
}

export type StructuredClockReader = (
  path: string,
  text: string,
  identities: IdentityLookupIndex,
  version: SourceVersion,
  maximumClockRecords: number,
  context: StructuredClockReadContext,
) => readonly LogbookClock[] | Promise<readonly LogbookClock[]>;

export interface StructuredClockReadContext {
  readonly sourceBytes: number;
  readonly signal?: AbortSignal;
  readonly checkpoint: AsyncCheckpoint;
}

export interface WorkspaceIndexOptions {
  readonly limits?: Partial<WorkspaceIndexLimits>;
  readonly readStructuredClocks?: StructuredClockReader;
  readonly clockParsing?: ParseClockOptions;
}

interface PhysicalLine {
  readonly start: number;
  readonly end: number;
  readonly line: number;
  readonly content: string;
}

const TERMINAL_BLOCK_ID = /(?:^|[ \t])\^([A-Za-z0-9-]+)[ \t]*$/;
const FENCE_OPEN = /^([ \t]*)(`{3,}|~{3,})/;
const ANY_LIST_ITEM = /^([ \t]*)([-+*]|[0-9]{1,9}[.)])([ \t]+)/;
const CLOCK_RECORD_LIMIT = Object.freeze({ kind: "clock-record-limit" as const });
const REBUILD_CANCELLED = Object.freeze({ kind: "cancelled" as const });
const REBUILD_STALE = Object.freeze({ kind: "source-changed" as const });
const STRUCTURED_INPUT_LIMIT = Object.freeze({ kind: "structured-input-limit" as const });
const MAX_STRUCTURED_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_STRUCTURED_REGION_BYTES = 1024 * 1024;
const MAX_STRUCTURED_PLAN_ITEMS = 1_000;
const MAX_STRUCTURED_ITEM_BYTES = 16 * 1024;
const MAX_STRUCTURED_LIST_DEPTH = 16;

function isTableRow(content: string): boolean {
  return /^ {0,3}\S.*\|.*$/.test(content) || /^ {0,3}\|.*$/.test(content);
}

function isTableDelimiter(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed.includes("|")) return false;
  const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|");
  return cells.length > 0 && cells.every((cell) => /^[ \t]*:?-{3,}:?[ \t]*$/.test(cell));
}

function frozenEmptySnapshot(
  generation: number,
  reason: WorkspaceIndexIncompleteReason,
  counts: Partial<Pick<WorkspaceIndexSnapshot, "markdownFiles" | "markdownBytes" | "blockIds">> = {},
): WorkspaceIndexSnapshot {
  return Object.freeze({
    generation,
    complete: false,
    reason,
    markdownFiles: counts.markdownFiles ?? 0,
    markdownBytes: counts.markdownBytes ?? 0,
    blockIds: counts.blockIds ?? 0,
    clocks: Object.freeze([]),
    running: Object.freeze([]),
    potentialRunning: Object.freeze([]),
  });
}

async function* physicalLines(
  text: string,
  checkpoint: AsyncCheckpoint,
): AsyncIterable<PhysicalLine> {
  let start = 0;
  let line = 0;
  let offset = 0;
  let nextCheckpoint = 64 * 1024;
  while (offset < text.length) {
    const code = text.charCodeAt(offset);
    if (code === 10 || code === 13) {
      yield { start, end: offset, line, content: text.slice(start, offset) };
      if (code === 13 && text.charCodeAt(offset + 1) === 10) offset += 1;
      offset += 1;
      start = offset;
      line += 1;
      if (offset >= nextCheckpoint) {
        await checkpoint();
        nextCheckpoint = offset + 64 * 1024;
      }
      continue;
    }
    offset += 1;
    if (offset >= nextCheckpoint) {
      await checkpoint();
      nextCheckpoint = offset + 64 * 1024;
    }
  }
  yield { start, end: text.length, line, content: text.slice(start) };
}

async function* outsideFenceLines(
  text: string,
  checkpoint: AsyncCheckpoint,
): AsyncIterable<PhysicalLine> {
  let fence: {
    readonly marker: string;
    readonly length: number;
    readonly quoteDepth: number;
  } | undefined;
  let htmlBlock: {
    readonly closePattern?: RegExp;
    readonly endsOnBlank: boolean;
    readonly quoteDepth: number;
  } | undefined;
  let frontmatter = false;
  let firstLine = true;
  let separatedByBlank = false;
  let listQuoteDepth = 0;
  let indentedCodeAt: number | undefined;
  let pendingTableHeader: PhysicalLine | undefined;
  let inTable = false;
  const listContentIndents: number[] = [];
  for await (const line of physicalLines(text, checkpoint)) {
    const firstContent = firstLine && line.content.startsWith("\uFEFF")
      ? line.content.slice(1)
      : line.content;
    if (firstLine && firstContent === "---") {
      frontmatter = true;
      firstLine = false;
      continue;
    }
    firstLine = false;
    if (frontmatter) {
      if (line.content === "---" || line.content === "...") frontmatter = false;
      continue;
    }
    const container = markdownContainerContent(line.content);
    if (pendingTableHeader) {
      if (isTableDelimiter(container.content)) {
        pendingTableHeader = undefined;
        inTable = true;
        continue;
      }
      yield pendingTableHeader;
      pendingTableHeader = undefined;
    }
    if (inTable) {
      if (isTableRow(container.content)) continue;
      inTable = false;
    }
    if (container.quoteDepth !== listQuoteDepth) {
      listContentIndents.length = 0;
      separatedByBlank = false;
      indentedCodeAt = undefined;
      listQuoteDepth = container.quoteDepth;
    }
    if (fence && container.quoteDepth < fence.quoteDepth) fence = undefined;
    const rawFenceMatch = FENCE_OPEN.exec(container.content);
    if (fence) {
      if (rawFenceMatch) {
        const run = rawFenceMatch[2]!;
        const remainder = container.content.slice(rawFenceMatch[0].length);
        const indent = indentationWidth(rawFenceMatch[1]!);
        const validIndent = indent <= 3 || (
          listContentIndents.length > 0
          && indent >= listContentIndents[listContentIndents.length - 1]!
          && indent <= listContentIndents[listContentIndents.length - 1]! + 3
        );
        if (
          container.quoteDepth === fence.quoteDepth
          && validIndent
          && run[0] === fence.marker
          && run.length >= fence.length
          && /^[ \t]*$/.test(remainder)
        ) fence = undefined;
      }
      continue;
    }
    if (htmlBlock) {
      if (container.quoteDepth < htmlBlock.quoteDepth) {
        htmlBlock = undefined;
      } else {
        if (
          container.quoteDepth === htmlBlock.quoteDepth
          && htmlBlock.endsOnBlank
          && /^[ \t]*$/.test(container.content)
        ) htmlBlock = undefined;
        else if (
          container.quoteDepth === htmlBlock.quoteDepth
          && htmlBlock.closePattern?.test(container.content)
        ) htmlBlock = undefined;
        continue;
      }
    }
    const blank = /^[ \t]*$/.test(container.content);
    const indentText = /^([ \t]*)/.exec(container.content)![1]!;
    const indent = indentationWidth(indentText);
    if (indentedCodeAt !== undefined) {
      if (blank) {
        separatedByBlank = true;
        continue;
      }
      if (indent >= indentedCodeAt) continue;
      indentedCodeAt = undefined;
    }
    if (blank) {
      separatedByBlank = true;
      continue;
    }
    while (listContentIndents.length > 0 && indent < listContentIndents[listContentIndents.length - 1]!) {
      listContentIndents.pop();
    }
    if (
      separatedByBlank
      && listContentIndents.length > 0
      && indent >= listContentIndents[listContentIndents.length - 1]! + 4
    ) {
      indentedCodeAt = listContentIndents[listContentIndents.length - 1]! + 4;
      separatedByBlank = false;
      continue;
    }
    if (listContentIndents.length === 0 && indent >= 4) {
      indentedCodeAt = 4;
      separatedByBlank = false;
      continue;
    }

    const list = ANY_LIST_ITEM.exec(container.content);
    if (list) {
      const blockContent = container.content.slice(list[0].length);
      listContentIndents.push(indentationWidth(list[1]! + list[2]! + list[3]!));
      const listFence = FENCE_OPEN.exec(blockContent);
      if (listFence) {
        const run = listFence[2]!;
        const remainder = blockContent.slice(listFence[0].length);
        if (run[0] !== "`" || !remainder.includes("`")) {
          fence = { marker: run[0]!, length: run.length, quoteDepth: container.quoteDepth };
          separatedByBlank = false;
          continue;
        }
      }
      const listHtmlStart = markdownHtmlBlockStart(blockContent);
      if (listHtmlStart) {
        if (listHtmlStart.endsOnBlank || !listHtmlStart.closedOnOpeningLine) {
          htmlBlock = {
            ...(listHtmlStart.closePattern ? { closePattern: listHtmlStart.closePattern } : {}),
            endsOnBlank: listHtmlStart.endsOnBlank,
            quoteDepth: container.quoteDepth,
          };
        }
        separatedByBlank = false;
        continue;
      }
      separatedByBlank = false;
      yield line;
      continue;
    }

    if (rawFenceMatch) {
      const run = rawFenceMatch[2]!;
      const remainder = container.content.slice(rawFenceMatch[0].length);
      const validIndent = indent <= 3 || (
        listContentIndents.length > 0
        && indent >= listContentIndents[listContentIndents.length - 1]!
        && indent <= listContentIndents[listContentIndents.length - 1]! + 3
      );
      if (validIndent && (run[0] !== "`" || !remainder.includes("`"))) {
        fence = { marker: run[0]!, length: run.length, quoteDepth: container.quoteDepth };
        separatedByBlank = false;
        continue;
      }
    }

    const htmlStart = markdownHtmlBlockStart(container.content);
    if (htmlStart) {
      if (htmlStart.endsOnBlank || !htmlStart.closedOnOpeningLine) {
        htmlBlock = {
          ...(htmlStart.closePattern ? { closePattern: htmlStart.closePattern } : {}),
          endsOnBlank: htmlStart.endsOnBlank,
          quoteDepth: container.quoteDepth,
        };
      }
      separatedByBlank = false;
      continue;
    }

    separatedByBlank = false;
    if (isTableRow(container.content)) pendingTableHeader = line;
    else yield line;
  }
  if (pendingTableHeader) yield pendingTableHeader;
}

function markdownContainerContent(content: string): {
  readonly content: string;
  readonly quoteDepth: number;
} {
  let offset = 0;
  let quoteDepth = 0;
  while (offset < content.length) {
    const marker = /^[ ]{0,3}>[ \t]?/.exec(content.slice(offset));
    if (!marker) break;
    offset += marker[0].length;
    quoteDepth += 1;
  }
  return { content: content.slice(offset), quoteDepth };
}

function indentationWidth(text: string): number {
  let width = 0;
  for (const character of text) {
    width = character === "\t" ? width + (4 - width % 4) : width + 1;
  }
  return width;
}

function terminalBlockId(line: PhysicalLine, path: string): BlockIdLocation | undefined {
  const match = TERMINAL_BLOCK_ID.exec(line.content);
  if (!match) return undefined;
  const caretInMatch = match[0].indexOf("^");
  const column = match.index + caretInMatch;
  const id = match[1]!;
  return Object.freeze({
    id,
    path,
    fromOffset: line.start + column,
    toOffset: line.start + column + id.length + 1,
    line: line.line,
    column,
  });
}

function canonicalClockOnLine(
  line: PhysicalLine,
  path: string,
  blockId: BlockIdLocation | undefined,
): IndexedClockSource | undefined {
  if (!blockId || !isCanonicalClockId(blockId.id)) return undefined;
  const contentOffset = line.content.indexOf("CLOCK: [");
  if (contentOffset < 0) return undefined;
  const raw = line.content.slice(contentOffset);
  const trailing = /[ \t]*$/.exec(raw)![0].length;
  const text = raw.slice(0, raw.length - trailing);
  const parsed = parseClockText(text);
  if (parsed.kind === "not-clock") return undefined;
  return Object.freeze({
    path,
    fromOffset: line.start + contentOffset,
    toOffset: line.start + contentOffset + text.length,
    text,
    clockId: blockId.id,
    scope: "canonical-global" as const,
    parsed,
  });
}

function identityLookup(
  locations: ReadonlyMap<string, readonly BlockIdLocation[]>,
  id: string,
): IdentityLookup {
  const matches = locations.get(id);
  if (!matches || matches.length === 0) return Object.freeze({ kind: "missing" as const });
  if (matches.length === 1) {
    return Object.freeze({ kind: "unique" as const, location: matches[0]! });
  }
  return Object.freeze({ kind: "collision" as const, locations: matches });
}

function clockKey(clock: Pick<IndexedClockSource, "path" | "fromOffset" | "toOffset">): string {
  return `${clock.path}\0${clock.fromOffset}\0${clock.toOffset}`;
}

function isValidStructuredClock(clock: LogbookClock, path: string, text: string): boolean {
  return clock.path === path
    && Number.isInteger(clock.fromOffset)
    && Number.isInteger(clock.toOffset)
    && clock.fromOffset >= 0
    && clock.toOffset >= clock.fromOffset
    && clock.toOffset <= text.length
    && text.slice(clock.fromOffset, clock.toOffset) === clock.text;
}

function isAnonymousLegacyRunningFact(clock: LogbookClock): boolean {
  if (clock.ownerId) return false;
  if (clock.parsed.kind === "record") {
    return clock.parsed.record.format === "legacy"
      && clock.parsed.record.state === "running"
      && clock.parsed.record.clockId === undefined;
  }
  if (clock.parsed.kind !== "malformed" || !clock.parsed.potentialRunning) return false;
  const terminalId = TERMINAL_BLOCK_ID.exec(clock.text)?.[1];
  return terminalId === undefined || !isCanonicalClockId(terminalId);
}

function normalizeLimits(overrides: Partial<WorkspaceIndexLimits> | undefined): WorkspaceIndexLimits {
  const limits = { ...DEFAULT_WORKSPACE_INDEX_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a nonnegative safe integer`);
  }
  return Object.freeze(limits);
}

function interruptionReason(error: unknown): "cancelled" | "source-changed" | undefined {
  if (error === REBUILD_CANCELLED) return "cancelled";
  if (error === REBUILD_STALE) return "source-changed";
  return undefined;
}

async function hasPlanOpeningMarker(
  text: string,
  checkpoint: AsyncCheckpoint,
): Promise<boolean> {
  let fence: { readonly marker: string; readonly length: number } | undefined;
  for await (const line of physicalLines(text, checkpoint)) {
    const content = line.line === 0 && line.content.startsWith("\uFEFF")
      ? line.content.slice(1)
      : line.content;
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(content);
    if (fence) {
      if (
        marker
        && marker[1]![0] === fence.marker
        && marker[1]!.length >= fence.length
        && /^[ \t]*$/.test(marker[2]!)
      ) fence = undefined;
      continue;
    }
    if (marker && !(marker[1]![0] === "`" && marker[2]!.includes("`"))) {
      fence = { marker: marker[1]![0]!, length: marker[1]!.length };
      continue;
    }
    if (/^<!-- nautilus-log:plan\/v[0-9]+ -->[ \t]*$/.test(content)) return true;
  }
  return false;
}

async function defaultStructuredClockReader(
  path: string,
  text: string,
  _identities: IdentityLookupIndex,
  version: SourceVersion,
  maximumClockRecords: number,
  context: StructuredClockReadContext,
  options: ParseClockOptions,
): Promise<readonly LogbookClock[]> {
  const clocks: LogbookClock[] = [];
  if (context.sourceBytes > MAX_STRUCTURED_SOURCE_BYTES) {
    if (await hasPlanOpeningMarker(text, context.checkpoint)) throw STRUCTURED_INPUT_LIMIT;
    return Object.freeze(clocks);
  }
  const primary = resolvePrimaryPlan(version, text, {
    maxPlanRegionBytes: MAX_STRUCTURED_REGION_BYTES,
    maxPlanItems: MAX_STRUCTURED_PLAN_ITEMS,
    maxPlanItemBytes: MAX_STRUCTURED_ITEM_BYTES,
    maxListDepth: MAX_STRUCTURED_LIST_DEPTH,
  });
  await context.checkpoint();
  if (!primary.region) return Object.freeze(clocks);
  if (primary.limitExceeded) throw STRUCTURED_INPUT_LIMIT;
  const parsed = parseGrammar({ version: primary.region.version, candidates: primary.candidates });
  const parsedAnonymousSources = new Set(parsed.items
    .filter((item) => !item.source.blockId)
    .map((item) => item.source));
  for (const candidate of primary.candidates) {
    await context.checkpoint();
    if (
      candidate.status === "foreign"
      || (!candidate.source.blockId && !parsedAnonymousSources.has(candidate.source))
    ) continue;
    const logbook = readLogbook(text, {
      path,
      itemFromOffset: candidate.source.itemSpan.fromOffset,
      itemToOffset: candidate.source.itemSpan.toOffset,
      ...(candidate.source.blockId ? { ownerId: candidate.source.blockId } : {}),
    }, { ...options, maxClockRecords: maximumClockRecords - clocks.length });
    if (!logbook.complete) throw CLOCK_RECORD_LIMIT;
    clocks.push(...logbook.clocks);
  }
  return Object.freeze(clocks);
}

export class WorkspaceIndex {
  readonly #access: WorkspaceIndexTextAccess;
  readonly #limits: WorkspaceIndexLimits;
  readonly #readStructuredClocks: StructuredClockReader;
  readonly #unsubscribe: () => void;
  #revision = 0;
  #rebuildAttempt = 0;
  #generation = 0;
  #dirty = true;
  #locations: ReadonlyMap<string, readonly BlockIdLocation[]> = new Map();
  #snapshot: WorkspaceIndexSnapshot = frozenEmptySnapshot(0, "not-built");

  constructor(access: WorkspaceIndexTextAccess, options: WorkspaceIndexOptions = {}) {
    this.#access = access;
    this.#limits = normalizeLimits(options.limits);
    this.#readStructuredClocks = options.readStructuredClocks
      ?? ((path, text, identities, version, maximumClockRecords, context) =>
        defaultStructuredClockReader(
          path,
          text,
          identities,
          version,
          maximumClockRecords,
          context,
          options.clockParsing ?? {},
        ));
    this.#unsubscribe = access.onChange((change: SourceChange) => this.invalidate(change));
  }

  get dirty(): boolean {
    return this.#dirty;
  }

  get snapshot(): WorkspaceIndexSnapshot {
    return this.#snapshot;
  }

  invalidate(_change: SourceChange): void {
    this.#revision += 1;
    this.#rebuildAttempt += 1;
    this.#dirty = true;
    this.#locations = new Map();
    this.#snapshot = frozenEmptySnapshot(this.#generation, "source-changed");
  }

  clear(): void {
    this.#revision += 1;
    this.#rebuildAttempt += 1;
    this.#dirty = true;
    this.#locations = new Map();
    this.#snapshot = frozenEmptySnapshot(this.#generation, "not-built");
  }

  dispose(): void {
    this.#unsubscribe();
    this.clear();
  }

  identity(id: string): IdentityLookup {
    if (!this.#snapshot.complete) {
      return Object.freeze({
        kind: "unavailable" as const,
        reason: this.#snapshot.reason ?? "not-built",
      });
    }
    return identityLookup(this.#locations, id);
  }

  async rebuild(signal?: AbortSignal): Promise<WorkspaceIndexSnapshot> {
    const attempt = ++this.#rebuildAttempt;
    const revision = this.#revision;
    const generation = this.#generation + 1;
    if (signal?.aborted) return this.#publishIncomplete(attempt, generation, "cancelled");
    let listed: readonly string[];
    try {
      listed = await this.#access.listMarkdownPaths(signal);
    } catch (error) {
      return this.#publishIncomplete(
        attempt,
        generation,
        signal?.aborted || (error instanceof DOMException && error.name === "AbortError")
          ? "cancelled"
          : "source-read-failed",
      );
    }
    if (signal?.aborted) return this.#publishIncomplete(attempt, generation, "cancelled");
    if (this.#revision !== revision || attempt !== this.#rebuildAttempt) {
      return this.#publishIncomplete(attempt, generation, "source-changed");
    }
    const paths = [...new Set(listed.filter((path) => path.toLowerCase().endsWith(".md")))].sort();
    if (paths.length > this.#limits.maxMarkdownFiles) {
      return this.#publishIncomplete(attempt, generation, "markdown-file-limit", { markdownFiles: paths.length });
    }

    const versions = new Map<string, SourceVersion>();
    const byteLengths = new Map<string, number>();
    const mutableLocations = new Map<string, BlockIdLocation[]>();
    const clocks = new Map<string, IndexedClockSource>();
    let markdownBytes = 0;
    let blockIds = 0;
    let lastYield = Date.now();
    const checkpoint: AsyncCheckpoint = async () => {
      if (signal?.aborted) throw REBUILD_CANCELLED;
      if (this.#revision !== revision || attempt !== this.#rebuildAttempt) throw REBUILD_STALE;
      if (Date.now() - lastYield < 40) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      lastYield = Date.now();
      if (signal?.aborted) throw REBUILD_CANCELLED;
      if (this.#revision !== revision || attempt !== this.#rebuildAttempt) throw REBUILD_STALE;
    };
    for (const path of paths) {
      if (signal?.aborted) return this.#publishIncomplete(attempt, generation, "cancelled", {
        markdownFiles: paths.length, markdownBytes, blockIds,
      });
      if (this.#revision !== revision || attempt !== this.#rebuildAttempt) {
        return this.#publishIncomplete(attempt, generation, "source-changed", {
          markdownFiles: paths.length, markdownBytes, blockIds,
        });
      }
      let text: string | undefined;
      try {
        text = await this.#access.readText(path, signal);
      } catch (error) {
        return this.#publishIncomplete(attempt, generation,
          signal?.aborted || (error instanceof DOMException && error.name === "AbortError")
            ? "cancelled"
            : "source-read-failed", {
          markdownFiles: paths.length,
          markdownBytes,
          blockIds,
        });
      }
      if (signal?.aborted) return this.#publishIncomplete(attempt, generation, "cancelled", {
        markdownFiles: paths.length, markdownBytes, blockIds,
      });
      if (this.#revision !== revision || attempt !== this.#rebuildAttempt) {
        return this.#publishIncomplete(attempt, generation, "source-changed", {
          markdownFiles: paths.length, markdownBytes, blockIds,
        });
      }
      if (text === undefined) {
        return this.#publishIncomplete(attempt, generation, "source-changed", {
          markdownFiles: paths.length,
          markdownBytes,
          blockIds,
        });
      }
      let fileBytes: number;
      try {
        fileBytes = await utf8ByteLengthCooperative(text, checkpoint);
      } catch (error) {
        return this.#publishIncomplete(
          attempt,
          generation,
          interruptionReason(error) ?? "source-read-failed",
          { markdownFiles: paths.length, markdownBytes, blockIds },
        );
      }
      byteLengths.set(path, fileBytes);
      markdownBytes += fileBytes;
      if (markdownBytes > this.#limits.maxMarkdownBytes) {
        return this.#publishIncomplete(attempt, generation, "markdown-byte-limit", {
          markdownFiles: paths.length,
          markdownBytes,
          blockIds,
        });
      }
      try {
        for await (const line of outsideFenceLines(text, checkpoint)) {
          const location = terminalBlockId(line, path);
          if (location) {
            blockIds += 1;
            if (blockIds > this.#limits.maxBlockIds) {
              return this.#publishIncomplete(attempt, generation, "block-id-limit", {
                markdownFiles: paths.length,
                markdownBytes,
                blockIds,
              });
            }
            const existing = mutableLocations.get(location.id);
            if (existing) existing.push(location);
            else mutableLocations.set(location.id, [location]);
          }
          const canonical = canonicalClockOnLine(line, path, location);
          if (canonical) {
            clocks.set(clockKey(canonical), canonical);
            if (clocks.size > this.#limits.maxClockRecords) {
              return this.#publishIncomplete(attempt, generation, "clock-record-limit", {
                markdownFiles: paths.length,
                markdownBytes,
                blockIds,
              });
            }
          }
        }
      } catch (error) {
        return this.#publishIncomplete(
          attempt,
          generation,
          interruptionReason(error) ?? "source-read-failed",
          { markdownFiles: paths.length, markdownBytes, blockIds },
        );
      }
      try {
        versions.set(path, await createSourceVersion(path, text, checkpoint));
      } catch (error) {
        return this.#publishIncomplete(attempt, generation, interruptionReason(error) ?? "source-read-failed", {
          markdownFiles: paths.length,
          markdownBytes,
          blockIds,
        });
      }
      if (signal?.aborted) return this.#publishIncomplete(attempt, generation, "cancelled", {
        markdownFiles: paths.length, markdownBytes, blockIds,
      });
      if (this.#revision !== revision || attempt !== this.#rebuildAttempt) {
        return this.#publishIncomplete(attempt, generation, "source-changed", {
          markdownFiles: paths.length, markdownBytes, blockIds,
        });
      }
    }

    if (this.#revision !== revision) {
      return this.#publishIncomplete(attempt, generation, "source-changed", {
        markdownFiles: paths.length,
        markdownBytes,
        blockIds,
      });
    }

    const locations = new Map<string, readonly BlockIdLocation[]>();
    for (const [id, entries] of mutableLocations) locations.set(id, Object.freeze(entries));
    const lookup: IdentityLookupIndex = Object.freeze({
      lookup: (id: string) => identityLookup(locations, id),
    });
    for (const path of paths) {
      if (signal?.aborted) return this.#publishIncomplete(attempt, generation, "cancelled", {
        markdownFiles: paths.length, markdownBytes, blockIds,
      });
      if (this.#revision !== revision || attempt !== this.#rebuildAttempt) {
        return this.#publishIncomplete(attempt, generation, "source-changed", {
          markdownFiles: paths.length, markdownBytes, blockIds,
        });
      }
      let text: string | undefined;
      try {
        text = await this.#access.readText(path, signal);
      } catch (error) {
        return this.#publishIncomplete(attempt, generation,
          signal?.aborted || (error instanceof DOMException && error.name === "AbortError")
            ? "cancelled"
            : "source-read-failed", {
          markdownFiles: paths.length,
          markdownBytes,
          blockIds,
        });
      }
      if (signal?.aborted) return this.#publishIncomplete(attempt, generation, "cancelled", {
        markdownFiles: paths.length, markdownBytes, blockIds,
      });
      if (this.#revision !== revision || attempt !== this.#rebuildAttempt) {
        return this.#publishIncomplete(attempt, generation, "source-changed", {
          markdownFiles: paths.length, markdownBytes, blockIds,
        });
      }
      if (text === undefined) {
        return this.#publishIncomplete(attempt, generation, "source-changed", {
          markdownFiles: paths.length,
          markdownBytes,
          blockIds,
        });
      }
      let version: SourceVersion;
      try {
        version = await createSourceVersion(path, text, checkpoint);
      } catch (error) {
        return this.#publishIncomplete(attempt, generation, interruptionReason(error) ?? "source-read-failed", {
          markdownFiles: paths.length,
          markdownBytes,
          blockIds,
        });
      }
      if (signal?.aborted) return this.#publishIncomplete(attempt, generation, "cancelled", {
        markdownFiles: paths.length, markdownBytes, blockIds,
      });
      if (this.#revision !== revision || attempt !== this.#rebuildAttempt) {
        return this.#publishIncomplete(attempt, generation, "source-changed", {
          markdownFiles: paths.length, markdownBytes, blockIds,
        });
      }
      const firstVersion = versions.get(path)!;
      if (
        version.contentDigest !== firstVersion.contentDigest
        || version.contentLength !== firstVersion.contentLength
      ) {
        return this.#publishIncomplete(attempt, generation, "source-changed", {
          markdownFiles: paths.length,
          markdownBytes,
          blockIds,
        });
      }
      let structured: readonly LogbookClock[];
      try {
        structured = await this.#readStructuredClocks(
          path,
          text,
          lookup,
          version,
          this.#limits.maxClockRecords,
          {
            sourceBytes: byteLengths.get(path)!,
            ...(signal ? { signal } : {}),
            checkpoint,
          },
        );
      } catch (error) {
        const reason = error === CLOCK_RECORD_LIMIT
          ? "clock-record-limit"
          : error === STRUCTURED_INPUT_LIMIT
            ? "structured-input-limit"
            : interruptionReason(error)
              ?? (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")
                ? "cancelled"
                : "source-read-failed");
        return this.#publishIncomplete(attempt, generation, reason, {
          markdownFiles: paths.length,
          markdownBytes,
          blockIds,
        });
      }
      if (signal?.aborted) return this.#publishIncomplete(attempt, generation, "cancelled", {
        markdownFiles: paths.length, markdownBytes, blockIds,
      });
      if (this.#revision !== revision || attempt !== this.#rebuildAttempt) {
        return this.#publishIncomplete(attempt, generation, "source-changed", {
          markdownFiles: paths.length, markdownBytes, blockIds,
        });
      }
      for (const clock of structured) {
        if (!isValidStructuredClock(clock, path, text)) {
          return this.#publishIncomplete(attempt, generation, "source-read-failed", {
            markdownFiles: paths.length,
            markdownBytes,
            blockIds,
          });
        }
        if (clock.ownerId) {
          if (lookup.lookup(clock.ownerId).kind !== "unique") continue;
        } else if (!isAnonymousLegacyRunningFact(clock)) continue;
        if (clock.parsed.kind === "not-clock") continue;
        const entry: IndexedClockSource = Object.freeze({
          path: clock.path,
          fromOffset: clock.fromOffset,
          toOffset: clock.toOffset,
          text: clock.text,
          ...(clock.ownerId ? { ownerId: clock.ownerId } : {}),
          ...(clock.parsed.kind === "record" && clock.parsed.record.clockId
            ? { clockId: clock.parsed.record.clockId }
            : {}),
          scope: "accepted-logbook",
          parsed: clock.parsed,
        });
        const key = clockKey(entry);
        const existing = clocks.get(key);
        if (!existing) clocks.set(key, entry);
        else if (!existing.ownerId && clock.ownerId) {
          clocks.set(key, Object.freeze({ ...existing, ownerId: clock.ownerId }));
        }
        if (clocks.size > this.#limits.maxClockRecords) {
          return this.#publishIncomplete(attempt, generation, "clock-record-limit", {
            markdownFiles: paths.length, markdownBytes, blockIds,
          });
        }
      }
      if (clocks.size > this.#limits.maxClockRecords) {
        return this.#publishIncomplete(attempt, generation, "clock-record-limit", {
          markdownFiles: paths.length,
          markdownBytes,
          blockIds,
        });
      }
      if (signal?.aborted) return this.#publishIncomplete(attempt, generation, "cancelled", {
        markdownFiles: paths.length, markdownBytes, blockIds,
      });
      if (this.#revision !== revision || attempt !== this.#rebuildAttempt) {
        return this.#publishIncomplete(attempt, generation, "source-changed", {
          markdownFiles: paths.length, markdownBytes, blockIds,
        });
      }
    }

    if (this.#revision !== revision) {
      return this.#publishIncomplete(attempt, generation, "source-changed", {
        markdownFiles: paths.length,
        markdownBytes,
        blockIds,
      });
    }

    const clockEntries = Object.freeze([...clocks.values()]);
    const running = Object.freeze(clockEntries.filter((entry) =>
      entry.parsed.kind === "record" && entry.parsed.record.state === "running"));
    const potentialRunning = Object.freeze(clockEntries.filter((entry) =>
      entry.parsed.kind === "malformed" && entry.parsed.potentialRunning));
    if (attempt !== this.#rebuildAttempt) return this.#snapshot;
    this.#generation = generation;
    this.#locations = locations;
    this.#snapshot = Object.freeze({
      generation,
      complete: true,
      markdownFiles: paths.length,
      markdownBytes,
      blockIds,
      clocks: clockEntries,
      running,
      potentialRunning,
    });
    this.#dirty = false;
    return this.#snapshot;
  }

  #publishIncomplete(
    attempt: number,
    generation: number,
    reason: WorkspaceIndexIncompleteReason,
    counts: Partial<Pick<WorkspaceIndexSnapshot, "markdownFiles" | "markdownBytes" | "blockIds">> = {},
  ): WorkspaceIndexSnapshot {
    if (attempt !== this.#rebuildAttempt) return this.#snapshot;
    this.#generation = generation;
    this.#locations = new Map();
    this.#snapshot = frozenEmptySnapshot(generation, reason, counts);
    this.#dirty = true;
    return this.#snapshot;
  }
}
