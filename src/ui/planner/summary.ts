import type { Messages } from "../../i18n/types";
import type { RuntimePlanProjection } from "../../runtime/projection-runtime";
import { formatClockMinute, formatDuration } from "./diagnostics";
import type { PlannerTimeBounds } from "./geometry";
import { buildPlannerSpiralModel, type PlannerTimelineItem } from "./spiral";

export type PlannerSummaryCopyOutcome = "copied" | "failed";

export function escapePlannerSummaryText(value: string): string {
  return value
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/([\\`*_[\]<>~])/gu, "\\$1");
}

function summaryDate(projection: RuntimePlanProjection): string {
  const { year, month, day } = projection.displayedDate;
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}`
    + `-${String(day).padStart(2, "0")}`;
}

function itemTitle(item: PlannerTimelineItem, messages: Messages): string {
  const title = escapePlannerSummaryText(item.title);
  return title || messages.t("planner", "warning.itemFallback", { index: item.sourceOrder + 1 });
}

function formatScheduledItem(item: PlannerTimelineItem, messages: Messages): string {
  const time = `${formatClockMinute(item.startMinutes)}-${formatClockMinute(item.endMinutes)}`;
  const title = itemTitle(item, messages);
  if (item.kind === "event") {
    return item.completed ? `- ~~${time} ${title}~~` : `- ${time} ${title}`;
  }
  const progress = !item.completed && item.progressPercent > 0
    ? ` (${Math.round(item.progressPercent)}%)`
    : "";
  return `- [${item.completed ? "x" : " "}] ${time} ${title}${progress}`;
}

export function formatPlannerSummary(
  projection: RuntimePlanProjection,
  bounds: PlannerTimeBounds,
  messages: Messages,
): string {
  const schedule = buildPlannerSpiralModel(projection, bounds, {
    mode: "compact",
    showCompleted: true,
  });
  const lines = [
    `## Spiral Day - ${summaryDate(projection)}`,
    "",
    `### ${messages.t("planner", "summary.schedule")}`,
  ];
  lines.push(...(schedule.items.length > 0
    ? schedule.items.map((item) => formatScheduledItem(item, messages))
    : [`- ${messages.t("planner", "summary.empty")}`]));

  if (projection.schedule.overflowTasks.length > 0) {
    lines.push("", `### ${messages.t("planner", "summary.unscheduled")}`);
    for (const entry of projection.schedule.overflowTasks) {
      const title = escapePlannerSummaryText(entry.task.label)
        || messages.t("planner", "warning.itemFallback", { index: entry.task.sourceOrder + 1 });
      lines.push(`- [ ] ${title} (${formatDuration(entry.durationMinutes)})`);
    }
  }
  return lines.join("\n");
}
