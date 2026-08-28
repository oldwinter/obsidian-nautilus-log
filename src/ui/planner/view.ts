import type { LogicalDate } from "../../core/day";
import type {
  RuntimeConnection,
  RuntimePlanProjection,
  RuntimeSnapshotListener,
  RuntimeViewContext,
} from "../../runtime/projection-runtime";
import type { RuntimeSnapshot } from "../../runtime/snapshots";
import { formatClockMinute, formatDuration, plannerOverflow, plannerWarnings } from "./diagnostics";
import { placeTooltip, spiralBandPath, spiralViewBox, type PlannerTimeBounds } from "./geometry";
import {
  initialPlannerPresentationState,
  normalizeStateForLayout,
  plannerPlaybackMinute,
  reducePlannerPresentationState,
  type PlannerPresentationState,
} from "./planner-state";
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
const PLAYBACK_DURATION_MILLISECONDS = 6_000;

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

export type PlannerIconName = "collapse" | "expand" | "hide-completed" | "show-completed" | "play";
export type PlannerIconRenderer = (element: HTMLElement, icon: PlannerIconName) => void;

export interface PlannerSurfaceOptions {
  readonly renderIcon?: PlannerIconRenderer;
  readonly now?: () => number;
}

export interface PlannerSurface {
  setContext(context: PlannerViewContext): void;
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
): PlannerSurfaceStateModel {
  if (!snapshot) {
    return Object.freeze({
      state: "runtime-unavailable",
      authoritative: false,
      heading: "Spiral Day unavailable",
      message: "The shared planner runtime is not ready.",
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
      heading: "Planner confirmed",
      message: "",
      hierarchy: Object.freeze(hierarchy),
      mutationEnabled: false,
    });
  }
  const copy = snapshot.state === "loading"
    ? ["Loading Spiral Day...", "Reading the confirmed plan snapshot."]
    : snapshot.state === "missing"
      ? ["No Primary Plan", "No supported Plan Region was found for this day."]
      : snapshot.state === "over-limit"
        ? ["Planner input limit reached", `${snapshot.overLimit.actual} ${snapshot.overLimit.kind}; limit ${snapshot.overLimit.limit}.`]
        : snapshot.state === "stale"
          ? ["Planner snapshot is stale", "Refreshing after a source change. No stale projection is shown."]
          : snapshot.state === "hidden"
            ? ["Planner refresh paused", "This leaf is hidden; the projection will refresh when revealed."]
            : ["Planner could not load", `Diagnostic: ${snapshot.diagnostic.code}.`];
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
  kind: string,
  minutes: number,
  percent: number | null,
  burning: boolean,
): void {
  const metric = element(parent.ownerDocument, "div", "spiral-day-planner__metric");
  metric.dataset.metric = kind;
  if (burning) metric.dataset.burning = "true";
  const value = element(parent.ownerDocument, "span", "spiral-day-planner__metric-value");
  value.textContent = formatDuration(minutes);
  const label = element(parent.ownerDocument, "span", "spiral-day-planner__metric-label");
  label.textContent = kind.replaceAll("-", " ");
  metric.append(value, label);
  if (percent !== null) {
    const total = element(parent.ownerDocument, "span", "spiral-day-planner__metric-percent");
    total.textContent = `${percent}%`;
    metric.append(total);
  }
  parent.append(metric);
}

function appendMetrics(parent: HTMLElement, projection: RuntimePlanProjection): void {
  parent.setAttribute("role", "status");
  parent.setAttribute(
    "aria-label",
    projection.capacity.metrics
      .map((metric) => `${metric.kind} ${formatDuration(metric.minutes)}`)
      .join(", "),
  );
  for (const metric of projection.capacity.metrics) {
    appendMetric(parent, metric.kind, metric.minutes, metric.percent, metric.burning);
  }
}

function appendLegend(parent: HTMLElement): void {
  parent.setAttribute("aria-label", "Planner legend: urgent, event, task");
  for (const [tone, label] of [["urgent", "Urgent"], ["event", "Event"], ["task", "Task"]] as const) {
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

function timelineTooltipText(item: PlannerTimelineItem): string {
  return `${item.kind === "event" ? "Fixed event" : item.tone === "urgent" ? "Urgent task" : "Task"}`
    + ` | ${item.title} | ${formatClockMinute(item.startMinutes)}-${formatClockMinute(item.endMinutes)}`
    + ` | ${formatDuration(item.durationMinutes)}`;
}

class PlannerSurfaceController implements PlannerSurface {
  readonly #root: HTMLElement;
  readonly #runtime: PlannerRuntimePort;
  readonly #renderIcon: PlannerIconRenderer;
  readonly #now: () => number;
  #context: PlannerViewContext;
  #connection: RuntimeConnection | undefined;
  #snapshot: RuntimeSnapshot<RuntimePlanProjection> | undefined;
  #layout: PlannerResponsiveLayout;
  #presentation: PlannerPresentationState;
  #resize: PlannerResizeSubscription | undefined;
  #visibilityObserver: MutationObserver | undefined;
  #documentVisibilityListener: (() => void) | undefined;
  #probeTimer: number | undefined;
  #animationFrame: number | undefined;
  #tooltip: HTMLElement | undefined;
  #pendingFocusKey: string | undefined;
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
    this.#now = options.now ?? Date.now;
    this.#layout = plannerLayoutForWidth(plannerContainerWidth(root), context.hostContext);
    this.#presentation = initialPlannerPresentationState(context.hostContext);
    root.classList.add("spiral-day-planner");
    this.#visible = this.#elementVisible();
    this.#observeVisibility();
    this.#resize = observePlannerContainer(root, context.hostContext, (layout) => {
      this.#applyLayout(layout);
      this.#removeTooltip();
      this.#render();
    });
    this.probeRuntimeNow();
  }

  setContext(context: PlannerViewContext): void {
    if (this.#destroyed) return;
    const validated = validatePlannerViewContext(context);
    const hostChanged = validated.hostContext !== this.#context.hostContext;
    this.#context = validated;
    this.#connection?.setContext({ logicalDate: validated.logicalDate });
    if (hostChanged) {
      this.#resize?.disconnect();
      this.#layout = plannerLayoutForWidth(plannerContainerWidth(this.#root), validated.hostContext);
      this.#presentation = initialPlannerPresentationState(validated.hostContext);
      this.#resize = observePlannerContainer(this.#root, validated.hostContext, (layout) => {
        this.#applyLayout(layout);
        this.#render();
      });
    }
    this.#removeTooltip();
    this.#render();
  }

  measure(): void {
    this.#resize?.measure();
  }

  probeRuntimeNow(): void {
    if (this.#destroyed || this.#connection) return;
    if (this.#runtime.state === "ready") {
      try {
        this.#connection = this.#runtime.connect(
          { logicalDate: this.#context.logicalDate },
          (snapshot) => {
            if (this.#destroyed) return;
            this.#snapshot = snapshot;
            this.#render();
          },
          this.#visible,
        );
        this.#clearProbe();
      } catch {
        this.#snapshot = undefined;
        this.#scheduleProbe();
      }
    } else {
      this.#snapshot = undefined;
      this.#scheduleProbe();
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
    if (this.#documentVisibilityListener) {
      this.#root.ownerDocument.removeEventListener("visibilitychange", this.#documentVisibilityListener);
    }
    this.#documentVisibilityListener = undefined;
    this.#clearProbe();
    const view = this.#root.ownerDocument.defaultView;
    if (this.#animationFrame !== undefined) view?.cancelAnimationFrame(this.#animationFrame);
    this.#animationFrame = undefined;
    this.#removeTooltip();
    this.#root.replaceChildren();
    this.#root.classList.remove("spiral-day-planner");
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
      let ancestor: HTMLElement | null = this.#root;
      while (ancestor) {
        this.#visibilityObserver.observe(ancestor, {
          attributes: true,
          attributeFilter: ["class", "hidden", "style"],
        });
        ancestor = ancestor.parentElement;
      }
    }
  }

  #publishVisibility(): void {
    if (this.#destroyed) return;
    const visible = this.#elementVisible();
    if (visible === this.#visible) return;
    this.#visible = visible;
    this.#connection?.setVisible(visible);
    if (!visible && this.#animationFrame !== undefined) {
      this.#root.ownerDocument.defaultView?.cancelAnimationFrame(this.#animationFrame);
      this.#animationFrame = undefined;
    }
    if (visible && !this.#connection) this.probeRuntimeNow();
  }

  #focusedKey(): string | undefined {
    const active = this.#root.ownerDocument.activeElement;
    if (!active || !this.#root.contains(active)) return undefined;
    return (active as HTMLElement | SVGElement).dataset.plannerFocusKey;
  }

  #restoreFocus(key: string | undefined): boolean {
    if (!key) return false;
    const target = [...this.#root.querySelectorAll<HTMLElement | SVGElement>("[data-planner-focus-key]")]
      .find((element) => element.dataset.plannerFocusKey === key);
    target?.focus({ preventScroll: true });
    return target !== undefined;
  }

  #applyLayout(layout: PlannerResponsiveLayout): void {
    const previousMode = this.#layout.mode;
    this.#layout = layout;
    this.#presentation = normalizeStateForLayout(
      this.#presentation,
      previousMode,
      layout.mode,
      this.#context.hostContext,
    );
  }

  #render(): void {
    if (this.#destroyed) return;
    if (this.#context.hostContext !== "replica") this.#root.hidden = false;
    this.#applyLayout(plannerLayoutForWidth(
      plannerContainerWidth(this.#root),
      this.#context.hostContext,
    ));
    const focusedKey = this.#focusedKey();
    if (focusedKey) this.#pendingFocusKey = focusedKey;
    this.#removeTooltip();
    this.#root.replaceChildren();
    this.#root.dataset.layout = this.#layout.mode;
    this.#root.dataset.narrow = String(this.#layout.narrow);
    if (this.#layout.suppressSurface) {
      this.#root.hidden = true;
      return;
    }
    this.#root.hidden = false;

    if (!this.#snapshot) {
      this.#renderRuntimeState();
      return;
    }
    if (this.#snapshot.state !== "confirmed") {
      this.#renderSnapshotState(this.#snapshot);
      return;
    }
    this.#renderConfirmed(this.#snapshot.projection);
    const active = this.#root.ownerDocument.activeElement;
    const canRestorePending = active === null || active === this.#root.ownerDocument.body
      || this.#root.contains(active);
    this.#restoreFocus(focusedKey ?? (canRestorePending ? this.#pendingFocusKey : undefined));
    this.#pendingFocusKey = undefined;
  }

  #renderRuntimeState(): void {
    const pending = this.#runtime.state === "starting";
    this.#renderStatus(
      pending ? "loading" : "unavailable",
      pending ? "Loading Spiral Day..." : "Spiral Day unavailable",
      pending
        ? "Waiting for the shared planner runtime."
        : "The shared planner runtime is not available. Reload Obsidian to retry.",
    );
  }

  #renderSnapshotState(snapshot: Exclude<RuntimeSnapshot<RuntimePlanProjection>, { state: "confirmed" }>): void {
    const model = plannerSurfaceStateModel(snapshot, this.#layout);
    this.#renderStatus(snapshot.state, model.heading, model.message);
  }

  #renderStatus(state: string, headingText: string, messageText: string): void {
    const status = element(this.#root.ownerDocument, "section", "spiral-day-planner__status");
    status.dataset.state = state;
    status.setAttribute("role", state === "loading" ? "status" : "alert");
    status.setAttribute("aria-live", state === "loading" ? "polite" : "assertive");
    const heading = element(this.#root.ownerDocument, "strong", "spiral-day-planner__status-heading");
    heading.textContent = headingText;
    const message = element(this.#root.ownerDocument, "span", "spiral-day-planner__status-message");
    message.textContent = messageText;
    status.append(heading, message);
    this.#root.append(status);
  }

  #createIconButton(icon: PlannerIconName, label: string, action: () => void): HTMLButtonElement {
    const button = element(this.#root.ownerDocument, "button", "clickable-icon spiral-day-planner__icon-button");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.dataset.plannerFocusKey = icon === "collapse" || icon === "expand"
      ? "control-collapse"
      : icon === "hide-completed" || icon === "show-completed"
        ? "control-completed"
        : "control-play";
    this.#renderIcon(button, icon);
    button.addEventListener("click", () => {
      if (button.getAttribute("aria-disabled") !== "true") action();
    });
    return button;
  }

  #renderConfirmed(projection: RuntimePlanProjection): void {
    if (this.#presentation.collapsed) {
      const expand = this.#createIconButton("expand", "Expand planner", () => {
        this.#presentation = reducePlannerPresentationState(this.#presentation, { type: "toggle-collapse" });
        this.#render();
      });
      expand.classList.add("spiral-day-planner__collapsed-control");
      this.#root.append(expand);
      return;
    }

    const now = this.#now();
    const playbackMinute = plannerPlaybackMinute(
      this.#presentation,
      now,
      this.#context.bounds.startMinutes,
      this.#context.bounds.endMinutes,
    );
    if (this.#presentation.playback === "running" && playbackMinute === null) {
      this.#presentation = reducePlannerPresentationState(this.#presentation, { type: "finish-playback" });
    }
    const spiral = buildPlannerSpiralModel(projection, this.#context.bounds, {
      mode: this.#layout.mode,
      showCompleted: this.#presentation.showCompleted,
      ...(playbackMinute === null ? {} : { playbackMinute }),
      measureLabel: (label) => this.#measureLabel(label),
      labelMaxWidth: plannerRailLabelMaxWidth(this.#layout.containerWidth),
    });

    const header = element(this.#root.ownerDocument, "header", "spiral-day-planner__header");
    if (this.#layout.showWideHeader) {
      const metrics = element(this.#root.ownerDocument, "div", "spiral-day-planner__metrics");
      appendMetrics(metrics, projection);
      header.append(metrics);
    }
    const headerEnd = element(this.#root.ownerDocument, "div", "spiral-day-planner__header-end");
    const controls = element(this.#root.ownerDocument, "div", "spiral-day-planner__controls");
    controls.append(
      this.#createIconButton("collapse", "Collapse planner", () => {
        this.#presentation = reducePlannerPresentationState(this.#presentation, { type: "toggle-collapse" });
        this.#render();
      }),
      this.#createIconButton(
        this.#presentation.showCompleted ? "hide-completed" : "show-completed",
        this.#presentation.showCompleted ? "Hide completed items" : "Show completed items",
        () => {
          this.#presentation = reducePlannerPresentationState(this.#presentation, { type: "toggle-completed" });
          this.#render();
        },
      ),
    );
    const play = this.#createIconButton("play", "Play day", () => this.#startPlayback());
    if (this.#presentation.playback === "running") play.setAttribute("aria-disabled", "true");
    controls.append(play);
    headerEnd.append(controls);
    if (this.#layout.showWideHeader) {
      const legend = element(this.#root.ownerDocument, "div", "spiral-day-planner__legend");
      appendLegend(legend);
      headerEnd.append(legend);
    }
    header.append(headerEnd);
    this.#root.append(header);

    if (this.#layout.showCompactOverview) {
      this.#root.append(this.#renderOverview(projection));
    }
    this.#root.append(this.#renderSpiral(spiral));
    if (this.#layout.showCompactSchedule) {
      this.#root.append(this.#renderSchedule(spiral));
    }
    this.#appendDiagnostics(projection);

    if (this.#presentation.playback === "running") this.#schedulePlaybackFrame();
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
    details.open = this.#presentation.overviewOpen;
    const summary = element(this.#root.ownerDocument, "summary", "spiral-day-planner__disclosure-summary");
    summary.textContent = "Overview";
    summary.dataset.plannerFocusKey = "disclosure-overview";
    summary.setAttribute(
      "aria-label",
      `Overview, ${projection.capacity.status}, available ${formatDuration(projection.capacity.availableMinutes)}`,
    );
    const body = element(this.#root.ownerDocument, "div", "spiral-day-planner__overview-body");
    const metrics = element(this.#root.ownerDocument, "div", "spiral-day-planner__metrics");
    appendMetrics(metrics, projection);
    const legend = element(this.#root.ownerDocument, "div", "spiral-day-planner__legend");
    appendLegend(legend);
    body.append(metrics, legend);
    details.append(summary, body);
    details.addEventListener("toggle", () => {
      if (details.open !== this.#presentation.overviewOpen) {
        this.#presentation = reducePlannerPresentationState(this.#presentation, { type: "toggle-overview" });
      }
    });
    return details;
  }

  #renderSchedule(spiral: PlannerSpiralModel): HTMLDetailsElement {
    const details = element(this.#root.ownerDocument, "details", "spiral-day-planner__disclosure spiral-day-planner__schedule");
    details.open = this.#presentation.scheduleOpen;
    const summary = element(this.#root.ownerDocument, "summary", "spiral-day-planner__disclosure-summary");
    summary.textContent = `Schedule | ${spiral.items.length} item${spiral.items.length === 1 ? "" : "s"}`;
    summary.dataset.plannerFocusKey = "disclosure-schedule";
    summary.setAttribute("aria-label", `Schedule, ${spiral.items.length} items`);
    details.append(summary);
    appendDisclosureRows(details, spiral.items.map((item) => ({
      title: item.title,
      meta: `${formatClockMinute(item.startMinutes)}-${formatClockMinute(item.endMinutes)}`,
      tone: item.tone,
    })));
    details.addEventListener("toggle", () => {
      if (details.open !== this.#presentation.scheduleOpen) {
        this.#presentation = reducePlannerPresentationState(this.#presentation, { type: "toggle-schedule" });
      }
    });
    return details;
  }

  #appendDiagnostics(projection: RuntimePlanProjection): void {
    const overflow = plannerOverflow(projection);
    if (overflow.length > 0) {
      const details = element(this.#root.ownerDocument, "details", "spiral-day-planner__disclosure spiral-day-planner__overflow");
      const summary = element(this.#root.ownerDocument, "summary", "spiral-day-planner__disclosure-summary");
      const total = overflow.reduce((sum, row) => sum + row.durationMinutes, 0);
      summary.textContent = `Unscheduled today | ${formatDuration(total)} | ${overflow.length} item${overflow.length === 1 ? "" : "s"}`;
      summary.dataset.plannerFocusKey = "disclosure-overflow";
      summary.setAttribute("aria-label", `${projection.capacity.status}, ${overflow.length} unscheduled items`);
      details.append(summary);
      appendDisclosureRows(details, overflow.map((row) => ({
        title: row.title,
        meta: formatDuration(row.durationMinutes),
        tone: "warning",
      })));
      this.#root.append(details);
    }
    const warnings = plannerWarnings(projection);
    if (warnings.length > 0) {
      const details = element(this.#root.ownerDocument, "details", "spiral-day-planner__disclosure spiral-day-planner__warnings");
      const summary = element(this.#root.ownerDocument, "summary", "spiral-day-planner__disclosure-summary");
      summary.textContent = `Schedule warnings | ${warnings.length} item${warnings.length === 1 ? "" : "s"}`;
      summary.dataset.plannerFocusKey = "disclosure-warnings";
      details.append(summary);
      appendDisclosureRows(details, warnings.map((row) => ({
        title: row.title,
        meta: row.message,
        tone: "warning",
      })));
      this.#root.append(details);
    }
  }

  #renderSpiral(model: PlannerSpiralModel): SVGSVGElement {
    const document = this.#root.ownerDocument;
    const svg = svgElement(document, "svg", "spiral-day-planner__spiral");
    const viewBox = spiralViewBox(model.geometry, model.labels);
    svg.setAttribute("viewBox", `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `${model.title} spiral schedule`);
    svg.dataset.mode = model.mode;

    const defs = svgElement(document, "defs");
    const hatch = svgElement(document, "pattern");
    hatch.id = "spiral-day-planner-hatch";
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
    dots.id = "spiral-day-planner-dots";
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
        group.setAttribute("role", "img");
        group.setAttribute("tabindex", "0");
        group.setAttribute("focusable", "true");
        group.setAttribute("aria-label", slot.ariaLabel);
        group.dataset.plannerFocusKey = `available-${slot.id}`;
        this.#bindTooltip(group, slot.ariaLabel);
      } else {
        group.setAttribute("aria-hidden", "true");
      }
      svg.append(group);
    }
    for (const item of model.items) svg.append(this.#renderTimelineTarget(item, model.mode));
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
      group.setAttribute("role", "img");
      group.setAttribute("tabindex", "0");
      group.setAttribute("focusable", "true");
      group.setAttribute("aria-label", label.timelineItem.ariaLabel);
      group.dataset.plannerFocusKey = `label-${label.id}`;
      if (label.timelineItem.current) group.setAttribute("aria-current", "true");
      const text = svgElement(document, "text");
      text.setAttribute("x", String(label.side === "left" ? label.box.x + label.box.width : label.box.x));
      text.setAttribute("y", String(label.box.y + label.box.height - 3));
      text.setAttribute("text-anchor", label.side === "left" ? "end" : "start");
      text.textContent = label.visibleText;
      const title = svgElement(document, "title");
      title.textContent = label.timelineItem.ariaLabel;
      group.append(title, text);
      this.#bindTooltip(group, timelineTooltipText(label.timelineItem), connector);
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
    return svg;
  }

  #fullSpiralPath(model: PlannerSpiralModel): string {
    const { startMinutes, endMinutes } = model.geometry.bounds;
    const start = spiralBandPath(startMinutes, endMinutes, model.geometry);
    return start;
  }

  #renderTimelineTarget(item: PlannerTimelineItem, mode: PlannerSpiralModel["mode"]): SVGGElement {
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
      group.append(progress);
    }
    const title = svgElement(this.#root.ownerDocument, "title");
    title.textContent = item.ariaLabel;
    group.append(title);
    if (mode === "wide") {
      group.setAttribute("role", "img");
      group.setAttribute("tabindex", "0");
      group.setAttribute("focusable", "true");
      group.setAttribute("aria-label", item.ariaLabel);
      group.dataset.plannerFocusKey = `item-${item.id}`;
      if (item.current) group.setAttribute("aria-current", "true");
      this.#bindTooltip(group, timelineTooltipText(item));
    } else {
      group.setAttribute("aria-hidden", "true");
    }
    return group;
  }

  #bindTooltip(target: SVGElement, text: string, companion?: SVGElement): void {
    if (!this.#layout.mountHoverSurface) return;
    const show = (): void => {
      companion?.classList.add("is-emphasized");
      target.classList.add("is-emphasized");
      this.#showTooltip(target, text);
    };
    const hide = (): void => {
      companion?.classList.remove("is-emphasized");
      target.classList.remove("is-emphasized");
      this.#removeTooltip();
    };
    target.addEventListener("mouseenter", show);
    target.addEventListener("mouseleave", hide);
    target.addEventListener("focus", show);
    target.addEventListener("blur", hide);
  }

  #showTooltip(target: SVGElement, text: string): void {
    this.#removeTooltip();
    const document = this.#root.ownerDocument;
    const tooltip = element(document, "div", "spiral-day-planner__tooltip");
    tooltip.setAttribute("role", "tooltip");
    tooltip.textContent = text;
    document.body.append(tooltip);
    const targetBox = target.getBoundingClientRect();
    const tooltipBox = tooltip.getBoundingClientRect();
    const view = document.defaultView;
    if (!view) return;
    const placement = placeTooltip({
      anchor: { x: targetBox.x, y: targetBox.y, width: targetBox.width, height: targetBox.height },
      tooltipWidth: tooltipBox.width,
      tooltipHeight: tooltipBox.height,
      viewportWidth: view.innerWidth,
      viewportHeight: view.innerHeight,
    });
    tooltip.dataset.side = placement.side;
    tooltip.style.left = `${placement.x}px`;
    tooltip.style.top = `${placement.y}px`;
    this.#tooltip = tooltip;
  }

  #removeTooltip(): void {
    this.#tooltip?.remove();
    this.#tooltip = undefined;
  }

  #startPlayback(): void {
    if (this.#presentation.playback === "running") return;
    this.#presentation = reducePlannerPresentationState(this.#presentation, {
      type: "start-playback",
      now: this.#now(),
    });
    this.#render();
  }

  #schedulePlaybackFrame(): void {
    const view = this.#root.ownerDocument.defaultView;
    if (!view || !this.#visible || this.#animationFrame !== undefined) return;
    this.#animationFrame = view.requestAnimationFrame(() => {
      this.#animationFrame = undefined;
      if (this.#destroyed || this.#presentation.playback !== "running") return;
      const startedAt = this.#presentation.playbackStartedAt;
      if (startedAt !== null && this.#now() - startedAt >= PLAYBACK_DURATION_MILLISECONDS) {
        this.#presentation = reducePlannerPresentationState(this.#presentation, { type: "finish-playback" });
      }
      this.#render();
    });
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
