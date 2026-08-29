import type { PlanItem } from "../../core/model";
import type {
  RuntimePlanItemSource,
  RuntimePlanProjection,
} from "../../runtime/projection-runtime";
import type { RuntimeSnapshot } from "../../runtime/snapshots";
import type {
  ExecutionApplicationIntent,
  ExecutionApplicationSnapshot,
  ExecutionTargetReference,
} from "../../runtime/execution/application";
import {
  executionElement,
  executionIconButton,
  type ExecutionIconRenderer,
  type ExecutionMessages,
} from "./shared-controls";

function formatMinutes(messages: ExecutionMessages, minutes: number): string {
  return messages.t("shared", "unit.duration", { minutes });
}

export interface PlanViewOptions {
  readonly nowEpochMs: number;
  readonly snapshot?: RuntimeSnapshot<RuntimePlanProjection>;
  readonly execution: ExecutionApplicationSnapshot;
  readonly pending: ReadonlySet<string>;
  readonly messages: ExecutionMessages;
  readonly renderIcon: ExecutionIconRenderer;
  readonly dispatch: (intent: ExecutionApplicationIntent) => void;
  readonly navigateTask: (
    target: { readonly path: string; readonly ownerId: string | null; readonly sourceOrder: number },
    location: "main" | "sidebar",
  ) => void;
}

function clockMinute(minutes: number): string {
  const bounded = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  return `${String(Math.floor(bounded / 60)).padStart(2, "0")}:${String(bounded % 60).padStart(2, "0")}`;
}

function targetReference(
  item: PlanItem<RuntimePlanItemSource>,
  projection: RuntimePlanProjection,
): ExecutionTargetReference {
  return Object.freeze({
    path: item.source.path,
    ownerId: item.source.blockId,
    sourceOrder: item.sourceOrder,
    sourceFingerprint: projection.sourceFingerprint,
  });
}

function taskKey(item: PlanItem<RuntimePlanItemSource>): string {
  return item.source.blockId ?? `${item.source.path}:${item.sourceOrder}`;
}

function appendTaskRow(
  parent: HTMLElement,
  item: PlanItem<RuntimePlanItemSource>,
  projection: RuntimePlanProjection,
  options: PlanViewOptions,
  range?: readonly [number, number],
): void {
  const key = taskKey(item);
  const row = executionElement(parent.ownerDocument, "li", "spiral-day-execution__plan-row");
  row.dataset.kind = item.kind;
  row.dataset.urgent = String(item.urgent);
  row.dataset.current = String(options.execution.focused?.ownerId === item.source.blockId);
  const body = executionElement(parent.ownerDocument, "div", "spiral-day-execution__plan-row-body");
  const title = executionElement(parent.ownerDocument, "button", "spiral-day-execution__task-title");
  title.type = "button";
  title.textContent = item.label;
  title.addEventListener("click", (event) => options.navigateTask({
    path: item.source.path,
    ownerId: item.source.blockId,
    sourceOrder: item.source.sourceOrder,
  }, event.shiftKey ? "sidebar" : "main"));
  body.append(title);
  const metadata = executionElement(parent.ownerDocument, "span", "spiral-day-execution__row-meta");
  if (options.execution.focused?.ownerId === item.source.blockId) {
    metadata.textContent = options.messages.t("execution", "timing.active");
  } else if (range) {
    metadata.textContent = options.messages.t("execution", "plan.range", {
      start: clockMinute(range[0]),
      end: clockMinute(range[1]),
    });
  } else if (item.progressPercent > 0) {
    metadata.textContent = options.messages.t("execution", "plan.remaining", {
      remaining: formatMinutes(options.messages, item.remainingDurationMinutes),
      planned: formatMinutes(options.messages, item.durationMinutes),
    });
  } else {
    metadata.textContent = formatMinutes(options.messages, item.durationMinutes);
  }
  body.append(metadata);

  const actions = executionElement(parent.ownerDocument, "div", "spiral-day-execution__row-actions");
  if (item.kind === "flexible-task" && item.status === "open" && item.executionEligible) {
    const target = targetReference(item, projection);
    const clock = executionIconButton({
      document: parent.ownerDocument,
      label: options.messages.t("execution", "action.clockIn"),
      icon: "clock",
      renderIcon: options.renderIcon,
      className: "spiral-day-execution__icon-button",
      onActivate: () => options.dispatch({
        type: "clock-in",
        intentId: `clock-in-${key}-${options.nowEpochMs}`,
        target,
      }),
    });
    const progress = executionIconButton({
      document: parent.ownerDocument,
      label: options.messages.t("execution", "action.complete"),
      icon: "check",
      renderIcon: options.renderIcon,
      className: "spiral-day-execution__icon-button",
      onActivate: () => options.dispatch({
        type: "advance-or-reopen-progress",
        intentId: `progress-${key}-${options.nowEpochMs}`,
        target,
      }),
    });
    const pending = options.pending.has(`task:${key}`);
    clock.disabled = pending || options.execution.writeBlocked;
    progress.disabled = pending || options.execution.writeBlocked;
    clock.setAttribute("aria-busy", String(pending));
    progress.setAttribute("aria-busy", String(pending));
    actions.append(clock, progress);
  }
  row.append(body, actions);
  parent.append(row);
}

function appendState(root: HTMLElement, heading: string, detail: string): void {
  const state = executionElement(root.ownerDocument, "div", "spiral-day-execution__empty");
  const title = executionElement(root.ownerDocument, "strong");
  title.textContent = heading;
  const message = executionElement(root.ownerDocument, "p");
  message.textContent = detail;
  state.append(title, message);
  root.append(state);
}

export function renderPlanView(root: HTMLElement, options: PlanViewOptions): void {
  const unscheduledOpen = root
    .querySelector<HTMLDetailsElement>(".spiral-day-execution__unscheduled")
    ?.open ?? false;
  root.replaceChildren();
  const snapshot = options.snapshot;
  if (!snapshot || snapshot.state === "loading" || snapshot.state === "hidden" || snapshot.state === "stale") {
    appendState(root, options.messages.t("execution", "plan.loading"), "");
    return;
  }
  if (snapshot.state === "missing") {
    appendState(root, options.messages.t("execution", "plan.noPrimary"), "");
    return;
  }
  if (snapshot.state !== "confirmed") {
    appendState(root, options.messages.t("execution", "plan.unavailable"), "");
    return;
  }
  const { projection } = snapshot;
  const scheduled = executionElement(root.ownerDocument, "section", "spiral-day-execution__plan-section");
  const heading = executionElement(root.ownerDocument, "h3");
  heading.textContent = options.messages.t("execution", "plan.scheduled");
  scheduled.append(heading);
  const list = executionElement(root.ownerDocument, "ul", "spiral-day-execution__rows");
  const placed = new Set<string>();
  const intervals = [
    ...projection.schedule.fixedEvents.map((entry) => ({
      item: entry.event,
      start: entry.startMinutes,
      end: entry.endMinutes,
    })),
    ...projection.schedule.plannedSlots.map((entry) => ({
      item: entry.task,
      start: entry.startMinutes,
      end: entry.endMinutes,
    })),
  ].sort((left, right) => left.start - right.start || left.item.sourceOrder - right.item.sourceOrder);
  for (const interval of intervals) {
    placed.add(taskKey(interval.item));
    appendTaskRow(list, interval.item, projection, options, [interval.start, interval.end]);
  }
  if (intervals.length === 0) {
    const empty = executionElement(root.ownerDocument, "p", "spiral-day-execution__muted");
    empty.textContent = options.messages.t("execution", "plan.noTasks");
    scheduled.append(empty);
  } else scheduled.append(list);

  const unscheduledItems = projection.items.filter((item) =>
    item.kind === "flexible-task"
    && item.status === "open"
    && !placed.has(taskKey(item)));
  const unscheduled = executionElement(root.ownerDocument, "details", "spiral-day-execution__unscheduled");
  unscheduled.open = unscheduledOpen;
  const summary = executionElement(root.ownerDocument, "summary");
  const summaryTitle = executionElement(root.ownerDocument, "span");
  summaryTitle.textContent = options.messages.t("execution", "plan.unscheduled");
  const summaryMeta = executionElement(root.ownerDocument, "span", "spiral-day-execution__row-meta");
  summaryMeta.textContent = options.messages.t("execution", "plan.unscheduledSummary", {
    count: unscheduledItems.length,
      duration: formatMinutes(options.messages, unscheduledItems.reduce(
      (total, item) => total + item.remainingDurationMinutes,
      0,
    )),
  });
  summary.append(summaryTitle, summaryMeta);
  unscheduled.append(summary);
  const unscheduledList = executionElement(root.ownerDocument, "ul", "spiral-day-execution__rows");
  for (const item of unscheduledItems) appendTaskRow(unscheduledList, item, projection, options);
  if (unscheduledItems.length === 0) {
    const empty = executionElement(root.ownerDocument, "p", "spiral-day-execution__muted");
    empty.textContent = options.messages.t("execution", "plan.noTasks");
    unscheduled.append(empty);
  } else unscheduled.append(unscheduledList);
  root.append(scheduled, unscheduled);
}
