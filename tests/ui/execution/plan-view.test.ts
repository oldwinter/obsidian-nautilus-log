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
  checked = false;
  open = false;
  readonly listeners = new Map<string, (event?: { shiftKey: boolean }) => void>();
  focus(): void { this.ownerDocument.activeElement = this; }
  fire(event: string): void { this.listeners.get(event)?.(); }

  constructor(readonly ownerDocument: DocumentStub) {}
  append(...children: ElementStub[]): void { this.children.push(...children); }
  replaceChildren(...children: ElementStub[]): void { this.children.splice(0, this.children.length, ...children); }
  querySelector(selector: string): ElementStub | null {
    if (selector.startsWith(".")) {
      const className = selector.slice(1);
      return this.children.find((child) => child.className === className)
        ?? this.children.map((child) => child.querySelector(selector)).find(Boolean) ?? null;
    }
    return null;
  }
  setAttribute(): void {}
  addEventListener(event: string, listener: (event?: { shiftKey: boolean }) => void): void { this.listeners.set(event, listener); }
}

class DocumentStub {
  activeElement: ElementStub | null = null;
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
  assert.match(text, /Use Copy sample task/);
  assert.match(text, /Copy sample task/);
  assert.match(text, /- \[ \] Write the release note 45m/);
});

test("Plan confirmed empty region names Copy sample task", () => {
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

test("Plan error state names Settings and Planner", () => {
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
    snapshot: { state: "error" } as PlanViewOptions["snapshot"],
  });
  const text = collectText(root).join("\n");
  assert.match(text, /Today's plan is unavailable/);
  assert.match(text, /Settings → Spiral Day/);
  assert.match(text, /open Planner from the ribbon/);
});

for (const locale of ["en", "zh-CN"]) {
  test(`Plan search combines schedule, unscheduled sorting, and original action targets in ${locale}`, () => {
    const document = new DocumentStub();
    const root = document.createElement();
    const task = (label: string, sourceOrder: number, remaining: number) => Object.freeze({
      ...partialTask, label, sourceOrder, remainingDurationMinutes: remaining,
      source: Object.freeze({ ...partialTask.source, sourceOrder, blockId: `search-${sourceOrder}` }),
    });
    const items = Object.freeze([
      task("Draft outline", 0, 30), task("Send email", 1, 20),
      task("Draft conclusion", 2, 15), task("Draft title", 3, 5),
      task("整理笔记", 4, 10),
    ]);
    const fixed = Object.freeze({ ...task("Draft meeting", 5, 30), kind: "fixed-event" as const, executionEligible: false });
    const dispatched: unknown[] = [];
    const navigated: unknown[] = [];
    const options: PlanViewOptions = {
      nowEpochMs: 10,
      messages: createMessages({ locale, namespaces: {
        execution: defineLocaleNamespace("execution", enExecution, zhCNExecution),
      } }),
      pending: new Set(), renderIcon: () => {},
      dispatch: (intent) => { dispatched.push(intent); },
      navigateTask: (target, location) => { navigated.push({ target, location }); },
      execution: { writeBlocked: false } as PlanViewOptions["execution"],
      snapshot: { state: "confirmed", projection: {
        sourceFingerprint: "original-search-source", items: Object.freeze([...items, fixed]),
        schedule: {
          fixedEvents: [{ event: fixed, startMinutes: 540, endMinutes: 570 }],
          plannedSlots: [{ task: items[0], startMinutes: 600, endMinutes: 630 }],
        },
      } } as PlanViewOptions["snapshot"],
    };
    const render = (searchQuery: string, shortestFirst = false) =>
      renderPlanView(root as unknown as HTMLElement, { ...options, searchQuery, shortestFirst });
    const rows = (section: string) => root.querySelector(section)?.querySelector(".spiral-day-execution__rows")?.children ?? [];
    const titles = (section: string) => rows(section).map((row) => row.querySelector(".spiral-day-execution__task-title")!.textContent);
    const scheduled = ".spiral-day-execution__plan-section";
    const unscheduled = ".spiral-day-execution__unscheduled";
    render("  DrAfT  ", true);
    assert.deepEqual(titles(scheduled), ["Draft meeting", "Draft outline"]);
    assert.deepEqual(titles(unscheduled), ["Draft title", "Draft conclusion"]);
    assert.equal(root.querySelector(unscheduled)!.open, true);
    root.querySelector(unscheduled)!.open = false;
    render("  DrAfT  ", true);
    assert.equal(root.querySelector(unscheduled)!.open, false, "a refresh preserves manual collapse");
    assert.deepEqual(dispatched, []);
    assert.deepEqual(navigated, []);
    const first = rows(unscheduled)[0];
    first.querySelector(".spiral-day-execution__task-title")!.listeners.get("click")?.({ shiftKey: true });
    first.querySelector(".spiral-day-execution__row-actions")!.children[0].fire("click");
    assert.deepEqual(navigated, [{ target: { path: "Daily/today.md", ownerId: "search-3", sourceOrder: 3 }, location: "sidebar" }]);
    assert.deepEqual(dispatched, [{ type: "clock-in", intentId: "clock-in-search-3-10", target: {
      path: "Daily/today.md", ownerId: "search-3", sourceOrder: 3, sourceFingerprint: "original-search-source",
    } }]);
    render("笔记");
    assert.equal(root.querySelector(unscheduled)!.open, true, "a new search reveals unscheduled matches");
    assert.deepEqual(titles(scheduled), []);
    assert.deepEqual(titles(unscheduled), ["整理笔记"]);
    render("no such item");
    assert.deepEqual(titles(scheduled), []);
    assert.deepEqual(titles(unscheduled), []);
    assert.ok(collectText(root).includes(options.messages.t("execution", "plan.noScheduledMatches")));
    assert.ok(collectText(root).includes(options.messages.t("execution", "plan.noUnscheduledMatches")));
    assert.equal(collectText(root).includes(options.messages.t("execution", "plan.noTasks")), false);
    render("   ");
    assert.deepEqual(titles(scheduled), ["Draft meeting", "Draft outline"]);
    assert.deepEqual(titles(unscheduled), ["Send email", "Draft conclusion", "Draft title", "整理笔记"]);
    assert.deepEqual(items.map((item) => item.sourceOrder), [0, 1, 2, 3, 4]);
  });

  test(`unscheduled quick-task sorting uses remaining time and preserves source targets in ${locale}`, () => {
    const document = new DocumentStub();
    const root = document.createElement();
    const makeTask = (label: string, sourceOrder: number, duration: number, remaining: number) => ({
      ...partialTask, label, sourceOrder, durationMinutes: duration, remainingDurationMinutes: remaining,
      source: { ...partialTask.source, sourceOrder, blockId: `task-${sourceOrder}` },
    });
    const items = Object.freeze([
      makeTask("Long task", 0, 30, 30),
      makeTask("Almost finished", 1, 60, 5),
      makeTask("Quick task", 2, 5, 5),
    ]);
    const navigated: unknown[] = [];
    const dispatched: unknown[] = [];
    let shortestFirst = false;
    const options: PlanViewOptions = {
      nowEpochMs: 0,
      messages: createMessages({ locale, namespaces: {
        execution: defineLocaleNamespace("execution", enExecution, zhCNExecution),
      } }),
      pending: new Set(), renderIcon: () => {},
      dispatch: (intent) => { dispatched.push(intent); },
      navigateTask: (target) => { navigated.push(target); },
      setShortestFirst: (enabled) => { shortestFirst = enabled; },
      execution: { writeBlocked: false } as PlanViewOptions["execution"],
      snapshot: { state: "confirmed", projection: {
        sourceFingerprint: "original", items,
        schedule: { fixedEvents: [], plannedSlots: [] },
      } } as PlanViewOptions["snapshot"],
    };
    const render = () => renderPlanView(root as unknown as HTMLElement, { ...options, shortestFirst });
    const titles = () => root.querySelector(".spiral-day-execution__unscheduled")!
      .querySelector(".spiral-day-execution__rows")!.children
      .map((row) => row.querySelector(".spiral-day-execution__task-title")!);
    render();
    assert.deepEqual(titles().map((title) => title.textContent), ["Long task", "Almost finished", "Quick task"]);
    const toggle = root.querySelector(".spiral-day-execution__shortest-first")!;
    toggle.focus();
    toggle.checked = true;
    toggle.fire("change");
    assert.equal(shortestFirst, true);
    assert.deepEqual(titles().map((title) => title.textContent), ["Almost finished", "Quick task", "Long task"]);
    assert.equal(document.activeElement, toggle);
    assert.deepEqual(dispatched, []);
    // Navigation keeps the original source reference after rows move.
    titles()[0].listeners.get("click")?.({ shiftKey: false });
    assert.deepEqual(navigated, [{ path: "Daily/today.md", ownerId: "task-1", sourceOrder: 1 }]);
    render();
    const refreshed = root.querySelector(".spiral-day-execution__shortest-first")!;
    assert.equal(refreshed.checked, true);
    assert.equal(document.activeElement, refreshed);
    refreshed.checked = false;
    refreshed.fire("change");
    assert.deepEqual(titles().map((title) => title.textContent), ["Long task", "Almost finished", "Quick task"]);
    assert.deepEqual(items.map((item) => item.label), ["Long task", "Almost finished", "Quick task"]);
    assert.ok(collectText(root).includes(locale === "en" ? "Shortest remaining first" : "剩余用时短的优先"));
  });
}
