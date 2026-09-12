import type { SharedCatalog } from "../../types";

function formatDuration(minutes: number): string {
  const safeMinutes = Math.max(0, Math.round(minutes));
  const hours = Math.floor(safeMinutes / 60);
  const remainder = safeMinutes % 60;
  if (hours === 0) return `${remainder}分钟`;
  if (remainder === 0) return `${hours}小时`;
  return `${hours}小时${remainder}分钟`;
}

export const zhCNShared = Object.freeze({
  "action.close": "关闭",
  "action.refresh": "刷新",
  "state.completed": "已完成",
  "state.conflict": "有冲突",
  "state.current": "当前",
  "state.urgent": "紧急",
  "status.error": "规划器无法载入",
  "status.hidden": "规划器刷新已暂停",
  "status.loading": "正在载入 Nautilus Log...",
  "status.missing": "没有主计划",
  "status.overLimit": "规划器输入已达上限",
  "status.stale": "规划器快照已过期",
  "status.unavailable": "Spiral Day 在当前工作区不可用。请启用插件并重新载入视图。",
  "unit.duration": ({ minutes }) => formatDuration(minutes),
  "unit.itemCount": ({ count }) => `${count}项`,
} satisfies SharedCatalog);
