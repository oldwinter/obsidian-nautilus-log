import type {
  ExecutionApplicationIntent,
  ExecutionApplicationSnapshot,
  ExecutionClockReference,
} from "../../runtime/execution/application";
import {
  executionElement,
  executionIconButton,
  formatExecutionDuration,
  type ExecutionIconRenderer,
  type ExecutionMessages,
} from "./shared-controls";

export interface ExecutionRecentTask {
  readonly key: string;
  readonly ownerId: string | null;
  readonly path: string;
  readonly sourceOrder: number;
  readonly label: string;
  readonly actualMinutes: number;
}

export interface TimingViewOptions {
  readonly nowEpochMs: number;
  readonly snapshot: ExecutionApplicationSnapshot;
  readonly recent: readonly ExecutionRecentTask[];
  readonly pending: ReadonlySet<string>;
  readonly messages: ExecutionMessages;
  readonly renderIcon: ExecutionIconRenderer;
  readonly dispatch: (intent: ExecutionApplicationIntent) => void;
  readonly refresh: () => void;
  readonly openActiveTask: () => void;
  readonly navigateTask: (
    target: { readonly path: string; readonly ownerId: string | null; readonly sourceOrder: number },
    location: "main" | "sidebar",
  ) => void;
  readonly requestDelete: (clock: ExecutionClockReference) => void;
}

function appendPending(button: HTMLButtonElement, pending: boolean, messages: ExecutionMessages): void {
  button.disabled = pending;
  button.setAttribute("aria-busy", String(pending));
  if (pending) button.title = messages.t("execution", "timing.pending");
}

function thresholdReached(snapshot: ExecutionApplicationSnapshot, nowEpochMs: number): boolean {
  const startEpochMs = snapshot.execution.kind === "active" || snapshot.execution.kind === "forgotten"
    ? snapshot.execution.taskPomoStartEpochMs
    : snapshot.standalonePomoStartEpochMs;
  return startEpochMs !== null
    && snapshot.pomoThresholdMinutes > 0
    && nowEpochMs - startEpochMs >= snapshot.pomoThresholdMinutes * 60_000;
}

function titleButton(
  parent: HTMLElement,
  label: string,
  activate: (event: MouseEvent) => void,
): HTMLButtonElement {
  const button = executionElement(parent.ownerDocument, "button", "spiral-day-execution__task-title");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", activate);
  parent.append(button);
  return button;
}

export function renderTimingView(root: HTMLElement, options: TimingViewOptions): void {
  root.replaceChildren();
  const { snapshot, messages } = options;
  const section = executionElement(root.ownerDocument, "section", "spiral-day-execution__timing");
  const focused = snapshot.focused;
  if (!focused && (snapshot.status === "degraded"
    || snapshot.status === "stale"
    || snapshot.status === "starting")) {
    const unavailable = executionElement(root.ownerDocument, "div", "spiral-day-execution__empty");
    const heading = executionElement(root.ownerDocument, "strong");
    heading.textContent = snapshot.status === "degraded"
      ? messages.t("execution", "status.degraded")
      : messages.t("execution", "status.stale");
    const detail = executionElement(root.ownerDocument, "p");
    detail.textContent = messages.t("execution", "error.refresh");
    const retry = executionIconButton({
      document: root.ownerDocument,
      label: messages.t("execution", "action.retry"),
      icon: "refresh",
      renderIcon: options.renderIcon,
      className: "spiral-day-execution__secondary-action",
      onActivate: options.refresh,
    });
    appendPending(retry, options.pending.has("refresh"), messages);
    unavailable.append(heading, detail, retry);
    section.append(unavailable);
  } else if (!focused) {
    const empty = executionElement(root.ownerDocument, "div", "spiral-day-execution__empty");
    const heading = executionElement(root.ownerDocument, "strong");
    heading.textContent = messages.t("execution", "timing.idle");
    const detail = executionElement(root.ownerDocument, "p");
    detail.textContent = messages.t("execution", "timing.noActive");
    empty.append(heading, detail);
    if (snapshot.standalonePomoStartEpochMs === null) {
      const pomo = executionIconButton({
        document: root.ownerDocument,
        label: messages.t("execution", "action.startPomo"),
        icon: "timer",
        renderIcon: options.renderIcon,
        className: "spiral-day-execution__secondary-action",
        onActivate: () => options.dispatch({
          type: "start-standalone-pomo",
          intentId: `standalone-pomo-start-${options.nowEpochMs}`,
        }),
      });
      appendPending(pomo, options.pending.has("standalone-pomo"), messages);
      if (snapshot.writeBlocked) pomo.disabled = true;
      empty.append(pomo);
    } else {
      const elapsed = executionElement(root.ownerDocument, "span", "spiral-day-execution__elapsed");
      elapsed.dataset.startEpochMs = String(snapshot.standalonePomoStartEpochMs);
      elapsed.dataset.suffix = messages.t("execution", "timing.pomo");
      if (snapshot.pomoThresholdMinutes > 0) {
        elapsed.dataset.warningAtEpochMs = String(
          snapshot.standalonePomoStartEpochMs + snapshot.pomoThresholdMinutes * 60_000,
        );
      }
      elapsed.textContent = `${formatExecutionDuration(options.nowEpochMs - snapshot.standalonePomoStartEpochMs)} · ${messages.t("execution", "timing.pomo")}`;
      if (thresholdReached(snapshot, options.nowEpochMs)) elapsed.dataset.warning = "true";
      const stop = executionIconButton({
        document: root.ownerDocument,
        label: messages.t("execution", "action.stopPomo"),
        icon: "x",
        renderIcon: options.renderIcon,
        className: "spiral-day-execution__icon-button",
        onActivate: () => options.dispatch({
          type: "stop-standalone-pomo",
          intentId: `standalone-pomo-stop-${options.nowEpochMs}`,
        }),
      });
      appendPending(stop, options.pending.has("standalone-pomo"), messages);
      if (snapshot.writeBlocked) stop.disabled = true;
      const timer = executionElement(root.ownerDocument, "div", "spiral-day-execution__standalone");
      timer.append(elapsed, stop);
      empty.append(timer);
    }
    section.append(empty);
  } else {
    const current = executionElement(root.ownerDocument, "article", "spiral-day-execution__current");
    const label = executionElement(root.ownerDocument, "span", "spiral-day-execution__section-label");
    label.textContent = messages.t("execution", "timing.active");
    const heading = executionElement(root.ownerDocument, "div", "spiral-day-execution__current-heading");
    titleButton(heading, focused.label, (event) => options.navigateTask({
      path: focused.path,
      ownerId: focused.ownerId,
      sourceOrder: focused.sourceOrder,
    }, event.shiftKey ? "sidebar" : "main"));
    const elapsed = executionElement(root.ownerDocument, "time", "spiral-day-execution__elapsed");
    elapsed.dataset.startEpochMs = String(focused.clock.startEpochMs);
    if (snapshot.execution.kind === "forgotten") {
      elapsed.dataset.warningAtEpochMs = "0";
    } else if (snapshot.pomoThresholdMinutes > 0) {
      elapsed.dataset.warningAtEpochMs = String(
        focused.clock.startEpochMs + snapshot.pomoThresholdMinutes * 60_000,
      );
    }
    elapsed.dateTime = `PT${Math.max(0, Math.floor((options.nowEpochMs - focused.clock.startEpochMs) / 1_000))}S`;
    elapsed.textContent = formatExecutionDuration(options.nowEpochMs - focused.clock.startEpochMs);
    if (snapshot.execution.kind === "forgotten" || thresholdReached(snapshot, options.nowEpochMs)) {
      elapsed.dataset.warning = "true";
    }
    if (snapshot.execution.kind === "forgotten") {
      current.dataset.forgotten = "true";
    }
    heading.append(elapsed);

    const actions = executionElement(root.ownerDocument, "div", "spiral-day-execution__actions");
    const openActiveTask = executionIconButton({
      document: root.ownerDocument,
      label: messages.t("execution", "action.openActiveTask"),
      icon: "focus",
      renderIcon: options.renderIcon,
      className: "spiral-day-execution__secondary-action",
      onActivate: options.openActiveTask,
    });
    const clockOut = executionIconButton({
      document: root.ownerDocument,
      label: messages.t("execution", "action.clockOut"),
      icon: "square",
      renderIcon: options.renderIcon,
      className: "spiral-day-execution__primary-action",
      onActivate: () => options.dispatch({
        type: "clock-out",
        intentId: `clock-out-${options.nowEpochMs}`,
      }),
    });
    const complete = executionIconButton({
      document: root.ownerDocument,
      label: messages.t("execution", "action.complete"),
      icon: "check",
      renderIcon: options.renderIcon,
      className: "spiral-day-execution__secondary-action",
      onActivate: () => options.dispatch({
        type: "complete",
        intentId: `complete-${focused.ownerId}-${options.nowEpochMs}`,
        target: {
          path: focused.path,
          ownerId: focused.ownerId,
          sourceOrder: focused.sourceOrder,
          sourceFingerprint: "identified-target",
        },
      }),
    });
    const remove = executionIconButton({
      document: root.ownerDocument,
      label: messages.t("execution", "action.deleteClock"),
      icon: "trash",
      renderIcon: options.renderIcon,
      className: "spiral-day-execution__icon-button spiral-day-execution__danger-action",
      onActivate: () => options.requestDelete(focused.clock),
    });
    appendPending(clockOut, options.pending.has("clock-out"), messages);
    appendPending(complete, options.pending.has(`task:${focused.ownerId}`), messages);
    appendPending(remove, options.pending.has("delete-clock"), messages);
    if (snapshot.writeBlocked) {
      clockOut.disabled = true;
      complete.disabled = true;
      remove.disabled = true;
    }
    actions.append(openActiveTask, clockOut, complete, remove);
    current.append(label, heading, actions);
    if (snapshot.execution.kind === "forgotten") {
      const warning = executionElement(root.ownerDocument, "p", "spiral-day-execution__warning");
      warning.textContent = messages.t("execution", "timing.forgotten");
      current.append(warning);
    }
    section.append(current);
  }

  const recent = executionElement(root.ownerDocument, "section", "spiral-day-execution__recent");
  const recentHeading = executionElement(root.ownerDocument, "h3");
  recentHeading.textContent = messages.t("execution", "timing.recent");
  recent.append(recentHeading);
  if (options.recent.length === 0) {
    const empty = executionElement(root.ownerDocument, "p", "spiral-day-execution__muted");
    empty.textContent = messages.t("execution", "timing.noRecent");
    recent.append(empty);
  } else {
    const list = executionElement(root.ownerDocument, "ul", "spiral-day-execution__rows");
    for (const task of options.recent) {
      const item = executionElement(root.ownerDocument, "li", "spiral-day-execution__row");
      titleButton(item, task.label, (event) => options.navigateTask(task, event.shiftKey ? "sidebar" : "main"));
      const actual = executionElement(root.ownerDocument, "span", "spiral-day-execution__row-meta");
      actual.textContent = messages.t("shared", "unit.duration", { minutes: task.actualMinutes });
      item.append(actual);
      list.append(item);
    }
    recent.append(list);
  }
  root.append(section, recent);
}
