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
  readonly onCopyLink: () => void;
}

export function updateActiveTaskElapsed(
  root: HTMLElement,
  snapshot: ExecutionApplicationSnapshot,
  nowEpochMs: number,
): void {
  const focused = snapshot.focused;
  const elapsed = root.querySelector<HTMLTimeElement>(".spiral-day-active-task__elapsed");
  if (!focused || !elapsed) return;
  const elapsedMs = Math.max(0, nowEpochMs - focused.clock.startEpochMs);
  elapsed.dateTime = `PT${Math.floor(elapsedMs / 1_000)}S`;
  elapsed.textContent = formatExecutionDuration(elapsedMs);
  const pomoStart = snapshot.execution.kind === "active" || snapshot.execution.kind === "forgotten"
    ? snapshot.execution.taskPomoStartEpochMs
    : null;
  if (snapshot.execution.kind === "forgotten"
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
  if (!focused || options.snapshot.status === "degraded" || options.snapshot.status === "stopped") {
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

  root.dataset.state = options.snapshot.execution.kind;
  const article = executionElement(root.ownerDocument, "article", "spiral-day-active-task__content");
  article.tabIndex = 0;
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
    className: "spiral-day-active-task__action spiral-day-active-task__open",
    onActivate: options.onOpenSource,
  });
  const copy = executionIconButton({
    document: root.ownerDocument,
    label: options.messages.t("execution", "action.copyTaskLink"),
    icon: "copy",
    renderIcon: options.renderIcon,
    className: "spiral-day-active-task__action spiral-day-active-task__copy",
    onActivate: options.onCopyLink,
  });
  const actions = executionElement(root.ownerDocument, "div", "spiral-day-active-task__actions");
  actions.append(open, copy);
  const hint = executionElement(root.ownerDocument, "p", "spiral-day-active-task__hint");
  hint.textContent = options.messages.t("execution", "active.keyboardHint");
  article.addEventListener("keydown", (event) => {
    if (event.target !== article || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    options.onOpenSource();
  });
  article.append(title, timing, actions, hint);
  root.append(article);
  updateActiveTaskElapsed(root, options.snapshot, options.nowEpochMs);
}
