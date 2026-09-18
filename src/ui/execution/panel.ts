import type {
  ExecutionApplicationIntent,
  ExecutionApplicationSnapshot,
} from "../../runtime/execution/application";
import type { ExecutionCommandOutcome } from "../../runtime/execution/commands";
import type { RuntimePlanProjection } from "../../runtime/projection-runtime";
import type { RuntimeSnapshot } from "../../runtime/snapshots";
import { renderPlanView } from "./plan-view";
import { executionPopoverPlacement } from "./panel-layout";
import {
  ExecutionRovingTabs,
  executionElement,
  executionIconButton,
  executionLiveRegion,
  formatExecutionDuration,
  type ExecutionIconRenderer,
  type ExecutionMessages,
} from "./shared-controls";
import { renderTimingView, type ExecutionRecentTask } from "./timing-view";

export type ExecutionPanelTab = "timing" | "plan" | "review";

export interface ExecutionReviewSurface {
  render(root: HTMLElement, visible: boolean): void;
  destroy(): void;
}

export interface ExecutionPanelFeedback {
  readonly message: string;
  readonly level: "info" | "warning" | "danger";
}

export interface ExecutionPanelPort {
  readonly now: () => number;
  readonly refresh: () => Promise<ExecutionApplicationSnapshot>;
  readonly subscribeExecution: (listener: (snapshot: ExecutionApplicationSnapshot) => void) => () => void;
  readonly subscribePlan: (listener: (snapshot: RuntimeSnapshot<RuntimePlanProjection>) => void) => () => void;
  readonly dispatch: (intent: ExecutionApplicationIntent) => Promise<ExecutionCommandOutcome>;
  readonly outcomeFeedback: (outcome: ExecutionCommandOutcome) => ExecutionPanelFeedback;
  readonly navigatePrimary: () => void | Promise<void>;
  readonly openActiveTask: () => void | Promise<void>;
  readonly navigateTask: (
    target: { readonly path: string; readonly ownerId: string | null; readonly sourceOrder: number },
    location: "main" | "sidebar",
  ) => void | Promise<void>;
  readonly subscribeRecent: (listener: (recent: readonly ExecutionRecentTask[]) => void) => () => void;
  readonly createReviewSurface?: (root: HTMLElement) => ExecutionReviewSurface;
  readonly insertPrimaryPlan?: () => void | Promise<void>;
}

export interface ExecutionPanelOptions {
  readonly trigger: HTMLElement;
  readonly messages: ExecutionMessages;
  readonly renderIcon: ExecutionIconRenderer;
  readonly initialTab?: ExecutionPanelTab;
  readonly onError?: (error: unknown) => void;
}

export interface ExecutionPanelSurface {
  readonly isOpen: boolean;
  open(tab?: ExecutionPanelTab): void;
  close(restoreFocus?: boolean): void;
  setLocale(): void;
  destroy(): void;
}

const DELETE_CONFIRMATION_WINDOW_MS = 2_500;
let intentSequence = 0;
let panelSequence = 0;

function intentId(prefix: string, now: number): string {
  intentSequence += 1;
  return `${prefix}-${now}-${intentSequence}`;
}

function pendingKey(intent: ExecutionApplicationIntent): string {
  if (intent.type === "clock-out") return "clock-out";
  if (intent.type === "delete-clock") return "delete-clock";
  if (intent.type === "start-standalone-pomo" || intent.type === "stop-standalone-pomo") {
    return "standalone-pomo";
  }
  if ("target" in intent && "ownerId" in intent.target) {
    return `task:${intent.target.ownerId ?? `${intent.target.path}:${"sourceOrder" in intent.target ? intent.target.sourceOrder : 0}`}`;
  }
  return intent.type;
}

function capacityLabel(
  snapshot: RuntimeSnapshot<RuntimePlanProjection> | undefined,
  messages: ExecutionMessages,
): string {
  if (snapshot?.state !== "confirmed") return "";
  return snapshot.projection.capacity.metrics
    .map((metric) => `${metric.kind === "events"
      ? messages.t("planner", "metric.fixedTime")
      : metric.kind === "available"
        ? messages.t("planner", "metric.availableTime")
        : metric.kind === "planned"
          ? messages.t("planner", "metric.scheduledTime")
          : messages.t("planner", "metric.flexibleTime")} ${messages.t("shared", "unit.duration", { minutes: metric.minutes })}`)
    .join(", ");
}

export function mountExecutionPanel(
  port: ExecutionPanelPort,
  options: ExecutionPanelOptions,
): ExecutionPanelSurface {
  const { trigger } = options;
  const document = trigger.ownerDocument;
  const triggerNeedsButtonSemantics = trigger.tagName !== "BUTTON";
  if (triggerNeedsButtonSemantics) {
    trigger.setAttribute("role", "button");
    trigger.tabIndex = 0;
  }
  const popover = executionElement(document, "section", "spiral-day-execution");
  panelSequence += 1;
  popover.id = `spiral-day-execution-dialog-${panelSequence}`;
  popover.hidden = true;
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-modal", "false");
  popover.setAttribute("aria-label", options.messages.t("execution", "surface.name"));
  trigger.setAttribute("aria-controls", popover.id);
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-haspopup", "dialog");

  const header = executionElement(document, "header", "spiral-day-execution__header");
  const identity = executionElement(document, "button", "spiral-day-execution__identity");
  identity.type = "button";
  identity.textContent = options.messages.t("execution", "surface.identity");
  identity.addEventListener("click", () => void Promise.resolve(port.navigatePrimary()).catch(options.onError));
  const close = executionIconButton({
    document,
    label: options.messages.t("shared", "action.close"),
    icon: "x",
    renderIcon: options.renderIcon,
    className: "spiral-day-execution__icon-button",
    onActivate: () => surface.close(true),
  });
  header.append(identity, close);

  const tablist = executionElement(document, "div", "spiral-day-execution__tabs");
  const timingPanel = executionElement(document, "div", "spiral-day-execution__tabpanel");
  const planPanel = executionElement(document, "div", "spiral-day-execution__tabpanel");
  const reviewPanel = executionElement(document, "div", "spiral-day-execution__tabpanel");
  const tabs = new ExecutionRovingTabs({
    root: tablist,
    active: options.initialTab ?? "timing",
    tabs: [
      { name: "timing", label: options.messages.t("execution", "tab.timing"), panel: timingPanel },
      { name: "plan", label: options.messages.t("execution", "tab.plan"), panel: planPanel },
      { name: "review", label: options.messages.t("execution", "tab.review"), panel: reviewPanel },
    ],
    onChange: (name) => {
      lastTab = name;
      render();
    },
  });
  const capacity = executionElement(document, "div", "spiral-day-execution__capacity");
  const feedback = executionElement(document, "div", "spiral-day-execution__feedback");
  feedback.hidden = true;
  const live = executionLiveRegion(document);
  popover.append(header, tablist, capacity, feedback, timingPanel, planPanel, reviewPanel, live);
  document.body.append(popover);

  let execution: ExecutionApplicationSnapshot | undefined;
  let plan: RuntimeSnapshot<RuntimePlanProjection> | undefined;
  let recent: readonly ExecutionRecentTask[] = Object.freeze([]);
  let lastTab: ExecutionPanelTab = options.initialTab ?? "timing";
  let shortestFirst = false;
  let opened = false;
  let destroyed = false;
  let timer: number | undefined;
  let deleteTimer: number | undefined;
  let deleteActivation: { readonly key: string; readonly epochMs: number } | undefined;
  const pending = new Set<string>();
  const review = port.createReviewSurface?.(reviewPanel);

  const showFeedback = (next: ExecutionPanelFeedback, kind?: string): void => {
    feedback.hidden = false;
    feedback.dataset.level = next.level;
    if (kind) feedback.dataset.kind = kind;
    else delete feedback.dataset.kind;
    feedback.textContent = next.message;
    live.textContent = next.message;
  };

  const clearDeleteActivation = (clearFeedback = true): void => {
    deleteActivation = undefined;
    delete popover.dataset.deleteArmed;
    if (deleteTimer !== undefined) {
      document.defaultView?.clearTimeout(deleteTimer);
      deleteTimer = undefined;
    }
    if (clearFeedback && feedback.dataset.kind === "delete-confirmation") {
      feedback.hidden = true;
      feedback.textContent = "";
      delete feedback.dataset.kind;
    }
  };

  const updateTrigger = (): void => {
    const surfaceName = options.messages.t("execution", "surface.name");
    trigger.setAttribute("aria-label", surfaceName);
    if (!execution) return;
    trigger.dataset.state = execution.execution.kind;
    trigger.setAttribute("aria-expanded", String(opened));
    let pomoStartEpochMs: number | null = null;
    if (execution.execution.kind === "active" || execution.execution.kind === "forgotten") {
      pomoStartEpochMs = execution.execution.taskPomoStartEpochMs;
    } else if (execution.standalonePomoStartEpochMs !== null) {
      pomoStartEpochMs = execution.standalonePomoStartEpochMs;
    }
    if (execution.focused) {
      const elapsed = formatExecutionDuration(port.now() - execution.focused.clock.startEpochMs);
      trigger.dataset.elapsed = elapsed;
      trigger.dataset.threads = options.messages.t("execution", "timing.active");
      trigger.setAttribute("aria-label", `${surfaceName}: ${execution.focused.label}, ${elapsed}`);
    } else if (execution.standalonePomoStartEpochMs !== null) {
      const elapsed = formatExecutionDuration(port.now() - execution.standalonePomoStartEpochMs);
      const pomo = options.messages.t("execution", "timing.pomo");
      trigger.dataset.elapsed = elapsed;
      trigger.dataset.threads = pomo;
      trigger.setAttribute("aria-label", `${surfaceName}: ${pomo}, ${elapsed}`);
    } else {
      delete trigger.dataset.elapsed;
      delete trigger.dataset.threads;
    }
    if (pomoStartEpochMs !== null
      && execution.pomoThresholdMinutes > 0
      && port.now() - pomoStartEpochMs >= execution.pomoThresholdMinutes * 60_000) {
      trigger.dataset.warning = "true";
    } else {
      delete trigger.dataset.warning;
    }
  };

  const updateElapsed = (): void => {
    const now = port.now();
    updateTrigger();
    for (const elapsed of popover.querySelectorAll<HTMLElement>("[data-start-epoch-ms]")) {
      const startEpochMs = Number(elapsed.dataset.startEpochMs);
      if (!Number.isFinite(startEpochMs)) continue;
      const duration = formatExecutionDuration(now - startEpochMs);
      elapsed.textContent = elapsed.dataset.suffix
        ? `${duration} · ${elapsed.dataset.suffix}`
        : duration;
      if (elapsed.tagName === "TIME") {
        (elapsed as HTMLTimeElement).dateTime = `PT${Math.max(0, Math.floor((now - startEpochMs) / 1_000))}S`;
      }
      const warningAtEpochMs = Number(elapsed.dataset.warningAtEpochMs);
      if (Number.isFinite(warningAtEpochMs) && now >= warningAtEpochMs) {
        elapsed.dataset.warning = "true";
      } else {
        delete elapsed.dataset.warning;
      }
    }
  };

  const dispatch = (input: ExecutionApplicationIntent): void => {
    const key = pendingKey(input);
    if (pending.has(key) || destroyed) return;
    feedback.hidden = true;
    feedback.textContent = "";
    delete feedback.dataset.kind;
    pending.add(key);
    render();
    void port.dispatch(input).then((outcome) => {
      showFeedback(port.outcomeFeedback(outcome));
    }, (error: unknown) => {
      showFeedback({
        message: options.messages.t("execution", "error.generic"),
        level: "warning",
      });
      options.onError?.(error);
    }).finally(() => {
      pending.delete(key);
      render();
    });
  };

  const refreshExecution = (): void => {
    if (pending.has("refresh") || destroyed) return;
    pending.add("refresh");
    feedback.hidden = true;
    feedback.textContent = "";
    render();
    void Promise.resolve().then(() => port.refresh()).then((snapshot) => {
      const recovered = snapshot.status === "ready";
      showFeedback({
        message: options.messages.t("execution", recovered ? "notice.refreshed" : "error.refresh"),
        level: recovered ? "info" : "warning",
      });
    }, (error: unknown) => {
      showFeedback({
        message: options.messages.t("execution", "error.refresh"),
        level: "warning",
      });
      options.onError?.(error);
    }).finally(() => {
      pending.delete("refresh");
      render();
    });
  };

  const requestDelete = (clock: NonNullable<ExecutionApplicationSnapshot["focused"]>["clock"]): void => {
    const now = port.now();
    if (!deleteActivation
      || deleteActivation.key !== clock.targetKey
      || now - deleteActivation.epochMs > DELETE_CONFIRMATION_WINDOW_MS) {
      clearDeleteActivation(false);
      deleteActivation = Object.freeze({ key: clock.targetKey, epochMs: now });
      popover.dataset.deleteArmed = "true";
      showFeedback({
        message: options.messages.t("execution", "timing.deleteConfirm"),
        level: "warning",
      }, "delete-confirmation");
      const activation = deleteActivation;
      deleteTimer = document.defaultView?.setTimeout(() => {
        if (deleteActivation === activation) clearDeleteActivation(true);
      }, DELETE_CONFIRMATION_WINDOW_MS);
      return;
    }
    const first = deleteActivation;
    clearDeleteActivation(false);
    dispatch({
      type: "delete-clock",
      intentId: intentId("delete-clock", now),
      target: clock,
      confirmation: {
        firstActivationEpochMs: first.epochMs,
        secondActivationEpochMs: now,
        firstTargetKey: first.key,
        secondTargetKey: clock.targetKey,
      },
    });
  };

  const render = (): void => {
    if (destroyed) return;
    updateTrigger();
    if (!execution) return;
    const label = capacityLabel(plan, options.messages);
    capacity.hidden = label.length === 0;
    capacity.textContent = label.length > 0
      ? `${options.messages.t("execution", "plan.capacity")} · ${label}`
      : "";
    renderTimingView(timingPanel, {
      nowEpochMs: port.now(),
      snapshot: execution,
      recent,
      pending,
      messages: options.messages,
      renderIcon: options.renderIcon,
      dispatch,
      refresh: refreshExecution,
      openActiveTask: () => void Promise.resolve(port.openActiveTask()).catch(options.onError),
      navigateTask: (target, location) => void Promise.resolve(port.navigateTask(target, location)).catch(options.onError),
      requestDelete,
    });
    renderPlanView(planPanel, {
      shortestFirst,
      setShortestFirst: (enabled) => { shortestFirst = enabled; },
      nowEpochMs: port.now(),
      ...(plan ? { snapshot: plan } : {}),
      execution,
      pending,
      messages: options.messages,
      renderIcon: options.renderIcon,
      dispatch,
      navigateTask: (target, location) => void Promise.resolve(port.navigateTask(target, location)).catch(options.onError),
      ...(port.insertPrimaryPlan
        ? { insertPrimaryPlan: () => void Promise.resolve(port.insertPrimaryPlan?.()).catch(options.onError) }
        : {}),
    });
    if (review) review.render(reviewPanel, opened && tabs.active === "review");
    else {
      reviewPanel.replaceChildren();
      const empty = executionElement(document, "p", "spiral-day-execution__empty");
      empty.textContent = options.messages.t("execution", "review.pending");
      reviewPanel.append(empty);
    }
    if (opened) place();
  };

  const place = (): void => {
    const rect = trigger.getBoundingClientRect();
    const height = popover.getBoundingClientRect().height;
    const placement = executionPopoverPlacement({
      viewportWidth: document.documentElement.clientWidth,
      viewportHeight: document.documentElement.clientHeight,
      trigger: rect,
      contentHeight: height,
    });
    popover.style.width = `${placement.width}px`;
    popover.style.left = `${placement.left}px`;
    popover.style.top = `${placement.top}px`;
  };

  const onDocumentPointerDown = (event: PointerEvent): void => {
    const target = event.target;
    const DocumentNode = document.defaultView?.Node;
    if (!DocumentNode || !(target instanceof DocumentNode)
      || popover.contains(target) || trigger.contains(target)) return;
    surface.close(false);
  };
  const onDocumentKeyDown = (event: KeyboardEvent): void => {
    if (!opened || event.key !== "Escape") return;
    event.preventDefault();
    surface.close(true);
  };
  const onResize = (): void => {
    if (opened) place();
  };
  const onTrigger = (): void => opened ? surface.close(false) : surface.open();
  const onTriggerKeyDown = (event: KeyboardEvent): void => {
    if (!triggerNeedsButtonSemantics || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    onTrigger();
  };
  trigger.addEventListener("click", onTrigger);
  trigger.addEventListener("keydown", onTriggerKeyDown);
  document.addEventListener("pointerdown", onDocumentPointerDown, true);
  document.addEventListener("keydown", onDocumentKeyDown, true);
  document.defaultView?.addEventListener("resize", onResize);

  const unsubscribeExecution = port.subscribeExecution((snapshot) => {
    execution = snapshot;
    render();
  });
  const unsubscribePlan = port.subscribePlan((snapshot) => {
    plan = snapshot;
    render();
  });
  const unsubscribeRecent = port.subscribeRecent((snapshot) => {
    recent = snapshot;
    render();
  });

  const surface: ExecutionPanelSurface = {
    get isOpen() {
      return opened;
    },
    open(tab) {
      if (destroyed) return;
      tabs.select(tab ?? lastTab, false);
      opened = true;
      popover.hidden = false;
      place();
      updateTrigger();
      render();
      tabs.focusActive();
      if (timer === undefined) {
        timer = document.defaultView?.setInterval(() => updateElapsed(), 1_000);
      }
    },
    close(restoreFocus = false) {
      clearDeleteActivation(true);
      if (!opened) return;
      opened = false;
      review?.render(reviewPanel, false);
      popover.hidden = true;
      if (timer !== undefined) {
        document.defaultView?.clearInterval(timer);
        timer = undefined;
      }
      updateTrigger();
      if (restoreFocus) trigger.focus();
    },
    setLocale() {
      popover.setAttribute("aria-label", options.messages.t("execution", "surface.name"));
      identity.textContent = options.messages.t("execution", "surface.identity");
      const closeLabel = options.messages.t("shared", "action.close");
      close.setAttribute("aria-label", closeLabel);
      close.title = closeLabel;
      tabs.setLabel("timing", options.messages.t("execution", "tab.timing"));
      tabs.setLabel("plan", options.messages.t("execution", "tab.plan"));
      tabs.setLabel("review", options.messages.t("execution", "tab.review"));
      clearDeleteActivation(true);
      feedback.hidden = true;
      feedback.textContent = "";
      render();
    },
    destroy() {
      if (destroyed) return;
      surface.close(false);
      destroyed = true;
      unsubscribeExecution();
      unsubscribePlan();
      unsubscribeRecent();
      review?.destroy();
      trigger.removeEventListener("click", onTrigger);
      trigger.removeEventListener("keydown", onTriggerKeyDown);
      document.removeEventListener("pointerdown", onDocumentPointerDown, true);
      document.removeEventListener("keydown", onDocumentKeyDown, true);
      document.defaultView?.removeEventListener("resize", onResize);
      popover.remove();
    },
  };
  render();
  return Object.freeze(surface);
}
