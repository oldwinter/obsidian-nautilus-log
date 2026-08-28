import type {
  FixedEvent,
  FlexibleTask,
  PlanItem,
  PlanItemStatus,
} from "../../../src/core/model.ts";
import type { LocalMidnightResolver, LogicalDate } from "../../../src/core/day.ts";

const EMPTY_TOKENS = Object.freeze({});

function base(sourceOrder: number, status: PlanItemStatus, label: string) {
  return {
    source: Object.freeze({ id: `item-${sourceOrder}` }),
    sourceOrder,
    status,
    label,
    progressPercent: 0,
    urgent: false,
    tokens: EMPTY_TOKENS,
  } as const;
}

export function task(
  sourceOrder: number,
  remainingDurationMinutes: number,
  status: PlanItemStatus = "open",
  label = `Task ${sourceOrder}`,
): FlexibleTask<{ readonly id: string }> {
  return Object.freeze({
    ...base(sourceOrder, status, label),
    kind: "flexible-task",
    durationMinutes: remainingDurationMinutes,
    remainingDurationMinutes,
    executionEligible: status === "open",
  });
}

export function event(
  sourceOrder: number,
  startMinutes: number,
  endMinutes: number,
  status: PlanItemStatus = "open",
  label = `Event ${sourceOrder}`,
): FixedEvent<{ readonly id: string }> {
  return Object.freeze({
    ...base(sourceOrder, status, label),
    kind: "fixed-event",
    durationMinutes: 15,
    remainingDurationMinutes: 15,
    executionEligible: false,
    startMinutes,
    endMinutes,
  });
}

export function frozenItems(
  items: readonly PlanItem<{ readonly id: string }>[],
): readonly PlanItem<{ readonly id: string }>[] {
  return Object.freeze([...items]);
}

const MIDNIGHT_FIXTURES = new Map<string, number>([
  ["UTC:2026-02-01", Date.parse("2026-02-01T00:00:00Z")],
  ["UTC:2026-02-02", Date.parse("2026-02-02T00:00:00Z")],
  ["Asia/Shanghai:2026-02-01", Date.parse("2026-02-01T00:00:00+08:00")],
  ["Asia/Shanghai:2026-02-02", Date.parse("2026-02-02T00:00:00+08:00")],
  ["Asia/Shanghai:2026-08-28", Date.parse("2026-08-28T00:00:00+08:00")],
  ["Asia/Shanghai:2026-08-29", Date.parse("2026-08-29T00:00:00+08:00")],
  ["America/New_York:2026-02-01", Date.parse("2026-02-01T00:00:00-05:00")],
  ["America/New_York:2026-02-02", Date.parse("2026-02-02T00:00:00-05:00")],
  ["America/New_York:2026-03-08", Date.parse("2026-03-08T00:00:00-05:00")],
  ["America/New_York:2026-03-09", Date.parse("2026-03-09T00:00:00-04:00")],
  ["America/New_York:2026-11-01", Date.parse("2026-11-01T00:00:00-04:00")],
  ["America/New_York:2026-11-02", Date.parse("2026-11-02T00:00:00-05:00")],
]);

export const fixtureLocalMidnight: LocalMidnightResolver = (
  date: LogicalDate,
  timeZone: string,
) => {
  const key = `${timeZone}:${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
  const value = MIDNIGHT_FIXTURES.get(key);
  if (value === undefined) throw new RangeError(`Missing calendar fixture ${key}`);
  return value;
};
