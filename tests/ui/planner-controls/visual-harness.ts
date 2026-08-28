import { calculateCapacity } from "../../../src/core/capacity.ts";
import { projectDay, type LogicalDate } from "../../../src/core/day.ts";
import type { PlanItem, PlanItemStatus } from "../../../src/core/model.ts";
import { schedulePlan } from "../../../src/core/scheduler.ts";
import {
  createPlannerViewFactory,
  type PlannerItemViewDependencies,
  type SpiralDayPlannerView,
} from "../../../src/adapters/planner-view.ts";
import { setIcon } from "obsidian";
import { createMessages } from "../../../src/i18n/resolver.ts";
import type { SupportedLocale } from "../../../src/i18n/types.ts";
import type {
  RuntimePlanItemSource,
  RuntimePlanProjection,
} from "../../../src/runtime/projection-runtime.ts";
import {
  confirmedSnapshot,
  createProjectionRevision,
  loadingSnapshot,
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
import { constrainedPlannerContentWidth } from "./harness-layout.ts";

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
  readonly debugCenterMarkers: number;
  readonly debugGeometryGroups: number;
  readonly debugGuideCircles: number;
  readonly debugRectangles: number;
  readonly debugValues: string;
  readonly duplicateFocusKeys: number;
  readonly focusKey: string | null;
  readonly horizontalOverflow: boolean;
  readonly layout: string | undefined;
  readonly motionTransitionsDisabled: boolean;
  readonly overviewMetricClipped: boolean;
  readonly overviewMetricLabels: readonly string[];
  readonly overviewOpen: boolean;
  readonly renderedContrast: Readonly<{
    readonly control: number;
    readonly focus: number;
    readonly state: number;
    readonly text: number;
  }>;
  readonly semanticTargetCount: number;
  readonly surfaceRole: string | null;
  readonly playbackRunning: boolean;
  readonly scheduleOpen: boolean;
  readonly tooltipVisible: boolean;
  readonly visible: boolean;
  readonly viewportClipped: boolean;
  readonly width: number | null;
  readonly warningsText: string;
}

interface HarnessState {
  readonly documentHorizontalOverflow: boolean;
  readonly forbiddenControls: number;
  readonly intentCount: number;
  readonly items: readonly Readonly<Pick<HarnessItem, "blockId" | "progressRaw" | "status">>[];
  readonly liveText: string;
  readonly locale: SupportedLocale;
  readonly primary: HarnessSurfaceState;
  readonly projectionCallCount: number;
  readonly reducedMotion: boolean;
  readonly secondary: HarnessSurfaceState;
  readonly stageHorizontalOverflow: boolean;
  readonly theme: Theme;
  readonly tooltipViewportClipped: boolean;
  readonly width: number;
  readonly zoom: number;
}

declare global {
  interface Window {
    issue24Harness: {
      activateProgress(id?: string): boolean;
      assertAdapterLifecycle(): Promise<Readonly<Record<string, boolean>>>;
      assertAcceptance(): HarnessState;
      assertConnectFailureState(): boolean;
      assertRuntimeProbeInterval(): boolean;
      assertExternalFocusPreserved(): boolean;
      assertKeyboardPointerParity(): Promise<boolean>;
      assertLayoutFocusRestoration(): Promise<boolean>;
      assertLifecycleReparenting(): Promise<boolean>;
      assertMediaQueryLifecycle(): Promise<boolean>;
      assertPlaybackStopsOnContextChange(): Promise<boolean>;
      assertPlaybackStopsOnRuntimeState(): Promise<boolean>;
      assertReplicaRemount(): boolean;
      assertTooltipClearsWhenHidden(): Promise<boolean>;
      closeAdapterEvidence(): Promise<void>;
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
const stageShell = document.querySelector<HTMLElement>(".harness-stage-shell")!;
const primaryLeaf = document.querySelector<HTMLElement>("#primary-leaf")!;
const secondaryLeaf = document.querySelector<HTMLElement>("#secondary-leaf")!;
const primaryRoot = document.querySelector<HTMLElement>("#primary-planner")!;
const secondaryRoot = document.querySelector<HTMLElement>("#secondary-planner")!;
const adapterLeaf = document.querySelector<HTMLElement>("#adapter-leaf")!;
const adapterRoot = document.querySelector<HTMLElement>("#adapter-planner")!;

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
let projectionCallCount = 0;
let revisionSequence = 1;
let adapterView: SpiralDayPlannerView | undefined;
let adapterIntentCount = 0;
let adapterLocale: SupportedLocale = "en";
const adapterLocaleListeners = new Set<(locale: string) => void>();

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
  projectionCallCount += 1;
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
    sourceFingerprint: `sha256:harness-${revisionSequence}`,
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
    sourceFingerprint: `sha256:harness-${revisionSequence}`,
    settingsVersion: 1,
    logicalDate: DISPLAYED_DATE,
    minuteBucket: 13 * 60,
    timeZone: "Asia/Shanghai",
    grammarVersion: "v1",
  }), projection());
}

function emitProjection(): void {
  revisionSequence += 1;
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

const obsidianIconNames: Readonly<Record<PlannerIconName, string>> = Object.freeze({
  collapse: "chevron-up",
  debug: "bug",
  expand: "chevron-down",
  "hide-completed": "eye-off",
  "show-completed": "eye",
  play: "play",
});

let primary: PlannerSurface;
let secondary: PlannerSurface;

function renderIcon(button: HTMLElement, icon: PlannerIconName): void {
  setIcon(button, obsidianIconNames[icon]);
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
  const shellStyle = getComputedStyle(stageShell);
  const availableInlineSize = stageShell.clientWidth
    - Number.parseFloat(shellStyle.paddingLeft)
    - Number.parseFloat(shellStyle.paddingRight);
  const contentWidth = constrainedPlannerContentWidth(width, availableInlineSize);
  primaryRoot.style.width = `${contentWidth + 20}px`;
  secondaryRoot.style.width = "340px";
  primaryLeaf.style.width = `${contentWidth + 23}px`;
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
  const layoutViewportWidth = window.innerWidth / zoom;
  document.body.dataset.zoom = String(zoom);
  document.body.dataset.layoutViewport = layoutViewportWidth <= 760
    ? "small"
    : layoutViewportWidth <= 940
      ? "medium"
      : "wide";
  document.body.style.inlineSize = `${layoutViewportWidth}px`;
  document.body.style.minBlockSize = `${window.innerHeight / zoom}px`;
  document.body.style.zoom = String(zoom);
  stage.style.zoom = "";
  applyWidth();
}

function overlaps(left: DOMRect, right: DOMRect): boolean {
  return left.left < right.right && left.right > right.left
    && left.top < right.bottom && left.bottom > right.top;
}

function measuredWidth(root: HTMLElement): number {
  const style = getComputedStyle(root);
  return root.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight);
}

type Rgba = readonly [red: number, green: number, blue: number, alpha: number];

function parsedColor(value: string): Rgba {
  if (value === "transparent") return [0, 0, 0, 0];
  const hex = value.match(/^#([0-9a-f]{6})([0-9a-f]{2})?$/i);
  if (hex) {
    const color = hex[1]!;
    return [
      Number.parseInt(color.slice(0, 2), 16),
      Number.parseInt(color.slice(2, 4), 16),
      Number.parseInt(color.slice(4, 6), 16),
      hex[2] ? Number.parseInt(hex[2], 16) / 255 : 1,
    ];
  }
  const components = value.match(/[\d.]+/g)?.map(Number);
  if (!components || components.length < 3) throw new Error(`Unsupported computed color: ${value}`);
  return [components[0]!, components[1]!, components[2]!, components[3] ?? 1];
}

function composite(foreground: Rgba, background: Rgba): Rgba {
  const alpha = foreground[3] + background[3] * (1 - foreground[3]);
  if (alpha === 0) return [0, 0, 0, 0];
  return [
    (foreground[0] * foreground[3] + background[0] * background[3] * (1 - foreground[3])) / alpha,
    (foreground[1] * foreground[3] + background[1] * background[3] * (1 - foreground[3])) / alpha,
    (foreground[2] * foreground[3] + background[2] * background[3] * (1 - foreground[3])) / alpha,
    alpha,
  ];
}

function effectiveBackground(element: Element): Rgba {
  let result: Rgba = [0, 0, 0, 0];
  let current: Element | null = element;
  while (current) {
    result = composite(result, parsedColor(getComputedStyle(current).backgroundColor));
    current = current.parentElement;
  }
  return composite(result, [255, 255, 255, 1]);
}

function relativeLuminance(color: Rgba): number {
  const channels = color.slice(0, 3).map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0]! + 0.7152 * channels[1]! + 0.0722 * channels[2]!;
}

function contrastRatio(first: Rgba, second: Rgba): number {
  const opaqueFirst = composite(first, second);
  const firstLuminance = relativeLuminance(opaqueFirst);
  const secondLuminance = relativeLuminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05)
    / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

function renderedContrast(root: HTMLElement): HarnessSurfaceState["renderedContrast"] {
  const visibleText = [...root.querySelectorAll<HTMLElement>(
    ".spiral-day-planner__metric-label, .spiral-day-planner__disclosure-summary, "
      + ".spiral-day-planner__interactive-item-title, .spiral-day-planner__row-title",
  )].filter((entry) => entry.getClientRects().length > 0 && entry.textContent?.trim());
  const textRatios = visibleText.map((entry) => contrastRatio(
    parsedColor(getComputedStyle(entry).color),
    effectiveBackground(entry),
  ));
  const controlProbe = document.createElement("span");
  controlProbe.style.backgroundColor = "var(--spiral-day-control-surface)";
  controlProbe.style.border = "1px solid var(--spiral-day-control-border)";
  root.append(controlProbe);
  const controlRatio = contrastRatio(
    parsedColor(getComputedStyle(controlProbe).borderTopColor),
    effectiveBackground(controlProbe),
  );
  const stateBoundaries = [
    ...root.querySelectorAll<SVGElement>(".spiral-day-planner__item-path"),
    ...root.querySelectorAll<HTMLElement>(".spiral-day-planner__interactive-item"),
  ].filter((entry) => entry.getClientRects().length > 0);
  const stateRatios = stateBoundaries.map((entry) => {
    const style = getComputedStyle(entry);
    const value = entry instanceof SVGElement ? style.stroke : style.borderLeftColor;
    return contrastRatio(parsedColor(value), effectiveBackground(entry));
  });
  const focusProbe = document.createElement("span");
  focusProbe.style.backgroundColor = "transparent";
  focusProbe.style.outline = "1px solid var(--spiral-day-focus)";
  root.append(focusProbe);
  const focusRatio = contrastRatio(
    parsedColor(getComputedStyle(focusProbe).outlineColor),
    effectiveBackground(focusProbe),
  );
  controlProbe.remove();
  focusProbe.remove();
  return Object.freeze({
    control: controlRatio,
    focus: focusRatio,
    state: stateRatios.length > 0 ? Math.min(...stateRatios) : Number.POSITIVE_INFINITY,
    text: textRatios.length > 0 ? Math.min(...textRatios) : Number.POSITIVE_INFINITY,
  });
}

function surfaceState(root: HTMLElement): HarnessSurfaceState {
  const visible = root.getClientRects().length > 0;
  const rootBox = root.getBoundingClientRect();
  const candidates = [...root.querySelectorAll<Element>(
    "button, summary, [data-planner-focus-key], .spiral-day-planner__debug-overlay",
  )].filter((entry) => entry.getClientRects().length > 0);
  const controlBoxes = [...root.querySelectorAll<HTMLElement>(".spiral-day-planner__controls button")]
    .map((entry) => entry.getBoundingClientRect());
  const overview = root.querySelector<HTMLDetailsElement>(".spiral-day-planner__overview");
  const overviewMetricLabels = [...root.querySelectorAll<HTMLElement>(
    ".spiral-day-planner__overview .spiral-day-planner__metric-label",
  )];
  const overviewBox = overview?.getBoundingClientRect();
  const icon = root.querySelector<HTMLElement>(".spiral-day-planner__icon-button");
  const focusKeys = [...root.querySelectorAll<HTMLElement>("[data-planner-focus-key]")]
    .map((entry) => entry.dataset.plannerFocusKey).filter((key): key is string => Boolean(key));
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
    debugCenterMarkers: root.querySelectorAll(
      'svg.spiral-day-planner__spiral .spiral-day-planner__debug-center-marker[data-debug-marker="center"]',
    ).length,
    debugGeometryGroups: root.querySelectorAll(
      'svg.spiral-day-planner__spiral .spiral-day-planner__debug-geometry[data-debug-geometry="true"]',
    ).length,
    debugGuideCircles: root.querySelectorAll(
      'svg.spiral-day-planner__spiral .spiral-day-planner__debug-guide-circle[data-debug-marker="guide-circle"]',
    ).length,
    debugRectangles: root.querySelectorAll(
      'svg.spiral-day-planner__spiral .spiral-day-planner__debug-rectangle[data-debug-marker]',
    ).length,
    debugValues: root.querySelector(".spiral-day-planner__debug-overlay")?.textContent ?? "",
    duplicateFocusKeys: focusKeys.length - new Set(focusKeys).size,
    focusKey: root.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.plannerFocusKey ?? null
      : null,
    horizontalOverflow: visible && root.scrollWidth > root.clientWidth,
    layout: root.dataset.layout,
    motionTransitionsDisabled: icon === null || getComputedStyle(icon).transitionDuration
      .split(",").every((duration) => Number.parseFloat(duration) === 0),
    overviewMetricClipped: Boolean(overview?.open && overviewBox) && overviewMetricLabels.some((label) => {
      const box = label.getBoundingClientRect();
      return label.getClientRects().length === 0
        || label.scrollWidth > label.clientWidth + 1
        || box.left < overviewBox!.left - 1
        || box.right > overviewBox!.right + 1;
    }),
    overviewMetricLabels: Object.freeze(overviewMetricLabels.map((label) => label.textContent ?? "")),
    overviewOpen: overview?.open ?? false,
    renderedContrast: renderedContrast(root),
    semanticTargetCount: root.querySelectorAll(
      'svg.spiral-day-planner__spiral[role="group"] [data-planner-focus-key][aria-label][role]',
    ).length,
    surfaceRole: root.querySelector("svg.spiral-day-planner__spiral")?.getAttribute("role") ?? null,
    playbackRunning: root.querySelector('[data-control="play"]')?.getAttribute("aria-disabled") === "true",
    scheduleOpen: root.querySelector<HTMLDetailsElement>(".spiral-day-planner__schedule")?.open ?? false,
    tooltipVisible: [...document.querySelectorAll<HTMLElement>(".spiral-day-planner__tooltip")]
      .some((tooltip) => !tooltip.hidden),
    visible,
    viewportClipped: visible && rootBox.width > 0
      && (rootBox.left < -1 || rootBox.right > window.innerWidth + 1),
    width: visible ? measuredWidth(root) : null,
    warningsText: root.querySelector(".spiral-day-planner__warnings")?.textContent ?? "",
  });
}

function state(): HarnessState {
  const tooltipViewportClipped = [...document.querySelectorAll<HTMLElement>(
    ".spiral-day-planner__tooltip",
  )].some((tooltip) => {
    if (tooltip.hidden) return false;
    const box = tooltip.getBoundingClientRect();
    return box.left < -1 || box.right > window.innerWidth + 1
      || box.top < -1 || box.bottom > window.innerHeight + 1;
  });
  return Object.freeze({
    documentHorizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
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
    primary: surfaceState(primaryRoot),
    projectionCallCount,
    reducedMotion,
    secondary: surfaceState(secondaryRoot),
    stageHorizontalOverflow: stageShell.scrollWidth > stageShell.clientWidth,
    theme,
    tooltipViewportClipped,
    width,
    zoom,
  });
}

function assertAcceptance(): HarnessState {
  const result = state();
  const shellStyle = getComputedStyle(stageShell);
  const expectedWidth = constrainedPlannerContentWidth(
    width,
    stageShell.clientWidth
      - Number.parseFloat(shellStyle.paddingLeft)
      - Number.parseFloat(shellStyle.paddingRight),
  );
  const expectedLayout = expectedWidth <= 520 ? "compact" : "wide";
  if (!result.primary.visible
    || result.primary.width !== expectedWidth
    || result.primary.layout !== expectedLayout) {
    throw new Error(`boundary mismatch: ${JSON.stringify(result.primary)}`);
  }
  if (result.primary.horizontalOverflow || result.primary.clippedElements > 0
    || result.primary.controlOverlaps > 0 || result.primary.viewportClipped
    || result.primary.duplicateFocusKeys > 0 || result.secondary.duplicateFocusKeys > 0
    || result.documentHorizontalOverflow || result.stageHorizontalOverflow
    || result.tooltipViewportClipped || result.forbiddenControls > 0) {
    throw new Error(`visual contract failed: ${JSON.stringify(result)}`);
  }
  if (zoom === 2 && (result.secondary.visible || result.secondary.width !== null)) {
    throw new Error(`hidden secondary measurement failed: ${JSON.stringify(result.secondary)}`);
  }
  if (result.primary.buttonLabels.some((label) => label === "")) {
    throw new Error(`i18n/control contract failed: ${JSON.stringify(result)}`);
  }
  if (result.projectionCallCount < 1) {
    throw new Error(`runtime projection contract failed: ${JSON.stringify(result)}`);
  }
  if (reducedMotion && (!result.primary.motionTransitionsDisabled
    || primaryRoot.dataset.reducedMotion !== "true")) {
    throw new Error(`reduced-motion contract failed: ${JSON.stringify(result.primary)}`);
  }
  if ([300, 320, 360].includes(expectedWidth)
    && (!result.primary.overviewOpen
      || result.primary.overviewMetricLabels.length !== 4
      || result.primary.overviewMetricLabels.some((label) => label.trim() === "")
      || result.primary.overviewMetricClipped)) {
    throw new Error(`overview metric contract failed: ${JSON.stringify(result.primary)}`);
  }
  if (result.primary.surfaceRole !== "group"
    || (expectedLayout === "wide" && result.primary.semanticTargetCount === 0)) {
    throw new Error(`accessibility tree contract failed: ${JSON.stringify(result.primary)}`);
  }
  if ((expectedLayout === "compact" && !result.primary.scheduleOpen)
    || result.secondary.scheduleOpen) {
    throw new Error(`compact Schedule default contract failed: ${JSON.stringify({
      primary: result.primary.scheduleOpen,
      secondary: result.secondary.scheduleOpen,
    })}`);
  }
  if (result.primary.renderedContrast.text < 4.5
    || result.primary.renderedContrast.control < 3
    || result.primary.renderedContrast.state < 3
    || result.primary.renderedContrast.focus < 3) {
    throw new Error(`rendered contrast contract failed: ${JSON.stringify(result.primary.renderedContrast)}`);
  }
  if (!result.primary.warningsText.includes(
    messages.t("planner", "warning.planRegionDuplicate"),
  ) || !result.primary.warningsText.includes(messages.t("planner", "warning.sameTime"))) {
    throw new Error(`plan-region warning contract failed: ${JSON.stringify(result.primary)}`);
  }
  return result;
}

function progressElement(id: string): HTMLElement | SVGElement | null {
  return primaryRoot.querySelector<HTMLElement | SVGElement>(`[data-item-id="${id}"]`);
}

function dispatchPointerActivation(target: Element | null): boolean {
  return target?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })) ?? false;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
}

localeSelect.addEventListener("change", () => window.issue24Harness.setLocale(localeSelect.value as SupportedLocale));
widthSelect.addEventListener("change", () => window.issue24Harness.setWidth(Number(widthSelect.value)));
themeSelect.addEventListener("change", () => window.issue24Harness.setTheme(themeSelect.value as Theme));
zoomSelect.addEventListener("change", () => window.issue24Harness.setZoom(Number(zoomSelect.value) as 0.8 | 1 | 2));
motionInput.addEventListener("change", () => window.issue24Harness.setReducedMotion(motionInput.checked));
debugEntryInput.addEventListener("change", () => window.issue24Harness.setDebugEntry(debugEntryInput.checked));
motionPreference.addEventListener("change", (event) => window.issue24Harness.setReducedMotion(event.matches));

applyTheme();
applyZoom();
mountSurfaces();
window.addEventListener("resize", applyZoom);

window.issue24Harness = {
  activateProgress(id = "nl-urgent") {
    const target = progressElement(id);
    dispatchPointerActivation(target);
    return target !== null;
  },
  async assertAdapterLifecycle() {
    await this.closeAdapterEvidence();
    this.setZoom(1);
    this.setWidth(521);
    adapterLeaf.hidden = false;
    adapterRoot.style.boxSizing = "border-box";
    adapterRoot.style.width = "520px";
    adapterIntentCount = 0;
    adapterLocale = "en";
    let adapterHostContext: "main" | "sidebar" = "main";
    const ordinaryDebugAbsent = primaryRoot.querySelector('[data-control="debug"]') === null;
    const identitySuffix = String(Date.now());
    const identityA = `browser-adapter-a-${identitySuffix}`;
    const identityB = `browser-adapter-b-${identitySuffix}`;
    const leaf = {
      contentEl: adapterRoot,
      getViewState: () => ({ state: {} }),
    };
    const dependencies: PlannerItemViewDependencies = {
      runtime,
      defaultLogicalDate: () => DISPLAYED_DATE,
      debugControl: () => true,
      dispatchPlannerProgress: () => { adapterIntentCount += 1; },
      locale: () => adapterLocale,
      subscribeLocale(listener) {
        adapterLocaleListeners.add(listener);
        return () => adapterLocaleListeners.delete(listener);
      },
      resolveContext: (logicalDate) => ({ logicalDate, bounds: BOUNDS, hostContext: adapterHostContext }),
    };
    adapterView = createPlannerViewFactory(dependencies)(leaf as never);
    await adapterView.setState({
      logicalDate: DISPLAYED_DATE,
      plannerInstanceId: identityA,
    }, {} as never);
    await (adapterView as unknown as { onOpen(): Promise<void> }).onOpen();
    await nextFrame();
    const opened = adapterRoot.classList.contains("spiral-day-planner")
      && adapterRoot.querySelectorAll("[data-obsidian-icon] svg.lucide").length >= 4;
    const mainSchedule = adapterRoot.querySelector<HTMLDetailsElement>(".spiral-day-planner__schedule");
    const mainCompactScheduleInitiallyOpen = mainSchedule?.open === true;
    mainSchedule?.querySelector<HTMLElement>("summary")?.click();
    await nextFrame();
    const foldedMainSchedule = adapterRoot.querySelector<HTMLDetailsElement>(".spiral-day-planner__schedule");
    const mainScheduleCanFold = foldedMainSchedule?.open === false;
    foldedMainSchedule?.querySelector<HTMLElement>("summary")?.click();
    await nextFrame();
    const mainScheduleCanReopen = adapterRoot
      .querySelector<HTMLDetailsElement>(".spiral-day-planner__schedule")?.open === true;
    adapterRoot.style.width = "541px";
    adapterView.onResize();
    await nextFrame();
    const mainReachedWide = adapterRoot.dataset.layout === "wide"
      && adapterRoot.querySelector(".spiral-day-planner__schedule") === null;
    adapterRoot.style.width = "540px";
    adapterView.onResize();
    await nextFrame();
    const mainWideToCompactScheduleOpen = adapterRoot.dataset.layout === "compact"
      && adapterRoot.querySelector<HTMLDetailsElement>(".spiral-day-planner__schedule")?.open === true;
    adapterRoot.querySelector<HTMLDetailsElement>(".spiral-day-planner__schedule")
      ?.querySelector<HTMLElement>("summary")?.click();
    await nextFrame();
    await adapterView.setState({
      logicalDate: DISPLAYED_DATE,
      plannerInstanceId: identityA,
    }, {} as never);
    await nextFrame();
    const stableMainTogglePreserved = adapterRoot
      .querySelector<HTMLDetailsElement>(".spiral-day-planner__schedule")?.open === false;
    adapterRoot.querySelector<HTMLDetailsElement>(".spiral-day-planner__schedule")
      ?.querySelector<HTMLElement>("summary")?.click();
    await nextFrame();
    adapterRoot.style.width = "520px";
    adapterView.onResize();
    await nextFrame();
    dispatchPointerActivation(adapterRoot.querySelector('[data-item-id="nl-urgent"]'));
    const progressBound = adapterIntentCount === 1;
    adapterLocale = "zh-CN";
    for (const listener of adapterLocaleListeners) listener(adapterLocale);
    await nextFrame();
    const localeBound = adapterRoot.querySelector('[aria-label="折叠规划器"]') !== null;
    const completedControl = adapterRoot.querySelector<HTMLButtonElement>('[data-control="completed"]');
    const completedInitiallyVisible = adapterRoot.querySelector('[data-tone="completed"]') !== null;
    completedControl?.focus();
    adapterLocale = "en";
    for (const listener of adapterLocaleListeners) listener(adapterLocale);
    await nextFrame();
    const focusPreserved = document.activeElement?.getAttribute("data-planner-focus-key") === "control-completed";
    adapterRoot.querySelector<HTMLButtonElement>('[data-control="completed"]')?.click();
    await nextFrame();
    const completedHidden = adapterRoot.querySelector('[data-tone="completed"]') === null;
    adapterRoot.querySelector<HTMLButtonElement>('[data-control="completed"]')?.click();
    const debugOffButton = adapterRoot.querySelector<HTMLButtonElement>('[data-control="debug"]');
    const debugInitiallyOff = debugOffButton?.textContent === "debug is off"
      && debugOffButton.querySelector(".spiral-day-planner__debug-state-text")?.textContent === "debug is off"
      && debugOffButton.getAttribute("aria-label") === "debug is off"
      && debugOffButton.title === "debug is off"
      && debugOffButton.getAttribute("aria-pressed") === "false"
      && debugOffButton.querySelector("svg")?.getAttribute("aria-hidden") === "true";
    debugOffButton?.click();
    await nextFrame();
    const debugState = surfaceState(adapterRoot);
    const debugOnButton = adapterRoot.querySelector<HTMLButtonElement>('[data-control="debug"]');
    const debugEnabled = debugState.debugEnabled
      && debugState.debugGeometryGroups === 1
      && debugState.debugRectangles === 2
      && debugState.debugCenterMarkers === 1
      && debugState.debugGuideCircles === 1
      && debugState.debugValues === "center 225,158; size 450x315; radii 35/105; band 11; minute 780"
      && debugOnButton?.textContent === "debug is on"
      && debugOnButton.querySelector(".spiral-day-planner__debug-state-text")?.textContent === "debug is on"
      && debugOnButton.getAttribute("aria-label") === "debug is on"
      && debugOnButton.title === "debug is on"
      && debugOnButton.getAttribute("aria-pressed") === "true"
      && adapterRoot.querySelector(".spiral-day-planner__live-region")?.textContent === "debug is on";
    debugOnButton?.click();
    await nextFrame();
    const debugOffState = surfaceState(adapterRoot);
    const debugOffAgainButton = adapterRoot.querySelector<HTMLButtonElement>('[data-control="debug"]');
    const debugDisabledAgain = debugOffState.debugEnabled === false
      && debugOffState.debugGeometryGroups === 0
      && debugOffState.debugRectangles === 0
      && debugOffState.debugCenterMarkers === 0
      && debugOffState.debugGuideCircles === 0
      && debugOffState.debugValues === ""
      && debugOffAgainButton?.textContent === "debug is off"
      && debugOffAgainButton.getAttribute("aria-label") === "debug is off"
      && debugOffAgainButton.title === "debug is off"
      && debugOffAgainButton.getAttribute("aria-pressed") === "false"
      && adapterRoot.querySelector(".spiral-day-planner__live-region")?.textContent === "debug is off";
    adapterRoot.querySelector<HTMLButtonElement>('[data-control="play"]')?.click();
    const playbackStarted = adapterRoot.querySelector('[data-control="play"]')
      ?.getAttribute("aria-disabled") === "true";
    await nextFrame();
    await nextFrame();
    const disclosureOpened = adapterRoot
      .querySelector<HTMLDetailsElement>(".spiral-day-planner__schedule")?.open === true;
    adapterRoot.querySelector<HTMLButtonElement>('[data-control="collapse"]')?.click();
    const collapsedA = adapterRoot.querySelector(".spiral-day-planner__collapsed-control") !== null;

    adapterHostContext = "sidebar";
    await adapterView.setState({
      logicalDate: DISPLAYED_DATE,
      plannerInstanceId: identityB,
    }, {} as never);
    await nextFrame();
    const remountedB = adapterView.getState().plannerInstanceId === identityB
      && adapterRoot.querySelector(".spiral-day-planner__collapsed-control") === null;
    const sidebarCompactScheduleInitiallyFolded = adapterRoot
      .querySelector<HTMLDetailsElement>(".spiral-day-planner__schedule")?.open === false;
    adapterRoot.style.width = "541px";
    adapterView.onResize();
    await nextFrame();
    const sidebarReachedWide = adapterRoot.dataset.layout === "wide"
      && adapterRoot.querySelector(".spiral-day-planner__schedule") === null;
    adapterRoot.style.width = "540px";
    adapterView.onResize();
    await nextFrame();
    const sidebarWideToCompactScheduleFolded = adapterRoot.dataset.layout === "compact"
      && adapterRoot.querySelector<HTMLDetailsElement>(".spiral-day-planner__schedule")?.open === false;
    adapterRoot.style.width = "520px";
    adapterView.onResize();
    await nextFrame();
    adapterRoot.querySelector<HTMLButtonElement>('[data-control="collapse"]')?.click();
    const collapsedB = adapterRoot.querySelector(".spiral-day-planner__collapsed-control") !== null;

    await (adapterView as unknown as { onClose(): Promise<void> }).onClose();
    const tornDown = adapterLocaleListeners.size === 0
      && adapterRoot.childElementCount === 0
      && !adapterRoot.classList.contains("spiral-day-planner");
    await (adapterView as unknown as { onOpen(): Promise<void> }).onOpen();
    await nextFrame();
    const restoredB = adapterView.getState().plannerInstanceId === identityB
      && adapterRoot.querySelector(".spiral-day-planner__collapsed-control") !== null;
    adapterRoot.querySelector<HTMLButtonElement>('[data-control="collapse"]')?.click();
    await nextFrame();
    const sidebarScheduleFoldedAfterReopen = adapterRoot
      .querySelector<HTMLDetailsElement>(".spiral-day-planner__schedule")?.open === false;
    return Object.freeze({
      collapsedA,
      collapsedB,
      completedHidden,
      completedInitiallyVisible,
      debugDisabledAgain,
      debugEnabled,
      debugInitiallyOff,
      disclosureOpened,
      focusPreserved,
      listenerBound: Number(adapterLocaleListeners.size) === 1,
      localeBound,
      mainCompactScheduleInitiallyOpen,
      mainReachedWide,
      mainScheduleCanFold,
      mainScheduleCanReopen,
      mainWideToCompactScheduleOpen,
      opened,
      ordinaryDebugAbsent,
      playbackStarted,
      progressBound,
      remountedB,
      restoredB,
      sidebarCompactScheduleInitiallyFolded,
      sidebarReachedWide,
      sidebarScheduleFoldedAfterReopen,
      sidebarWideToCompactScheduleFolded,
      stableMainTogglePreserved,
      tornDown,
    });
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
    const englishMessages = createMessages({ locale: "en" });
    const surface = mountPlannerSurface(root, unavailableRuntime, {
      logicalDate: DISPLAYED_DATE,
      bounds: BOUNDS,
      hostContext: "main",
    }, { instanceId: "issue24-connect-failure", messages: englishMessages, renderIcon });
    const status = root.querySelector<HTMLElement>('[data-state="unavailable"][role="alert"]');
    const passed = status?.querySelector(".spiral-day-planner__status-heading")?.textContent
        === "Extension not installed. To use Nautilus Log, install it from Roam Depot."
      && status.querySelector(".spiral-day-planner__status-message")?.textContent === ""
      && status.textContent === "Extension not installed. To use Nautilus Log, install it from Roam Depot.";
    surface.destroy();
    root.remove();
    return passed;
  },
  assertRuntimeProbeInterval() {
    const originalSetInterval = window.setInterval;
    const originalClearInterval = window.clearInterval;
    const timerId = 42_124;
    let probeCallback: (() => void) | undefined;
    let probeDelay: number | undefined;
    let clearedTimer: number | undefined;
    let clearCount = 0;
    let intervalCount = 0;
    let runtimeState: PlannerRuntimePort["state"] = "starting";
    let connectCount = 0;
    let disconnectCount = 0;
    const root = document.createElement("div");
    root.style.width = "920px";
    document.body.append(root);
    Object.defineProperty(window, "setInterval", {
      configurable: true,
      value: (handler: TimerHandler, timeout?: number) => {
        intervalCount += 1;
        probeCallback = typeof handler === "function" ? handler : undefined;
        probeDelay = timeout;
        return timerId;
      },
    });
    Object.defineProperty(window, "clearInterval", {
      configurable: true,
      value: (intervalId?: number) => {
        clearCount += 1;
        clearedTimer = intervalId;
      },
    });
    let surface: PlannerSurface | undefined;
    try {
      const probeRuntime: PlannerRuntimePort = {
        get state() { return runtimeState; },
        connect(_context, listener, visible = true) {
          connectCount += 1;
          if (visible) listener(currentSnapshot());
          return Object.freeze({
            setContext() {},
            setVisible() {},
            refresh() { listener(currentSnapshot()); },
            disconnect() { disconnectCount += 1; },
          });
        },
      };
      surface = mountPlannerSurface(root, probeRuntime, {
        logicalDate: DISPLAYED_DATE,
        bounds: BOUNDS,
        hostContext: "main",
      }, {
        instanceId: "issue24-runtime-probe",
        messages: createMessages({ locale: "en" }),
        renderIcon,
      });
      const loading = root.querySelector<HTMLElement>('[data-state="loading"][role="status"]');
      const exactLoading = loading?.querySelector(".spiral-day-planner__status-heading")?.textContent
          === "Loading Nautilus Log..."
        && loading.querySelector(".spiral-day-planner__status-message")?.textContent === ""
        && loading.textContent === "Loading Nautilus Log...";
      runtimeState = "unloaded";
      probeCallback?.();
      const unavailable = root.querySelector<HTMLElement>('[data-state="unavailable"][role="alert"]');
      const exactUnavailable = unavailable?.querySelector(".spiral-day-planner__status-heading")?.textContent
          === "Extension not installed. To use Nautilus Log, install it from Roam Depot."
        && unavailable.querySelector(".spiral-day-planner__status-message")?.textContent === ""
        && unavailable.textContent
          === "Extension not installed. To use Nautilus Log, install it from Roam Depot.";
      runtimeState = "ready";
      probeCallback?.();
      const firstReady = root.querySelector("svg.spiral-day-planner__spiral") !== null
        && connectCount === 1
        && disconnectCount === 0
        && clearedTimer === undefined;
      probeCallback?.();
      const noDuplicateReadyConnection = connectCount === 1 && disconnectCount === 0;
      runtimeState = "stopping";
      probeCallback?.();
      const stopping = root.querySelector<HTMLElement>('[data-state="unavailable"][role="alert"]');
      const exactStopping = stopping?.textContent
          === "Extension not installed. To use Nautilus Log, install it from Roam Depot."
        && root.querySelector("svg.spiral-day-planner__spiral") === null
        && connectCount === 1
        && disconnectCount === 1;
      runtimeState = "unloaded";
      probeCallback?.();
      const unloadedRemainsDisconnected = connectCount === 1 && disconnectCount === 1;
      runtimeState = "ready";
      probeCallback?.();
      const reconnected = root.querySelector("svg.spiral-day-planner__spiral") !== null
        && connectCount === 2
        && disconnectCount === 1
        && clearedTimer === undefined;
      probeCallback?.();
      const noDuplicateReconnect = connectCount === 2 && disconnectCount === 1;
      surface.destroy();
      surface = undefined;
      return probeDelay === 5_000
        && intervalCount === 1
        && exactLoading
        && exactUnavailable
        && firstReady
        && noDuplicateReadyConnection
        && exactStopping
        && unloadedRemainsDisconnected
        && reconnected
        && noDuplicateReconnect
        && connectCount === 2
        && disconnectCount === 2
        && clearCount === 1
        && clearedTimer === timerId;
    } finally {
      surface?.destroy();
      root.remove();
      Object.defineProperty(window, "setInterval", { configurable: true, value: originalSetInterval });
      Object.defineProperty(window, "clearInterval", { configurable: true, value: originalClearInterval });
    }
  },
  assertExternalFocusPreserved() {
    localeSelect.focus();
    const before = messages.locale;
    messages.setLocale(before === "en" ? "zh-CN" : "en");
    const preserved = document.activeElement === localeSelect;
    messages.setLocale(before);
    return preserved;
  },
  async assertKeyboardPointerParity() {
    this.setWidth(521);
    await nextFrame();
    const item = items.find((candidate) => candidate.blockId === "nl-draft")!;
    const originalProgress = item.progressRaw;
    const before = intentCount;
    dispatchPointerActivation(progressElement("nl-draft"));
    await nextFrame();
    const pointerDispatched = intentCount === before + 1;
    const keyboardTarget = progressElement("nl-draft");
    keyboardTarget?.focus();
    const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
    keyboardTarget?.dispatchEvent(event);
    await nextFrame();
    const keyboardDispatched = intentCount === before + 2 && event.defaultPrevented;
    const announced = state().liveText.trim() !== "";
    const focusPreserved = state().primary.focusKey?.startsWith("slice-") === true;
    item.progressRaw = originalProgress;
    emitProjection();
    await nextFrame();
    return pointerDispatched && keyboardDispatched && announced && focusPreserved;
  },
  async assertLayoutFocusRestoration() {
    this.setWidth(521);
    await nextFrame();
    const externalLabel = primaryRoot.querySelector<SVGElement>(
      ".spiral-day-planner__external-label[data-planner-focus-key^='label-']",
    );
    externalLabel?.focus();
    const labelKey = state().primary.focusKey;
    const itemId = labelKey?.slice("label-".length);
    const beforeIntentCount = intentCount;
    const isExactLabel = (): boolean => document.activeElement?.classList
      .contains("spiral-day-planner__external-label") === true
      && document.activeElement?.getAttribute("role") === "img"
      && (document.activeElement as HTMLElement).dataset.plannerFocusKey === labelKey;
    const originalLocale = messages.locale;
    messages.setLocale(originalLocale === "en" ? "zh-CN" : "en");
    await nextFrame();
    const localeRestored = isExactLabel();
    emitProjection();
    await nextFrame();
    const runtimeRestored = isExactLabel();
    primaryRoot.querySelector<HTMLButtonElement>('[data-control="play"]')?.click();
    await nextFrame();
    const playbackRestored = isExactLabel();
    this.setWidth(520);
    await nextFrame();
    const compact = state().primary.focusKey === `row-${itemId}`
      && document.activeElement?.classList.contains("spiral-day-planner__disclosure-row") === true;
    this.setWidth(521);
    await nextFrame();
    const wideAfter = state().primary.focusKey === `slice-${itemId}`
      && document.activeElement?.classList.contains("spiral-day-planner__item") === true
      && document.activeElement?.getAttribute("role") === "button";
    this.setReducedMotion(true);
    await nextFrame();
    this.setReducedMotion(false);
    messages.setLocale(originalLocale);
    await nextFrame();
    return externalLabel !== null && labelKey !== null && itemId !== undefined
      && localeRestored && runtimeRestored && playbackRestored
      && compact && wideAfter && intentCount === beforeIntentCount;
  },
  async assertLifecycleReparenting() {
    const firstParent = document.createElement("section");
    const secondParent = document.createElement("section");
    const root = document.createElement("div");
    root.style.width = "600px";
    firstParent.append(root);
    document.body.append(firstParent, secondParent);
    const visibility: boolean[] = [];
    let disconnectCount = 0;
    const lifecycleRuntime: PlannerRuntimePort = {
      state: "ready",
      connect(_context, listener, visible = true) {
        if (visible) listener(currentSnapshot());
        return Object.freeze({
          setContext() {},
          setVisible(nextVisible: boolean) {
            visibility.push(nextVisible);
            if (nextVisible) listener(currentSnapshot());
          },
          refresh() { listener(currentSnapshot()); },
          disconnect() { disconnectCount += 1; },
        });
      },
    };
    const surface = mountPlannerSurface(root, lifecycleRuntime, {
      logicalDate: DISPLAYED_DATE,
      bounds: BOUNDS,
      hostContext: "main",
    }, { instanceId: "issue24-lifecycle", messages, renderIcon });
    root.querySelector<HTMLButtonElement>('[data-control="play"]')?.click();
    const playbackStarted = root.querySelector('[data-control="play"]')
      ?.getAttribute("aria-disabled") === "true";
    root.remove();
    await nextFrame();
    await nextFrame();
    const detached = visibility.at(-1) === false;
    secondParent.append(root);
    await nextFrame();
    await nextFrame();
    const reattached = visibility.at(-1) === true;
    const playbackStopped = root.querySelector('[data-control="play"]')
      ?.getAttribute("aria-disabled") !== "true";
    secondParent.hidden = true;
    await nextFrame();
    await nextFrame();
    const reparentedAncestorHidden = visibility.at(-1) === false;
    secondParent.hidden = false;
    await nextFrame();
    await nextFrame();
    const reparentedAncestorShown = visibility.at(-1) === true;
    surface.destroy();
    firstParent.remove();
    secondParent.remove();
    return playbackStarted && detached && reattached && playbackStopped
      && reparentedAncestorHidden && reparentedAncestorShown && disconnectCount === 1;
  },
  async assertMediaQueryLifecycle() {
    class ControlledMotionPreference extends EventTarget {
      matches = false;
      readonly media = "(prefers-reduced-motion: reduce)";
      onchange: ((this: MediaQueryList, event: MediaQueryListEvent) => unknown) | null = null;
      listenerCount = 0;

      override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null): void {
        if (type === "change" && callback) this.listenerCount += 1;
        super.addEventListener(type, callback);
      }

      override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null): void {
        if (type === "change" && callback) this.listenerCount -= 1;
        super.removeEventListener(type, callback);
      }

      setMatches(matches: boolean): void {
        this.matches = matches;
        const event = new Event("change") as MediaQueryListEvent;
        Object.defineProperty(event, "matches", { value: matches });
        this.dispatchEvent(event);
        this.onchange?.call(this as unknown as MediaQueryList, event);
      }
    }
    const preference = new ControlledMotionPreference();
    const originalMatchMedia = window.matchMedia;
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: () => preference as unknown as MediaQueryList,
    });
    const root = document.createElement("div");
    root.style.width = "900px";
    document.body.append(root);
    const surface = mountPlannerSurface(root, runtime, {
      logicalDate: DISPLAYED_DATE,
      bounds: BOUNDS,
      hostContext: "main",
    }, { instanceId: "issue24-motion-query", messages, renderIcon });
    Object.defineProperty(window, "matchMedia", { configurable: true, value: originalMatchMedia });
    const initial = root.dataset.reducedMotion === "false" && preference.listenerCount === 1;
    root.querySelector<HTMLButtonElement>('[data-control="play"]')?.click();
    const started = root.querySelector('[data-control="play"]')?.getAttribute("aria-disabled") === "true";
    preference.setMatches(true);
    await nextFrame();
    const icon = root.querySelector<HTMLElement>(".spiral-day-planner__icon-button");
    const zeroDurations = icon !== null && getComputedStyle(icon).transitionDuration
      .split(",").every((duration) => Number.parseFloat(duration) === 0);
    const finished = root.dataset.reducedMotion === "true"
      && root.querySelector('[data-control="play"]')?.getAttribute("aria-disabled") !== "true";
    surface.destroy();
    const removed = preference.listenerCount === 0 && root.dataset.reducedMotion === undefined;
    preference.setMatches(false);
    const inertAfterDestroy = root.dataset.reducedMotion === undefined;
    root.remove();
    return initial && started && finished && zeroDurations && removed && inertAfterDestroy;
  },
  async assertPlaybackStopsOnContextChange() {
    this.setWidth(900);
    await nextFrame();
    primaryRoot.querySelector<HTMLButtonElement>('[data-control="play"]')?.click();
    const started = state().primary.playbackRunning;
    primary.setContext({
      logicalDate: { year: 2026, month: 8, day: 29 },
      bounds: BOUNDS,
      hostContext: "main",
    });
    await nextFrame();
    const stopped = !state().primary.playbackRunning;
    primary.setContext({ logicalDate: DISPLAYED_DATE, bounds: BOUNDS, hostContext: "main" });
    await nextFrame();
    return started && stopped;
  },
  async assertPlaybackStopsOnRuntimeState() {
    this.setWidth(900);
    await nextFrame();
    primaryRoot.querySelector<HTMLButtonElement>('[data-control="play"]')?.click();
    const started = state().primary.playbackRunning;
    generation += 1;
    const loading = loadingSnapshot(createProjectionRevision({
      generation,
      path: SOURCE_PATH,
      sourceFingerprint: `sha256:harness-${revisionSequence}`,
      settingsVersion: 1,
      logicalDate: DISPLAYED_DATE,
      minuteBucket: 13 * 60,
      timeZone: "Asia/Shanghai",
      grammarVersion: "v1",
    }));
    for (const listener of listeners) listener(loading);
    await nextFrame();
    await nextFrame();
    const stopped = !state().primary.playbackRunning
      && primaryRoot.querySelector('[data-state="loading"]') !== null;
    const confirmed = currentSnapshot();
    for (const listener of listeners) listener(confirmed);
    await nextFrame();
    return started && stopped && !state().primary.playbackRunning;
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
  async closeAdapterEvidence() {
    if (adapterView) {
      await (adapterView as unknown as { onClose(): Promise<void> }).onClose();
      adapterView = undefined;
    }
    adapterLocaleListeners.clear();
    adapterLeaf.hidden = true;
    adapterRoot.style.removeProperty("box-sizing");
    adapterRoot.style.removeProperty("width");
  },
  focusProgress(id = "nl-urgent") {
    const target = progressElement(id);
    target?.focus();
    return target !== null;
  },
  openDisclosure(key) {
    const details = primaryRoot.querySelector<HTMLDetailsElement>(`.spiral-day-planner__${key}`);
    if (details && !details.open) details.querySelector<HTMLElement>("summary")?.click();
    return details !== null;
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
            this.setReducedMotion(nextTheme === "high-contrast");
            this.setZoom(nextZoom);
            await nextFrame();
            if ([300, 320, 360].includes(nextWidth)) {
              const overview = primaryRoot.querySelector<HTMLDetailsElement>(
                ".spiral-day-planner__overview",
              );
              if (overview && !overview.open) overview.querySelector<HTMLElement>("summary")?.click();
              await nextFrame();
            }
            const tooltipTarget = primaryRoot.querySelector<HTMLElement>("[aria-describedby]");
            tooltipTarget?.focus();
            await nextFrame();
            results.push(assertAcceptance());
            tooltipTarget?.blur();
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
    const beforeProjectionCalls = projectionCallCount;
    localeSelect.value = locale;
    document.documentElement.lang = locale;
    messages.setLocale(locale);
    if (projectionCallCount !== beforeProjectionCalls) {
      throw new Error("Locale changes must not regenerate the runtime projection");
    }
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
  },
  state,
};
