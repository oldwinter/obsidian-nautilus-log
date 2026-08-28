import { calculateCapacity } from "../../../src/core/capacity.ts";
import { projectDay, type DayRelation, type LogicalDate } from "../../../src/core/day.ts";
import type { PlanItem } from "../../../src/core/model.ts";
import { schedulePlan } from "../../../src/core/scheduler.ts";
import type {
  RuntimePlanItemSource,
  RuntimePlanProjection,
} from "../../../src/runtime/projection-runtime.ts";

export const DISPLAYED_DATE: LogicalDate = Object.freeze({ year: 2026, month: 8, day: 28 });
export const TODAY: LogicalDate = DISPLAYED_DATE;
export const BOUNDS = Object.freeze({ startMinutes: 5 * 60, endMinutes: 24 * 60 });

function source(sourceOrder: number): RuntimePlanItemSource {
  return Object.freeze({
    path: "Journal/2026-08-28.md",
    blockId: `nl-${sourceOrder}`,
    sourceOrder,
  });
}

function base(
  sourceOrder: number,
  label: string,
  status: "plain" | "open" | "done",
  durationMinutes: number,
) {
  return {
    source: source(sourceOrder),
    sourceOrder,
    status,
    label,
    durationMinutes,
    progressPercent: status === "done" ? 100 : 0,
    remainingDurationMinutes: status === "done" ? 0 : durationMinutes,
    urgent: false,
    executionEligible: status === "open",
    tokens: Object.freeze({}),
  } as const;
}

export function denseItems(): readonly PlanItem<RuntimePlanItemSource>[] {
  return Object.freeze([
    Object.freeze({
      ...base(0, "Deep work proposal with a long Latin label", "open", 30),
      kind: "flexible-task" as const,
    }),
    Object.freeze({
      ...base(1, "urgent 发布前检查与长中文标题", "open", 45),
      kind: "flexible-task" as const,
      urgent: true,
      progressPercent: 40,
      remainingDurationMinutes: 27,
    }),
    Object.freeze({
      ...base(2, "Client review", "plain", 60),
      kind: "fixed-event" as const,
      startMinutes: 14 * 60,
      endMinutes: 15 * 60,
    }),
    Object.freeze({
      ...base(3, "Conflicting design review", "plain", 60),
      kind: "fixed-event" as const,
      startMinutes: 14 * 60 + 30,
      endMinutes: 15 * 60 + 30,
    }),
    Object.freeze({
      ...base(4, "Completed morning setup long Latin label", "done", 30),
      kind: "flexible-task" as const,
      completionAnchorMinutes: 7 * 60,
    }),
    Object.freeze({
      ...base(5, "已完成早间事件与长中文标题", "done", 45),
      kind: "fixed-event" as const,
      startMinutes: 6 * 60,
      endMinutes: 6 * 60 + 45,
    }),
    Object.freeze({
      ...base(6, "Large overflow task remains visible", "open", 11 * 60),
      kind: "flexible-task" as const,
    }),
    Object.freeze({
      ...base(7, "Ends at midnight", "plain", 60),
      kind: "fixed-event" as const,
      startMinutes: 23 * 60,
      endMinutes: 24 * 60,
    }),
  ]);
}

function dateForRelation(relation: DayRelation): { displayedDate: LogicalDate; today: LogicalDate } {
  if (relation === "past") {
    return { displayedDate: { year: 2026, month: 8, day: 27 }, today: TODAY };
  }
  if (relation === "future") {
    return { displayedDate: { year: 2026, month: 8, day: 29 }, today: TODAY };
  }
  if (relation === "other") {
    return { displayedDate: DISPLAYED_DATE, today: { year: 2026, month: 8, day: 29 } };
  }
  return { displayedDate: DISPLAYED_DATE, today: TODAY };
}

export function plannerProjection(
  relation: DayRelation = "today",
): RuntimePlanProjection {
  const items = denseItems();
  const dates = dateForRelation(relation);
  const nowMinutes = 13 * 60;
  const day = projectDay({
    ...dates,
    ...BOUNDS,
    nowMinutes,
  });
  const scheduleInput = {
    ...BOUNDS,
    nowMinutes: day.scheduleFromMinutes,
    items,
  };
  return Object.freeze({
    contextKey: "2026-08-28",
    sourcePath: "Journal/2026-08-28, Thursday.md",
    sourceFingerprint: "sha256:planner-fixture",
    displayedDate: Object.freeze({ ...dates.displayedDate }),
    today: Object.freeze({ ...dates.today }),
    items,
    diagnostics: Object.freeze([
      Object.freeze({ code: "overnight-truncated", sourceOrder: 7 }),
      Object.freeze({ code: "same-time", sourceOrder: 3 }),
    ]),
    day,
    schedule: schedulePlan(scheduleInput),
    capacity: calculateCapacity(scheduleInput),
  });
}
