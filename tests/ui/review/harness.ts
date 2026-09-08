import { createReviewEntryPort } from "@review-source/adapters/review-entry.ts";
import { projectReview, type ReviewClock, type ReviewTask } from "@review-source/core/review.ts";
import type { LogicalDate } from "@review-source/core/day.ts";
import type { ExecutionApplicationSnapshot, ExecutionTargetReference } from "@review-source/runtime/execution/application.ts";
import type { ReviewCoordinatorSnapshot, RuntimeReviewTask } from "@review-source/runtime/review/coordinator.ts";

type Locale = "en" | "zh-CN";
type Outcome = "applied" | "already-applied" | "rejected" | "uncertain";
type ReadyReviewMode =
  | "full"
  | "target"
  | "completed-target"
  | "row-removed"
  | "empty"
  | "missing-note"
  | "missing-plan"
  | "invalid-plan";
type ReviewMode = ReadyReviewMode | "building" | "over-limit" | "unavailable";

interface MutableStats {
  ticks: number;
  refreshes: number;
  dispatches: unknown[];
  navigations: unknown[];
  selectedDates: Array<LogicalDate | null>;
  planMutations: number;
}

const MINUTE = 60_000;
const TODAY = Object.freeze({ year: 2026, month: 8, day: 29 });
const DAY_START = Date.UTC(2026, 7, 29, 0, 0, 0);
const DAY_END = DAY_START + 24 * 60 * MINUTE;
const INITIAL_NOW = DAY_START + 12 * 60 * MINUTE;
const PLAN_TOKEN = "plan-generation-17";
const OPAQUE_TARGET = Object.freeze({
  path: "Daily/Selected Review.md",
  ownerId: "nl-88888888-8888-4888-8888-888888888888",
  sourceOrder: 17,
  sourceFingerprint: "sha256:opaque-fixture-source-fingerprint",
}) satisfies ExecutionTargetReference;

function target(index: number): ExecutionTargetReference {
  return Object.freeze({
    path: `Daily/Review Fixture ${index}.md`,
    ownerId: `nl-${String(index).padStart(8, "0")}-1111-4111-8111-111111111111`,
    sourceOrder: index,
    sourceFingerprint: `fixture-source-fingerprint-${index}`,
  });
}

function task(
  key: string,
  label: string,
  status: ReviewTask["status"],
  plannedMinutes: number,
  sourceOrder: number,
  executionTarget: ExecutionTargetReference = target(sourceOrder),
): RuntimeReviewTask {
  return Object.freeze({
    key,
    ownerId: executionTarget.ownerId ?? undefined,
    sourceOrder,
    direct: true,
    kind: "flexible-task",
    status,
    label,
    plannedMinutes,
    target: executionTarget,
  });
}

const FULL_TASKS = Object.freeze([
  task("row:not-started", "Not started", "open", 10, 0),
  task("row:live", "Live timer", "open", 25, 1),
  task("row:paused", "Paused task", "open", 40, 2),
  task("row:not-tracked", "No recorded time", "done", 35, 3),
  task("row:positive", "Positive variance", "done", 30, 4),
  task("row:negative", "Negative variance", "done", 30, 5),
  task("row:zero", "Zero variance", "done", 30, 6),
]);

const FULL_CLOCKS: readonly ReviewClock[] = Object.freeze([
  Object.freeze({
    state: "running",
    ownerId: FULL_TASKS[1]!.ownerId!,
    startEpochMilliseconds: INITIAL_NOW - 12 * MINUTE,
    clockId: "clock-live",
  }),
  Object.freeze({
    state: "closed",
    ownerId: FULL_TASKS[2]!.ownerId!,
    startEpochMilliseconds: INITIAL_NOW - 30 * MINUTE,
    endEpochMilliseconds: INITIAL_NOW - 10 * MINUTE,
    clockId: "clock-paused",
  }),
  Object.freeze({
    state: "closed",
    ownerId: FULL_TASKS[4]!.ownerId!,
    startEpochMilliseconds: INITIAL_NOW - 80 * MINUTE,
    endEpochMilliseconds: INITIAL_NOW - 35 * MINUTE,
    clockId: "clock-positive",
  }),
  Object.freeze({
    state: "closed",
    ownerId: FULL_TASKS[5]!.ownerId!,
    startEpochMilliseconds: INITIAL_NOW - 115 * MINUTE,
    endEpochMilliseconds: INITIAL_NOW - 95 * MINUTE,
    clockId: "clock-negative",
  }),
  Object.freeze({
    state: "closed",
    ownerId: FULL_TASKS[6]!.ownerId!,
    startEpochMilliseconds: INITIAL_NOW - 150 * MINUTE,
    endEpochMilliseconds: INITIAL_NOW - 120 * MINUTE,
    clockId: "clock-zero",
  }),
]);

const TARGET_TASKS = Object.freeze([
  task("forged/key|Daily/Wrong.md|owner=wrong|999", "Opaque target", "open", 25, 17, OPAQUE_TARGET),
]);
const COMPLETED_TARGET_TASKS: readonly RuntimeReviewTask[] = Object.freeze([
  Object.freeze({ ...TARGET_TASKS[0]!, status: "done" }),
]);
const ROW_REMOVED_TASKS = Object.freeze(FULL_TASKS.filter((entry) => entry.key !== "row:paused"));

function sameDate(left: LogicalDate, right: LogicalDate): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day;
}

class LocaleSource {
  locale: Locale = "en";
  readonly listeners = new Set<(locale: Locale) => void>();

  subscribe(listener: (locale: Locale) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  set(locale: Locale): void {
    this.locale = locale;
    for (const listener of this.listeners) listener(locale);
  }
}

let generation = 0;
let now = INITIAL_NOW;
let currentDate: LogicalDate = TODAY;
let mode: ReviewMode = "full";
let execution = executionSnapshot("ready");
let review = reviewSnapshot(mode, currentDate);
let nextOutcome: Outcome = "applied";
let deferDispatch = false;
let resolveDeferred: ((outcome: Outcome) => void) | undefined;
let intentSequence = 0;
const reviewListeners = new Set<(snapshot: ReviewCoordinatorSnapshot) => void>();
const executionListeners = new Set<(snapshot: ExecutionApplicationSnapshot) => void>();
const localeSource = new LocaleSource();
const disposers: Array<() => void> = [];
const stats: MutableStats = {
  ticks: 0,
  refreshes: 0,
  dispatches: [],
  navigations: [],
  selectedDates: [],
  planMutations: 0,
};

function executionSnapshot(
  status: ExecutionApplicationSnapshot["status"],
  options: { writeBlocked?: boolean; focusedOwner?: string } = {},
): ExecutionApplicationSnapshot {
  const writeBlocked = options.writeBlocked ?? status !== "ready";
  const focused = options.focusedOwner ? {
    ownerId: options.focusedOwner,
    path: "Daily/Focused.md",
    sourceOrder: 0,
    label: "Focused fixture",
    clock: {
      path: "Daily/Focused.md",
      ownerId: options.focusedOwner,
      clockId: "focused-clock",
      fromOffset: 0,
      startEpochMs: now - MINUTE,
      targetKey: "focused-clock",
    },
  } : undefined;
  return Object.freeze({
    generation: ++generation,
    status,
    runtime: Object.freeze({
      status: status === "ready" ? "ready" : "stale",
      clocks: Object.freeze({ kind: "idle", generation }),
      writeBlocked,
      pluginDataRevision: 1,
    }),
    execution: Object.freeze({ kind: "idle" }),
    writeBlocked,
    pomoThresholdMinutes: 30,
    standalonePomoStartEpochMs: null,
    ...(focused ? { focused } : {}),
  }) as ExecutionApplicationSnapshot;
}

function readySnapshot(reviewMode: ReadyReviewMode, date: LogicalDate): ReviewCoordinatorSnapshot {
  const tasks = reviewMode === "full" ? FULL_TASKS
    : reviewMode === "target" ? TARGET_TASKS
    : reviewMode === "completed-target" ? COMPLETED_TARGET_TASKS
    : reviewMode === "row-removed" ? ROW_REMOVED_TASKS : [];
  const clocks = reviewMode === "full" || reviewMode === "row-removed" ? FULL_CLOCKS : [];
  const availability = reviewMode === "missing-note" ? "missing-note"
    : reviewMode === "missing-plan" ? "missing-plan"
    : reviewMode === "invalid-plan" ? "invalid-plan" : "ready";
  return Object.freeze({
    state: "ready",
    generation: ++generation,
    displayedDate: Object.freeze({ ...date }),
    availability,
    projectedAtEpochMilliseconds: now,
    historyGeneration: 11,
    historyDiagnostics: Object.freeze([]),
    projection: projectReview({
      tasks,
      clocks,
      day: Object.freeze({
        date: Object.freeze({ ...date }),
        timeZone: "UTC",
        startEpochMilliseconds: DAY_START,
        endEpochMilliseconds: DAY_END,
      }),
      nowEpochMilliseconds: now,
    }),
    completedHistory: Object.freeze([]),
    pastUnplanned: Object.freeze([]),
  });
}

function reviewSnapshot(reviewMode: ReviewMode, date: LogicalDate): ReviewCoordinatorSnapshot {
  if (reviewMode === "building") return Object.freeze({ state: "building", generation: ++generation });
  if (reviewMode === "over-limit" || reviewMode === "unavailable") {
    return Object.freeze({
      state: "unavailable",
      generation: ++generation,
      reason: reviewMode === "over-limit" ? "history-over-limit" : "history-unavailable",
      history: Object.freeze({ state: "unavailable", generation, reason: "read-failed" }),
    }) as ReviewCoordinatorSnapshot;
  }
  return readySnapshot(reviewMode, date);
}

function publishReview(): void {
  for (const listener of reviewListeners) listener(review);
}

function publishExecution(): void {
  for (const listener of executionListeners) listener(execution);
}

function outcome(value: Outcome, intentId: string): unknown {
  return Object.freeze({
    intentId,
    outcome: value,
    snapshot: execution.runtime,
    pluginDataWarning: false,
  });
}

const root = document.querySelector<HTMLElement>("#review-root");
if (!root) throw new Error("Review browser harness root is missing");

const port = createReviewEntryPort({
  async dispatch(intent) {
    stats.dispatches.push(structuredClone(intent));
    if (!deferDispatch) return outcome(nextOutcome, intent.intentId) as never;
    deferDispatch = false;
    return new Promise((resolve) => {
      resolveDeferred = (value) => {
        resolveDeferred = undefined;
        resolve(outcome(value, intent.intentId) as never);
      };
    });
  },
  executionSnapshot: () => execution,
  subscribeExecution(listener) {
    executionListeners.add(listener);
    listener(execution);
    return () => executionListeners.delete(listener);
  },
  reviewSnapshot: () => review,
  subscribeReview(listener) {
    reviewListeners.add(listener);
    listener(review);
    return () => reviewListeners.delete(listener);
  },
  async navigateTask(value, location) {
    stats.navigations.push({ target: structuredClone(value), location });
  },
  today: () => TODAY,
  async selectDate(date) {
    stats.selectedDates.push(date ? Object.freeze({ ...date }) : null);
    currentDate = date ? Object.freeze({ ...date }) : TODAY;
    if (mode !== "building" && mode !== "over-limit" && mode !== "unavailable") {
      review = readySnapshot(mode, currentDate);
      publishReview();
    }
  },
  async refresh() {
    stats.refreshes += 1;
  },
  tick() {
    stats.ticks += 1;
    now += MINUTE;
    if (review.state === "ready" && mode !== "building" && mode !== "over-limit" && mode !== "unavailable") {
      review = readySnapshot(mode, currentDate);
      publishReview();
    }
  },
  intentId: () => `review-intent-${++intentSequence}`,
  messages: localeSource as never,
  addDisposer(dispose) {
    disposers.push(dispose);
  },
});
const surface = port.createSurface(root);

const api = Object.freeze({
  show(): void {
    root.hidden = false;
    surface.render(root, true);
  },
  hide(): void {
    surface.render(root, false);
    root.hidden = true;
  },
  destroy(): void {
    surface.destroy();
  },
  setReviewMode(nextMode: ReviewMode, publish = true): void {
    mode = nextMode;
    review = reviewSnapshot(mode, currentDate);
    if (publish) publishReview();
  },
  setExecution(status: ExecutionApplicationSnapshot["status"], options = {}): void {
    execution = executionSnapshot(status, options);
    publishExecution();
  },
  setLocale(locale: Locale): void {
    localeSource.set(locale);
  },
  tickNow(): void {
    stats.ticks += 1;
    now += MINUTE;
    if (mode !== "building" && mode !== "over-limit" && mode !== "unavailable") {
      review = readySnapshot(mode, currentDate);
      publishReview();
    }
  },
  setNextOutcome(value: Outcome): void {
    nextOutcome = value;
  },
  deferNextDispatch(): void {
    deferDispatch = true;
  },
  resolveDispatch(value: Outcome): void {
    if (!resolveDeferred) throw new Error("No deferred Review dispatch is pending");
    resolveDeferred(value);
  },
  stats(): unknown {
    return structuredClone({
      ...stats,
      currentDate,
      planToken: PLAN_TOKEN,
      reviewState: review.state,
      listeners: {
        review: reviewListeners.size,
        execution: executionListeners.size,
        locale: localeSource.listeners.size,
      },
      disposerCount: disposers.length,
      deferredDispatchPending: resolveDeferred !== undefined,
      isToday: sameDate(currentDate, TODAY),
    });
  },
  constants: Object.freeze({ today: TODAY, opaqueTarget: OPAQUE_TARGET, planToken: PLAN_TOKEN }),
});

Object.assign(window, { reviewHarness: api, reviewHarnessReady: true });

declare global {
  interface Window {
    readonly reviewHarness: typeof api;
    readonly reviewHarnessReady: boolean;
  }
}
