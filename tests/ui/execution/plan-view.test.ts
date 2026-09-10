import assert from "node:assert/strict";
import test from "node:test";

import type { PlanItem } from "../../../src/core/model";
import { enExecution } from "../../../src/i18n/locales/en/execution";
import { zhCNExecution } from "../../../src/i18n/locales/zh-CN/execution";
import { createMessages, defineLocaleNamespace } from "../../../src/i18n/resolver";
import type { RuntimePlanItemSource } from "../../../src/runtime/projection-runtime";
import { renderPlanView, type PlanViewOptions } from "../../../src/ui/execution/plan-view";

class ElementStub {
  className = "";
  textContent = "";
  readonly dataset: Record<string, string> = {};
  readonly children: ElementStub[] = [];

  constructor(readonly ownerDocument: DocumentStub) {}
  append(...children: ElementStub[]): void { this.children.push(...children); }
  replaceChildren(...children: ElementStub[]): void { this.children.splice(0, this.children.length, ...children); }
  querySelector(): null { return null; }
  setAttribute(): void {}
  addEventListener(): void {}
}

class DocumentStub {
  readonly elements: ElementStub[] = [];
  createElement(): ElementStub {
    const element = new ElementStub(this);
    this.elements.push(element);
    return element;
  }
}

const partialTask: PlanItem<RuntimePlanItemSource> = {
  kind: "flexible-task",
  status: "open",
  label: "Write a draft",
  durationMinutes: 60,
  progressPercent: 25,
  remainingDurationMinutes: 45,
  urgent: false,
  executionEligible: true,
  tokens: {},
  sourceOrder: 0,
  source: { path: "Daily/today.md", blockId: "task-1", sourceOrder: 0 },
};

function metadata(item = partialTask, locale = "en", scheduled = true, current = false): string[] {
  const document = new DocumentStub();
  const root = document.createElement();
  const messages = createMessages({
    locale,
    namespaces: { execution: defineLocaleNamespace("execution", enExecution, zhCNExecution) },
  });
  const interval = { startMinutes: 600, endMinutes: 645 };
  renderPlanView(root as unknown as HTMLElement, {
    nowEpochMs: 0,
    messages,
    pending: new Set(),
    renderIcon: () => {},
    dispatch: () => assert.fail("Rendering must not dispatch an execution intent"),
    navigateTask: () => assert.fail("Rendering must not navigate"),
    execution: {
      writeBlocked: false,
      ...(current ? { focused: { path: item.source.path, ownerId: item.source.blockId, sourceOrder: item.sourceOrder } } : {}),
    } as PlanViewOptions["execution"],
    snapshot: {
      state: "confirmed",
      projection: {
        items: [item],
        schedule: {
          fixedEvents: scheduled && item.kind === "fixed-event" ? [{ event: item, ...interval }] : [],
          plannedSlots: scheduled && item.kind === "flexible-task" ? [{ task: item, ...interval }] : [],
        },
      },
    } as PlanViewOptions["snapshot"],
  });
  const row = document.elements.find((element) => element.className === "spiral-day-execution__plan-row");
  assert.ok(row);
  return row.children[0].children
    .filter((element) => element.className === "spiral-day-execution__row-meta")
    .map((element) => element.textContent);
}

for (const [locale, expected] of [
  ["en", "45m remaining · 1h planned"],
  ["zh-CN", "剩余 45分钟 · 计划 1小时"],
]) {
  test(`scheduled partial tasks retain their time range and show projected durations in ${locale}`, () => {
    assert.deepEqual(metadata(partialTask, locale), ["10:00–10:45", expected]);
  });
}

test("Plan keeps unstarted and fixed-event rows concise", () => {
  assert.deepEqual(metadata({ ...partialTask, progressPercent: 0, remainingDurationMinutes: 60 }), ["10:00–10:45"]);
  assert.deepEqual(metadata({ ...partialTask, kind: "fixed-event", startMinutes: 600, endMinutes: 645 }), ["10:00–10:45"]);
});

test("Plan preserves current-task and unscheduled partial-task metadata", () => {
  assert.deepEqual(metadata(partialTask, "en", true, true), ["Current task"]);
  assert.deepEqual(metadata(partialTask, "zh-CN", true, true), ["当前任务"]);
  assert.deepEqual(metadata(partialTask, "en", false), ["45m remaining · 1h planned"]);
});

test("Plan displays the projected remaining duration without deriving it from the schedule", () => {
  assert.deepEqual(metadata({ ...partialTask, progressPercent: 33, remainingDurationMinutes: 40 }), ["10:00–10:45", "40m remaining · 1h planned"]);
});
