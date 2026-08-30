import type { ExecutionApplicationSnapshot } from "../../runtime/execution/application";
import {
  executionElement,
  executionIconButton,
  formatExecutionDuration,
  type ExecutionIconRenderer,
  type ExecutionMessages,
} from "./shared-controls";

export interface ActiveTaskSurfaceOptions {
  readonly snapshot: ExecutionApplicationSnapshot;
  readonly nowEpochMs: number;
  readonly messages: ExecutionMessages;
  readonly renderIcon: ExecutionIconRenderer;
  readonly onOpenSource: () => void;
}

export type ActiveTaskSurfaceMode = "active" | "idle" | "pomo" | "unavailable";

export function activeTaskSurfaceMode(snapshot: ExecutionApplicationSnapshot): ActiveTaskSurfaceMode {
  if (snapshot.status === "degraded" || snapshot.status === "stopped") return "unavailable";
  if (snapshot.focused) return "active";
  if (snapshot.standalonePomoStartEpochMs !== null) return "pomo";
  return "idle";
}

export function updateActiveTaskElapsed(
  root: HTMLElement,
  snapshot: ExecutionApplicationSnapshot,
  nowEpochMs: number,
): void {
  const focused = snapshot.focused;
  const elapsed = root.querySelector<HTMLTimeElement>(".spiral-day-active-task__elapsed");
  const startEpochMs = focused?.clock.startEpochMs ?? snapshot.standalonePomoStartEpochMs;
  if (startEpochMs === null || !elapsed) return;
  const elapsedMs = Math.max(0, nowEpochMs - startEpochMs);
  elapsed.dateTime = `PT${Math.floor(elapsedMs / 1_000)}S`;
  elapsed.textContent = formatExecutionDuration(elapsedMs);
  const pomoStart = focused && (snapshot.execution.kind === "active" || snapshot.execution.kind === "forgotten")
    ? snapshot.execution.taskPomoStartEpochMs
    : snapshot.standalonePomoStartEpochMs;
  if ((focused && snapshot.execution.kind === "forgotten")
    || (pomoStart !== null
      && snapshot.pomoThresholdMinutes > 0
      && nowEpochMs - pomoStart >= snapshot.pomoThresholdMinutes * 60_000)) {
    elapsed.dataset.warning = "true";
  } else {
    delete elapsed.dataset.warning;
  }
}

export function renderActiveTaskSurface(root: HTMLElement, options: ActiveTaskSurfaceOptions): void {
  root.replaceChildren();
  root.classList.add("spiral-day-active-task");
  const focused = options.snapshot.focused;
  const mode = activeTaskSurfaceMode(options.snapshot);
  if (mode === "unavailable") {
    root.dataset.state = "unavailable";
    const state = executionElement(root.ownerDocument, "div", "spiral-day-active-task__unavailable");
    const title = executionElement(root.ownerDocument, "h2");
    title.textContent = options.messages.t("execution", "active.unavailable");
    const detail = executionElement(root.ownerDocument, "p");
    detail.textContent = options.messages.t("execution", "active.unavailableDetail");
    const disclosure = executionElement(root.ownerDocument, "details", "spiral-day-active-task__details");
    const summary = executionElement(root.ownerDocument, "summary");
    summary.textContent = options.messages.t("execution", "action.showDetails");
    const code = executionElement(root.ownerDocument, "p");
    code.textContent = options.snapshot.code ?? options.snapshot.status;
    disclosure.append(summary, code);
    state.append(title, detail, disclosure);
    root.append(state);
    return;
  }

  if (mode === "idle" || mode === "pomo") {
    root.dataset.state = mode;
    const state = executionElement(root.ownerDocument, "section", "spiral-day-active-task__empty");
    const title = executionElement(root.ownerDocument, "h2");
    title.textContent = options.messages.t("execution", mode === "pomo" ? "timing.pomo" : "timing.idle");
    const detail = executionElement(root.ownerDocument, "p");
    detail.textContent = options.messages.t("execution", "timing.noActive");
    state.append(title, detail);
    if (mode === "pomo") {
      const timing = executionElement(root.ownerDocument, "div", "spiral-day-active-task__timing");
      const timingLabel = executionElement(root.ownerDocument, "span");
      timingLabel.textContent = options.messages.t("execution", "active.elapsed");
      const elapsed = executionElement(root.ownerDocument, "time", "spiral-day-active-task__elapsed");
      timing.append(timingLabel, elapsed);
      state.append(timing);
    }
    root.append(state);
    updateActiveTaskElapsed(root, options.snapshot, options.nowEpochMs);
    return;
  }

  if (!focused) return;

  root.dataset.state = options.snapshot.execution.kind;
  const article = executionElement(root.ownerDocument, "article", "spiral-day-active-task__content");
  article.setAttribute("aria-label", `${options.messages.t("execution", "active.title")}: ${focused.label}`);
  const title = executionElement(root.ownerDocument, "h2");
  title.textContent = focused.label;
  const timing = executionElement(root.ownerDocument, "div", "spiral-day-active-task__timing");
  const timingLabel = executionElement(root.ownerDocument, "span");
  timingLabel.textContent = options.messages.t("execution", "active.elapsed");
  const elapsed = executionElement(root.ownerDocument, "time", "spiral-day-active-task__elapsed");
  timing.append(timingLabel, elapsed);
  const open = executionIconButton({
    document: root.ownerDocument,
    label: options.messages.t("execution", "action.openSource"),
    icon: "external-link",
    renderIcon: options.renderIcon,
    className: "spiral-day-active-task__open",
    onActivate: options.onOpenSource,
  });
  article.append(title, timing, open);
  root.append(article);
  updateActiveTaskElapsed(root, options.snapshot, options.nowEpochMs);
}
