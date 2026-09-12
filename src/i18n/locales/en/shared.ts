import type { SharedCatalog } from "../../types";

function formatDuration(minutes: number): string {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

export const enShared = Object.freeze({
  "action.close": "Close",
  "action.refresh": "Refresh",
  "state.completed": "completed",
  "state.conflict": "conflict",
  "state.current": "current",
  "state.urgent": "urgent",
  "status.error": "Planner could not load",
  "status.hidden": "Planner refresh paused",
  "status.loading": "Loading Nautilus Log...",
  "status.missing": "No Primary Plan",
  "status.overLimit": "Planner input limit reached",
  "status.stale": "Planner snapshot is stale",
  "status.unavailable": "Spiral Day is unavailable in this workspace. Enable the plugin and reload the view.",
  "unit.duration": ({ minutes }) => formatDuration(minutes),
  "unit.itemCount": ({ count }) => `${count} ${count === 1 ? "item" : "items"}`,
} satisfies SharedCatalog);
