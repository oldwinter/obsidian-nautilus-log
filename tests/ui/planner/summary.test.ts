import assert from "node:assert/strict";
import test from "node:test";

import { copyPlannerSummary } from "../../../src/adapters/plan-summary.ts";
import { createMessages } from "../../../src/i18n/resolver.ts";
import { schedulePlan } from "../../../src/core/scheduler.ts";
import {
  escapePlannerSummaryText,
  formatPlannerSummary,
} from "../../../src/ui/planner/summary.ts";
import { BOUNDS, plannerProjection } from "./fixtures.ts";

test("plan summaries preserve schedule state, progress, overflow, and stable Markdown", () => {
  assert.equal(formatPlannerSummary(plannerProjection(), BOUNDS, createMessages()), [
    "## Spiral Day - 2026-08-28",
    "",
    "### Schedule",
    "- ~~06:00-06:45 已完成早间事件与长中文标题~~",
    "- [x] 06:30-07:00 Completed morning setup long Latin label",
    "- [ ] 13:00-13:30 Deep work proposal with a long Latin label",
    "- [ ] 13:30-13:57 urgent 发布前检查与长中文标题 (40%)",
    "- 14:00-15:00 Client review",
    "- 14:30-15:30 Conflicting design review",
    "- 23:00-24:00 Ends at midnight",
    "",
    "### Unscheduled",
    "- [ ] Large overflow task remains visible (11h)",
  ].join("\n"));
});

test("plan summaries localize headings and state an empty schedule", () => {
  const original = plannerProjection();
  const projection = Object.freeze({
    ...original,
    items: Object.freeze([]),
    schedule: schedulePlan({ ...BOUNDS, items: [] }),
  });
  assert.equal(formatPlannerSummary(projection, BOUNDS, createMessages({ locale: "zh-CN" })), [
    "## Spiral Day - 2026-08-28",
    "",
    "### 日程",
    "- 没有已排期项目",
  ].join("\n"));
});

test("plan summary labels collapse whitespace and escape inline Markdown", () => {
  assert.equal(
    escapePlannerSummaryText("  Review *draft*\n[owner] "),
    "Review \\*draft\\* \\[owner\\]",
  );
});

test("copy plan summary reports clipboard success, absence, and rejection", async () => {
  const copied: string[] = [];
  assert.equal(await copyPlannerSummary({
    summary: "summary",
    clipboard: { async writeText(value) { copied.push(value); } },
  }), "copied");
  assert.deepEqual(copied, ["summary"]);
  assert.equal(await copyPlannerSummary({ summary: "summary", clipboard: undefined }), "failed");
  assert.equal(await copyPlannerSummary({
    summary: "summary",
    clipboard: { async writeText() { throw new Error("denied"); } },
  }), "failed");
});
