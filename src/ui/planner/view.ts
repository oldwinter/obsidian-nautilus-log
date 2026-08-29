import { calculateCapacity } from "../../core/capacity";
import { projectDay, type LogicalDate } from "../../core/day";
import type { ParserDiagnosticCode } from "../../core/diagnostics";
import { schedulePlan } from "../../core/scheduler";
import { createMessages } from "../../i18n/resolver";
import type {
  Messages,
  PlannerLimitKind,
} from "../../i18n/types";
import type {
  RuntimeConnection,
  RuntimePlanProjection,
  RuntimeSnapshotListener,
  RuntimeViewContext,
} from "../../runtime/projection-runtime";
import type { RuntimeSnapshot } from "../../runtime/snapshots";
import type { PlanRegionDiagnosticCode } from "../../workspace/plan-region";
import { formatClockMinute, plannerOverflow } from "./diagnostics";
import { spiralBandPath, spiralViewBox, type PlannerTimeBounds } from "./geometry";
import {
  bindPlannerProgressTarget,
  createPlannerControls,
  type PlannerCollapseStore,
  type PlannerControlsController,
  type PlannerProgressIntent,
  type PlannerProgressTarget,
} from "./controls";
import {
  bindPlannerDisclosure,
  createPlannerDisclosures,
  initialPlannerDisclosureState,
  type PlannerDisclosuresController,
} from "./disclosures";
import {
  bindPlannerTooltip,
  createPlannerFocusManager,
  createPlannerLiveAnnouncer,
  plannerFocusKeyAfterLayoutTransition,
  type PlannerFocusManager,
  type PlannerLiveAnnouncer,
} from "./focus";
import {
  createPlannerPlayback,
  type PlannerPlaybackController,
  type PlannerPlaybackFrame,
} from "./playback";
import {
  observePlannerContainer,
  plannerContainerWidth,
  plannerLayoutForWidth,
  type PlannerHostContext,
  type PlannerResponsiveLayout,
  type PlannerResizeSubscription,
} from "./responsive-layout";
import {
  buildPlannerSpiralModel,
  plannerRailLabelMaxWidth,
  type PlannerSpiralModel,
  type PlannerTimelineItem,
} from "./spiral";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const RUNTIME_PROBE_MILLISECONDS = 5_000;

export interface PlannerRuntimePort {
  readonly state: "unloaded" | "starting" | "ready" | "stopping";
  connect(
    context: RuntimeViewContext,
    listener: RuntimeSnapshotListener,
    visible?: boolean,
  ): RuntimeConnection;
}

export interface PlannerViewContext {
  readonly logicalDate: LogicalDate;
  readonly bounds: PlannerTimeBounds;
  readonly hostContext: PlannerHostContext;
}

export type PlannerIconName = "collapse" | "debug" | "expand" | "hide-completed" | "show-completed" | "play";
export type PlannerIconRenderer = (element: HTMLElement, icon: PlannerIconName) => void;

export interface PlannerSurfaceOptions {
  readonly collapseStore?: PlannerCollapseStore;
  readonly debugControl?: boolean;
  readonly instanceId?: string;
  readonly locale?: string;
  readonly messages?: Messages;
  readonly onProgressIntent?: (intent: PlannerProgressIntent) => void | Promise<void>;
  readonly renderIcon?: PlannerIconRenderer;
  readonly reducedMotion?: boolean;
}

export interface PlannerSurface {
  setContext(context: PlannerViewContext): void;
  setLocale(locale: string): void;
  setReducedMotion(reducedMotion: boolean): void;
  measure(): void;
  probeRuntimeNow(): void;
  destroy(): void;
}

export interface PlannerSurfaceStateModel {
  readonly state: RuntimeSnapshot<RuntimePlanProjection>["state"] | "runtime-unavailable";
  readonly authoritative: boolean;
  readonly heading: string;
  readonly message: string;
  readonly hierarchy: readonly string[];
  readonly mutationEnabled: false;
}

function copyDate(date: LogicalDate): LogicalDate {
  if (!Number.isInteger(date.year) || !Number.isInteger(date.month) || !Number.isInteger(date.day)) {
    throw new RangeError("Planner view requires a valid logical date");
  }
  return Object.freeze({ ...date });
}

export function validatePlannerViewContext(context: PlannerViewContext): PlannerViewContext {
  if (context.bounds.startMinutes < 0 || context.bounds.endMinutes > 24 * 60
    || context.bounds.endMinutes <= context.bounds.startMinutes) {
    throw new RangeError("Planner view requires valid same-day chart bounds");
  }
  return Object.freeze({
    logicalDate: copyDate(context.logicalDate),
    bounds: Object.freeze({ ...context.bounds }),
    hostContext: context.hostContext,
  });
}

export function plannerSurfaceStateModel(
  snapshot: RuntimeSnapshot<RuntimePlanProjection> | undefined,
  layout: PlannerResponsiveLayout,
  messages: Messages = createMessages(),
): PlannerSurfaceStateModel {
  if (!snapshot) {
    return Object.freeze({
      state: "runtime-unavailable",
      authoritative: false,
      heading: messages.t("shared", "status.unavailable"),
      message: messages.t("planner", "status.unavailableDetail"),
      hierarchy: Object.freeze(["status"]),
      mutationEnabled: false,
    });
  }
  if (snapshot.state === "confirmed") {
    const hierarchy = ["capacity-controls-legend", "spiral"];
    if (layout.showCompactOverview) hierarchy.push("overview");
    if (layout.showCompactSchedule) hierarchy.push("schedule");
    hierarchy.push("overflow", "warnings");
    return Object.freeze({
      state: "confirmed",
      authoritative: true,
      heading: messages.t("planner", "surface.name"),
      message: "",
      hierarchy: Object.freeze(hierarchy),
      mutationEnabled: false,
    });
  }
  const limitKinds: readonly PlannerLimitKind[] = [
    "active-note-bytes",
    "list-depth",
    "plan-item-bytes",
    "plan-items",
    "plan-region-bytes",
  ];
  const overLimitMessage = snapshot.state === "over-limit"
    ? limitKinds.includes(snapshot.overLimit.kind as PlannerLimitKind)
      ? messages.t("planner", "status.overLimitDetail", {
        actual: snapshot.overLimit.actual,
        kind: snapshot.overLimit.kind as PlannerLimitKind,
        limit: snapshot.overLimit.limit,
      })
      : messages.t("planner", "status.overLimitUnknownDetail", {
        actual: snapshot.overLimit.actual,
        limit: snapshot.overLimit.limit,
      })
    : "";
  const copy = snapshot.state === "loading"
    ? [messages.t("shared", "status.loading"), messages.t("planner", "status.loadingDetail")]
    : snapshot.state === "missing"
      ? [messages.t("shared", "status.missing"), messages.t("planner", "status.missingDetail")]
      : snapshot.state === "over-limit"
        ? [messages.t("shared", "status.overLimit"), overLimitMessage]
        : snapshot.state === "stale"
          ? [messages.t("shared", "status.stale"), messages.t("planner", "status.staleDetail")]
          : snapshot.state === "hidden"
            ? [messages.t("shared", "status.hidden"), messages.t("planner", "status.hiddenDetail")]
            : [messages.t("shared", "status.error"), messages.t("planner", "status.errorDetail")];
  return Object.freeze({
    state: snapshot.state,
    authoritative: false,
    heading: copy[0]!,
    message: copy[1]!,
    hierarchy: Object.freeze(["status"]),
    mutationEnabled: false,
  });
}

function svgElement<K extends keyof SVGElementTagNameMap>(
  document: Document,
  name: K,
  className?: string,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  if (className) element.setAttribute("class", className);
  return element;
}

function element<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  name: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const created = document.createElement(name);
  if (className) created.className = className;
  return created;
}

function defaultIconRenderer(button: HTMLElement, icon: PlannerIconName): void {
  button.dataset.icon = icon;
  const fallback = {
    collapse: "-",
    debug: "#",
    expand: "+",
    "hide-completed": "o",
    "show-completed": "x",
    play: ">",
  }[icon];
  const glyph = element(button.ownerDocument, "span", "spiral-day-planner__fallback-icon");
  glyph.textContent = fallback;
  glyph.setAttribute("aria-hidden", "true");
  button.append(glyph);
}

function appendMetric(
  parent: HTMLElement,
  messages: Messages,
  kind: string,
  minutes: number,
  percent: number | null,
  burning: boolean,
): void {
  const metric = element(parent.ownerDocument, "div", "spiral-day-planner__metric");
  metric.dataset.metric = kind;
  if (burning) metric.dataset.burning = "true";
  const value = element(parent.ownerDocument, "span", "spiral-day-planner__metric-value");
  value.textContent = messages.t("shared", "unit.duration", { minutes });
  const label = element(parent.ownerDocument, "span", "spiral-day-planner__metric-label");
  label.textContent = kind === "events"
    ? messages.t("planner", "metric.fixedTime")
    : kind === "available"
      ? messages.t("planner", "metric.availableTime")
      : kind === "planned"
        ? messages.t("planner", "metric.scheduledTime")
        : messages.t("planner", "metric.flexibleTime");
  metric.append(value, label);
  if (percent !== null) {
    const total = element(parent.ownerDocument, "span", "spiral-day-planner__metric-percent");
    total.textContent = `${percent}%`;
    metric.append(total);
  }
  parent.append(metric);
}

function appendMetrics(parent: HTMLElement, projection: RuntimePlanProjection, messages: Messages): void {
  parent.setAttribute("role", "status");
  parent.setAttribute(
    "aria-label",
    projection.capacity.metrics
      .map((metric) => `${metric.kind === "events"
        ? messages.t("planner", "metric.fixedTime")
        : metric.kind === "available"
          ? messages.t("planner", "metric.availableTime")
          : metric.kind === "planned"
            ? messages.t("planner", "metric.scheduledTime")
            : messages.t("planner", "metric.flexibleTime")} ${messages.t("shared", "unit.duration", { minutes: metric.minutes })}`)
      .join(", "),
  );
  for (const metric of projection.capacity.metrics) {
    appendMetric(parent, messages, metric.kind, metric.minutes, metric.percent, metric.burning);
  }
}

function appendLegend(parent: HTMLElement, messages: Messages): void {
  const entries = [
    ["urgent", messages.t("planner", "legend.urgent")],
    ["event", messages.t("planner", "legend.event")],
    ["task", messages.t("planner", "legend.task")],
  ] as const;
  parent.setAttribute("aria-label", entries.map(([, label]) => label).join(", "));
  for (const [tone, label] of entries) {
    const item = element(parent.ownerDocument, "span", "spiral-day-planner__legend-item");
    const swatch = element(parent.ownerDocument, "span", "spiral-day-planner__legend-swatch");
    swatch.dataset.tone = tone;
    swatch.setAttribute("aria-hidden", "true");
    item.append(swatch, label);
    parent.append(item);
  }
}

function appendDisclosureRows(
  details: HTMLDetailsElement,
  rows: readonly { readonly title: string; readonly meta: string; readonly tone?: string }[],
): void {
  const list = element(details.ownerDocument, "ul", "spiral-day-planner__disclosure-list");
  for (const row of rows) {
    const item = element(details.ownerDocument, "li", "spiral-day-planner__disclosure-row");
    if (row.tone) item.dataset.tone = row.tone;
    const title = element(details.ownerDocument, "span", "spiral-day-planner__row-title");
    title.textContent = row.title;
    const meta = element(details.ownerDocument, "span", "spiral-day-planner__row-meta");
    meta.textContent = row.meta;
    item.append(title, meta);
    list.append(item);
  }
  details.append(list);
}

function timelineKind(messages: Messages, item: PlannerTimelineItem): string {
  return item.kind === "event"
    ? messages.t("planner", "item.fixedEvent")
    : messages.t("planner", item.tone === "urgent" ? "item.urgentTask" : "item.task");
}

function timelineStates(messages: Messages, item: PlannerTimelineItem): string {
  const states = [];
  if (item.tone === "urgent") states.push(messages.t("shared", "state.urgent"));
  if (item.completed) states.push(messages.t("shared", "state.completed"));
  if (item.current) states.push(messages.t("shared", "state.current"));
  if (item.conflict) states.push(messages.t("shared", "state.conflict"));
  return states.join(", ");
}

function timelineAccessibleName(messages: Messages, item: PlannerTimelineItem): string {
  return messages.t("planner", "item.accessibleName", {
    kind: timelineKind(messages, item),
    title: item.title,
    start: formatClockMinute(item.startMinutes),
    end: formatClockMinute(item.endMinutes),
    duration: messages.t("shared", "unit.duration", { minutes: item.durationMinutes }),
    states: timelineStates(messages, item),
  });
}

function timelineTooltipText(messages: Messages, item: PlannerTimelineItem): string {
  return messages.t("planner", "tooltip.item", {
    kind: timelineKind(messages, item),
    title: item.title,
    start: formatClockMinute(item.startMinutes),
    end: formatClockMinute(item.endMinutes),
    duration: messages.t("shared", "unit.duration", { minutes: item.durationMinutes }),
  });
}

let plannerSurfaceSequence = 0;
let plannerPatternSequence = 0;
let plannerTooltipSequence = 0;

class PlannerSurfaceController implements PlannerSurface {
  readonly #root: HTMLElement;
  readonly #content: HTMLElement;
  readonly #runtime: PlannerRuntimePort;
  readonly #renderIcon: PlannerIconRenderer;
  readonly #messages: Messages;
  readonly #onProgressIntent: ((intent: PlannerProgressIntent) => void | Promise<void>) | undefined;
  readonly #controls: PlannerControlsController;
  readonly #disclosures: PlannerDisclosuresController;
  readonly #focus: PlannerFocusManager;
  readonly #live: PlannerLiveAnnouncer;
  readonly #playback: PlannerPlaybackController;
  readonly #patternIds: Readonly<{ dots: string; hatch: string }>;
  #context: PlannerViewContext;
  #connection: RuntimeConnection | undefined;
  #snapshot: RuntimeSnapshot<RuntimePlanProjection> | undefined;
  #layout: PlannerResponsiveLayout;
  #resize: PlannerResizeSubscription | undefined;
  #visibilityObserver: MutationObserver | undefined;
  #topologyObserver: MutationObserver | undefined;
  #visibilityAncestors: readonly HTMLElement[] = [];
  #documentVisibilityListener: (() => void) | undefined;
  #probeTimer: number | undefined;
  #localeUnsubscribe: (() => void) | undefined;
  #motionPreference: MediaQueryList | undefined;
  #motionPreferenceListener: ((event: MediaQueryListEvent) => void) | undefined;
  #playbackFrame: PlannerPlaybackFrame | null = null;
  readonly #renderCleanups: Array<() => void> = [];
  #visible = true;
  #destroyed = false;

  constructor(
    root: HTMLElement,
    runtime: PlannerRuntimePort,
    context: PlannerViewContext,
    options: PlannerSurfaceOptions,
  ) {
    this.#root = root;
    this.#runtime = runtime;
    this.#context = validatePlannerViewContext(context);
    this.#renderIcon = options.renderIcon ?? defaultIconRenderer;
    this.#messages = options.messages ?? (options.locale === undefined
      ? createMessages()
      : createMessages({ locale: options.locale }));
    this.#onProgressIntent = options.onProgressIntent;
    const patternSequence = ++plannerPatternSequence;
    this.#patternIds = Object.freeze({
      dots: `spiral-day-planner-dots-${patternSequence}`,
      hatch: `spiral-day-planner-hatch-${patternSequence}`,
    });
    this.#layout = plannerLayoutForWidth(plannerContainerWidth(root), context.hostContext);
    root.classList.add("spiral-day-planner");
    root.setAttribute("aria-label", this.#messages.t("planner", "surface.name"));
    this.#content = element(root.ownerDocument, "div", "spiral-day-planner__content");
    root.replaceChildren(this.#content);
    this.#focus = createPlannerFocusManager(root);
    this.#live = createPlannerLiveAnnouncer(root);
    this.#disclosures = createPlannerDisclosures({
      ...initialPlannerDisclosureState(),
      schedule: this.#layout.scheduleInitiallyOpen,
    });
    this.#controls = createPlannerControls({
      instanceId: options.instanceId ?? `planner-${++plannerSurfaceSequence}`,
      ...(options.collapseStore ? { collapseStore: options.collapseStore } : {}),
      debugControl: options.debugControl ?? false,
      onChange: () => this.#render(),
    });
    const view = root.ownerDocument.defaultView;
    this.#motionPreference = view?.matchMedia("(prefers-reduced-motion: reduce)");
    const reducedMotion = options.reducedMotion ?? this.#motionPreference?.matches ?? false;
    this.#root.dataset.reducedMotion = String(reducedMotion);
    this.#playback = createPlannerPlayback({
      reducedMotion,
      onStart: () => {
        this.#controls.startPlayback();
        this.#live.announce(this.#messages.t("planner", "announcement.playbackStarted"));
      },
      onFrame: (frame) => {
        this.#playbackFrame = frame;
        this.#render();
      },
      onFinish: (reason) => {
        this.#playbackFrame = null;
        this.#controls.finishPlayback();
        if (reason === "completed") {
          this.#live.announce(this.#messages.t("planner", "announcement.playbackFinished"));
        }
      },
    });
    this.#motionPreferenceListener = (event) => this.setReducedMotion(event.matches);
    this.#motionPreference?.addEventListener("change", this.#motionPreferenceListener);
    this.#localeUnsubscribe = this.#messages.subscribe(() => {
      this.#root.setAttribute("aria-label", this.#messages.t("planner", "surface.name"));
      this.#render();
    });
    this.#visible = this.#elementVisible();
    this.#playback.setVisible(this.#visible);
    this.#observeVisibility();
    this.#resize = observePlannerContainer(root, context.hostContext, (layout) => {
      this.#applyLayout(layout);
      this.#render();
    });
    this.probeRuntimeNow();
  }

  setContext(context: PlannerViewContext): void {
    if (this.#destroyed) return;
    const validated = validatePlannerViewContext(context);
    const contextChanged = validated.logicalDate.year !== this.#context.logicalDate.year
      || validated.logicalDate.month !== this.#context.logicalDate.month
      || validated.logicalDate.day !== this.#context.logicalDate.day
      || validated.bounds.startMinutes !== this.#context.bounds.startMinutes
      || validated.bounds.endMinutes !== this.#context.bounds.endMinutes
      || validated.hostContext !== this.#context.hostContext;
    if (contextChanged) this.#playback.cancel("cancelled");
    const wasReplica = this.#context.hostContext === "replica";
    const hostChanged = validated.hostContext !== this.#context.hostContext;
    this.#context = validated;
    this.#connection?.setContext({ logicalDate: validated.logicalDate });
    if (hostChanged) {
      this.#resize?.disconnect();
      this.#applyLayout(plannerLayoutForWidth(plannerContainerWidth(this.#root), validated.hostContext));
      this.#resize = observePlannerContainer(this.#root, validated.hostContext, (layout) => {
        this.#applyLayout(layout);
        this.#render();
      });
    }
    if (wasReplica && validated.hostContext !== "replica") {
      this.#root.hidden = false;
      this.#publishVisibility();
    }
    this.#render();
  }

  setLocale(locale: string): void {
    if (!this.#destroyed) this.#messages.setLocale(locale);
  }

  setReducedMotion(reducedMotion: boolean): void {
    if (this.#destroyed) return;
    this.#root.dataset.reducedMotion = String(reducedMotion);
    this.#playback.setReducedMotion(reducedMotion);
  }

  measure(): void {
    this.#resize?.measure();
  }

  probeRuntimeNow(): void {
    if (this.#destroyed) return;
    this.#scheduleProbe();
    if (this.#runtime.state === "ready") {
      if (this.#connection) return;
      try {
        this.#connection = this.#runtime.connect(
          { logicalDate: this.#context.logicalDate },
          (snapshot) => {
            if (this.#destroyed) return;
            if (snapshot.state !== "confirmed") this.#playback.cancel("cancelled");
            this.#snapshot = snapshot;
            this.#render();
          },
          this.#visible,
        );
      } catch {
        this.#snapshot = undefined;
        this.#render();
      }
    } else {
      const connection = this.#connection;
      this.#connection = undefined;
      connection?.disconnect();
      this.#snapshot = undefined;
      this.#playback.cancel("cancelled");
      this.#render();
    }
  }

  destroy(): void {
    if (this.#destroyed) return;
    this.#destroyed = true;
    this.#connection?.disconnect();
    this.#connection = undefined;
    this.#resize?.disconnect();
    this.#resize = undefined;
    this.#visibilityObserver?.disconnect();
    this.#visibilityObserver = undefined;
    this.#topologyObserver?.disconnect();
    this.#topologyObserver = undefined;
    this.#visibilityAncestors = [];
    if (this.#documentVisibilityListener) {
      this.#root.ownerDocument.removeEventListener("visibilitychange", this.#documentVisibilityListener);
    }
    this.#documentVisibilityListener = undefined;
    this.#localeUnsubscribe?.();
    this.#localeUnsubscribe = undefined;
    if (this.#motionPreferenceListener) {
      this.#motionPreference?.removeEventListener("change", this.#motionPreferenceListener);
    }
    this.#motionPreference = undefined;
    this.#motionPreferenceListener = undefined;
    this.#clearProbe();
    this.#playback.destroy();
    this.#controls.destroy();
    this.#clearRenderBindings();
    this.#live.destroy();
    this.#root.replaceChildren();
    this.#root.classList.remove("spiral-day-planner");
    this.#root.hidden = false;
    this.#root.removeAttribute("aria-label");
    delete this.#root.dataset.layout;
    delete this.#root.dataset.narrow;
    delete this.#root.dataset.reducedMotion;
  }

  #scheduleProbe(): void {
    if (this.#probeTimer !== undefined || this.#destroyed) return;
    const view = this.#root.ownerDocument.defaultView;
    if (!view) return;
    this.#probeTimer = view.setInterval(() => this.probeRuntimeNow(), RUNTIME_PROBE_MILLISECONDS);
  }

  #clearProbe(): void {
    if (this.#probeTimer === undefined) return;
    this.#root.ownerDocument.defaultView?.clearInterval(this.#probeTimer);
    this.#probeTimer = undefined;
  }

  #elementVisible(): boolean {
    const document = this.#root.ownerDocument;
    if (document.hidden || !this.#root.isConnected) return false;
    const isShown = (this.#root as HTMLElement & { readonly isShown?: () => boolean }).isShown;
    return isShown ? isShown.call(this.#root) : this.#root.getClientRects().length > 0;
  }

  #observeVisibility(): void {
    const publish = (): void => this.#publishVisibility();
    this.#documentVisibilityListener = publish;
    this.#root.ownerDocument.addEventListener("visibilitychange", publish);
    const ViewMutationObserver = this.#root.ownerDocument.defaultView?.MutationObserver;
    if (ViewMutationObserver) {
      this.#visibilityObserver = new ViewMutationObserver(publish);
      this.#topologyObserver = new ViewMutationObserver(() => {
        const ancestors = this.#currentVisibilityAncestors();
        const changed = ancestors.length !== this.#visibilityAncestors.length
          || ancestors.some((ancestor, index) => ancestor !== this.#visibilityAncestors[index]);
        if (changed) this.#rebuildVisibilityObservation(ancestors);
        publish();
      });
      this.#topologyObserver.observe(this.#root.ownerDocument.documentElement, {
        childList: true,
        subtree: true,
      });
      this.#rebuildVisibilityObservation(this.#currentVisibilityAncestors());
    }
  }

  #currentVisibilityAncestors(): readonly HTMLElement[] {
    const ancestors: HTMLElement[] = [];
    let ancestor: HTMLElement | null = this.#root;
    while (ancestor) {
      ancestors.push(ancestor);
      ancestor = ancestor.parentElement;
    }
    return ancestors;
  }

  #rebuildVisibilityObservation(ancestors: readonly HTMLElement[]): void {
    this.#visibilityObserver?.disconnect();
    this.#visibilityAncestors = ancestors;
    for (const ancestor of ancestors) {
      this.#visibilityObserver?.observe(ancestor, {
        attributes: true,
        attributeFilter: ["class", "hidden", "style"],
      });
    }
  }

  #publishVisibility(): void {
    if (this.#destroyed) return;
    const visible = this.#elementVisible();
    if (visible === this.#visible) return;
    this.#visible = visible;
    this.#connection?.setVisible(visible);
    this.#playback.setVisible(visible);
    if (!visible) this.#clearRenderBindings();
    else this.#render();
    if (visible && !this.#connection) this.probeRuntimeNow();
  }

  #applyLayout(layout: PlannerResponsiveLayout): void {
    const resetDisclosureDefaults = this.#layout.mode !== layout.mode
      || this.#layout.hostContext !== layout.hostContext;
    this.#layout = layout;
    if (resetDisclosureDefaults) {
      this.#disclosures.setOpen("overview", false);
      this.#disclosures.setOpen("schedule", layout.scheduleInitiallyOpen);
    }
  }

  #render(): void {
    if (this.#destroyed || !this.#visible) return;
    if (this.#context.hostContext !== "replica") this.#root.hidden = false;
    const renderedLayout = this.#root.dataset.layout === "compact"
      || this.#root.dataset.layout === "wide"
      ? this.#root.dataset.layout
      : undefined;
    const focusedKey = this.#focus.capture();
    const nextLayout = plannerLayoutForWidth(
      plannerContainerWidth(this.#root),
      this.#context.hostContext,
    );
    this.#applyLayout(nextLayout);
    const restoreKey = plannerFocusKeyAfterLayoutTransition(
      focusedKey,
      renderedLayout ?? nextLayout.mode,
      nextLayout.mode,
    );
    if (restoreKey?.startsWith("row-") && nextLayout.mode === "compact") {
      this.#disclosures.setOpen("schedule", true);
    }
    this.#clearRenderBindings();
    this.#content.replaceChildren();
    this.#root.dataset.layout = this.#layout.mode;
    this.#root.dataset.narrow = String(this.#layout.narrow);
    if (this.#layout.suppressSurface) {
      this.#root.hidden = true;
      return;
    }
    this.#root.hidden = false;

    if (!this.#snapshot) {
      this.#renderRuntimeState();
      if (restoreKey) this.#focus.restore(restoreKey, "status");
      return;
    }
    if (this.#snapshot.state !== "confirmed") {
      this.#renderSnapshotState(this.#snapshot);
      if (restoreKey) this.#focus.restore(restoreKey, "status");
      return;
    }
    this.#renderConfirmed(this.#snapshot.projection);
    if (restoreKey) this.#focus.restore(restoreKey, "control-completed");
  }

  #clearRenderBindings(): void {
    for (const cleanup of this.#renderCleanups.splice(0)) cleanup();
  }

  #renderRuntimeState(): void {
    const pending = this.#runtime.state === "starting";
    this.#renderStatus(
      pending ? "loading" : "unavailable",
      this.#messages.t("shared", pending ? "status.loading" : "status.unavailable"),
      "",
    );
  }

  #renderSnapshotState(snapshot: Exclude<RuntimeSnapshot<RuntimePlanProjection>, { state: "confirmed" }>): void {
    const model = plannerSurfaceStateModel(snapshot, this.#layout, this.#messages);
    this.#renderStatus(snapshot.state, model.heading, model.message);
  }

  #renderStatus(state: string, headingText: string, messageText: string): void {
    const status = element(this.#root.ownerDocument, "section", "spiral-day-planner__status");
    status.dataset.state = state;
    status.dataset.plannerFocusKey = "status";
    status.tabIndex = -1;
    status.setAttribute("role", state === "loading" ? "status" : "alert");
    status.setAttribute("aria-live", state === "loading" ? "polite" : "assertive");
    const heading = element(this.#root.ownerDocument, "strong", "spiral-day-planner__status-heading");
    heading.textContent = headingText;
    const message = element(this.#root.ownerDocument, "span", "spiral-day-planner__status-message");
    message.textContent = messageText;
    status.append(heading, message);
    this.#content.append(status);
  }

  #createIconButton(icon: PlannerIconName, label: string, action: () => void): HTMLButtonElement {
    const button = element(this.#root.ownerDocument, "button", "clickable-icon spiral-day-planner__icon-button");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.dataset.control = icon === "collapse" || icon === "expand"
      ? "collapse"
      : icon === "hide-completed" || icon === "show-completed"
        ? "completed"
        : icon;
    button.dataset.plannerFocusKey = icon === "collapse" || icon === "expand"
      ? "control-collapse"
      : icon === "hide-completed" || icon === "show-completed"
        ? "control-completed"
        : icon === "debug"
          ? "control-debug"
          : "control-play";
    this.#renderIcon(button, icon);
    button.addEventListener("click", () => {
      if (button.getAttribute("aria-disabled") !== "true") action();
    });
    return button;
  }

  #renderConfirmed(projection: RuntimePlanProjection): void {
    const controlsState = this.#controls.state;
    if (controlsState.collapsed) {
      const expand = this.#createIconButton("expand", this.#messages.t("planner", "control.expand"), () => {
        try {
          if (this.#controls.toggleCollapsed()) {
            this.#live.announce(this.#messages.t("planner", "announcement.expanded"));
          }
        } catch {
          this.#live.announce(this.#messages.t("planner", "status.errorDetail"), "assertive");
        }
      });
      expand.classList.add("spiral-day-planner__collapsed-control");
      this.#content.append(expand);
      return;
    }

    const playbackMinute = this.#playbackFrame?.minute;
    const displayedProjection = playbackMinute === undefined
      ? projection
      : this.#playbackProjection(projection, playbackMinute);
    const spiral = buildPlannerSpiralModel(displayedProjection, this.#context.bounds, {
      mode: this.#layout.mode,
      showCompleted: controlsState.showCompleted,
      ...(playbackMinute === undefined ? {} : { playbackMinute }),
      measureLabel: (label) => this.#measureLabel(label),
      labelMaxWidth: plannerRailLabelMaxWidth(this.#layout.containerWidth),
    });

    const header = element(this.#root.ownerDocument, "header", "spiral-day-planner__header");
    if (this.#layout.showWideHeader) {
      const metrics = element(this.#root.ownerDocument, "div", "spiral-day-planner__metrics");
      appendMetrics(metrics, displayedProjection, this.#messages);
      header.append(metrics);
    }
    const headerEnd = element(this.#root.ownerDocument, "div", "spiral-day-planner__header-end");
    const controls = element(this.#root.ownerDocument, "div", "spiral-day-planner__controls");
    controls.append(
      this.#createIconButton("collapse", this.#messages.t("planner", "control.collapse"), () => {
        try {
          this.#playback.cancel("hidden");
          if (this.#controls.toggleCollapsed()) {
            this.#live.announce(this.#messages.t("planner", "announcement.collapsed"));
          }
        } catch {
          this.#live.announce(this.#messages.t("planner", "status.errorDetail"), "assertive");
        }
      }),
      this.#createIconButton(
        controlsState.showCompleted ? "hide-completed" : "show-completed",
        this.#messages.t("planner", controlsState.showCompleted ? "control.hideCompleted" : "control.showCompleted"),
        () => {
          if (!this.#controls.toggleCompleted()) return;
          this.#live.announce(this.#messages.t(
            "planner",
            this.#controls.state.showCompleted
              ? "announcement.completedShown"
              : "announcement.completedHidden",
          ));
        },
      ),
    );
    const play = this.#createIconButton(
      "play",
      this.#messages.t("planner", controlsState.playbackRunning ? "control.playbackRunning" : "control.play"),
      () => this.#startPlayback(),
    );
    if (controlsState.playbackRunning) play.setAttribute("aria-disabled", "true");
    controls.append(play);
    if (this.#controls.debugControl) {
      controls.classList.add("spiral-day-planner__controls--debug");
      const debugStateText = this.#messages.t(
        "planner",
        controlsState.debugEnabled ? "control.debugDisable" : "control.debugEnable",
      );
      const debug = this.#createIconButton(
        "debug",
        debugStateText,
        () => {
          if (!this.#controls.toggleDebug()) return;
          this.#live.announce(this.#messages.t(
            "planner",
            this.#controls.state.debugEnabled ? "announcement.debugOn" : "announcement.debugOff",
          ));
        },
      );
      debug.setAttribute("aria-pressed", String(controlsState.debugEnabled));
      debug.querySelector("svg")?.setAttribute("aria-hidden", "true");
      const debugText = element(this.#root.ownerDocument, "span", "spiral-day-planner__debug-state-text");
      debugText.textContent = debugStateText;
      debug.append(debugText);
      controls.append(debug);
    }
    headerEnd.append(controls);
    if (this.#layout.showWideHeader) {
      const legend = element(this.#root.ownerDocument, "div", "spiral-day-planner__legend");
      appendLegend(legend, this.#messages);
      headerEnd.append(legend);
    }
    header.append(headerEnd);
    this.#content.append(header);

    if (this.#layout.showCompactOverview) {
      this.#content.append(this.#renderOverview(displayedProjection));
    }
    this.#content.append(this.#renderSpiral(spiral, projection));
    if (this.#layout.showCompactSchedule) {
      this.#content.append(this.#renderSchedule(spiral, projection));
    }
    this.#appendDiagnostics(displayedProjection);
    if (this.#controls.debugControl && controlsState.debugEnabled) {
      const debug = element(this.#root.ownerDocument, "pre", "spiral-day-planner__debug-overlay");
      debug.textContent = this.#messages.t("planner", "debug.geometry", {
        width: Math.round(spiral.geometry.width),
        height: Math.round(spiral.geometry.height),
        innerRadius: Math.round(spiral.geometry.innerRadius),
        outerRadius: Math.round(spiral.geometry.outerRadius),
        bandWidth: Math.round(spiral.geometry.bandWidth),
        centerX: Math.round(spiral.geometry.center.x),
        centerY: Math.round(spiral.geometry.center.y),
        minute: Math.round(playbackMinute ?? projection.day.elapsedUntilMinutes ?? this.#context.bounds.startMinutes),
      });
      this.#content.append(debug);
    }
  }

  #playbackProjection(
    projection: RuntimePlanProjection,
    playbackMinute: number,
  ): RuntimePlanProjection {
    const day = projectDay({
      displayedDate: projection.displayedDate,
      today: projection.today,
      startMinutes: this.#context.bounds.startMinutes,
      endMinutes: this.#context.bounds.endMinutes,
      nowMinutes: playbackMinute,
      playbackMinutes: playbackMinute,
    });
    const scheduleInput = {
      startMinutes: this.#context.bounds.startMinutes,
      endMinutes: this.#context.bounds.endMinutes,
      nowMinutes: day.scheduleFromMinutes,
      items: projection.items,
    };
    return Object.freeze({
      ...projection,
      day,
      schedule: schedulePlan(scheduleInput),
      capacity: calculateCapacity(scheduleInput),
    });
  }

  #measureLabel(label: string): number {
    const canvas = this.#root.ownerDocument.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return [...label].length * 7.2;
    const style = this.#root.ownerDocument.defaultView?.getComputedStyle(this.#root);
    context.font = `${style?.fontSize ?? "14px"} ${style?.fontFamily ?? "sans-serif"}`;
    return context.measureText(label).width + 4;
  }

  #renderOverview(projection: RuntimePlanProjection): HTMLDetailsElement {
    const details = element(this.#root.ownerDocument, "details", "spiral-day-planner__disclosure spiral-day-planner__overview");
    const summary = element(this.#root.ownerDocument, "summary", "spiral-day-planner__disclosure-summary");
    summary.textContent = this.#messages.t("planner", "disclosure.overview");
    summary.dataset.plannerFocusKey = "disclosure-overview";
    summary.setAttribute(
      "aria-label",
      `${this.#messages.t("planner", "disclosure.overview")}, ${this.#messages.t("planner", "metric.availableTime")} ${this.#messages.t("shared", "unit.duration", { minutes: projection.capacity.availableMinutes })}`,
    );
    const body = element(this.#root.ownerDocument, "div", "spiral-day-planner__overview-body");
    const metrics = element(this.#root.ownerDocument, "div", "spiral-day-planner__metrics");
    appendMetrics(metrics, projection, this.#messages);
    const legend = element(this.#root.ownerDocument, "div", "spiral-day-planner__legend");
    appendLegend(legend, this.#messages);
    body.append(metrics, legend);
    details.append(summary, body);
    this.#renderCleanups.push(bindPlannerDisclosure(details, "overview", this.#disclosures));
    return details;
  }

  #renderSchedule(
    spiral: PlannerSpiralModel,
    projection: RuntimePlanProjection,
  ): HTMLDetailsElement {
    const details = element(this.#root.ownerDocument, "details", "spiral-day-planner__disclosure spiral-day-planner__schedule");
    const summary = element(this.#root.ownerDocument, "summary", "spiral-day-planner__disclosure-summary");
    summary.textContent = this.#messages.t("planner", "disclosure.schedule", { count: spiral.items.length });
    summary.dataset.plannerFocusKey = "disclosure-schedule";
    summary.setAttribute("aria-label", summary.textContent);
    const list = element(details.ownerDocument, "ul", "spiral-day-planner__disclosure-list");
    for (const item of spiral.items) {
      const row = element(details.ownerDocument, "li", "spiral-day-planner__disclosure-row spiral-day-planner__interactive-item");
      row.dataset.tone = item.tone;
      row.dataset.completed = String(item.completed);
      row.dataset.conflict = String(item.conflict);
      row.dataset.current = String(item.current);
      row.dataset.itemId = item.id;
      row.dataset.plannerFocusKey = `row-${item.id}`;
      const name = timelineAccessibleName(this.#messages, item);
      row.setAttribute("aria-label", name);
      const title = element(details.ownerDocument, "span", "spiral-day-planner__interactive-item-title");
      title.textContent = item.title;
      const meta = element(details.ownerDocument, "span", "spiral-day-planner__interactive-item-meta");
      meta.textContent = `${formatClockMinute(item.startMinutes)}-${formatClockMinute(item.endMinutes)}`;
      const state = element(details.ownerDocument, "span", "spiral-day-planner__interactive-item-state");
      state.textContent = [timelineKind(this.#messages, item), timelineStates(this.#messages, item)]
        .filter(Boolean).join(" | ");
      row.append(title, meta, state);
      this.#bindProgressTarget(row, item, projection);
      list.append(row);
    }
    details.append(summary, list);
    this.#renderCleanups.push(bindPlannerDisclosure(details, "schedule", this.#disclosures));
    return details;
  }

  #appendDiagnostics(projection: RuntimePlanProjection): void {
    const overflow = plannerOverflow(projection);
    if (overflow.length > 0) {
      const details = element(this.#root.ownerDocument, "details", "spiral-day-planner__disclosure spiral-day-planner__overflow");
      const summary = element(this.#root.ownerDocument, "summary", "spiral-day-planner__disclosure-summary");
      const total = overflow.reduce((sum, row) => sum + row.durationMinutes, 0);
      summary.textContent = this.#messages.t("planner", "disclosure.overflow", {
        count: overflow.length,
        duration: this.#messages.t("shared", "unit.duration", { minutes: total }),
      });
      summary.dataset.plannerFocusKey = "disclosure-overflow";
      summary.setAttribute("aria-label", summary.textContent);
      details.append(summary);
      appendDisclosureRows(details, overflow.map((row) => ({
        title: row.title,
        meta: this.#messages.t("shared", "unit.duration", { minutes: row.durationMinutes }),
        tone: "warning",
      })));
      this.#renderCleanups.push(bindPlannerDisclosure(details, "overflow", this.#disclosures));
      this.#content.append(details);
    }
    const labels = new Map(projection.items.map((item) => [item.sourceOrder, item.label]));
    const warningKeys = Object.freeze({
      "duplicate-plan-region": "warning.planRegionDuplicate",
      "empty-plan-item": "warning.emptyPlanItem",
      "invalid-time-range": "warning.invalidTimeRange",
      "nested-plan-region": "warning.planRegionNested",
      "overnight-truncated": "warning.overnightTruncated",
      "same-time": "warning.sameTime",
      "unclosed-plan-region": "warning.planRegionUnclosed",
      "unsupported-plan-version": "warning.planVersionUnsupported",
    } as const satisfies Readonly<Record<ParserDiagnosticCode | PlanRegionDiagnosticCode, string>>);
    const warnings = projection.diagnostics.flatMap((diagnostic) => {
      const key = warningKeys[diagnostic.code as keyof typeof warningKeys];
      if (!key) return [];
      return [Object.freeze({
        title: diagnostic.sourceOrder === null
          ? this.#messages.t("planner", "warning.plan")
          : labels.get(diagnostic.sourceOrder)
            ?? this.#messages.t("planner", "warning.itemFallback", { index: diagnostic.sourceOrder + 1 }),
        message: this.#messages.t("planner", key),
      })];
    });
    if (warnings.length > 0) {
      const details = element(this.#root.ownerDocument, "details", "spiral-day-planner__disclosure spiral-day-planner__warnings");
      const summary = element(this.#root.ownerDocument, "summary", "spiral-day-planner__disclosure-summary");
      summary.textContent = this.#messages.t("planner", "disclosure.warnings", { count: warnings.length });
      summary.dataset.plannerFocusKey = "disclosure-warnings";
      summary.setAttribute("aria-label", summary.textContent);
      details.append(summary);
      appendDisclosureRows(details, warnings.map((row) => ({
        title: row.title,
        meta: row.message,
        tone: "warning",
      })));
      this.#renderCleanups.push(bindPlannerDisclosure(details, "warnings", this.#disclosures));
      this.#content.append(details);
    }
  }

  #renderSpiral(
    model: PlannerSpiralModel,
    projection: RuntimePlanProjection,
  ): SVGSVGElement {
    const document = this.#root.ownerDocument;
    const svg = svgElement(document, "svg", "spiral-day-planner__spiral");
    const viewBox = spiralViewBox(model.geometry, model.labels);
    svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
    svg.setAttribute("role", "group");
    svg.setAttribute("aria-label", this.#messages.t("planner", "surface.name"));
    svg.dataset.mode = model.mode;

    const defs = svgElement(document, "defs");
    const hatch = svgElement(document, "pattern");
    hatch.id = this.#patternIds.hatch;
    hatch.setAttribute("width", "6");
    hatch.setAttribute("height", "6");
    hatch.setAttribute("patternUnits", "userSpaceOnUse");
    hatch.setAttribute("patternTransform", "rotate(35)");
    const hatchLine = svgElement(document, "line");
    hatchLine.setAttribute("x1", "0");
    hatchLine.setAttribute("y1", "0");
    hatchLine.setAttribute("x2", "0");
    hatchLine.setAttribute("y2", "6");
    hatchLine.setAttribute("class", "spiral-day-planner__hatch-line");
    hatch.append(hatchLine);
    const dots = svgElement(document, "pattern");
    dots.id = this.#patternIds.dots;
    dots.setAttribute("width", "5");
    dots.setAttribute("height", "5");
    dots.setAttribute("patternUnits", "userSpaceOnUse");
    const dot = svgElement(document, "circle");
    dot.setAttribute("cx", "1.5");
    dot.setAttribute("cy", "1.5");
    dot.setAttribute("r", "1");
    dot.setAttribute("class", "spiral-day-planner__progress-dot");
    dots.append(dot);
    defs.append(hatch, dots);
    svg.append(defs);

    const fullGrid = svgElement(document, "path", "spiral-day-planner__grid-band");
    fullGrid.setAttribute("d", this.#fullSpiralPath(model));
    svg.append(fullGrid);
    if (model.elapsedPath) {
      const elapsed = svgElement(document, "path", "spiral-day-planner__elapsed");
      elapsed.setAttribute("d", model.elapsedPath);
      elapsed.style.fill = `url(\"#${this.#patternIds.hatch}\")`;
      svg.append(elapsed);
    }
    for (const tick of model.ticks) {
      const line = svgElement(document, "line", "spiral-day-planner__tick");
      line.setAttribute("x1", String(tick.inner.x));
      line.setAttribute("y1", String(tick.inner.y));
      line.setAttribute("x2", String(tick.outer.x));
      line.setAttribute("y2", String(tick.outer.y));
      const label = svgElement(document, "text", "spiral-day-planner__hour");
      label.setAttribute("x", String(tick.labelPoint.x));
      label.setAttribute("y", String(tick.labelPoint.y));
      label.textContent = tick.label;
      svg.append(line, label);
    }
    for (const slot of model.availableSlots) {
      const group = svgElement(document, "g", "spiral-day-planner__target spiral-day-planner__available");
      const path = svgElement(document, "path");
      path.setAttribute("d", slot.path);
      group.append(path);
      if (model.mode === "wide") {
        const availableName = this.#messages.t("planner", "item.availableName", {
          start: formatClockMinute(slot.startMinutes),
          end: formatClockMinute(slot.endMinutes),
          duration: this.#messages.t("shared", "unit.duration", { minutes: slot.durationMinutes }),
          states: slot.availableNow ? this.#messages.t("shared", "state.current") : "",
        });
        group.setAttribute("role", "img");
        group.setAttribute("tabindex", "0");
        group.setAttribute("focusable", "true");
        group.setAttribute("aria-label", availableName);
        group.dataset.plannerFocusKey = `available-${slot.id}`;
        this.#bindTooltip(group, availableName);
      } else {
        group.setAttribute("aria-hidden", "true");
      }
      svg.append(group);
    }
    for (const item of model.items) svg.append(this.#renderTimelineTarget(item, model.mode, projection));
    for (const label of model.labels) {
      const connector = svgElement(document, "path", "spiral-day-planner__connector");
      connector.dataset.tone = label.timelineItem.tone;
      connector.setAttribute(
        "d",
        `M ${label.anchor.x.toFixed(2)} ${label.anchor.y.toFixed(2)} `
          + `L ${label.connectorEnd.x.toFixed(2)} ${label.connectorEnd.y.toFixed(2)}`,
      );
      const group = svgElement(document, "g", "spiral-day-planner__external-label");
      group.dataset.tone = label.timelineItem.tone;
      const accessibleName = timelineAccessibleName(this.#messages, label.timelineItem);
      group.setAttribute("role", "img");
      group.setAttribute("tabindex", "0");
      group.setAttribute("focusable", "true");
      group.setAttribute("aria-label", accessibleName);
      group.dataset.plannerFocusKey = `label-${label.timelineItem.id}`;
      if (label.timelineItem.current) group.setAttribute("aria-current", "true");
      const text = svgElement(document, "text");
      text.setAttribute("x", String(label.side === "left" ? label.box.x + label.box.width : label.box.x));
      text.setAttribute("y", String(label.box.y + label.box.height - 3));
      text.setAttribute("text-anchor", label.side === "left" ? "end" : "start");
      text.textContent = label.visibleText;
      const title = svgElement(document, "title");
      title.textContent = accessibleName;
      group.append(title, text);
      this.#bindTooltip(group, timelineTooltipText(this.#messages, label.timelineItem), connector);
      svg.append(connector, group);
    }
    if (model.needlePath) {
      const needle = svgElement(document, "path", "spiral-day-planner__needle");
      needle.setAttribute("d", model.needlePath);
      needle.setAttribute("aria-hidden", "true");
      svg.append(needle);
    }
    const center = svgElement(document, "g", "spiral-day-planner__center");
    center.setAttribute("aria-hidden", "true");
    const title = svgElement(document, "text", "spiral-day-planner__center-title");
    title.setAttribute("x", String(model.geometry.center.x));
    title.setAttribute("y", String(model.geometry.center.y - 3));
    title.textContent = model.title;
    center.append(title);
    if (model.centerTime) {
      const time = svgElement(document, "text", "spiral-day-planner__center-time");
      time.setAttribute("x", String(model.geometry.center.x));
      time.setAttribute("y", String(model.geometry.center.y + 15));
      time.textContent = model.centerTime;
      center.append(time);
    }
    svg.append(center);
    if (this.#controls.debugControl && this.#controls.state.debugEnabled) {
      const debugGeometry = svgElement(document, "g", "spiral-day-planner__debug-geometry");
      debugGeometry.dataset.debugGeometry = "true";
      debugGeometry.setAttribute("aria-hidden", "true");
      const canvasBounds = svgElement(document, "rect", "spiral-day-planner__debug-rectangle");
      canvasBounds.dataset.debugMarker = "canvas-bounds";
      canvasBounds.setAttribute("x", "0.5");
      canvasBounds.setAttribute("y", "0.5");
      canvasBounds.setAttribute("width", String(model.geometry.width - 1));
      canvasBounds.setAttribute("height", String(model.geometry.height - 1));
      const radialBounds = svgElement(document, "rect", "spiral-day-planner__debug-rectangle");
      radialBounds.dataset.debugMarker = "radial-bounds";
      radialBounds.setAttribute("x", String(model.geometry.center.x - model.geometry.outerRadius));
      radialBounds.setAttribute("y", String(model.geometry.center.y - model.geometry.outerRadius));
      radialBounds.setAttribute("width", String(model.geometry.outerRadius * 2));
      radialBounds.setAttribute("height", String(model.geometry.outerRadius * 2));
      const guideCircle = svgElement(document, "circle", "spiral-day-planner__debug-guide-circle");
      guideCircle.dataset.debugMarker = "guide-circle";
      guideCircle.setAttribute("cx", String(model.geometry.center.x));
      guideCircle.setAttribute("cy", String(model.geometry.center.y));
      guideCircle.setAttribute("r", String(model.geometry.outerRadius + model.geometry.bandWidth / 2));
      const centerMarker = svgElement(document, "circle", "spiral-day-planner__debug-center-marker");
      centerMarker.dataset.debugMarker = "center";
      centerMarker.setAttribute("cx", String(model.geometry.center.x));
      centerMarker.setAttribute("cy", String(model.geometry.center.y));
      centerMarker.setAttribute("r", "7");
      debugGeometry.append(canvasBounds, radialBounds, guideCircle, centerMarker);
      svg.append(debugGeometry);
    }
    return svg;
  }

  #fullSpiralPath(model: PlannerSpiralModel): string {
    const { startMinutes, endMinutes } = model.geometry.bounds;
    const start = spiralBandPath(startMinutes, endMinutes, model.geometry);
    return start;
  }

  #renderTimelineTarget(
    item: PlannerTimelineItem,
    mode: PlannerSpiralModel["mode"],
    projection: RuntimePlanProjection,
  ): SVGGElement {
    const group = svgElement(this.#root.ownerDocument, "g", "spiral-day-planner__target spiral-day-planner__item");
    group.dataset.tone = item.tone;
    group.dataset.conflict = String(item.conflict);
    group.dataset.current = String(item.current);
    group.dataset.past = String(item.past);
    const path = svgElement(this.#root.ownerDocument, "path", "spiral-day-planner__item-path");
    path.setAttribute("d", item.path);
    group.append(path);
    if (item.progressPercent > 0 && !item.completed) {
      const progress = svgElement(this.#root.ownerDocument, "path", "spiral-day-planner__progress");
      progress.setAttribute("d", item.path);
      progress.style.fill = `url(\"#${this.#patternIds.dots}\")`;
      group.append(progress);
    }
    const accessibleName = timelineAccessibleName(this.#messages, item);
    const title = svgElement(this.#root.ownerDocument, "title");
    title.textContent = accessibleName;
    group.append(title);
    if (mode === "wide") {
      group.setAttribute("focusable", "true");
      group.setAttribute("aria-label", accessibleName);
      group.dataset.plannerFocusKey = `slice-${item.id}`;
      if (item.current) group.setAttribute("aria-current", "true");
      this.#bindProgressTarget(group, item, projection);
      this.#bindTooltip(group, timelineTooltipText(this.#messages, item));
    } else {
      group.setAttribute("aria-hidden", "true");
    }
    return group;
  }

  #bindProgressTarget(
    target: HTMLElement | SVGElement,
    item: PlannerTimelineItem,
    projection: RuntimePlanProjection,
  ): void {
    const source = projection.items.find((candidate) => candidate.sourceOrder === item.sourceOrder);
    if (source) target.dataset.itemId = source.source.blockId ?? item.id;
    if (!source || !this.#onProgressIntent) {
      target.setAttribute("role", "img");
      target.setAttribute("tabindex", "0");
      return;
    }
    const progressTarget = (): PlannerProgressTarget => Object.freeze({
      authoritative: true,
      blockId: source.source.blockId,
      dayRelation: projection.day.relation,
      executionEligible: source.executionEligible,
      itemId: source.source.blockId ?? item.id,
      kind: source.kind,
      path: source.source.path,
      progress: Object.freeze({
        present: "unknown" as const,
        projectedPercent: source.progressPercent,
      }),
      sourceOrder: source.sourceOrder,
      status: source.status,
      title: source.label,
    });
    this.#renderCleanups.push(bindPlannerProgressTarget(
      target,
      progressTarget,
      (dispatch) => {
        this.#live.announce(this.#messages.t("planner", "announcement.progressPending", {
          title: dispatch.target.title,
        }));
        try {
          const result = this.#onProgressIntent?.(dispatch.intent);
          if (result && "catch" in result) {
            void result.catch(() => {
              this.#live.announce(this.#messages.t("planner", "status.errorDetail"), "assertive");
            });
          }
        } catch {
          this.#live.announce(this.#messages.t("planner", "status.errorDetail"), "assertive");
        }
      },
    ));
  }

  #bindTooltip(target: SVGElement, text: string, companion?: SVGElement): void {
    if (!this.#layout.mountHoverSurface) return;
    const tooltip = element(this.#root.ownerDocument, "div", "spiral-day-planner__tooltip");
    tooltip.id = `spiral-day-planner-tooltip-${++plannerTooltipSequence}`;
    this.#root.ownerDocument.body.append(tooltip);
    const emphasize = (): void => {
      companion?.classList.add("is-emphasized");
      target.classList.add("is-emphasized");
    };
    const deemphasize = (): void => {
      companion?.classList.remove("is-emphasized");
      target.classList.remove("is-emphasized");
    };
    target.addEventListener("mouseenter", emphasize);
    target.addEventListener("mouseleave", deemphasize);
    target.addEventListener("focus", emphasize);
    target.addEventListener("blur", deemphasize);
    const unbindTooltip = bindPlannerTooltip(target, tooltip, text);
    this.#renderCleanups.push(() => {
      unbindTooltip();
      target.removeEventListener("mouseenter", emphasize);
      target.removeEventListener("mouseleave", deemphasize);
      target.removeEventListener("focus", emphasize);
      target.removeEventListener("blur", deemphasize);
      deemphasize();
      tooltip.remove();
    });
  }

  #startPlayback(): void {
    this.#playback.start(this.#context.bounds);
  }
}

export function mountPlannerSurface(
  root: HTMLElement,
  runtime: PlannerRuntimePort,
  context: PlannerViewContext,
  options: PlannerSurfaceOptions = {},
): PlannerSurface {
  return new PlannerSurfaceController(root, runtime, context, options);
}
