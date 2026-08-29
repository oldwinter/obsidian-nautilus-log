import type { CalendarDayBounds, LogicalDate } from "../../core/day";
import type { GrammarV1Settings } from "../../core/model";
import {
  projectCompletedHistory,
  projectPastUnplanned,
  projectReview,
  type CompletedHistorySlice,
  type ReviewClock,
  type ReviewProjection,
  type ReviewTask,
} from "../../core/review";
import type { EpochInterval } from "../../core/history";
import type { ParseClockOptions } from "../../workspace/clock-parser";
import type { DailyNoteConfiguration } from "../../workspace/daily-notes";
import {
  type CurrentHistoryIndexSnapshot,
  type HistoryIndexDiagnostic,
  type HistoryIndex,
  type HistoryIndexSnapshot,
  type IndexedHistoryTask,
} from "../../workspace/history-index";

export type ReviewCoordinatorStatus = "absent" | "building" | "ready" | "unavailable";

export interface ReviewCoordinatorRequest {
  readonly logicalDate: LogicalDate;
  readonly configuration: DailyNoteConfiguration;
  readonly grammarSettings?: GrammarV1Settings;
  readonly clockParsing?: ParseClockOptions;
  readonly day: CalendarDayBounds;
  readonly nowEpochMilliseconds: number;
  readonly resolveMinuteEpoch: (
    date: LogicalDate,
    minute: number,
    timeZone: string,
  ) => number | undefined;
  readonly confirmedExecutionClocks?: readonly ReviewClock[];
  readonly scheduledIntervals?: readonly EpochInterval[];
  readonly hourBoundariesEpochMilliseconds?: readonly number[];
  readonly signal?: AbortSignal;
}

interface ReviewCoordinatorSnapshotBase {
  readonly generation: number;
}

export interface PassiveReviewCoordinatorSnapshot extends ReviewCoordinatorSnapshotBase {
  readonly state: "absent" | "building";
}

export interface ReadyReviewCoordinatorSnapshot extends ReviewCoordinatorSnapshotBase {
  readonly state: "ready";
  readonly historyGeneration: number;
  readonly historyDiagnostics: readonly HistoryIndexDiagnostic[];
  readonly projection: ReviewProjection;
  readonly completedHistory: readonly CompletedHistorySlice[];
  readonly pastUnplanned: readonly EpochInterval[];
}

export interface UnavailableReviewCoordinatorSnapshot extends ReviewCoordinatorSnapshotBase {
  readonly state: "unavailable";
  readonly reason:
    | "cancelled"
    | "history-dirty"
    | "history-over-limit"
    | "history-unavailable"
    | "invalid-day"
    | "superseded";
  readonly history: HistoryIndexSnapshot;
}

export type ReviewCoordinatorSnapshot =
  | ReadyReviewCoordinatorSnapshot
  | UnavailableReviewCoordinatorSnapshot
  | PassiveReviewCoordinatorSnapshot;

export type ReviewCoordinatorListener = (snapshot: ReviewCoordinatorSnapshot) => void;

function emptySnapshot(
  state: "absent" | "building",
  generation: number,
): PassiveReviewCoordinatorSnapshot {
  return Object.freeze({ state, generation });
}

function sameDate(left: LogicalDate, right: LogicalDate): boolean {
  return left.year === right.year && left.month === right.month && left.day === right.day;
}

function validDay(request: ReviewCoordinatorRequest): boolean {
  return sameDate(request.logicalDate, request.day.date)
    && request.day.timeZone.length > 0
    && Number.isFinite(request.day.startEpochMilliseconds)
    && Number.isFinite(request.day.endEpochMilliseconds)
    && request.day.endEpochMilliseconds > request.day.startEpochMilliseconds
    && Number.isFinite(request.nowEpochMilliseconds);
}

function indexedClockSet(
  snapshot: CurrentHistoryIndexSnapshot,
  tasks: readonly IndexedHistoryTask[],
  confirmed: readonly ReviewClock[] | undefined,
): readonly ReviewClock[] {
  const duplicateOwners = new Set(snapshot.diagnostics
    .filter((diagnostic) => diagnostic.code === "duplicate-owner-id" && diagnostic.ownerId)
    .map((diagnostic) => diagnostic.ownerId!));
  const indexed = tasks.flatMap((task) =>
    task.ownerId && !duplicateOwners.has(task.ownerId) ? task.clocks : []);
  if (confirmed === undefined) return Object.freeze(indexed);
  const retained = indexed.filter((clock) => clock.state !== "running");
  const acceptedConfirmed = confirmed.filter((clock) =>
    !clock.ownerId || !duplicateOwners.has(clock.ownerId));
  return Object.freeze([...retained, ...acceptedConfirmed]);
}

function reviewTask(
  indexed: IndexedHistoryTask,
  request: ReviewCoordinatorRequest,
  ownerCollides: boolean,
): ReviewTask {
  const completionAnchorEpochMilliseconds = indexed.completionAnchorMinutes === undefined
    ? undefined
    : request.resolveMinuteEpoch(
        indexed.logicalDate,
        indexed.completionAnchorMinutes,
        request.day.timeZone,
      );
  const fixedStart = indexed.fixedStartMinutes === undefined
    ? undefined
    : request.resolveMinuteEpoch(indexed.logicalDate, indexed.fixedStartMinutes, request.day.timeZone);
  const fixedEnd = indexed.fixedEndMinutes === undefined
    ? undefined
    : request.resolveMinuteEpoch(indexed.logicalDate, indexed.fixedEndMinutes, request.day.timeZone);
  const fixedInterval = fixedStart !== undefined
    && fixedEnd !== undefined
    && fixedEnd > fixedStart
    ? Object.freeze({ startEpochMilliseconds: fixedStart, endEpochMilliseconds: fixedEnd })
    : undefined;
  return Object.freeze({
    key: indexed.key,
    ...(!ownerCollides && indexed.ownerId ? { ownerId: indexed.ownerId } : {}),
    sourceOrder: indexed.sourceOrder,
    direct: true,
    kind: indexed.kind,
    status: indexed.status,
    label: indexed.label,
    plannedMinutes: indexed.plannedMinutes,
    ...(completionAnchorEpochMilliseconds === undefined
      ? {}
      : { completionAnchorEpochMilliseconds }),
    ...(fixedInterval ? { fixedInterval } : {}),
  });
}

function unavailableReason(
  history: HistoryIndexSnapshot,
): UnavailableReviewCoordinatorSnapshot["reason"] {
  if (history.state === "over-limit") return "history-over-limit";
  if (history.state === "dirty" || history.state === "building" || history.state === "absent") {
    return "history-dirty";
  }
  if (history.state === "unavailable" && history.reason === "cancelled") return "cancelled";
  return "history-unavailable";
}

export class ReviewCoordinator {
  readonly #history: HistoryIndex;
  readonly #unsubscribeHistory: () => void;
  readonly #listeners = new Set<ReviewCoordinatorListener>();
  #generation = 0;
  #attempt = 0;
  #disposed = false;
  #snapshot: ReviewCoordinatorSnapshot = emptySnapshot("absent", 0);

  constructor(history: HistoryIndex) {
    this.#history = history;
    this.#unsubscribeHistory = history.subscribe((snapshot) => this.#onHistorySnapshot(snapshot));
  }

  get snapshot(): ReviewCoordinatorSnapshot {
    return this.#snapshot;
  }

  subscribe(listener: ReviewCoordinatorListener): () => void {
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

  async refresh(request: ReviewCoordinatorRequest): Promise<ReviewCoordinatorSnapshot> {
    if (this.#disposed) return this.#snapshot;
    const attempt = ++this.#attempt;
    const generation = this.#generation + 1;
    this.#publish(emptySnapshot("building", generation), attempt);
    const history = await this.#history.rebuild({
      configuration: request.configuration,
      ...(request.grammarSettings ? { grammarSettings: request.grammarSettings } : {}),
      ...(request.clockParsing ? { clockParsing: request.clockParsing } : {}),
      ...(request.signal ? { signal: request.signal } : {}),
    });
    if (this.#disposed || attempt !== this.#attempt) {
      return Object.freeze({
        state: "unavailable",
        generation,
        reason: "superseded",
        history,
      });
    }
    if (request.signal?.aborted) {
      return this.#publish(Object.freeze({
        state: "unavailable",
        generation,
        reason: "cancelled",
        history,
      }), attempt);
    }
    if (!validDay(request)) {
      return this.#publish(Object.freeze({
        state: "unavailable",
        generation,
        reason: "invalid-day",
        history,
      }), attempt);
    }
    if (history.state !== "current") {
      return this.#publish(Object.freeze({
        state: "unavailable",
        generation,
        reason: unavailableReason(history),
        history,
      }), attempt);
    }

    const indexedTasks = history.tasks.filter((task) => sameDate(task.logicalDate, request.logicalDate));
    const collidingOwners = new Set(history.diagnostics
      .filter((diagnostic) => diagnostic.code === "duplicate-owner-id" && diagnostic.ownerId)
      .map((diagnostic) => diagnostic.ownerId!));
    const tasks = Object.freeze(indexedTasks.map((task) => reviewTask(
      task,
      request,
      task.ownerId !== undefined && collidingOwners.has(task.ownerId),
    )));
    const clocks = indexedClockSet(history, indexedTasks, request.confirmedExecutionClocks);
    const projection = projectReview({
      tasks,
      clocks,
      day: request.day,
      nowEpochMilliseconds: request.nowEpochMilliseconds,
    });
    const completedHistory = projectCompletedHistory(tasks, clocks, request.day);
    const fixed = tasks.flatMap((task) => task.fixedInterval ? [task.fixedInterval] : []);
    const pastUnplanned = projectPastUnplanned({
      day: request.day,
      nowEpochMilliseconds: request.nowEpochMilliseconds,
      fixed,
      scheduled: request.scheduledIntervals ?? [],
      completedHistory,
      ...(request.hourBoundariesEpochMilliseconds
        ? { hourBoundariesEpochMilliseconds: request.hourBoundariesEpochMilliseconds }
        : {}),
    });
    return this.#publish(Object.freeze({
      state: "ready",
      generation,
      historyGeneration: history.generation,
      historyDiagnostics: history.diagnostics,
      projection,
      completedHistory,
      pastUnplanned,
    }), attempt);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#attempt += 1;
    this.#unsubscribeHistory();
    this.#listeners.clear();
    this.#history.dispose();
    this.#snapshot = emptySnapshot("absent", this.#generation);
  }

  #publish<T extends ReviewCoordinatorSnapshot>(snapshot: T, attempt: number): T {
    if (this.#disposed || attempt !== this.#attempt) return snapshot;
    this.#generation = snapshot.generation;
    this.#snapshot = snapshot;
    for (const listener of this.#listeners) listener(snapshot);
    return snapshot;
  }

  #onHistorySnapshot(history: HistoryIndexSnapshot): void {
    if (this.#disposed || this.#snapshot.state !== "ready" || history.state === "current") return;
    const attempt = ++this.#attempt;
    this.#publish(Object.freeze({
      state: "unavailable",
      generation: this.#generation + 1,
      reason: unavailableReason(history),
      history,
    }), attempt);
  }
}
