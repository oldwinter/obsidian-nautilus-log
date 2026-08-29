import type { PluginDataDocument, PluginDataSnapshot, PluginDataStore } from "../plugin-data";

export type PomoStore = Pick<PluginDataStore, "data" | "update">;

export interface PomoProjection {
  readonly taskStartEpochMs: number | null;
  readonly standaloneStartEpochMs: number | null;
  readonly elapsedMs: number;
  readonly overThreshold: boolean;
}

function elapsed(nowEpochMs: number, startEpochMs: number | null): number {
  if (!Number.isFinite(nowEpochMs)) throw new TypeError("POMO time must be finite");
  return startEpochMs === null ? 0 : Math.max(0, nowEpochMs - startEpochMs);
}

function samePomo(
  current: PluginDataDocument,
  taskPomoStartEpochMs: number | null,
  standalonePomoStartEpochMs: number | null,
): boolean {
  return current.taskPomoStartEpochMs === taskPomoStartEpochMs
    && current.standalonePomoStartEpochMs === standalonePomoStartEpochMs;
}

export class PomoController {
  readonly #store: PomoStore;

  constructor(store: PomoStore) {
    this.#store = store;
  }

  project(hasRunningClock: boolean, nowEpochMs: number, thresholdMinutes: number): PomoProjection {
    if (!Number.isFinite(thresholdMinutes) || thresholdMinutes < 0) {
      throw new RangeError("POMO threshold must be finite and nonnegative");
    }
    const taskStartEpochMs = hasRunningClock ? this.#store.data.taskPomoStartEpochMs : null;
    const standaloneStartEpochMs = hasRunningClock ? null : this.#store.data.standalonePomoStartEpochMs;
    const activeStart = taskStartEpochMs ?? standaloneStartEpochMs;
    const elapsedMs = elapsed(nowEpochMs, activeStart);
    return Object.freeze({
      taskStartEpochMs,
      standaloneStartEpochMs,
      elapsedMs,
      overThreshold: activeStart !== null
        && elapsedMs >= thresholdMinutes * 60_000,
    });
  }

  restore(
    runningClockStartEpochMs?: number,
    maximumStartEpochMs?: number,
  ): Promise<PluginDataSnapshot | undefined> {
    const current = this.#store.data;
    const persistedTask = maximumStartEpochMs !== undefined
      && current.taskPomoStartEpochMs !== null
      && current.taskPomoStartEpochMs > maximumStartEpochMs
      ? null
      : current.taskPomoStartEpochMs;
    const task = runningClockStartEpochMs === undefined
      ? null
      : persistedTask ?? runningClockStartEpochMs;
    const standalone = runningClockStartEpochMs === undefined
      ? current.standalonePomoStartEpochMs
      : null;
    return this.#set(task, standalone);
  }

  startStandalone(nowEpochMs: number, hasRunningClock: boolean): Promise<PluginDataSnapshot | undefined> {
    if (!Number.isFinite(nowEpochMs)) throw new TypeError("POMO start must be finite");
    if (hasRunningClock || this.#store.data.standalonePomoStartEpochMs !== null) {
      return Promise.resolve(undefined);
    }
    return this.#set(null, nowEpochMs);
  }

  stopStandalone(): Promise<PluginDataSnapshot | undefined> {
    return this.#set(this.#store.data.taskPomoStartEpochMs, null);
  }

  afterClockIn(nowEpochMs: number): Promise<PluginDataSnapshot | undefined> {
    if (!Number.isFinite(nowEpochMs)) throw new TypeError("POMO start must be finite");
    return this.#set(this.#store.data.taskPomoStartEpochMs ?? nowEpochMs, null);
  }

  rebaseStandalone(startEpochMs: number): Promise<PluginDataSnapshot | undefined> {
    if (!Number.isFinite(startEpochMs)) throw new TypeError("POMO start must be finite");
    if (this.#store.data.standalonePomoStartEpochMs === null) {
      return Promise.resolve(undefined);
    }
    return this.#set(null, startEpochMs);
  }

  clearTask(): Promise<PluginDataSnapshot | undefined> {
    return this.#set(null, this.#store.data.standalonePomoStartEpochMs);
  }

  clearAll(): Promise<PluginDataSnapshot | undefined> {
    return this.#set(null, null);
  }

  #set(
    taskPomoStartEpochMs: number | null,
    standalonePomoStartEpochMs: number | null,
  ): Promise<PluginDataSnapshot | undefined> {
    if (samePomo(this.#store.data, taskPomoStartEpochMs, standalonePomoStartEpochMs)) {
      return Promise.resolve(undefined);
    }
    return this.#store.update((current) => ({
      ...current,
      taskPomoStartEpochMs,
      standalonePomoStartEpochMs,
    }));
  }
}
