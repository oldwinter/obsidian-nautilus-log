export type PlannerControlKind = "collapse" | "completed" | "debug" | "playback";

export interface PlannerControlsState {
  readonly collapsed: boolean;
  readonly debugEnabled: boolean;
  readonly playbackRunning: boolean;
  readonly showCompleted: boolean;
}

export interface PlannerControlChange {
  readonly kind: PlannerControlKind;
  readonly state: PlannerControlsState;
}

export interface PlannerCollapseStore {
  load(instanceId: string): boolean | undefined;
  save(instanceId: string, collapsed: boolean): void;
}

export interface PlannerDebugStore {
  readonly enabled: boolean;
  setEnabled(enabled: boolean): void;
  subscribe(listener: (enabled: boolean) => void): () => void;
}

export function createMemoryPlannerCollapseStore(): PlannerCollapseStore {
  const values = new Map<string, boolean>();
  return Object.freeze({
    load: (instanceId: string) => values.get(instanceId),
    save: (instanceId: string, collapsed: boolean) => values.set(instanceId, collapsed),
  });
}

export function createPlannerDebugStore(initial = false): PlannerDebugStore {
  let enabled = initial;
  const listeners = new Set<(enabled: boolean) => void>();
  return Object.freeze({
    get enabled() {
      return enabled;
    },
    setEnabled(next: boolean) {
      if (next === enabled) return;
      enabled = next;
      for (const listener of listeners) listener(enabled);
    },
    subscribe(listener: (next: boolean) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}

const defaultCollapseStore = createMemoryPlannerCollapseStore();
const defaultDebugStore = createPlannerDebugStore();

export interface PlannerControlsOptions {
  readonly debugControl?: boolean;
  readonly debugStore?: PlannerDebugStore;
  readonly collapseStore?: PlannerCollapseStore;
  readonly instanceId: string;
  readonly onChange?: (change: PlannerControlChange) => void;
}

export interface PlannerControlsController {
  readonly debugControl: boolean;
  readonly state: PlannerControlsState;
  toggleCollapsed(): boolean;
  toggleCompleted(): boolean;
  toggleDebug(): boolean;
  startPlayback(): boolean;
  finishPlayback(): boolean;
  destroy(): void;
}

export function createPlannerControls(options: PlannerControlsOptions): PlannerControlsController {
  if (options.instanceId.trim() === "") throw new RangeError("Planner controls require an instance ID");
  const collapseStore = options.collapseStore ?? defaultCollapseStore;
  const debugStore = options.debugStore ?? defaultDebugStore;
  let collapsed = collapseStore.load(options.instanceId) ?? false;
  let showCompleted = true;
  let playbackRunning = false;
  let destroyed = false;

  const snapshot = (): PlannerControlsState => Object.freeze({
    collapsed,
    debugEnabled: debugStore.enabled,
    playbackRunning,
    showCompleted,
  });
  const publish = (kind: PlannerControlKind): void => {
    if (!destroyed) options.onChange?.(Object.freeze({ kind, state: snapshot() }));
  };
  const stopDebugSubscription = debugStore.subscribe(() => publish("debug"));

  return Object.freeze({
    debugControl: options.debugControl ?? false,
    get state() {
      return snapshot();
    },
    toggleCollapsed() {
      if (destroyed) return false;
      const next = !collapsed;
      collapseStore.save(options.instanceId, next);
      collapsed = next;
      publish("collapse");
      return true;
    },
    toggleCompleted() {
      if (destroyed) return false;
      showCompleted = !showCompleted;
      publish("completed");
      return true;
    },
    toggleDebug() {
      if (destroyed || !(options.debugControl ?? false)) return false;
      debugStore.setEnabled(!debugStore.enabled);
      return true;
    },
    startPlayback() {
      if (destroyed || playbackRunning) return false;
      playbackRunning = true;
      publish("playback");
      return true;
    },
    finishPlayback() {
      if (destroyed || !playbackRunning) return false;
      playbackRunning = false;
      publish("playback");
      return true;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopDebugSubscription();
    },
  });
}

export type PlannerProgressStatus = "done" | "open" | "plain";

export interface PlannerProgressTarget {
  readonly authoritative: boolean;
  readonly blockId: string | null;
  readonly dayRelation: "future" | "other" | "past" | "today";
  readonly executionEligible: boolean;
  readonly itemId: string;
  readonly kind: "fixed-event" | "flexible-task";
  readonly path: string;
  readonly progress: PlannerProgressTokenState;
  readonly sourceOrder: number;
  readonly status: PlannerProgressStatus;
  readonly title: string;
}

export type PlannerProgressTokenState =
  | Readonly<{ readonly present: false }>
  | Readonly<{ readonly present: true; readonly rawPercent: number }>
  | Readonly<{ readonly present: "unknown"; readonly projectedPercent: number }>;

export type PlannerProgressPreview =
  | { readonly outcome: "advanced"; readonly percent: number }
  | { readonly outcome: "cleared" }
  | { readonly outcome: "completed"; readonly percent: 100 }
  | { readonly outcome: "conflict"; readonly reason: "done-with-progress" }
  | { readonly outcome: "pending" }
  | { readonly outcome: "reopened"; readonly percent: 10 };

export interface PlannerProgressIntent {
  readonly intentId: string;
  readonly type: "advance-or-reopen-progress";
  readonly target: Readonly<{
    blockId: string | null;
    itemId: string;
    path: string;
    sourceOrder: number;
  }>;
}

export interface PlannerProgressDispatch {
  readonly intent: PlannerProgressIntent;
  readonly preview: PlannerProgressPreview;
  readonly target: PlannerProgressTarget;
}

let fallbackIntentSequence = 0;

function defaultIntentId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  fallbackIntentSequence += 1;
  return `planner-intent-${Date.now()}-${fallbackIntentSequence}`;
}

export function plannerProgressPreview(target: PlannerProgressTarget): PlannerProgressPreview | null {
  if (!target.authoritative || target.dayRelation !== "today" || target.kind !== "flexible-task") {
    return null;
  }
  if (target.progress.present === "unknown") {
    return (target.status === "open" && target.executionEligible) || target.status === "done"
      ? Object.freeze({ outcome: "pending" })
      : null;
  }
  if (target.status === "done") {
    return target.progress.present
      ? Object.freeze({ outcome: "conflict", reason: "done-with-progress" })
      : Object.freeze({ outcome: "reopened", percent: 10 });
  }
  if (target.status !== "open" || !target.executionEligible) return null;
  const rawPercent = target.progress.present ? target.progress.rawPercent : 0;
  if (!Number.isInteger(rawPercent) || rawPercent < 0) return null;
  const nextPercent = rawPercent + 10;
  if (nextPercent === 100) return Object.freeze({ outcome: "completed", percent: 100 });
  if (nextPercent > 100) return Object.freeze({ outcome: "cleared" });
  return Object.freeze({ outcome: "advanced", percent: nextPercent });
}

export function dispatchPlannerProgress(
  target: PlannerProgressTarget,
  dispatch: (progress: PlannerProgressDispatch) => void,
  createIntentId: () => string = defaultIntentId,
): boolean {
  const preview = plannerProgressPreview(target);
  if (!preview) return false;
  const progress = Object.freeze({
    intent: Object.freeze({
      intentId: createIntentId(),
      type: "advance-or-reopen-progress" as const,
      target: Object.freeze({
        blockId: target.blockId,
        itemId: target.itemId,
        path: target.path,
        sourceOrder: target.sourceOrder,
      }),
    }),
    preview,
    target,
  });
  dispatch(progress);
  return true;
}

function isActivationKey(event: KeyboardEvent): boolean {
  return event.key === "Enter" || event.key === " " || event.key === "Spacebar";
}

export function bindPlannerProgressTarget(
  element: HTMLElement | SVGElement,
  getTarget: () => PlannerProgressTarget,
  dispatch: (progress: PlannerProgressDispatch) => void,
  createIntentId?: () => string,
): () => void {
  const nativeButton = element.tagName.toLowerCase() === "button";
  const actionable = plannerProgressPreview(getTarget()) !== null;
  element.setAttribute("role", actionable ? "button" : "img");
  element.setAttribute("tabindex", "0");
  const activate = (): void => {
    dispatchPlannerProgress(getTarget(), dispatch, createIntentId);
  };
  const click = (): void => activate();
  const keydown = (event: Event): void => {
    const keyboardEvent = event as KeyboardEvent;
    if (nativeButton || !isActivationKey(keyboardEvent) || keyboardEvent.repeat) return;
    keyboardEvent.preventDefault();
    activate();
  };
  element.addEventListener("click", click);
  element.addEventListener("keydown", keydown);
  return () => {
    element.removeEventListener("click", click);
    element.removeEventListener("keydown", keydown);
  };
}

export const FORBIDDEN_LATER_MAIN_PLANNER_CONTROLS = Object.freeze(["tidy", "undo"] as const);
