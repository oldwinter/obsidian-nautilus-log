import {
  isCanonicalClockId,
  parseClockText,
  type ClockParseResult,
  type ParseClockOptions,
} from "./clock-parser";
import { readLogbook, type LogbookClock } from "./logbook-reader";
import { resolvePrimaryPlan } from "./primary-plan-resolver";
import { createSourceVersion, type SourceVersion } from "./source-version";
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
  | "source-read-failed"
  | "markdown-file-limit"
  | "markdown-byte-limit"
  | "block-id-limit"
  | "clock-record-limit";

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
) => readonly LogbookClock[] | Promise<readonly LogbookClock[]>;

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
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;

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

function* physicalLines(text: string): Iterable<PhysicalLine> {
  let start = 0;
  let line = 0;
  while (start <= text.length) {
    const newline = text.indexOf("\n", start);
    const physicalEnd = newline < 0 ? text.length : newline;
    const end = physicalEnd > start && text.charCodeAt(physicalEnd - 1) === 13
      ? physicalEnd - 1
      : physicalEnd;
    yield { start, end, line, content: text.slice(start, end) };
    if (newline < 0) break;
    start = newline + 1;
    line += 1;
  }
}

function* outsideFenceLines(text: string): Iterable<PhysicalLine> {
  let fence: { readonly marker: string; readonly length: number } | undefined;
  for (const line of physicalLines(text)) {
    const match = FENCE_OPEN.exec(line.content);
    if (match) {
      const run = match[1]!;
      const remainder = line.content.slice(match[0].length);
      if (!fence) {
        if (run[0] !== "`" || !remainder.includes("`")) {
          fence = { marker: run[0]!, length: run.length };
        }
      } else if (
        run[0] === fence.marker
        && run.length >= fence.length
        && /^[ \t]*$/.test(remainder)
      ) {
        fence = undefined;
      }
      continue;
    }
    if (!fence) yield line;
  }
}

function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      const next = text.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
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

function normalizeLimits(overrides: Partial<WorkspaceIndexLimits> | undefined): WorkspaceIndexLimits {
  const limits = { ...DEFAULT_WORKSPACE_INDEX_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`${name} must be a nonnegative safe integer`);
  }
  return Object.freeze(limits);
}

async function defaultStructuredClockReader(
  path: string,
  text: string,
  _identities: IdentityLookupIndex,
  version: SourceVersion,
  options: ParseClockOptions,
): Promise<readonly LogbookClock[]> {
  const clocks: LogbookClock[] = [];
  const primary = resolvePrimaryPlan(version, text);
  for (const candidate of primary.candidates) {
    if (candidate.status === "foreign" || !candidate.source.blockId) continue;
    clocks.push(...readLogbook(text, {
      path,
      itemFromOffset: candidate.source.itemSpan.fromOffset,
      itemToOffset: candidate.source.itemSpan.toOffset,
      ownerId: candidate.source.blockId,
    }, options).clocks);
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
      ?? ((path, text, identities, version) =>
        defaultStructuredClockReader(path, text, identities, version, options.clockParsing ?? {}));
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

  async rebuild(): Promise<WorkspaceIndexSnapshot> {
    const attempt = ++this.#rebuildAttempt;
    const revision = this.#revision;
    const generation = this.#generation + 1;
    let listed: readonly string[];
    try {
      listed = await this.#access.listMarkdownPaths();
    } catch {
      return this.#publishIncomplete(attempt, generation, "source-read-failed");
    }
    const paths = [...new Set(listed.filter((path) => path.toLowerCase().endsWith(".md")))].sort();
    if (paths.length > this.#limits.maxMarkdownFiles) {
      return this.#publishIncomplete(attempt, generation, "markdown-file-limit", { markdownFiles: paths.length });
    }

    const versions = new Map<string, SourceVersion>();
    const mutableLocations = new Map<string, BlockIdLocation[]>();
    const clocks = new Map<string, IndexedClockSource>();
    let markdownBytes = 0;
    let blockIds = 0;
    for (const path of paths) {
      let text: string | undefined;
      try {
        text = await this.#access.readText(path);
      } catch {
        return this.#publishIncomplete(attempt, generation, "source-read-failed", {
          markdownFiles: paths.length,
          markdownBytes,
          blockIds,
        });
      }
      if (text === undefined) {
        return this.#publishIncomplete(attempt, generation, "source-changed", {
          markdownFiles: paths.length,
          markdownBytes,
          blockIds,
        });
      }
      markdownBytes += utf8ByteLength(text);
      if (markdownBytes > this.#limits.maxMarkdownBytes) {
        return this.#publishIncomplete(attempt, generation, "markdown-byte-limit", {
          markdownFiles: paths.length,
          markdownBytes,
          blockIds,
        });
      }
      const lines = outsideFenceLines(text);
      for (const line of lines) {
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
        if (canonical) clocks.set(clockKey(canonical), canonical);
      }
      if (clocks.size > this.#limits.maxClockRecords) {
        return this.#publishIncomplete(attempt, generation, "clock-record-limit", {
          markdownFiles: paths.length,
          markdownBytes,
          blockIds,
        });
      }
      try {
        versions.set(path, await createSourceVersion(path, text));
      } catch {
        return this.#publishIncomplete(attempt, generation, "source-read-failed", {
          markdownFiles: paths.length,
          markdownBytes,
          blockIds,
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
      let text: string | undefined;
      try {
        text = await this.#access.readText(path);
      } catch {
        return this.#publishIncomplete(attempt, generation, "source-read-failed", {
          markdownFiles: paths.length,
          markdownBytes,
          blockIds,
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
        version = await createSourceVersion(path, text);
      } catch {
        return this.#publishIncomplete(attempt, generation, "source-read-failed", {
          markdownFiles: paths.length,
          markdownBytes,
          blockIds,
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
        structured = await this.#readStructuredClocks(path, text, lookup, version);
      } catch {
        return this.#publishIncomplete(attempt, generation, "source-read-failed", {
          markdownFiles: paths.length,
          markdownBytes,
          blockIds,
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
        if (!clock.ownerId || lookup.lookup(clock.ownerId).kind !== "unique") continue;
        if (clock.parsed.kind === "not-clock") continue;
        const entry: IndexedClockSource = Object.freeze({
          path: clock.path,
          fromOffset: clock.fromOffset,
          toOffset: clock.toOffset,
          text: clock.text,
          ownerId: clock.ownerId,
          ...(clock.parsed.kind === "record" && clock.parsed.record.clockId
            ? { clockId: clock.parsed.record.clockId }
            : {}),
          scope: "accepted-logbook",
          parsed: clock.parsed,
        });
        const key = clockKey(entry);
        const existing = clocks.get(key);
        if (!existing) clocks.set(key, entry);
        else if (!existing.ownerId) clocks.set(key, Object.freeze({ ...existing, ownerId: clock.ownerId }));
      }
      if (clocks.size > this.#limits.maxClockRecords) {
        return this.#publishIncomplete(attempt, generation, "clock-record-limit", {
          markdownFiles: paths.length,
          markdownBytes,
          blockIds,
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
