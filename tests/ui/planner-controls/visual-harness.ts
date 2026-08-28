import { calculateCapacity } from "../../../src/core/capacity.ts";
import { projectDay, type LogicalDate } from "../../../src/core/day.ts";
import type { PlanItem, PlanItemStatus } from "../../../src/core/model.ts";
import { schedulePlan } from "../../../src/core/scheduler.ts";
import { createMessages } from "../../../src/i18n/resolver.ts";
import type { SupportedLocale } from "../../../src/i18n/types.ts";
import type {
  RuntimePlanItemSource,
  RuntimePlanProjection,
} from "../../../src/runtime/projection-runtime.ts";
import {
  confirmedSnapshot,
  createProjectionRevision,
  type RuntimeSnapshot,
} from "../../../src/runtime/snapshots.ts";
import {
  createMemoryPlannerCollapseStore,
  plannerProgressPreview,
  type PlannerProgressIntent,
  type PlannerProgressTarget,
} from "../../../src/ui/planner/controls.ts";
import {
  mountPlannerSurface,
  type PlannerIconName,
  type PlannerRuntimePort,
  type PlannerSurface,
} from "../../../src/ui/planner/view.ts";

type Theme = "custom" | "dark" | "high-contrast" | "light";

interface HarnessItem {
  readonly blockId: string;
  readonly durationMinutes: number;
  readonly endMinutes?: number;
  readonly kind: "fixed-event" | "flexible-task";
  readonly sourceOrder: number;
  readonly startMinutes?: number;
  readonly title: string;
  readonly urgent: boolean;
  completionAnchorMinutes?: number;
  progressRaw: number | null;
  status: PlanItemStatus;
}

interface HarnessSurfaceState {
  readonly buttonLabels: readonly string[];
  readonly clippedElements: number;
  readonly collapsed: boolean;
  readonly completedVisible: boolean;
  readonly controlOverlaps: number;
  readonly debugControlVisible: boolean;
  readonly debugEnabled: boolean;
  readonly focusKey: string | null;
  readonly horizontalOverflow: boolean;
  readonly layout: string | undefined;
  readonly semanticTargetCount: number;
  readonly surfaceRole: string | null;
  readonly playbackRunning: boolean;
  readonly tooltipVisible: boolean;
  readonly viewportClipped: boolean;
  readonly width: number;
  readonly warningsText: string;
}

interface HarnessState {
  readonly forbiddenControls: number;
  readonly intentCount: number;
  readonly items: readonly Readonly<Pick<HarnessItem, "blockId" | "progressRaw" | "status">>[];
  readonly liveText: string;
  readonly locale: SupportedLocale;
  readonly parseCount: number;
  readonly primary: HarnessSurfaceState;
  readonly projectionCount: number;
  readonly reducedMotion: boolean;
  readonly secondary: HarnessSurfaceState;
  readonly theme: Theme;
  readonly width: number;
  readonly zoom: number;
}

declare global {
  interface Window {
    issue24Harness: {
      activateProgress(id?: string): boolean;
      assertAcceptance(): HarnessState;
      assertConnectFailureState(): boolean;
      assertExternalFocusPreserved(): boolean;
      assertReplicaRemount(): boolean;
      assertTooltipClearsWhenHidden(): Promise<boolean>;
      focusProgress(id?: string): boolean;
      openDisclosure(key: "overflow" | "overview" | "schedule" | "warnings"): boolean;
      runMatrix(): Promise<readonly HarnessState[]>;
      setDebugEntry(enabled: boolean): void;
      setLocale(locale: SupportedLocale): void;
      setReducedMotion(enabled: boolean): void;
      setTheme(theme: Theme): void;
      setWidth(width: number): void;
      setZoom(zoom: 0.8 | 1 | 2): void;
      state(): HarnessState;
    };
  }
}

const DISPLAYED_DATE: LogicalDate = Object.freeze({ year: 2026, month: 8, day: 28 });
const BOUNDS = Object.freeze({ startMinutes: 5 * 60, endMinutes: 24 * 60 });
const SOURCE_PATH = "Journal/2026-08-28.md";

const localeSelect = document.querySelector<HTMLSelectElement>("#locale")!;
const widthSelect = document.querySelector<HTMLSelectElement>("#width")!;
const themeSelect = document.querySelector<HTMLSelectElement>("#theme")!;
const zoomSelect = document.querySelector<HTMLSelectElement>("#zoom")!;
const motionInput = document.querySelector<HTMLInputElement>("#motion")!;
const debugEntryInput = document.querySelector<HTMLInputElement>("#debug-entry")!;
const stage = document.querySelector<HTMLElement>("#harness-stage")!;
const primaryLeaf = document.querySelector<HTMLElement>("#primary-leaf")!;
const secondaryLeaf = document.querySelector<HTMLElement>("#secondary-leaf")!;
const primaryRoot = document.querySelector<HTMLElement>("#primary-planner")!;
const secondaryRoot = document.querySelector<HTMLElement>("#secondary-planner")!;

const messages = createMessages();
const collapseStore = createMemoryPlannerCollapseStore();
const motionPreference = matchMedia("(prefers-reduced-motion: reduce)");
const listeners = new Set<(snapshot: RuntimeSnapshot<RuntimePlanProjection>) => void>();
let width = 900;
let zoom: 0.8 | 1 | 2 = 1;
let theme: Theme = "light";
let reducedMotion = motionPreference.matches;
let debugEntry = false;
let generation = 0;
let intentCount = 0;
let projectionCount = 1;
const parseCount = 1;

const items: HarnessItem[] = [
  {
    blockId: "nl-draft",
    durationMinutes: 30,
    kind: "flexible-task",
    progressRaw: 40,
    sourceOrder: 0,
    status: "open",
    title: "Deep work proposal with a long Latin label",
    urgent: false,
  },
  {
    blockId: "nl-urgent",
    durationMinutes: 45,
    kind: "flexible-task",
    progressRaw: 90,
    sourceOrder: 1,
    status: "open",
    title: "发布前检查与长中文标题",
    urgent: true,
  },
  {
    blockId: "nl-review",
    durationMinutes: 60,
    endMinutes: 15 * 60,
    kind: "fixed-event",
    progressRaw: null,
    sourceOrder: 2,
    startMinutes: 14 * 60,
    status: "plain",
    title: "Client review",
    urgent: false,
  },
  {
    blockId: "nl-overlap",
    durationMinutes: 60,
    endMinutes: 15 * 60 + 30,
    kind: "fixed-event",
    progressRaw: null,
    sourceOrder: 3,
    startMinutes: 14 * 60 + 30,
    status: "plain",
    title: "Conflicting design review",
    urgent: false,
  },
  {
    blockId: "nl-complete",
    completionAnchorMinutes: 7 * 60,
    durationMinutes: 30,
    kind: "flexible-task",
    progressRaw: null,
    sourceOrder: 4,
    status: "done",
    title: "Completed morning setup",
    urgent: false,
  },
  {
    blockId: "nl-overflow",
    durationMinutes: 11 * 60,
    kind: "flexible-task",
    progressRaw: null,
    sourceOrder: 5,
    status: "open",
    title: "Large overflow task remains visible",
    urgent: false,
  },
];

function source(item: HarnessItem): RuntimePlanItemSource {
  return Object.freeze({ path: SOURCE_PATH, blockId: item.blockId, sourceOrder: item.sourceOrder });
}

function planItem(item: HarnessItem): PlanItem<RuntimePlanItemSource> {
  const progressPercent = item.progressRaw ?? 0;
  const common = {
    source: source(item),
    sourceOrder: item.sourceOrder,
    status: item.status,
    label: item.title,
    durationMinutes: item.durationMinutes,
    progressPercent,
    remainingDurationMinutes: Math.max(0, Math.round(item.durationMinutes * (100 - progressPercent) / 100)),
    urgent: item.urgent,
    executionEligible: item.kind === "flexible-task" && item.status === "open",
    tokens: Object.freeze({}),
  } as const;
  return item.kind === "fixed-event"
    ? Object.freeze({
      ...common,
      kind: "fixed-event" as const,
      startMinutes: item.startMinutes!,
      endMinutes: item.endMinutes!,
    })
    : Object.freeze({
      ...common,
      kind: "flexible-task" as const,
      ...(item.completionAnchorMinutes === undefined
        ? {}
        : { completionAnchorMinutes: item.completionAnchorMinutes }),
    });
}

function projection(): RuntimePlanProjection {
  const projectedItems = Object.freeze(items.map(planItem));
  const day = projectDay({
    displayedDate: DISPLAYED_DATE,
    today: DISPLAYED_DATE,
    ...BOUNDS,
    nowMinutes: 13 * 60,
  });
  const scheduleInput = { ...BOUNDS, nowMinutes: day.scheduleFromMinutes, items: projectedItems };
  return Object.freeze({
    contextKey: "2026-08-28",
    sourcePath: SOURCE_PATH,
    sourceFingerprint: `sha256:harness-${projectionCount}`,
    displayedDate: DISPLAYED_DATE,
    today: DISPLAYED_DATE,
    items: projectedItems,
    diagnostics: Object.freeze([
      Object.freeze({ code: "duplicate-plan-region", sourceOrder: null }),
      Object.freeze({ code: "same-time", sourceOrder: 3 }),
      Object.freeze({ code: "overnight-truncated", sourceOrder: 2 }),
    ]),
    day,
    schedule: schedulePlan(scheduleInput),
    capacity: calculateCapacity(scheduleInput),
  });
}

function currentSnapshot(): RuntimeSnapshot<RuntimePlanProjection> {
  generation += 1;
  return confirmedSnapshot(createProjectionRevision({
    generation,
    path: SOURCE_PATH,
    sourceFingerprint: `sha256:harness-${projectionCount}`,
    settingsVersion: 1,
    logicalDate: DISPLAYED_DATE,
    minuteBucket: 13 * 60,
    timeZone: "Asia/Shanghai",
    grammarVersion: "v1",
  }), projection());
}

function emitProjection(): void {
  projectionCount += 1;
  const snapshot = currentSnapshot();
  for (const listener of listeners) listener(snapshot);
}

const runtime: PlannerRuntimePort = {
  state: "ready",
  connect(_context, listener, visible = true) {
    listeners.add(listener);
    if (visible) listener(currentSnapshot());
    return Object.freeze({
      setContext() {},
      setVisible(nextVisible: boolean) {
        if (nextVisible) listener(currentSnapshot());
      },
      refresh() {
        listener(currentSnapshot());
      },
      disconnect() {
        listeners.delete(listener);
      },
    });
  },
};

function targetFor(item: HarnessItem): PlannerProgressTarget {
  return Object.freeze({
    authoritative: true,
    blockId: item.blockId,
    dayRelation: "today",
    executionEligible: item.kind === "flexible-task" && item.status === "open",
    itemId: item.blockId,
    kind: item.kind,
    path: SOURCE_PATH,
    progress: item.progressRaw === null
      ? Object.freeze({ present: false as const })
      : Object.freeze({ present: true as const, rawPercent: item.progressRaw }),
    sourceOrder: item.sourceOrder,
    status: item.status,
    title: item.title,
  });
}

function applyIntent(intent: PlannerProgressIntent): void {
  intentCount += 1;
  const item = items.find((candidate) => candidate.blockId === intent.target.blockId);
  if (!item) return;
  const preview = plannerProgressPreview(targetFor(item));
  if (!preview || preview.outcome === "pending" || preview.outcome === "conflict") return;
  if (preview.outcome === "advanced") item.progressRaw = preview.percent;
  if (preview.outcome === "cleared") item.progressRaw = null;
  if (preview.outcome === "completed") {
    item.status = "done";
    item.progressRaw = null;
    item.completionAnchorMinutes = 13 * 60;
  }
  if (preview.outcome === "reopened") {
    item.status = "open";
    item.progressRaw = 10;
    delete item.completionAnchorMinutes;
  }
  emitProjection();
}

const iconGlyphs: Readonly<Record<PlannerIconName, string>> = Object.freeze({
  collapse: "^",
  debug: "#",
  expand: "v",
  "hide-completed": "o",
  "show-completed": "x",
  play: ">",
});

let primary: PlannerSurface;
let secondary: PlannerSurface;

function renderIcon(button: HTMLElement, icon: PlannerIconName): void {
  const glyph = document.createElement("span");
  glyph.className = "planner-icon";
  glyph.textContent = iconGlyphs[icon];
  glyph.setAttribute("aria-hidden", "true");
  button.append(glyph);
}

function mountSurfaces(): void {
  primary?.destroy();
  secondary?.destroy();
  const common = {
    collapseStore,
    debugControl: debugEntry,
    messages,
    onProgressIntent: applyIntent,
    reducedMotion,
    renderIcon,
  } as const;
  primary = mountPlannerSurface(primaryRoot, runtime, {
    logicalDate: DISPLAYED_DATE,
    bounds: BOUNDS,
    hostContext: "main",
  }, { ...common, instanceId: "issue24-primary" });
  secondary = mountPlannerSurface(secondaryRoot, runtime, {
    logicalDate: DISPLAYED_DATE,
    bounds: BOUNDS,
    hostContext: "sidebar",
  }, { ...common, instanceId: "issue24-secondary" });
}

function applyWidth(): void {
  primaryRoot.style.width = `${width + 20}px`;
  secondaryRoot.style.width = "340px";
  primaryLeaf.style.width = `${width + 23}px`;
  secondaryLeaf.style.width = "343px";
  primary?.measure();
  secondary?.measure();
}

function applyTheme(): void {
  document.body.classList.toggle("theme-dark", theme === "dark");
  document.body.classList.toggle("spiral-day-theme-high-contrast", theme === "high-contrast");
  document.body.classList.toggle("spiral-day-theme-custom", theme === "custom");
}

function applyZoom(): void {
  document.body.dataset.zoom = String(zoom);
  stage.style.zoom = String(zoom);
}

function overlaps(left: DOMRect, right: DOMRect): boolean {
  return left.left < right.right && left.right > right.left
    && left.top < right.bottom && left.bottom > right.top;
}

function measuredWidth(root: HTMLElement): number {
  const style = getComputedStyle(root);
  return root.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
}

function surfaceState(root: HTMLElement): HarnessSurfaceState {
  const rootBox = root.getBoundingClientRect();
  const candidates = [...root.querySelectorAll<Element>(
    "button, summary, [data-planner-focus-key], .spiral-day-planner__debug-overlay",
  )].filter((entry) => entry.getClientRects().length > 0);
  const controlBoxes = [...root.querySelectorAll<HTMLElement>(".spiral-day-planner__controls button")]
    .map((entry) => entry.getBoundingClientRect());
  let controlOverlaps = 0;
  for (let left = 0; left < controlBoxes.length; left += 1) {
    for (let right = left + 1; right < controlBoxes.length; right += 1) {
      if (overlaps(controlBoxes[left]!, controlBoxes[right]!)) controlOverlaps += 1;
    }
  }
  return Object.freeze({
    buttonLabels: Object.freeze([...root.querySelectorAll<HTMLButtonElement>("button")]
      .map((button) => button.getAttribute("aria-label") ?? "")),
    clippedElements: candidates.filter((entry) => {
      const box = entry.getBoundingClientRect();
      return box.left < rootBox.left - 1 || box.right > rootBox.right + 1;
    }).length,
    collapsed: Boolean(root.querySelector(".spiral-day-planner__collapsed-control")),
    completedVisible: Boolean(root.querySelector('[data-tone="completed"]')),
    controlOverlaps,
    debugControlVisible: Boolean(root.querySelector('[data-control="debug"]')),
    debugEnabled: Boolean(root.querySelector(".spiral-day-planner__debug-overlay")),
    focusKey: root.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.plannerFocusKey ?? null
      : null,
    horizontalOverflow: root.scrollWidth > root.clientWidth,
    layout: root.dataset.layout,
    semanticTargetCount: root.querySelectorAll(
      'svg[role="group"] [data-planner-focus-key][aria-label][role]',
    ).length,
    surfaceRole: root.querySelector("svg")?.getAttribute("role") ?? null,
    playbackRunning: root.querySelector('[data-control="play"]')?.getAttribute("aria-disabled") === "true",
    tooltipVisible: [...document.querySelectorAll<HTMLElement>(".spiral-day-planner__tooltip")]
      .some((tooltip) => !tooltip.hidden),
    viewportClipped: rootBox.width > 0
      && (rootBox.left < -1 || rootBox.right > window.innerWidth + 1),
    width: measuredWidth(root),
    warningsText: root.querySelector(".spiral-day-planner__warnings")?.textContent ?? "",
  });
}

function state(): HarnessState {
  return Object.freeze({
    forbiddenControls: document.querySelectorAll('[data-control="tidy"], [data-control="undo"]').length,
    intentCount,
    items: Object.freeze(items.map((item) => Object.freeze({
      blockId: item.blockId,
      progressRaw: item.progressRaw,
      status: item.status,
    }))),
    liveText: [...document.querySelectorAll<HTMLElement>(".spiral-day-planner__live-region")]
      .map((region) => region.textContent ?? "").filter(Boolean).join(" | "),
    locale: messages.locale,
    parseCount,
    primary: surfaceState(primaryRoot),
    projectionCount,
    reducedMotion,
    secondary: surfaceState(secondaryRoot),
    theme,
    width,
    zoom,
  });
}

function assertAcceptance(): HarnessState {
  const result = state();
  const expectedLayout = width <= 520 ? "compact" : "wide";
  if (result.primary.width !== width || result.primary.layout !== expectedLayout) {
    throw new Error(`boundary mismatch: ${JSON.stringify(result.primary)}`);
  }
  if (result.primary.horizontalOverflow || result.primary.clippedElements > 0
    || result.primary.controlOverlaps > 0 || result.primary.viewportClipped
    || result.forbiddenControls > 0) {
    throw new Error(`visual contract failed: ${JSON.stringify(result)}`);
  }
  if (result.parseCount !== 1 || result.primary.buttonLabels.some((label) => label === "")) {
    throw new Error(`i18n/control contract failed: ${JSON.stringify(result)}`);
  }
  if (result.primary.surfaceRole !== "group"
    || (expectedLayout === "wide" && result.primary.semanticTargetCount === 0)) {
    throw new Error(`accessibility tree contract failed: ${JSON.stringify(result.primary)}`);
  }
  if (!result.primary.warningsText.includes(
    messages.t("planner", "warning.planRegionDuplicate"),
  ) || !result.primary.warningsText.includes(messages.t("planner", "warning.sameTime"))) {
    throw new Error(`plan-region warning contract failed: ${JSON.stringify(result.primary)}`);
  }
  return result;
}

function progressElement(id: string): HTMLElement | null {
  return primaryRoot.querySelector<HTMLElement>(`[data-item-id="${id}"]`);
}

localeSelect.addEventListener("change", () => window.issue24Harness.setLocale(localeSelect.value as SupportedLocale));
widthSelect.addEventListener("change", () => window.issue24Harness.setWidth(Number(widthSelect.value)));
themeSelect.addEventListener("change", () => window.issue24Harness.setTheme(themeSelect.value as Theme));
zoomSelect.addEventListener("change", () => window.issue24Harness.setZoom(Number(zoomSelect.value) as 0.8 | 1 | 2));
motionInput.addEventListener("change", () => window.issue24Harness.setReducedMotion(motionInput.checked));
debugEntryInput.addEventListener("change", () => window.issue24Harness.setDebugEntry(debugEntryInput.checked));
motionPreference.addEventListener("change", (event) => window.issue24Harness.setReducedMotion(event.matches));

applyWidth();
applyTheme();
applyZoom();
mountSurfaces();

window.issue24Harness = {
  activateProgress(id = "nl-urgent") {
    const target = progressElement(id);
    target?.click();
    return target !== null;
  },
  assertAcceptance,
  assertConnectFailureState() {
    const root = document.createElement("div");
    root.style.width = "920px";
    document.body.append(root);
    const unavailableRuntime: PlannerRuntimePort = {
      state: "ready",
      connect() {
        throw new Error("intentional harness connection failure");
      },
    };
    const surface = mountPlannerSurface(root, unavailableRuntime, {
      logicalDate: DISPLAYED_DATE,
      bounds: BOUNDS,
      hostContext: "main",
    }, { instanceId: "issue24-connect-failure", messages, renderIcon });
    const status = root.querySelector<HTMLElement>('[data-state="unavailable"][role="alert"]');
    const passed = status?.textContent?.includes(messages.t("shared", "status.unavailable")) === true;
    surface.destroy();
    root.remove();
    return passed;
  },
  assertExternalFocusPreserved() {
    localeSelect.focus();
    const before = messages.locale;
    messages.setLocale(before === "en" ? "zh-CN" : "en");
    const preserved = document.activeElement === localeSelect;
    messages.setLocale(before);
    return preserved;
  },
  assertReplicaRemount() {
    const root = document.createElement("div");
    root.style.width = "920px";
    document.body.append(root);
    const replica = mountPlannerSurface(root, runtime, {
      logicalDate: DISPLAYED_DATE,
      bounds: BOUNDS,
      hostContext: "replica",
    }, { instanceId: "issue24-replica", messages, renderIcon });
    const replicaSuppressed = root.hidden;
    replica.destroy();
    const destroyClean = !root.hidden
      && !root.hasAttribute("aria-label")
      && root.dataset.layout === undefined
      && root.dataset.narrow === undefined;
    const main = mountPlannerSurface(root, runtime, {
      logicalDate: DISPLAYED_DATE,
      bounds: BOUNDS,
      hostContext: "main",
    }, { instanceId: "issue24-remounted-main", messages, renderIcon });
    const mainRendered = !root.hidden
      && root.dataset.layout === "wide"
      && root.querySelector('svg[role="group"]') !== null;
    main.destroy();
    root.remove();
    return replicaSuppressed && destroyClean && mainRendered;
  },
  async assertTooltipClearsWhenHidden() {
    this.setWidth(900);
    this.setDebugEntry(true);
    const target = progressElement("nl-draft");
    target?.focus();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    primaryLeaf.style.display = "none";
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    const content = primaryRoot.querySelector(".spiral-day-planner__content");
    const renderedChild = content?.firstElementChild;
    const originalLocale = messages.locale;
    messages.setLocale(originalLocale === "en" ? "zh-CN" : "en");
    secondaryRoot.querySelector<HTMLButtonElement>('[data-control="debug"]')?.click();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    const cleared = content?.firstElementChild === renderedChild
      && ![...document.querySelectorAll<HTMLElement>(".spiral-day-planner__tooltip")]
      .some((tooltip) => !tooltip.hidden);
    messages.setLocale(originalLocale);
    secondaryRoot.querySelector<HTMLButtonElement>('[data-control="debug"]')?.click();
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    primaryLeaf.style.display = "";
    await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    this.setDebugEntry(false);
    return cleared;
  },
  focusProgress(id = "nl-urgent") {
    const target = progressElement(id);
    target?.focus();
    return target !== null;
  },
  openDisclosure(key) {
    const summary = primaryRoot.querySelector<HTMLElement>(`.spiral-day-planner__${key} summary`);
    summary?.click();
    return summary !== null;
  },
  async runMatrix() {
    const results: HarnessState[] = [];
    for (const nextWidth of [300, 320, 360, 519, 520, 521, 900]) {
      for (const locale of ["en", "zh-CN"] as const) {
        for (const nextTheme of ["light", "dark", "high-contrast", "custom"] as const) {
          for (const nextZoom of [0.8, 1, 2] as const) {
            this.setWidth(nextWidth);
            this.setLocale(locale);
            this.setTheme(nextTheme);
            this.setZoom(nextZoom);
            await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
            results.push(assertAcceptance());
          }
        }
      }
    }
    return Object.freeze(results);
  },
  setDebugEntry(enabled) {
    debugEntry = enabled;
    debugEntryInput.checked = enabled;
    mountSurfaces();
  },
  setLocale(locale) {
    localeSelect.value = locale;
    document.documentElement.lang = locale;
    messages.setLocale(locale);
  },
  setReducedMotion(enabled) {
    reducedMotion = enabled;
    motionInput.checked = enabled;
    primary.setReducedMotion(enabled);
    secondary.setReducedMotion(enabled);
  },
  setTheme(nextTheme) {
    theme = nextTheme;
    themeSelect.value = nextTheme;
    applyTheme();
    primary.measure();
    secondary.measure();
  },
  setWidth(nextWidth) {
    if (![300, 320, 360, 519, 520, 521, 900].includes(nextWidth)) {
      throw new RangeError("Unsupported harness width");
    }
    width = nextWidth;
    widthSelect.value = String(nextWidth);
    applyWidth();
  },
  setZoom(nextZoom) {
    zoom = nextZoom;
    zoomSelect.value = String(nextZoom);
    applyZoom();
    primary.measure();
    secondary.measure();
  },
  state,
};
