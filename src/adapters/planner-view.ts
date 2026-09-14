import {
  ItemView,
  setIcon,
  type App,
  type IconName,
  type ViewStateResult,
  type WorkspaceLeaf,
} from "obsidian";
import type { LogicalDate } from "../core/day";
import type { PlannerSummaryCopyOutcome } from "../ui/planner/summary";
import {
  createMemoryPlannerCollapseStore,
  createMemoryPlannerCompletedVisibilityStore,
  type PlannerCollapseStore,
  type PlannerCompletedVisibilityStore,
  type PlannerProgressIntent,
} from "../ui/planner/controls";
import {
  mountPlannerSurface,
  validatePlannerViewContext,
  type PlannerIconName,
  type PlannerRuntimePort,
  type PlannerSurface,
  type PlannerViewContext,
} from "../ui/planner/view";

export const PLANNER_VIEW_TYPE = "spiral-day-planner";
export const MAX_PLANNER_LEAVES = 4;

export interface PlannerItemViewDependencies {
  readonly runtime: PlannerRuntimePort;
  readonly defaultLogicalDate: () => LogicalDate;
  readonly debugControl?: () => boolean;
  readonly copySummary?: (summary: string) => PlannerSummaryCopyOutcome | Promise<PlannerSummaryCopyOutcome>;
  readonly dispatchPlannerProgress?: (intent: PlannerProgressIntent) => void | Promise<void>;
  readonly locale?: () => string;
  readonly subscribeLocale?: (listener: (locale: string) => void) => () => void;
  readonly resolveContext: (
    logicalDate: LogicalDate,
    leaf: WorkspaceLeaf,
  ) => PlannerViewContext;
}

export interface OpenPlannerViewResult {
  readonly leaf: WorkspaceLeaf;
  readonly reused: boolean;
}

const ICONS: Readonly<Record<PlannerIconName, IconName>> = Object.freeze({
  collapse: "chevron-up",
  copy: "copy",
  debug: "bug",
  expand: "chevron-down",
  "hide-completed": "eye-off",
  "show-completed": "eye",
  play: "play",
  refresh: "refresh-cw",
});

const COLLAPSE_STORAGE_PREFIX = "spiral-day:planner-collapsed:";
const COMPLETED_VISIBILITY_STORAGE_PREFIX = "spiral-day:planner-show-completed:";
const ADAPTER_CLEANUP_DRAIN_ATTEMPTS = 3;
const transientCollapseStore = createMemoryPlannerCollapseStore();
const transientCompletedVisibilityStore = createMemoryPlannerCompletedVisibilityStore();
let plannerInstanceSequence = 0;

function createPlannerInstanceId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  plannerInstanceSequence += 1;
  return `planner-view-${Date.now()}-${plannerInstanceSequence}`;
}

function stateInstanceId(state: unknown): string | undefined {
  if (!state || typeof state !== "object" || Array.isArray(state)) return undefined;
  const value = (state as { readonly plannerInstanceId?: unknown }).plannerInstanceId;
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function collapseStore(storage: Storage | undefined): PlannerCollapseStore {
  if (!storage) return transientCollapseStore;
  return Object.freeze({
    load(instanceId: string) {
      try {
        const value = storage?.getItem(`${COLLAPSE_STORAGE_PREFIX}${instanceId}`);
        return value === "true" ? true : value === "false" ? false : undefined;
      } catch {
        return undefined;
      }
    },
    save(instanceId: string, collapsed: boolean) {
      storage.setItem(`${COLLAPSE_STORAGE_PREFIX}${instanceId}`, String(collapsed));
    },
  });
}

function completedVisibilityStore(storage: Storage | undefined): PlannerCompletedVisibilityStore {
  if (!storage) return transientCompletedVisibilityStore;
  return Object.freeze({
    load(instanceId: string) {
      try {
        const value = storage.getItem(`${COMPLETED_VISIBILITY_STORAGE_PREFIX}${instanceId}`);
        return value === "true" ? true : value === "false" ? false : undefined;
      } catch {
        return undefined;
      }
    },
    save(instanceId: string, showCompleted: boolean) {
      storage.setItem(`${COMPLETED_VISIBILITY_STORAGE_PREFIX}${instanceId}`, String(showCompleted));
    },
  });
}

function documentStorage(document: Document): Storage | undefined {
  try {
    return document.defaultView?.localStorage;
  } catch {
    return undefined;
  }
}

function validLogicalDate(value: unknown): LogicalDate | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const date = value as Partial<LogicalDate>;
  if (!Number.isInteger(date.year) || !Number.isInteger(date.month) || !Number.isInteger(date.day)) {
    return undefined;
  }
  const candidate = { year: date.year!, month: date.month!, day: date.day! };
  const utc = new Date(Date.UTC(candidate.year, candidate.month - 1, candidate.day));
  if (utc.getUTCFullYear() !== candidate.year
    || utc.getUTCMonth() + 1 !== candidate.month
    || utc.getUTCDate() !== candidate.day) return undefined;
  return Object.freeze(candidate);
}

function stateDate(state: unknown): LogicalDate | undefined {
  if (!state || typeof state !== "object" || Array.isArray(state)) return undefined;
  return validLogicalDate((state as { readonly logicalDate?: unknown }).logicalDate);
}

function defaultDate(dependencies: PlannerItemViewDependencies): LogicalDate {
  return validLogicalDate(dependencies.defaultLogicalDate())
    ?? Object.freeze({ year: 1970, month: 1, day: 1 });
}

function dateKey(date: LogicalDate): string {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}`
    + `-${String(date.day).padStart(2, "0")}`;
}

export class SpiralDayPlannerView extends ItemView {
  readonly #dependencies: PlannerItemViewDependencies;
  #logicalDate: LogicalDate;
  #plannerInstanceId = createPlannerInstanceId();
  #surface: PlannerSurface | undefined;
  #surfaceRoot: HTMLElement | undefined;
  #surfaceContext: PlannerViewContext | undefined;
  readonly #retiredLocaleUnsubscribes: Array<() => void> = [];
  readonly #retiredSurfaces: PlannerSurface[] = [];
  #localeUnsubscribe: (() => void) | undefined;

  constructor(leaf: WorkspaceLeaf, dependencies: PlannerItemViewDependencies) {
    super(leaf);
    this.#dependencies = dependencies;
    this.#logicalDate = defaultDate(dependencies);
  }

  override getViewType(): string {
    return PLANNER_VIEW_TYPE;
  }

  override getDisplayText(): string {
    return `Spiral Day - ${dateKey(this.#logicalDate)}`;
  }

  override getIcon(): IconName {
    return "shell";
  }

  override getState(): Record<string, unknown> {
    return {
      logicalDate: { ...this.#logicalDate },
      plannerInstanceId: this.#plannerInstanceId,
    };
  }

  override async setState(state: unknown, _result: ViewStateResult): Promise<void> {
    const previousInstanceId = this.#plannerInstanceId;
    const nextLogicalDate = stateDate(state) ?? defaultDate(this.#dependencies);
    const nextInstanceId = stateInstanceId(state) ?? previousInstanceId;
    const nextContext = validatePlannerViewContext(
      this.#dependencies.resolveContext(nextLogicalDate, this.leaf),
    );

    if (this.#surface && previousInstanceId !== nextInstanceId) {
      this.#replaceSurface(this.#stageSurface(nextContext, nextInstanceId));
    } else if (this.#surface) {
      this.#surface.setContext(nextContext);
    }

    this.#logicalDate = nextLogicalDate;
    this.#plannerInstanceId = nextInstanceId;
    this.#surfaceContext = this.#surface ? nextContext : undefined;
    this.#retryRetiredResources();
  }

  override onResize(): void {
    if (!this.#surface) return;
    const context = validatePlannerViewContext(
      this.#dependencies.resolveContext(this.#logicalDate, this.leaf),
    );
    this.#surface.setContext(context);
    this.#surfaceContext = context;
    this.#surface.measure();
  }

  protected override async onOpen(): Promise<void> {
    const previousLocaleUnsubscribe = this.#localeUnsubscribe;
    this.#localeUnsubscribe = undefined;
    if (previousLocaleUnsubscribe) this.#retireLocaleSubscription(previousLocaleUnsubscribe);
    this.#drainRetiredResources();
    this.contentEl.replaceChildren();
    this.contentEl.classList.add("spiral-day-planner-view");
    const context = validatePlannerViewContext(
      this.#dependencies.resolveContext(this.#logicalDate, this.leaf),
    );
    this.#replaceSurface(this.#stageSurface(context, this.#plannerInstanceId));
    this.#surfaceContext = context;
    this.#drainRetiredResources();
    this.#localeUnsubscribe = this.#dependencies.subscribeLocale?.((locale) => {
      this.#surface?.setLocale(locale);
    });
  }

  #stageSurface(
    context: PlannerViewContext,
    instanceId: string,
  ): Readonly<{ root: HTMLElement; surface: PlannerSurface }> {
    const root = this.contentEl.ownerDocument.createElement("div");
    root.classList.add("spiral-day-planner-view__surface");
    root.style.boxSizing = "border-box";
    root.style.width = "100%";
    root.style.display = "none";
    this.contentEl.append(root);
    try {
      const surface = mountPlannerSurface(
        root,
        this.#dependencies.runtime,
        context,
        {
          collapseStore: collapseStore(documentStorage(this.contentEl.ownerDocument)),
          completedVisibilityStore: completedVisibilityStore(documentStorage(this.contentEl.ownerDocument)),
          debugControl: this.#dependencies.debugControl?.() ?? false,
          instanceId,
          locale: this.#dependencies.locale?.() ?? "en",
          ...(this.#dependencies.copySummary
            ? { onCopySummary: this.#dependencies.copySummary }
            : {}),
          ...(this.#dependencies.dispatchPlannerProgress
            ? { onProgressIntent: this.#dependencies.dispatchPlannerProgress }
            : {}),
          renderIcon: (element, icon) => setIcon(element, ICONS[icon]),
        },
      );
      return Object.freeze({ root, surface });
    } catch (error) {
      root.remove();
      throw error;
    }
  }

  #replaceSurface(candidate: Readonly<{ root: HTMLElement; surface: PlannerSurface }>): void {
    const previousSurface = this.#surface;
    const previousRoot = this.#surfaceRoot;
    candidate.root.style.removeProperty("display");
    this.contentEl.replaceChildren(candidate.root);
    this.#surface = candidate.surface;
    this.#surfaceRoot = candidate.root;
    if (previousSurface) this.#retireSurface(previousSurface, previousRoot);
    try {
      candidate.surface.measure();
    } catch {
      // A later resize retries measurement without invalidating the committed surface swap.
    }
  }

  #retireSurface(surface: PlannerSurface, root?: HTMLElement): unknown {
    root?.remove();
    try {
      surface.destroy();
      return undefined;
    } catch (error) {
      if (!this.#retiredSurfaces.includes(surface)) this.#retiredSurfaces.push(surface);
      return error;
    }
  }

  #retireLocaleSubscription(unsubscribe: () => void): unknown {
    try {
      unsubscribe();
      return undefined;
    } catch (error) {
      if (!this.#retiredLocaleUnsubscribes.includes(unsubscribe)) {
        this.#retiredLocaleUnsubscribes.push(unsubscribe);
      }
      return error;
    }
  }

  #retryRetiredResources(attempts = 1): readonly unknown[] {
    let errors: unknown[] = [];
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      if (this.#retiredLocaleUnsubscribes.length === 0 && this.#retiredSurfaces.length === 0) break;
      errors = [];
      const localeUnsubscribes = this.#retiredLocaleUnsubscribes.splice(0);
      for (const unsubscribe of localeUnsubscribes) {
        const error = this.#retireLocaleSubscription(unsubscribe);
        if (error !== undefined) errors.push(error);
      }
      const surfaces = this.#retiredSurfaces.splice(0);
      for (const surface of surfaces) {
        const error = this.#retireSurface(surface);
        if (error !== undefined) errors.push(error);
      }
    }
    return errors;
  }

  #drainRetiredResources(): void {
    const errors = this.#retryRetiredResources(ADAPTER_CLEANUP_DRAIN_ATTEMPTS);
    if (this.#retiredLocaleUnsubscribes.length > 0 || this.#retiredSurfaces.length > 0) {
      throw new AggregateError(errors, "Planner adapter cleanup remains incomplete");
    }
  }

  protected override async onClose(): Promise<void> {
    const localeUnsubscribe = this.#localeUnsubscribe;
    this.#localeUnsubscribe = undefined;
    if (localeUnsubscribe) this.#retireLocaleSubscription(localeUnsubscribe);
    const surface = this.#surface;
    const root = this.#surfaceRoot;
    this.#surface = undefined;
    this.#surfaceRoot = undefined;
    if (surface) this.#retireSurface(surface, root);
    this.#surfaceContext = undefined;
    this.contentEl.classList.remove("spiral-day-planner-view");
    this.#drainRetiredResources();
  }
}

export function createPlannerViewFactory(
  dependencies: PlannerItemViewDependencies,
): (leaf: WorkspaceLeaf) => SpiralDayPlannerView {
  return (leaf) => new SpiralDayPlannerView(leaf, dependencies);
}

function leafDate(leaf: WorkspaceLeaf): LogicalDate | undefined {
  return stateDate(leaf.getViewState().state);
}

function chooseExistingLeaf(
  leaves: readonly WorkspaceLeaf[],
  logicalDate: LogicalDate,
): WorkspaceLeaf {
  const targetKey = dateKey(logicalDate);
  return leaves.find((leaf) => {
    const date = leafDate(leaf);
    return date !== undefined && dateKey(date) === targetKey;
  }) ?? leaves[0]!;
}

export async function openPlannerView(
  app: App,
  logicalDate: LogicalDate,
): Promise<OpenPlannerViewResult> {
  const validatedDate = validLogicalDate(logicalDate);
  if (!validatedDate) throw new RangeError("Cannot open the planner for an invalid date");
  const existing = app.workspace.getLeavesOfType(PLANNER_VIEW_TYPE);
  if (existing.length >= MAX_PLANNER_LEAVES) {
    const leaf = chooseExistingLeaf(existing, validatedDate);
    await app.workspace.revealLeaf(leaf);
    app.workspace.setActiveLeaf(leaf, { focus: true });
    return Object.freeze({ leaf, reused: true });
  }

  const leaf = app.workspace.getLeaf("tab");
  await leaf.setViewState({
    type: PLANNER_VIEW_TYPE,
    active: true,
    state: { logicalDate: { ...validatedDate } },
  });
  await app.workspace.revealLeaf(leaf);
  app.workspace.setActiveLeaf(leaf, { focus: true });
  return Object.freeze({ leaf, reused: false });
}
