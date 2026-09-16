import assert from "node:assert/strict";
import test from "node:test";

import type { PlanItem } from "../../../src/core/model";
import { enExecution } from "../../../src/i18n/locales/en/execution";
import { zhCNExecution } from "../../../src/i18n/locales/zh-CN/execution";
import { createMessages, defineLocaleNamespace } from "../../../src/i18n/resolver";
import type { RuntimePlanItemSource } from "../../../src/runtime/projection-runtime";
import { primaryPlanSeed } from "../../../src/workspace/insert-primary-plan";
import { renderPlanView, type PlanViewOptions } from "../../../src/ui/execution/plan-view";

class ElementStub {
  className = "";
  textContent = "";
  readonly dataset: Record<string, string> = {};
  readonly children: ElementStub[] = [];

  constructor(readonly ownerDocument: DocumentStub) {}
  append(...children: ElementStub[]): void { this.children.push(...children); }
  replaceChildren(...children: ElementStub[]): void { this.children.splice(0, this.children.length, ...children); }
  querySelector(selector: string): ElementStub | null {
    if (selector.startsWith(".")) {
      const className = selector.slice(1);
      return this.children.find((child) => child.className === className) ?? null;
    }
    return null;
  }
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

function collectText(element: ElementStub): string[] {
  return [element.textContent, ...element.children.flatMap(collectText)].filter((value) => value !== "");
}

test("Plan missing state shows the Primary Plan markers and next actions", () => {
  const document = new DocumentStub();
  const root = document.createElement();
  const messages = createMessages({
    locale: "en",
    namespaces: { execution: defineLocaleNamespace("execution", enExecution, zhCNExecution) },
  });
  renderPlanView(root as unknown as HTMLElement, {
    nowEpochMs: 0,
    messages,
    pending: new Set(),
    renderIcon: () => {},
    dispatch: () => assert.fail("Rendering must not dispatch an execution intent"),
    navigateTask: () => assert.fail("Rendering must not navigate"),
    execution: { writeBlocked: false } as PlanViewOptions["execution"],
    snapshot: { state: "missing" } as PlanViewOptions["snapshot"],
  });
  const text = collectText(root).join("\n");
  assert.match(text, /No Primary Plan was found today/);
  assert.match(text, /nautilus-log:plan\/v1/);
  assert.equal(text.includes(primaryPlanSeed("en")), true);
});

test("Plan unscheduled empty copy does not claim there are no unfinished tasks", () => {
  const document = new DocumentStub();
  const root = document.createElement();
  const messages = createMessages({
    locale: "en",
    namespaces: { execution: defineLocaleNamespace("execution", enExecution, zhCNExecution) },
  });
  renderPlanView(root as unknown as HTMLElement, {
    nowEpochMs: 0,
    messages,
    pending: new Set(),
    renderIcon: () => {},
    dispatch: () => assert.fail("Rendering must not dispatch an execution intent"),
    navigateTask: () => assert.fail("Rendering must not navigate"),
    execution: { writeBlocked: false } as PlanViewOptions["execution"],
    snapshot: {
      state: "confirmed",
      projection: {
        items: [partialTask],
        schedule: {
          fixedEvents: [],
          plannedSlots: [{ task: partialTask, startMinutes: 600, endMinutes: 645 }],
        },
      },
    } as PlanViewOptions["snapshot"],
  });
  const text = collectText(root).join("\n");
  assert.match(text, /Write a draft/);
  assert.match(text, /Every open flexible task is already on the schedule/);
  assert.equal(text.includes("No unfinished direct tasks are available"), false);
});

test("Plan scheduled-empty with existing items offers Copy sample task", () => {
  const document = new DocumentStub();
  const root = document.createElement();
  const messages = createMessages({
    locale: "en",
    namespaces: { execution: defineLocaleNamespace("execution", enExecution, zhCNExecution) },
  });
  const doneTask = {
    ...partialTask,
    status: "done" as const,
    progressPercent: 100,
    remainingDurationMinutes: 0,
    executionEligible: false,
  };
  renderPlanView(root as unknown as HTMLElement, {
    nowEpochMs: 0,
    messages,
    pending: new Set(),
    renderIcon: () => {},
    dispatch: () => assert.fail("Rendering must not dispatch an execution intent"),
    navigateTask: () => assert.fail("Rendering must not navigate"),
    execution: { writeBlocked: false } as PlanViewOptions["execution"],
    snapshot: {
      state: "confirmed",
      projection: {
        items: [doneTask],
        schedule: { fixedEvents: [], plannedSlots: [] },
      },
    } as PlanViewOptions["snapshot"],
  });
  const text = collectText(root).join("\n");
  assert.match(text, /No unfinished direct tasks are available/);
  assert.match(text, /Add a direct `- \[ \]` flexible task/);
  assert.match(text, /Copy sample task/);
  assert.match(text, /- \[ \] Write the release note 45m/);
});

test("Plan confirmed empty region tells the user to add a list item", () => {
  const document = new DocumentStub();
  const root = document.createElement();
  const messages = createMessages({
    locale: "en",
    namespaces: { execution: defineLocaleNamespace("execution", enExecution, zhCNExecution) },
  });
  renderPlanView(root as unknown as HTMLElement, {
    nowEpochMs: 0,
    messages,
    pending: new Set(),
    renderIcon: () => {},
    dispatch: () => assert.fail("Rendering must not dispatch an execution intent"),
    navigateTask: () => assert.fail("Rendering must not navigate"),
    execution: { writeBlocked: false } as PlanViewOptions["execution"],
    snapshot: {
      state: "confirmed",
      projection: { items: [], schedule: { fixedEvents: [], plannedSlots: [] } },
    } as PlanViewOptions["snapshot"],
  });
  const text = collectText(root).join("\n");
  assert.match(text, /This Primary Plan has no list items/);
  assert.match(text, /Copy sample task/);
  assert.match(text, /- \[ \] Write the release note 45m/);
});
