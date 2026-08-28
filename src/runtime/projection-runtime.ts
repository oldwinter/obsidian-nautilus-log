import { calculateCapacity, type CapacityResult } from "../core/capacity";
import { projectDay, type DayProjection, type LogicalDate } from "../core/day";
import type { ParserDiagnosticCode } from "../core/diagnostics";
import type { PlanItem } from "../core/model";
import { schedulePlan, type ScheduleResult } from "../core/scheduler";
import { resolveDailyNotePath } from "../workspace/daily-notes";
import {
  readWorkspacePlan,
  type WorkspacePlanReadResult,
} from "../workspace/read";
import type {
  SourceChange,
  TextAccess,
  Unsubscribe,
} from "../workspace/text-access";
import type { WorkspacePlanItemSource } from "../workspace/primary-plan-resolver";
import { DisposableLruCache } from "./cache";
import {
  type PluginDataSnapshot,
  type PluginDataStore,
  type PluginSettings,
} from "./plugin-data";
import { RefreshCoordinator, type RefreshKind } from "./refresh";
import {
  confirmedSnapshot,
  createRuntimeSnapshot,
  errorSnapshot,
  hiddenSnapshot,
  loadingSnapshot,
  missingSnapshot,
  overLimitSnapshot,
  staleSnapshot,
  type ProjectionRevisionInput,
  type RuntimeDiagnostic,
  type RuntimeSnapshot,
} from "./snapshots";
import {
  type SystemClock,
  type TimerHandle,
  zonedTimeParts,
} from "./system-clock";

const PROJECTION_GRAMMAR_VERSION = "v1";
const DEFAULT_SNAPSHOT_CACHE_ENTRIES = 8;
const REFRESH_HARD_CAP_MILLISECONDS = 1_000;

export type ProjectionRuntimeState =
  | "unloaded"
  | "starting"
  | "ready"
  | "stopping";

export interface RuntimeViewContext {
  readonly logicalDate: LogicalDate;
}

export interface RuntimePlanItemSource {
  readonly path: string;
  readonly blockId: string | null;
  readonly sourceOrder: number;
}

export interface RuntimeProjectionDiagnostic {
  readonly code: ParserDiagnosticCode | string;
  readonly sourceOrder: number | null;
}

export interface RuntimePlanProjection {
  readonly contextKey: string;
  readonly sourcePath: string;
  readonly sourceFingerprint: string;
  readonly displayedDate: LogicalDate;
  readonly today: LogicalDate;
  readonly items: readonly PlanItem<RuntimePlanItemSource>[];
  readonly diagnostics: readonly RuntimeProjectionDiagnostic[];
  readonly day: DayProjection;
  readonly schedule: ScheduleResult<RuntimePlanItemSource>;
  readonly capacity: CapacityResult<RuntimePlanItemSource>;
}

export type RuntimeSnapshotListener = (
  snapshot: RuntimeSnapshot<RuntimePlanProjection>,
) => void;

export interface RuntimeConnection {
  setContext(context: RuntimeViewContext): void;
  setVisible(visible: boolean): void;
  refresh(): void;
  disconnect(): void;
}

export interface ProjectionRuntimeDependencies {
  readonly access: TextAccess;
  readonly pluginData: PluginDataStore;
  readonly clock: SystemClock;
  readonly snapshotCacheEntries?: number;
  readonly readPlan?: typeof readWorkspacePlan;
}

interface ConnectionRecord {
  contextKey: string;
  visible: boolean;
  disconnected: boolean;
  readonly listener: RuntimeSnapshotListener;
}

interface ContextEntry {
  readonly key: string;
  context: RuntimeViewContext;
  readonly connections: Set<ConnectionRecord>;
  refresh: RefreshCoordinator;
  generation: number;
  dirty: boolean;
  followUpReady: boolean;
  inFlight: {
    readonly generation: number;
    readonly controller: AbortController;
    readonly timeout: TimerHandle;
  } | undefined;
  snapshot?: RuntimeSnapshot<RuntimePlanProjection>;
  confirmed?: RuntimeSnapshot<RuntimePlanProjection>;
}

function twoDigits(value: number): string {
  return String(value).padStart(2, "0");
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

export function runtimeContextKey(context: RuntimeViewContext): string {
  const { year, month, day } = context.logicalDate;
  if (!Number.isInteger(year)
    || !Number.isInteger(month)
    || !Number.isInteger(day)
    || year < 1
    || year > 9_999
    || month < 1
    || month > 12
    || day < 1
    || day > daysInMonth(year, month)) {
    throw new RangeError("Runtime context requires a valid logical date");
  }
  return `${String(year).padStart(4, "0")}-${twoDigits(month)}-${twoDigits(day)}`;
}

function copyContext(context: RuntimeViewContext): RuntimeViewContext {
  runtimeContextKey(context);
  return Object.freeze({
    logicalDate: Object.freeze({ ...context.logicalDate }),
  });
}

function hasVisibleConnection(entry: ContextEntry): boolean {
  for (const connection of entry.connections) {
    if (!connection.disconnected && connection.visible) return true;
  }
  return false;
}

function safeSource(
  path: string,
  sourceOrder: number,
  source: WorkspacePlanItemSource,
): RuntimePlanItemSource {
  return Object.freeze({
    path,
    blockId: source.blockId ?? null,
    sourceOrder,
  });
}

function publicPlanItem(
  path: string,
  item: PlanItem<WorkspacePlanItemSource>,
): PlanItem<RuntimePlanItemSource> {
  const common = {
    source: safeSource(path, item.sourceOrder, item.source),
    sourceOrder: item.sourceOrder,
    status: item.status,
    label: item.label,
    durationMinutes: item.durationMinutes,
    progressPercent: item.progressPercent,
    remainingDurationMinutes: item.remainingDurationMinutes,
    urgent: item.urgent,
    executionEligible: item.executionEligible,
    // Token offsets are source locators and never cross the runtime snapshot boundary.
    tokens: Object.freeze({}),
  } as const;
  return item.kind === "fixed-event"
    ? Object.freeze({
        ...common,
        kind: "fixed-event" as const,
        startMinutes: item.startMinutes,
        endMinutes: item.endMinutes,
      })
    : Object.freeze({
        ...common,
        kind: "flexible-task" as const,
        ...(item.completionAnchorMinutes === undefined
          ? {}
          : { completionAnchorMinutes: item.completionAnchorMinutes }),
      });
}

function settingsGrammar(settings: PluginSettings) {
  return Object.freeze({
    defaultDurationMinutes: settings.defaultDurationMinutes,
    urgentTrigger: settings.urgentTrigger,
  });
}

function semanticSettingsKey(settings: PluginSettings): string {
  return JSON.stringify([
    settings.language,
    settings.chartStartHour,
    settings.chartEndHour,
    settings.componentPrefix,
    settings.legendMaxLength,
    settings.defaultDurationMinutes,
    settings.urgentTrigger,
    settings.executionEnabled,
    settings.keepTimingFirst,
    settings.pomoThresholdMinutes,
    settings.recentRetentionMinutes,
    settings.forgottenWarningMinutes,
    settings.dailyNoteFolder,
    settings.dailyNoteFormat,
  ]);
}

function diagnostic(
  code: string,
  retry: RuntimeDiagnostic["retry"],
  context?: RuntimeDiagnostic["context"],
): RuntimeDiagnostic {
  return Object.freeze({
    code,
    retry,
    ...(context ? { context: Object.freeze({ ...context }) } : {}),
  });
}

export class NautilusProjectionRuntime {
  readonly #access: TextAccess;
  readonly #pluginData: PluginDataStore;
  readonly #clock: SystemClock;
  readonly #readPlan: typeof readWorkspacePlan;
  readonly #cache: DisposableLruCache<string, RuntimeSnapshot<RuntimePlanProjection>>;
  readonly #cacheKeysByContext = new Map<string, string>();
  readonly #cacheContextsByKey = new Map<string, string>();
  readonly #contexts = new Map<string, ContextEntry>();
  #state: ProjectionRuntimeState = "unloaded";
  #startPromise?: Promise<void>;
  #stopPromise?: Promise<void>;
  #unsubscribe: Unsubscribe | undefined;
  #minuteTimer: TimerHandle | undefined;
  #nextGeneration = 0;
  #lastClockKey = "";

  constructor(dependencies: ProjectionRuntimeDependencies) {
    this.#access = dependencies.access;
    this.#pluginData = dependencies.pluginData;
    this.#clock = dependencies.clock;
    this.#readPlan = dependencies.readPlan ?? readWorkspacePlan;
    this.#cache = new DisposableLruCache({
      maxEntries: dependencies.snapshotCacheEntries ?? DEFAULT_SNAPSHOT_CACHE_ENTRIES,
      dispose: (_snapshot, key) => {
        const contextKey = this.#cacheContextsByKey.get(key);
        if (contextKey && this.#cacheKeysByContext.get(contextKey) === key) {
          this.#cacheKeysByContext.delete(contextKey);
        }
        this.#cacheContextsByKey.delete(key);
      },
    });
  }

  get state(): ProjectionRuntimeState {
    return this.#state;
  }

  start(): Promise<void> {
    if (this.#state === "ready") return Promise.resolve();
    if (this.#state === "starting") return this.#startPromise!;
    if (this.#state !== "unloaded" || this.#stopPromise) {
      return Promise.reject(new Error("Runtime cannot be restarted after stop"));
    }

    this.#state = "starting";
    const operation = (async () => {
      await this.#pluginData.load();
      if (this.#state !== "starting") return;
      this.#unsubscribe = this.#access.onChange((change) => this.#onSourceChange(change));
      this.#lastClockKey = this.#clockKey();
      this.#armMinuteTimer();
      this.#state = "ready";
    })();
    this.#startPromise = operation.catch((error: unknown) => {
      if (this.#state === "starting") this.#state = "unloaded";
      throw error;
    });
    return this.#startPromise;
  }

  connect(
    context: RuntimeViewContext,
    listener: RuntimeSnapshotListener,
    visible = true,
  ): RuntimeConnection {
    this.#assertReady();
    const copied = copyContext(context);
    const entry = this.#entry(copied);
    const record: ConnectionRecord = {
      contextKey: entry.key,
      visible,
      disconnected: false,
      listener,
    };
    entry.connections.add(record);

    const cached = this.#cachedSnapshot(entry.key);
    if (visible) {
      if (entry.inFlight && entry.snapshot) {
        this.#notifyConnection(record, entry.snapshot);
      } else if (entry.snapshot) {
        this.#notifyConnection(record, entry.snapshot);
      } else if (cached) {
        entry.generation = cached.revision.generation;
        entry.snapshot = cached;
        entry.confirmed = cached;
        this.#notifyConnection(record, cached);
      } else {
        entry.generation = this.#newGeneration();
        entry.snapshot = loadingSnapshot(this.#revision(entry));
        this.#notifyConnection(record, entry.snapshot);
      }
      if (!entry.inFlight) this.#invalidateEntry(entry, "immediate");
    } else {
      entry.dirty = true;
    }

    let disconnected = false;
    const disconnect = (): void => {
      if (disconnected) return;
      disconnected = true;
      record.disconnected = true;
      this.#detach(record);
    };
    return Object.freeze({
      setContext: (nextContext: RuntimeViewContext): void => {
        if (disconnected) return;
        this.#moveConnection(record, copyContext(nextContext));
      },
      setVisible: (nextVisible: boolean): void => {
        if (disconnected || record.visible === nextVisible) return;
        record.visible = nextVisible;
        const current = this.#contexts.get(record.contextKey);
        if (!current) return;
        if (nextVisible) {
          current.generation = this.#newGeneration();
          current.snapshot = hiddenSnapshot(this.#revision(current));
          this.#notifyConnection(record, current.snapshot);
          this.#invalidateEntry(current, "immediate");
        } else if (!hasVisibleConnection(current)) {
          current.dirty = true;
          current.followUpReady = false;
          current.refresh.cancel();
          this.#discardInFlight(current);
        }
      },
      refresh: (): void => {
        if (disconnected) return;
        const current = this.#contexts.get(record.contextKey);
        if (!current) return;
        this.#invalidateEntry(current, "immediate");
      },
      disconnect,
    });
  }

  async updateSettings(
    patch: Partial<PluginSettings>,
  ): Promise<PluginDataSnapshot> {
    this.#assertReady();
    const snapshot = await this.#pluginData.update((current) => ({
      ...current,
      settings: { ...current.settings, ...patch },
    }));
    if (this.#state !== "ready") return snapshot;
    this.#clearCache();
    for (const entry of this.#contexts.values()) this.#invalidateEntry(entry, "immediate");
    return snapshot;
  }

  stop(): Promise<void> {
    if (this.#stopPromise) return this.#stopPromise;
    this.#state = "stopping";
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    if (this.#minuteTimer !== undefined) {
      this.#clock.clearTimeout(this.#minuteTimer);
      this.#minuteTimer = undefined;
    }
    for (const entry of this.#contexts.values()) {
      entry.refresh.cancel();
      entry.followUpReady = false;
      this.#discardInFlight(entry);
      for (const connection of entry.connections) connection.disconnected = true;
      entry.connections.clear();
    }
    this.#contexts.clear();
    this.#clearCache();
    this.#stopPromise = this.#pluginData.stop().finally(() => {
      this.#state = "unloaded";
    });
    return this.#stopPromise;
  }

  #assertReady(): void {
    if (this.#state !== "ready") throw new Error("Runtime is not ready");
  }

  #newGeneration(): number {
    this.#nextGeneration += 1;
    return this.#nextGeneration;
  }

  #snapshotCacheKey(
    contextKey: string,
    snapshot: RuntimeSnapshot<RuntimePlanProjection>,
  ): string {
    const { revision } = snapshot;
    return JSON.stringify([
      contextKey,
      revision.path,
      revision.sourceFingerprint,
      semanticSettingsKey(this.#pluginData.data.settings),
      revision.settingsVersion,
      revision.logicalDate.year,
      revision.logicalDate.month,
      revision.logicalDate.day,
      revision.minuteBucket,
      revision.timeZone,
      revision.grammarVersion,
    ]);
  }

  #cachedSnapshot(contextKey: string): RuntimeSnapshot<RuntimePlanProjection> | undefined {
    const key = this.#cacheKeysByContext.get(contextKey);
    if (!key) return undefined;
    const snapshot = this.#cache.get(key);
    const now = this.#clock.now();
    if (!snapshot
      || snapshot.state !== "confirmed"
      || snapshot.revision.minuteBucket !== Math.floor(now / 60_000)
      || snapshot.revision.timeZone !== this.#clock.timeZone()
      || key !== this.#snapshotCacheKey(contextKey, snapshot)) {
      this.#dropCachedContext(contextKey);
      return undefined;
    }
    return snapshot;
  }

  #dropCachedContext(contextKey: string): void {
    const key = this.#cacheKeysByContext.get(contextKey);
    this.#cacheKeysByContext.delete(contextKey);
    if (key) {
      this.#cache.delete(key);
      this.#cacheContextsByKey.delete(key);
    }
  }

  #rememberConfirmed(
    contextKey: string,
    snapshot: RuntimeSnapshot<RuntimePlanProjection>,
  ): void {
    const key = this.#snapshotCacheKey(contextKey, snapshot);
    const previous = this.#cacheKeysByContext.get(contextKey);
    if (previous && previous !== key) this.#cache.delete(previous);
    this.#cache.set(key, snapshot);
    this.#cacheKeysByContext.set(contextKey, key);
    this.#cacheContextsByKey.set(key, contextKey);
  }

  #clearCache(): void {
    this.#cache.clear();
    this.#cacheKeysByContext.clear();
    this.#cacheContextsByKey.clear();
  }

  #discardInFlight(entry: ContextEntry): void {
    const inFlight = entry.inFlight;
    if (!inFlight) return;
    entry.inFlight = undefined;
    this.#clock.clearTimeout(inFlight.timeout);
    inFlight.controller.abort();
  }

  #entry(context: RuntimeViewContext): ContextEntry {
    const key = runtimeContextKey(context);
    const existing = this.#contexts.get(key);
    if (existing) return existing;
    const entry = {
      key,
      context,
      connections: new Set<ConnectionRecord>(),
      generation: 0,
      dirty: true,
      followUpReady: false,
      inFlight: undefined,
    } as ContextEntry;
    entry.refresh = new RefreshCoordinator(this.#clock, () => this.#refreshEntry(entry));
    this.#contexts.set(key, entry);
    return entry;
  }

  #moveConnection(record: ConnectionRecord, context: RuntimeViewContext): void {
    const nextKey = runtimeContextKey(context);
    if (record.contextKey === nextKey) return;
    this.#detach(record);
    if (record.disconnected) return;
    const next = this.#entry(context);
    record.contextKey = next.key;
    next.connections.add(record);
    next.dirty = true;
    if (record.visible) this.#invalidateEntry(next, "immediate");
  }

  #detach(record: ConnectionRecord): void {
    const entry = this.#contexts.get(record.contextKey);
    if (!entry) return;
    entry.connections.delete(record);
    if (entry.connections.size === 0) {
      entry.refresh.cancel();
      entry.followUpReady = false;
      this.#discardInFlight(entry);
      this.#contexts.delete(entry.key);
    } else if (!hasVisibleConnection(entry)) {
      entry.dirty = true;
      entry.refresh.cancel();
      entry.followUpReady = false;
      this.#discardInFlight(entry);
    }
  }

  #onSourceChange(_change: SourceChange): void {
    if (this.#state !== "ready") return;
    this.#clearCache();
    const kind: RefreshKind = _change.kind === "editor" ? "editor" : "vault";
    for (const entry of this.#contexts.values()) this.#invalidateEntry(entry, kind);
  }

  #invalidateEntry(entry: ContextEntry, kind: RefreshKind): void {
    if (this.#state !== "ready") return;
    entry.generation = this.#newGeneration();
    entry.dirty = true;
    this.#dropCachedContext(entry.key);
    if (!hasVisibleConnection(entry)) {
      entry.refresh.cancel();
      return;
    }
    const revision = this.#revision(
      entry,
      entry.snapshot?.revision.path,
      entry.snapshot?.revision.sourceFingerprint,
    );
    entry.snapshot = entry.snapshot
      ? staleSnapshot(entry.snapshot, revision)
      : loadingSnapshot(revision);
    this.#publish(entry, entry.snapshot, false);
    if (entry.inFlight) {
      entry.inFlight.controller.abort();
    }
    entry.refresh.schedule(kind);
  }

  #refreshEntry(entry: ContextEntry): void {
    if (this.#state !== "ready" || !hasVisibleConnection(entry)) return;
    if (entry.inFlight) {
      entry.followUpReady = true;
      entry.inFlight.controller.abort();
      return;
    }

    void this.#runRefresh(entry);
  }

  async #runRefresh(entry: ContextEntry): Promise<void> {
    const generation = entry.generation || this.#newGeneration();
    entry.generation = generation;
    entry.dirty = false;
    entry.followUpReady = false;
    const controller = new AbortController();
    const timeout = this.#clock.setTimeout(
      () => this.#handleRefreshTimeout(entry, generation),
      REFRESH_HARD_CAP_MILLISECONDS,
    );
    entry.inFlight = { generation, controller, timeout };
    try {
      const settings = this.#pluginData.data.settings;
      const result = await this.#readPlan(
        this.#access,
        entry.context.logicalDate,
        { folder: settings.dailyNoteFolder, format: settings.dailyNoteFormat },
        settingsGrammar(settings),
        { signal: controller.signal },
      );
      if (!this.#canPublish(entry, generation)) return;
      this.#publishRead(entry, generation, settings, result);
    } catch (error: unknown) {
      if (!this.#canPublish(entry, generation)) return;
      const snapshot = errorSnapshot(
        this.#revision(entry),
        diagnostic("read-failed", "event", {
          error: error instanceof Error ? error.name : "unknown",
        }),
      );
      this.#publish(entry, snapshot);
    } finally {
      if (entry.inFlight?.generation !== generation) return;
      this.#clock.clearTimeout(entry.inFlight.timeout);
      entry.inFlight = undefined;
      this.#scheduleDirtyFollowUp(entry);
    }
  }

  #handleRefreshTimeout(entry: ContextEntry, generation: number): void {
    const inFlight = entry.inFlight;
    if (!inFlight || inFlight.generation !== generation) return;
    entry.inFlight = undefined;
    inFlight.controller.abort();
    if (this.#state !== "ready"
      || this.#contexts.get(entry.key) !== entry
      || !hasVisibleConnection(entry)) return;
    if (entry.followUpReady) {
      this.#scheduleDirtyFollowUp(entry);
      return;
    }
    if (entry.dirty) return;

    entry.generation = this.#newGeneration();
    this.#publish(entry, errorSnapshot(
      this.#revision(entry),
      diagnostic("refresh-timeout", "explicit", {
        durationMilliseconds: REFRESH_HARD_CAP_MILLISECONDS,
      }),
    ));
  }

  #scheduleDirtyFollowUp(entry: ContextEntry): void {
    if (!entry.followUpReady
      || !entry.dirty
      || this.#state !== "ready"
      || !hasVisibleConnection(entry)) return;
    entry.followUpReady = false;
    entry.refresh.schedule("immediate");
  }

  #publishRead(
    entry: ContextEntry,
    generation: number,
    settings: PluginSettings,
    result: WorkspacePlanReadResult,
  ): void {
    if (!result.ok) {
      if (result.reason === "cancelled") return;
      if (result.reason === "input-limit") {
        this.#publish(entry, overLimitSnapshot(
          this.#revision(entry, result.path),
          { kind: result.kind, actual: result.actual, limit: result.limit },
          diagnostic("input-limit", "explicit", {
            kind: result.kind,
            actual: result.actual,
            limit: result.limit,
          }),
        ));
        return;
      }
      if (result.reason === "missing-source" || result.reason === "daily-note-resolution") {
        this.#publish(entry, missingSnapshot(
          this.#revision(entry, "path" in result ? result.path : undefined),
          diagnostic(result.reason, "event"),
        ));
        return;
      }
      const revision = this.#revision(entry, result.path);
      const failed = entry.confirmed
        ? createRuntimeSnapshot<RuntimePlanProjection>({
            state: "stale",
            revision,
            reason: "read-failed",
            diagnostic: diagnostic("source-read-failed", "event"),
          })
        : errorSnapshot(revision, diagnostic("source-read-failed", "event"));
      this.#publish(entry, failed);
      return;
    }

    const revision = this.#revision(
      entry,
      result.path,
      result.sourceVersion.contentDigest,
      result.grammar.version,
    );
    if (!result.primaryPlan.region || !result.grammar.supported) {
      this.#publish(entry, missingSnapshot(
        revision,
        diagnostic(
          result.grammar.supported ? "primary-plan-missing" : "unsupported-grammar",
          "event",
        ),
      ));
      return;
    }

    try {
      const clock = zonedTimeParts(this.#clock.now(), this.#clock.timeZone());
      const today = Object.freeze({ year: clock.year, month: clock.month, day: clock.day });
      const items = Object.freeze(result.grammar.items.map((item) => publicPlanItem(result.path, item)));
      const startMinutes = settings.chartStartHour * 60;
      const endMinutes = settings.chartEndHour * 60;
      const day = projectDay({
        displayedDate: entry.context.logicalDate,
        today,
        startMinutes,
        endMinutes,
        nowMinutes: clock.minuteOfDay,
      });
      const schedule = schedulePlan({
        startMinutes,
        endMinutes,
        nowMinutes: day.scheduleFromMinutes,
        items,
      });
      const capacity = calculateCapacity({
        startMinutes,
        endMinutes,
        nowMinutes: day.capacityFromMinutes,
        items,
      });
      const diagnostics: RuntimeProjectionDiagnostic[] = [
        ...result.primaryPlan.diagnostics.map((entryDiagnostic) => ({
          code: entryDiagnostic.code,
          sourceOrder: null,
        })),
        ...result.grammar.diagnostics.map((entryDiagnostic) => ({
          code: entryDiagnostic.code,
          sourceOrder: entryDiagnostic.sourceOrder,
        })),
      ];
      const projection: RuntimePlanProjection = {
        contextKey: entry.key,
        sourcePath: result.path,
        sourceFingerprint: result.sourceVersion.contentDigest,
        displayedDate: Object.freeze({ ...entry.context.logicalDate }),
        today,
        items,
        diagnostics: Object.freeze(diagnostics.map((value) => Object.freeze(value))),
        day,
        schedule,
        capacity,
      };
      this.#publish(entry, confirmedSnapshot(revision, projection));
    } catch (error: unknown) {
      this.#publish(entry, errorSnapshot(
        revision,
        diagnostic("projection-failed", "explicit", {
          error: error instanceof Error ? error.name : "unknown",
        }),
      ));
    }
  }

  #canPublish(entry: ContextEntry, generation: number): boolean {
    return this.#state === "ready"
      && this.#contexts.get(entry.key) === entry
      && hasVisibleConnection(entry)
      && entry.inFlight?.generation === generation
      && entry.generation === generation;
  }

  #publish(
    entry: ContextEntry,
    snapshot: RuntimeSnapshot<RuntimePlanProjection>,
    rememberConfirmed = true,
  ): void {
    if (this.#state !== "ready" || this.#contexts.get(entry.key) !== entry) return;
    entry.snapshot = snapshot;
    if (snapshot.state === "confirmed" && rememberConfirmed) {
      entry.confirmed = snapshot;
      this.#rememberConfirmed(entry.key, snapshot);
    }
    for (const connection of entry.connections) {
      if (connection.visible && !connection.disconnected) {
        this.#notifyConnection(connection, snapshot);
      }
    }
  }

  #notifyConnection(
    connection: ConnectionRecord,
    snapshot: RuntimeSnapshot<RuntimePlanProjection>,
  ): void {
    try {
      connection.listener(snapshot);
    } catch {
      // One view callback cannot prevent publication to another connection.
    }
  }

  #revision(
    entry: ContextEntry,
    path = this.#expectedPath(entry.context),
    sourceFingerprint: string | null = null,
    grammarVersion = PROJECTION_GRAMMAR_VERSION,
  ): ProjectionRevisionInput {
    const now = this.#clock.now();
    return {
      generation: entry.generation,
      path,
      sourceFingerprint,
      settingsVersion: this.#pluginData.revision,
      logicalDate: entry.context.logicalDate,
      minuteBucket: Math.floor(now / 60_000),
      timeZone: this.#clock.timeZone(),
      grammarVersion,
    };
  }

  #expectedPath(context: RuntimeViewContext): string {
    const settings = this.#pluginData.data.settings;
    const resolution = resolveDailyNotePath(context.logicalDate, {
      folder: settings.dailyNoteFolder,
      format: settings.dailyNoteFormat,
    });
    return resolution.ok ? resolution.path : "unresolved.md";
  }

  #clockKey(): string {
    const now = this.#clock.now();
    const parts = zonedTimeParts(now, this.#clock.timeZone());
    return `${parts.timeZone}\0${parts.dateKey}\0${String(Math.floor(now / 60_000))}`;
  }

  #armMinuteTimer(): void {
    if (this.#state !== "starting" && this.#state !== "ready") return;
    const now = this.#clock.now();
    const remainder = ((now % 60_000) + 60_000) % 60_000;
    const delay = remainder === 0 ? 60_000 : 60_000 - remainder;
    this.#minuteTimer = this.#clock.setTimeout(() => {
      this.#minuteTimer = undefined;
      if (this.#state !== "ready") return;
      const nextClockKey = this.#clockKey();
      if (nextClockKey !== this.#lastClockKey) {
        this.#lastClockKey = nextClockKey;
        this.#clearCache();
        for (const entry of this.#contexts.values()) this.#invalidateEntry(entry, "immediate");
      }
      this.#armMinuteTimer();
    }, delay);
  }
}
