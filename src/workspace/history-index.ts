import { parseGrammar } from "../core/grammar-v1";
import type { LogicalDate } from "../core/day";
import type { GrammarV1Settings } from "../core/model";
import type { ReviewClock } from "../core/review";
import type { ParseClockOptions } from "./clock-parser";
import {
  parseDailyNotePath,
  resolveDailyNotePath,
  type DailyNoteConfiguration,
} from "./daily-notes";
import { readLogbook } from "./logbook-reader";
import { resolvePrimaryPlan } from "./primary-plan-resolver";
import { createSourceVersion, utf8ByteLengthCooperative } from "./source-version";
import type { SourceChange, TextAccess } from "./text-access";
import { WorkspaceIndex } from "./identity-index";

export type HistoryIndexStatus =
  | "absent"
  | "building"
  | "current"
  | "dirty"
  | "over-limit"
  | "unavailable";

export type HistoryIndexLimitKind =
  | "markdown-files"
  | "markdown-bytes"
  | "daily-notes"
  | "clock-records"
  | "active-note-bytes"
  | "plan-region-bytes"
  | "plan-items"
  | "plan-item-bytes"
  | "list-depth";

export interface HistoryIndexLimits {
  readonly maxMarkdownFiles: number;
  readonly maxMarkdownBytes: number;
  readonly maxDailyNotes: number;
  readonly maxClockRecords: number;
  readonly maxActiveNoteBytes: number;
  readonly maxPlanRegionBytes: number;
  readonly maxPlanItems: number;
  readonly maxPlanItemBytes: number;
  readonly maxListDepth: number;
}

export const DEFAULT_HISTORY_INDEX_LIMITS: Readonly<HistoryIndexLimits> = Object.freeze({
  maxMarkdownFiles: 20_000,
  maxMarkdownBytes: 2_147_483_648,
  maxDailyNotes: 3_650,
  maxClockRecords: 25_000,
  maxActiveNoteBytes: 2 * 1024 * 1024,
  maxPlanRegionBytes: 1024 * 1024,
  maxPlanItems: 1_000,
  maxPlanItemBytes: 16 * 1024,
  maxListDepth: 16,
});

export interface HistoryIndexCounts {
  readonly markdownFiles: number;
  readonly markdownBytes: number;
  readonly dailyNotes: number;
  readonly clockRecords: number;
  readonly tasks: number;
}

export interface HistoryIndexDiagnostic {
  readonly code:
    | "ambiguous-logbook"
    | "duplicate-owner-id"
    | "malformed-clock"
    | "parser-diagnostic"
    | "plan-diagnostic"
    | "potential-running-clock";
  readonly path: string;
  readonly sourceOrder?: number;
  readonly ownerId?: string;
  readonly detail?: string;
}

export interface IndexedHistoryTask {
  readonly key: string;
  readonly path: string;
  readonly sourceFingerprint: string;
  readonly logicalDate: LogicalDate;
  readonly sourceOrder: number;
  readonly ownerId?: string;
  readonly direct: true;
  readonly kind: "flexible-task" | "fixed-event";
  readonly status: "plain" | "open" | "done";
  readonly label: string;
  readonly plannedMinutes: number;
  readonly completionAnchorMinutes?: number;
  readonly fixedStartMinutes?: number;
  readonly fixedEndMinutes?: number;
  readonly clocks: readonly ReviewClock[];
}

interface HistoryIndexSnapshotBase {
  readonly generation: number;
  readonly sourceRevision: number;
  readonly counts: HistoryIndexCounts;
}

export interface PassiveHistoryIndexSnapshot extends HistoryIndexSnapshotBase {
  readonly state: "absent" | "building" | "dirty";
}

export interface IndexedHistoryDay {
  readonly path: string;
  readonly logicalDate: LogicalDate;
  readonly state: "ready" | "missing-plan" | "invalid-plan";
}

export interface CurrentHistoryIndexSnapshot extends HistoryIndexSnapshotBase {
  readonly state: "current";
  readonly configurationKey: string;
  readonly tasks: readonly IndexedHistoryTask[];
  readonly days: readonly IndexedHistoryDay[];
  readonly diagnostics: readonly HistoryIndexDiagnostic[];
}

export interface OverLimitHistoryIndexSnapshot extends HistoryIndexSnapshotBase {
  readonly state: "over-limit";
  readonly kind: HistoryIndexLimitKind;
  readonly actual: number;
  readonly limit: number;
}

export interface UnavailableHistoryIndexSnapshot extends HistoryIndexSnapshotBase {
  readonly state: "unavailable";
  readonly reason:
    | "cancelled"
    | "identity-index-unavailable"
    | "invalid-configuration"
    | "source-read-failed"
    | "source-changed";
}

export type HistoryIndexSnapshot =
  | CurrentHistoryIndexSnapshot
  | OverLimitHistoryIndexSnapshot
  | UnavailableHistoryIndexSnapshot
  | PassiveHistoryIndexSnapshot;

export type HistoryIndexListener = (snapshot: HistoryIndexSnapshot) => void;

export interface HistoryIndexRequest {
  readonly configuration: DailyNoteConfiguration;
  readonly grammarSettings?: GrammarV1Settings;
  readonly clockParsing?: ParseClockOptions;
  readonly clockParsingKey?: string;
  readonly signal?: AbortSignal;
}

export interface HistoryIndexScheduler {
  now(): number;
  yield(): Promise<void>;
}

export interface HistoryIndexOptions {
  readonly limits?: Partial<HistoryIndexLimits>;
  readonly scheduler?: HistoryIndexScheduler;
  readonly maximumContinuousMilliseconds?: number;
  readonly identityIndex?: WorkspaceIndex;
}

const EMPTY_COUNTS: HistoryIndexCounts = Object.freeze({
  markdownFiles: 0,
  markdownBytes: 0,
  dailyNotes: 0,
  clockRecords: 0,
  tasks: 0,
});

function frozenCounts(counts: HistoryIndexCounts): HistoryIndexCounts {
  return Object.freeze({ ...counts });
}

function passiveSnapshot(
  state: "absent" | "building" | "dirty",
  generation: number,
  sourceRevision: number,
  counts: HistoryIndexCounts = EMPTY_COUNTS,
): PassiveHistoryIndexSnapshot {
  return Object.freeze({ state, generation, sourceRevision, counts: frozenCounts(counts) });
}

function normalizeLimits(overrides: Partial<HistoryIndexLimits> | undefined): HistoryIndexLimits {
  const limits = { ...DEFAULT_HISTORY_INDEX_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new RangeError(`${name} must be a nonnegative safe integer`);
    }
  }
  return Object.freeze(limits);
}

function configurationKey(request: HistoryIndexRequest): string {
  return JSON.stringify([
    request.configuration.folder,
    request.configuration.format,
    request.grammarSettings?.defaultDurationMinutes ?? null,
    request.grammarSettings?.urgentTrigger ?? "",
    request.clockParsingKey ?? null,
  ]);
}

function immutableDate(date: LogicalDate): LogicalDate {
  return Object.freeze({ ...date });
}

function interruptionReason(
  error: unknown,
  signal: AbortSignal | undefined,
): UnavailableHistoryIndexSnapshot["reason"] {
  if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) return "cancelled";
  return "source-read-failed";
}

class CooperativeInterruption extends Error {}

function reviewClock(
  ownerId: string,
  clock: ReturnType<typeof readLogbook>["clocks"][number],
): ReviewClock {
  if (clock.parsed.kind === "record") {
    const record = clock.parsed.record;
    if (record.state === "closed") {
      return Object.freeze({
        state: "closed" as const,
        ownerId,
        startEpochMilliseconds: record.startEpochMs,
        endEpochMilliseconds: record.endEpochMs,
        ...(record.clockId ? { clockId: record.clockId } : {}),
      });
    }
    return Object.freeze({
      state: "running" as const,
      ownerId,
      startEpochMilliseconds: record.startEpochMs,
      ...(record.clockId ? { clockId: record.clockId } : {}),
    });
  }
  if (clock.parsed.kind === "not-clock") {
    return Object.freeze({ state: "malformed" as const, ownerId });
  }
  return Object.freeze({
    state: clock.parsed.potentialRunning ? "potential-running" as const : "malformed" as const,
    ownerId,
  });
}

function overLimit(
  generation: number,
  sourceRevision: number,
  counts: HistoryIndexCounts,
  kind: HistoryIndexLimitKind,
  actual: number,
  limit: number,
): OverLimitHistoryIndexSnapshot {
  return Object.freeze({
    state: "over-limit",
    generation,
    sourceRevision,
    counts: frozenCounts(counts),
    kind,
    actual,
    limit,
  });
}

export class HistoryIndex {
  readonly #access: TextAccess;
  readonly #limits: HistoryIndexLimits;
  readonly #scheduler: HistoryIndexScheduler;
  readonly #identityIndex: WorkspaceIndex;
  readonly #ownsIdentityIndex: boolean;
  readonly #maximumContinuousMilliseconds: number;
  readonly #unsubscribe: () => void;
  readonly #listeners = new Set<HistoryIndexListener>();
  readonly #pendingYields = new Set<() => void>();
  #sourceRevision = 0;
  #generation = 0;
  #attempt = 0;
  #disposed = false;
  #clockResolver: ParseClockOptions["resolveLocalTime"] | undefined;
  #snapshot: HistoryIndexSnapshot = passiveSnapshot("absent", 0, 0);

  constructor(access: TextAccess, options: HistoryIndexOptions = {}) {
    this.#access = access;
    this.#limits = normalizeLimits(options.limits);
    this.#scheduler = options.scheduler ?? {
      now: () => globalThis.performance.now(),
      yield: () => new Promise<void>((resolve) => {
        const finish = (): void => {
          globalThis.clearTimeout(timer);
          this.#pendingYields.delete(finish);
          resolve();
        };
        const timer = globalThis.setTimeout(finish, 0);
        this.#pendingYields.add(finish);
      }),
    };
    this.#identityIndex = options.identityIndex ?? new WorkspaceIndex(access);
    this.#ownsIdentityIndex = options.identityIndex === undefined;
    this.#maximumContinuousMilliseconds = options.maximumContinuousMilliseconds ?? 40;
    if (!Number.isFinite(this.#maximumContinuousMilliseconds)
      || this.#maximumContinuousMilliseconds <= 0
      || this.#maximumContinuousMilliseconds > 50) {
      throw new RangeError("history index must yield within 50 milliseconds");
    }
    this.#unsubscribe = access.onChange((change) => this.invalidate(change));
  }

  get snapshot(): HistoryIndexSnapshot {
    return this.#snapshot;
  }

  currentFor(request: HistoryIndexRequest): CurrentHistoryIndexSnapshot | undefined {
    const snapshot = this.#snapshot;
    return !this.#disposed && !request.signal?.aborted && snapshot.state === "current"
      && snapshot.configurationKey === configurationKey(request)
      && (request.clockParsingKey !== undefined
        || this.#clockResolver === request.clockParsing?.resolveLocalTime)
      ? snapshot : undefined;
  }

  subscribe(listener: HistoryIndexListener): () => void {
    if (this.#disposed) return () => {};
    this.#listeners.add(listener);
    listener(this.#snapshot);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.#listeners.delete(listener);
    };
  }

  invalidate(_change?: SourceChange): void {
    if (this.#disposed) return;
    this.#sourceRevision += 1;
    this.#attempt += 1;
    this.#snapshot = passiveSnapshot(
      "dirty",
      this.#generation,
      this.#sourceRevision,
      this.#snapshot.counts,
    );
    this.#notify();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const finish of this.#pendingYields) finish();
    this.#attempt += 1;
    this.#unsubscribe();
    if (this.#ownsIdentityIndex) this.#identityIndex.dispose();
    this.#snapshot = passiveSnapshot("absent", this.#generation, this.#sourceRevision);
    this.#notify();
    this.#listeners.clear();
  }

  async rebuild(request: HistoryIndexRequest): Promise<HistoryIndexSnapshot> {
    if (this.#disposed) {
      return this.#publishUnavailable(
        this.#generation,
        this.#sourceRevision,
        EMPTY_COUNTS,
        "cancelled",
      );
    }
    const attempt = ++this.#attempt;
    const sourceRevision = this.#sourceRevision;
    const generation = this.#generation + 1;
    let counts: HistoryIndexCounts = {
      markdownFiles: 0,
      markdownBytes: 0,
      dailyNotes: 0,
      clockRecords: 0,
      tasks: 0,
    };
    this.#generation = generation;
    this.#snapshot = passiveSnapshot("building", generation, sourceRevision, counts);
    this.#notify();
    const requestKey = configurationKey(request);
    const configurationProbe = resolveDailyNotePath(
      Object.freeze({ year: 2000, month: 1, day: 1 }),
      request.configuration,
    );
    if (!configurationProbe.ok) {
      return this.#publishUnavailable(generation, sourceRevision, counts, "invalid-configuration", attempt);
    }

    let paths: readonly string[];
    try {
      paths = await this.#access.listMarkdownPaths(request.signal);
    } catch (error) {
      return this.#publishUnavailable(
        generation,
        sourceRevision,
        counts,
        interruptionReason(error, request.signal),
        attempt,
      );
    }
    const markdownPaths = [...new Set(paths.filter((path) => path.toLowerCase().endsWith(".md")))].sort();
    counts = { ...counts, markdownFiles: markdownPaths.length };
    if (markdownPaths.length > this.#limits.maxMarkdownFiles) {
      return this.#publish(
        overLimit(generation, sourceRevision, counts, "markdown-files", markdownPaths.length, this.#limits.maxMarkdownFiles),
        attempt,
      );
    }

    let lastYieldAt = this.#scheduler.now();
    const checkpoint = async (forceYield = false): Promise<boolean> => {
      if (request.signal?.aborted || this.#disposed) return false;
      if (attempt !== this.#attempt || sourceRevision !== this.#sourceRevision) return false;
      const now = this.#scheduler.now();
      if (forceYield || now - lastYieldAt >= this.#maximumContinuousMilliseconds) {
        await this.#scheduler.yield();
        lastYieldAt = this.#scheduler.now();
      }
      return !(request.signal?.aborted
        || this.#disposed
        || attempt !== this.#attempt
        || sourceRevision !== this.#sourceRevision);
    };
    const cooperativeCheckpoint = async (): Promise<void> => {
      if (!await checkpoint()) throw new CooperativeInterruption();
    };
    const staleReason = (): UnavailableHistoryIndexSnapshot["reason"] =>
      request.signal?.aborted || this.#disposed ? "cancelled" : "source-changed";

    const tasks: IndexedHistoryTask[] = [];
    const days: IndexedHistoryDay[] = [];
    const diagnostics: HistoryIndexDiagnostic[] = [];
    for (const path of markdownPaths) {
      if (!await checkpoint()) {
        return this.#publishUnavailable(generation, sourceRevision, counts, staleReason(), attempt);
      }
      let source: string | undefined;
      try {
        source = await this.#access.readText(path, request.signal);
      } catch (error) {
        return this.#publishUnavailable(
          generation,
          sourceRevision,
          counts,
          interruptionReason(error, request.signal),
          attempt,
        );
      }
      if (source === undefined) {
        return this.#publishUnavailable(generation, sourceRevision, counts, "source-changed", attempt);
      }
      let sourceBytes: number;
      try {
        sourceBytes = await utf8ByteLengthCooperative(source, cooperativeCheckpoint);
      } catch (error) {
        if (error instanceof CooperativeInterruption) {
          return this.#publishUnavailable(generation, sourceRevision, counts, staleReason(), attempt);
        }
        return this.#publishUnavailable(
          generation,
          sourceRevision,
          counts,
          interruptionReason(error, request.signal),
          attempt,
        );
      }
      counts = { ...counts, markdownBytes: counts.markdownBytes + sourceBytes };
      if (counts.markdownBytes > this.#limits.maxMarkdownBytes) {
        return this.#publish(
          overLimit(
            generation,
            sourceRevision,
            counts,
            "markdown-bytes",
            counts.markdownBytes,
            this.#limits.maxMarkdownBytes,
          ),
          attempt,
        );
      }
      const resolvedDate = parseDailyNotePath(path, request.configuration);
      if (!resolvedDate.ok) continue;
      counts = { ...counts, dailyNotes: counts.dailyNotes + 1 };
      if (counts.dailyNotes > this.#limits.maxDailyNotes) {
        return this.#publish(
          overLimit(generation, sourceRevision, counts, "daily-notes", counts.dailyNotes, this.#limits.maxDailyNotes),
          attempt,
        );
      }
      if (sourceBytes > this.#limits.maxActiveNoteBytes) {
        return this.#publish(
          overLimit(generation, sourceRevision, counts, "active-note-bytes", sourceBytes, this.#limits.maxActiveNoteBytes),
          attempt,
        );
      }

      let version: Awaited<ReturnType<typeof createSourceVersion>>;
      try {
        version = await createSourceVersion(path, source, cooperativeCheckpoint);
      } catch (error) {
        if (error instanceof CooperativeInterruption) {
          return this.#publishUnavailable(generation, sourceRevision, counts, staleReason(), attempt);
        }
        return this.#publishUnavailable(
          generation,
          sourceRevision,
          counts,
          interruptionReason(error, request.signal),
          attempt,
        );
      }
      if (!await checkpoint(true)) {
        return this.#publishUnavailable(generation, sourceRevision, counts, staleReason(), attempt);
      }
      const primary = resolvePrimaryPlan(version, source, {
        maxPlanRegionBytes: this.#limits.maxPlanRegionBytes,
        maxPlanItems: this.#limits.maxPlanItems,
        maxPlanItemBytes: this.#limits.maxPlanItemBytes,
        maxListDepth: this.#limits.maxListDepth,
      });
      if (primary.limitExceeded) {
        return this.#publish(
          overLimit(
            generation,
            sourceRevision,
            counts,
            primary.limitExceeded.kind,
            primary.limitExceeded.actual,
            primary.limitExceeded.limit,
          ),
          attempt,
        );
      }
      days.push(Object.freeze({
        path,
        logicalDate: immutableDate(resolvedDate.logicalDate),
        state: primary.region ? "ready" : primary.diagnostics.length > 0 ? "invalid-plan" : "missing-plan",
      }));
      for (const diagnostic of primary.diagnostics) {
        diagnostics.push(Object.freeze({
          code: "plan-diagnostic",
          path,
          detail: diagnostic.code,
        }));
      }
      if (!await checkpoint(true)) {
        return this.#publishUnavailable(generation, sourceRevision, counts, staleReason(), attempt);
      }
      const parsed = parseGrammar({
        version: primary.region?.version ?? "unsupported",
        candidates: primary.candidates,
        ...(request.grammarSettings ? { settings: request.grammarSettings } : {}),
      });
      for (const diagnostic of parsed.diagnostics) {
        diagnostics.push(Object.freeze({
          code: "parser-diagnostic",
          path,
          sourceOrder: diagnostic.sourceOrder,
          detail: diagnostic.code,
        }));
      }
      for (const item of parsed.items) {
        if (!await checkpoint()) {
          return this.#publishUnavailable(generation, sourceRevision, counts, staleReason(), attempt);
        }
        const ownerId = item.source.blockId;
        const logbook = readLogbook(source, {
          path,
          itemFromOffset: item.source.itemSpan.fromOffset,
          itemToOffset: item.source.itemSpan.toOffset,
          ...(ownerId ? { ownerId } : {}),
        }, {
          maxClockRecords: this.#limits.maxClockRecords - counts.clockRecords,
          ...(request.clockParsing ?? {}),
        });
        if (!logbook.complete) {
          return this.#publish(
            overLimit(
              generation,
              sourceRevision,
              counts,
              "clock-records",
              this.#limits.maxClockRecords + 1,
              this.#limits.maxClockRecords,
            ),
            attempt,
          );
        }
        counts = { ...counts, clockRecords: counts.clockRecords + logbook.clocks.length };
        if (counts.clockRecords > this.#limits.maxClockRecords) {
          return this.#publish(
            overLimit(
              generation,
              sourceRevision,
              counts,
              "clock-records",
              counts.clockRecords,
              this.#limits.maxClockRecords,
            ),
            attempt,
          );
        }
        const ambiguous = logbook.kind === "ambiguous";
        if (ambiguous) diagnostics.push(Object.freeze({
          code: "ambiguous-logbook",
          path,
          sourceOrder: item.sourceOrder,
          ...(ownerId ? { ownerId } : {}),
        }));
        for (const clock of logbook.clocks) {
          if (clock.parsed.kind !== "malformed") continue;
          diagnostics.push(Object.freeze({
            code: clock.parsed.potentialRunning ? "potential-running-clock" : "malformed-clock",
            path,
            sourceOrder: item.sourceOrder,
            ...(ownerId ? { ownerId } : {}),
          }));
        }
        const clocks = ambiguous || ownerId === undefined
          ? Object.freeze([])
          : Object.freeze(logbook.clocks.map((clock) => reviewClock(ownerId, clock)));
        const common = {
          key: `${path}\0${ownerId ?? "anonymous"}\0${String(item.sourceOrder)}`,
          path,
          sourceFingerprint: version.contentDigest,
          logicalDate: immutableDate(resolvedDate.logicalDate),
          sourceOrder: item.sourceOrder,
          ...(ownerId ? { ownerId } : {}),
          direct: true as const,
          kind: item.kind,
          status: item.status,
          label: item.label,
          plannedMinutes: item.durationMinutes,
          clocks,
        };
        tasks.push(Object.freeze(item.kind === "fixed-event"
          ? { ...common, fixedStartMinutes: item.startMinutes, fixedEndMinutes: item.endMinutes }
          : {
              ...common,
              ...(item.completionAnchorMinutes === undefined
                ? {}
                : { completionAnchorMinutes: item.completionAnchorMinutes }),
            }));
        counts = { ...counts, tasks: counts.tasks + 1 };
      }
    }

    if (!await checkpoint(true)) {
      return this.#publishUnavailable(generation, sourceRevision, counts, staleReason(), attempt);
    }
    let identitySnapshot = this.#identityIndex.safetySnapshot;
    if (this.#identityIndex.dirty) {
      try {
        await this.#identityIndex.rebuild(request.signal);
        identitySnapshot = this.#identityIndex.safetySnapshot;
      } catch (error) {
        return this.#publishUnavailable(
          generation,
          sourceRevision,
          counts,
          interruptionReason(error, request.signal),
          attempt,
        );
      }
    }
    if (!identitySnapshot.complete) {
      const reason = identitySnapshot.reason === "cancelled" || request.signal?.aborted
        ? "cancelled"
        : identitySnapshot.reason === "source-changed"
          ? "source-changed"
          : identitySnapshot.reason === "source-read-failed"
            ? "source-read-failed"
            : "identity-index-unavailable";
      return this.#publishUnavailable(generation, sourceRevision, counts, reason, attempt);
    }
    if (attempt !== this.#attempt || sourceRevision !== this.#sourceRevision) {
      return this.#publishUnavailable(generation, sourceRevision, counts, "source-changed", attempt);
    }

    const owners = new Map<string, IndexedHistoryTask[]>();
    for (const task of tasks) {
      if (!task.ownerId) continue;
      const existing = owners.get(task.ownerId);
      if (existing) existing.push(task);
      else owners.set(task.ownerId, [task]);
    }
    for (const [ownerId, entries] of owners) {
      const identity = this.#identityIndex.safetyIdentity(ownerId);
      if (identity.kind === "unavailable") {
        return this.#publishUnavailable(
          generation,
          sourceRevision,
          counts,
          "identity-index-unavailable",
          attempt,
        );
      }
      if (identity.kind === "missing"
        || (identity.kind === "unique" && !entries.some((entry) => entry.path === identity.location.path))) {
        return this.#publishUnavailable(generation, sourceRevision, counts, "source-changed", attempt);
      }
      if (identity.kind !== "collision" && entries.length < 2) continue;
      for (const entry of entries) {
        diagnostics.push(Object.freeze({
          code: "duplicate-owner-id",
          path: entry.path,
          sourceOrder: entry.sourceOrder,
          ownerId,
        }));
      }
    }
    this.#clockResolver = request.clockParsing?.resolveLocalTime;
    const current: CurrentHistoryIndexSnapshot = Object.freeze({
      state: "current",
      generation,
      sourceRevision,
      counts: frozenCounts(counts),
      configurationKey: requestKey,
      tasks: Object.freeze(tasks),
      days: Object.freeze(days),
      diagnostics: Object.freeze(diagnostics),
    });
    return this.#publish(current, attempt);
  }

  #publish<T extends HistoryIndexSnapshot>(snapshot: T, attempt: number): HistoryIndexSnapshot {
    if (this.#disposed || attempt !== this.#attempt || snapshot.sourceRevision !== this.#sourceRevision) {
      return this.#snapshot;
    }
    this.#generation = snapshot.generation;
    this.#snapshot = snapshot;
    this.#notify();
    return snapshot;
  }

  #notify(): void {
    for (const listener of this.#listeners) listener(this.#snapshot);
  }

  #publishUnavailable(
    generation: number,
    sourceRevision: number,
    counts: HistoryIndexCounts,
    reason: UnavailableHistoryIndexSnapshot["reason"],
    attempt = this.#attempt,
  ): HistoryIndexSnapshot {
    const unavailable: UnavailableHistoryIndexSnapshot = Object.freeze({
      state: "unavailable",
      generation,
      sourceRevision,
      counts: frozenCounts(counts),
      reason,
    });
    return this.#publish(unavailable, attempt);
  }
}
