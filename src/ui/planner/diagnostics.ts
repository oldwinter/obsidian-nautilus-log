import type { RuntimePlanProjection } from "../../runtime/projection-runtime";

export interface PlannerWarningRow {
  readonly sourceOrder: number | null;
  readonly title: string;
  readonly message: string;
}

export interface PlannerOverflowRow {
  readonly sourceOrder: number;
  readonly title: string;
  readonly durationMinutes: number;
}

const WARNING_MESSAGES: Readonly<Record<string, string>> = Object.freeze({
  "overnight-truncated": "Overnight events display only through 24:00",
  "same-time": "Start and end are the same",
  "invalid-time-range": "The time range is invalid",
  "empty-plan-item": "The plan item has no visible label",
});

export function plannerWarnings(
  projection: RuntimePlanProjection,
): readonly PlannerWarningRow[] {
  const labels = new Map(projection.items.map((item) => [item.sourceOrder, item.label]));
  return Object.freeze(projection.diagnostics.flatMap((diagnostic) => {
    const message = WARNING_MESSAGES[diagnostic.code];
    if (!message) return [];
    return [Object.freeze({
      sourceOrder: diagnostic.sourceOrder,
      title: diagnostic.sourceOrder === null
        ? "Plan"
        : labels.get(diagnostic.sourceOrder) ?? `Item ${diagnostic.sourceOrder + 1}`,
      message,
    })];
  }));
}

export function plannerOverflow(
  projection: RuntimePlanProjection,
): readonly PlannerOverflowRow[] {
  return Object.freeze(projection.schedule.overflowTasks.map((entry) => Object.freeze({
    sourceOrder: entry.task.sourceOrder,
    title: entry.task.label,
    durationMinutes: entry.durationMinutes,
  })));
}

export function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes)) return "-";
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (hours === 0) return `${remainder}m`;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

export function formatClockMinute(minutes: number): string {
  const bounded = Math.max(0, Math.min(24 * 60, Math.round(minutes)));
  if (bounded === 24 * 60) return "24:00";
  return `${String(Math.floor(bounded / 60)).padStart(2, "0")}`
    + `:${String(bounded % 60).padStart(2, "0")}`;
}
