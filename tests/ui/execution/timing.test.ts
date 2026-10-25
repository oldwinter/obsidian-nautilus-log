import assert from "node:assert/strict";
import test from "node:test";

import type { PlanItem } from "../../../src/core/model";
import { enExecution } from "../../../src/i18n/locales/en/execution";
import { zhCNExecution } from "../../../src/i18n/locales/zh-CN/execution";
import { createMessages, defineLocaleNamespace } from "../../../src/i18n/resolver";
import type { ExecutionApplicationSnapshot } from "../../../src/runtime/execution/application";
import type { RuntimePlanItemSource } from "../../../src/runtime/projection-runtime";
import {
  recentTaskClockInIntent,
  renderTimingView,
  selectUpNextTask,
  upNextClockInIntent,
  type ExecutionRecentTask,
  type TimingViewOptions,
} from "../../../src/ui/execution/timing-view";

const task: ExecutionRecentTask = Object.freeze({
  key: "Daily/2026-08-29.md#task-1",
  ownerId: "nl-11111111-1111-4111-8111-111111111111",
  path: "Daily/2026-08-29.md",
  sourceOrder: 2,
  label: "Review the release note",
  actualMinutes: 18,
});

test("recent task resume targets the stable owner and preserves source location", () => {
  assert.deepEqual(recentTaskClockInIntent(task, 123_000), {
    type: "clock-in",
    intentId: "clock-in-recent-nl-11111111-1111-4111-8111-111111111111-123000",
    target: {
      path: "Daily/2026-08-29.md",
      ownerId: "nl-11111111-1111-4111-8111-111111111111",
      sourceOrder: 2,
      sourceFingerprint: "identified-target",
    },
  });
});

const PATH = "Daily/2026-08-29.md";
const OWNER = "nl-11111111-1111-4111-8111-111111111111";
const NOW = Date.UTC(2026, 7, 29, 2, 14, 35);

function flexibleTask(
  sourceOrder: number,
  label: string,
  overrides: Partial<PlanItem<RuntimePlanItemSource>> = {},
): PlanItem<RuntimePlanItemSource> {
  return {
    kind: "flexible-task",
    status: "open",
    executionEligible: true,
    label,
    durationMinutes: 45,
    remainingDurationMinutes: 45,
    progressPercent: 0,
    urgent: false,
    tokens: {},
    sourceOrder,
    source: { path: PATH, blockId: `nl-task-${sourceOrder}`, sourceOrder },
    ...overrides,
  } as PlanItem<RuntimePlanItemSource>;
}

function confirmedPlan(
  slots: readonly { readonly task: PlanItem<RuntimePlanItemSource>; readonly startMinutes: number; readonly endMinutes: number }[],
  relation: "past" | "today" | "future" | "other" = "today",
) {
  return {
    state: "confirmed",
    projection: {
      sourceFingerprint: "sha256:confirmed-source",
      day: { relation },
      schedule: { plannedSlots: slots },
    },
  } as unknown as NonNullable<TimingViewOptions["plan"]>;
}

test("up next selects the earliest eligible open task from a confirmed today plan", () => {
  const later = flexibleTask(2, "Later task");
  const earlier = flexibleTask(1, "Earlier task");
  const selected = selectUpNextTask(confirmedPlan([
    { task: later, startMinutes: 11 * 60, endMinutes: 11 * 60 + 45 },
    { task: earlier, startMinutes: 10 * 60, endMinutes: 10 * 60 + 30 },
  ]));
  assert.deepEqual(selected, {
    key: "nl-task-1",
    ownerId: "nl-task-1",
    path: PATH,
    sourceOrder: 1,
    label: "Earlier task",
    startMinutes: 600,
    endMinutes: 630,
    remainingMinutes: 45,
    sourceFingerprint: "sha256:confirmed-source",
  });
});

test("up next ignores incomplete, completed, ineligible, and overflow tasks", () => {
  const done = flexibleTask(0, "Done", {
    status: "done",
    executionEligible: false,
    progressPercent: 100,
    remainingDurationMinutes: 0,
  });
  const ineligible = flexibleTask(1, "Ineligible", { executionEligible: false });
  const noTime = flexibleTask(2, "No time", { remainingDurationMinutes: 0 });
  const eligible = flexibleTask(3, "Eligible");
  assert.equal(selectUpNextTask(confirmedPlan([
    { task: done, startMinutes: 540, endMinutes: 570 },
    { task: ineligible, startMinutes: 570, endMinutes: 600 },
    { task: noTime, startMinutes: 600, endMinutes: 615 },
  ])), undefined);
  assert.equal(selectUpNextTask(confirmedPlan([
    { task: done, startMinutes: 540, endMinutes: 570 },
    { task: eligible, startMinutes: 570, endMinutes: 600 },
  ]))?.label, "Eligible");
});

test("up next requires a confirmed projection for today", () => {
  const task = flexibleTask(0, "Task");
  const slot = [{ task, startMinutes: 600, endMinutes: 645 }];
  assert.equal(selectUpNextTask(undefined), undefined);
  assert.equal(selectUpNextTask(confirmedPlan(slot, "past")), undefined);
  assert.equal(selectUpNextTask(confirmedPlan(slot, "future")), undefined);
  assert.equal(selectUpNextTask({
    state: "loading",
    projection: { day: { relation: "today" }, schedule: { plannedSlots: slot } },
  } as unknown as NonNullable<TimingViewOptions["plan"]>), undefined);
});

test("up next Clock In uses the confirmed fingerprint and stable source target", () => {
  const selected = selectUpNextTask(confirmedPlan([{
    task: flexibleTask(4, "Prepare release evidence"),
    startMinutes: 600,
    endMinutes: 645,
  }]))!;
  assert.deepEqual(upNextClockInIntent(selected, 123_000), {
    type: "clock-in",
    intentId: "clock-in-next-nl-task-4-123000",
    target: {
      path: PATH,
      ownerId: "nl-task-4",
      sourceOrder: 4,
      sourceFingerprint: "sha256:confirmed-source",
    },
  });
});

class TimingElementStub {
  className = "";
  textContent = "";
  type = "";
  title = "";
  disabled = false;
  readonly dataset: Record<string, string> = {};
  readonly children: TimingElementStub[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, (event?: { shiftKey?: boolean }) => void>();
  constructor(readonly ownerDocument: TimingDocumentStub) {}
  append(...children: Array<TimingElementStub | string>): void {
    for (const child of children) if (typeof child !== "string") this.children.push(child);
  }
  replaceChildren(...children: TimingElementStub[]): void {
    this.children.splice(0, this.children.length, ...children);
  }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  addEventListener(event: string, listener: (event?: { shiftKey?: boolean }) => void): void {
    this.listeners.set(event, listener);
  }
}

class TimingDocumentStub {
  readonly elements: TimingElementStub[] = [];
  createElement(): TimingElementStub {
    const element = new TimingElementStub(this);
    this.elements.push(element);
    return element;
  }
}

function idleSnapshot(overrides: Partial<ExecutionApplicationSnapshot> = {}): TimingViewOptions["snapshot"] {
  return {
    status: "ready",
    focused: undefined,
    execution: { kind: "idle" },
    standalonePomoStartEpochMs: null,
    pomoThresholdMinutes: 45,
    writeBlocked: false,
    ...overrides,
  } as TimingViewOptions["snapshot"];
}

function renderIdle(options: {
  readonly locale?: "en" | "zh-CN";
  readonly plan?: TimingViewOptions["plan"];
  readonly snapshot?: TimingViewOptions["snapshot"];
  readonly pending?: ReadonlySet<string>;
}) {
  const document = new TimingDocumentStub();
  const root = document.createElement();
  const dispatched: unknown[] = [];
  const navigated: unknown[] = [];
  const messages = createMessages({
    locale: options.locale ?? "en",
    namespaces: { execution: defineLocaleNamespace("execution", enExecution, zhCNExecution) },
  });
  renderTimingView(root as unknown as HTMLElement, {
    nowEpochMs: NOW,
    snapshot: options.snapshot ?? idleSnapshot(),
    ...(options.plan ? { plan: options.plan } : {}),
    recent: [],
    pending: options.pending ?? new Set(),
    messages,
    renderIcon: () => {},
    dispatch: (intent) => { dispatched.push(intent); },
    refresh: () => assert.fail("Rendering must not refresh"),
    openActiveTask: () => assert.fail("Rendering must not open the active task"),
    navigateTask: (target, location) => { navigated.push({ target, location }); },
    requestDelete: () => assert.fail("Rendering must not delete"),
  });
  return { document, root, dispatched, navigated };
}

function byClass(document: TimingDocumentStub, className: string): TimingElementStub[] {
  return document.elements.filter((element) => element.className === className);
}

test("idle Timing shows an up-next card instead of the long generic guidance", () => {
  const plan = confirmedPlan([{
    task: flexibleTask(0, "Prepare release evidence"),
    startMinutes: 600,
    endMinutes: 645,
  }]);
  const { document } = renderIdle({ plan });
  const [card] = byClass(document, "spiral-day-execution__up-next");
  assert.ok(card);
  assert.equal(byClass(document, "spiral-day-onboarding__next").length, 0);
  assert.ok(byClass(document, "spiral-day-execution__task-title").some((title) =>
    title.textContent === "Prepare release evidence"));
  const meta = byClass(document, "spiral-day-execution__row-meta").find((element) =>
    element.textContent.includes("10:00–10:45"));
  assert.ok(meta);
  assert.match(meta.textContent, /45m remaining/);
  assert.equal(byClass(document, "spiral-day-execution__primary-action").length, 1);
});

test("idle Timing falls back to guidance without an eligible scheduled task", () => {
  const done = flexibleTask(0, "Done", {
    status: "done",
    executionEligible: false,
    remainingDurationMinutes: 0,
  });
  const { document } = renderIdle({
    plan: confirmedPlan([{ task: done, startMinutes: 600, endMinutes: 645 }]),
  });
  assert.equal(byClass(document, "spiral-day-execution__up-next").length, 0);
  assert.equal(byClass(document, "spiral-day-onboarding__next").length, 1);
});

test("up-next card stays hidden for POMO and non-ready execution states", () => {
  const plan = confirmedPlan([{
    task: flexibleTask(0, "Prepare release evidence"),
    startMinutes: 600,
    endMinutes: 645,
  }]);
  assert.equal(byClass(renderIdle({
    plan,
    snapshot: idleSnapshot({ standalonePomoStartEpochMs: NOW - 60_000 }),
  }).document, "spiral-day-execution__up-next").length, 0);
  assert.equal(byClass(renderIdle({
    plan,
    snapshot: idleSnapshot({ status: "working" }),
  }).document, "spiral-day-execution__up-next").length, 0);
});

test("up-next Clock In and source actions dispatch the selected target", () => {
  const plan = confirmedPlan([{
    task: flexibleTask(0, "Prepare release evidence"),
    startMinutes: 600,
    endMinutes: 645,
  }]);
  const { document, dispatched, navigated } = renderIdle({ plan });
  const [clockIn] = byClass(document, "spiral-day-execution__primary-action");
  const [openSource] = byClass(document, "spiral-day-execution__secondary-action");
  assert.ok(clockIn);
  assert.ok(openSource);
  clockIn.listeners.get("click")?.();
  openSource.listeners.get("click")?.();
  assert.deepEqual(dispatched, [upNextClockInIntent({
    key: "nl-task-0",
    ownerId: "nl-task-0",
    path: PATH,
    sourceOrder: 0,
    label: "Prepare release evidence",
    startMinutes: 600,
    endMinutes: 645,
    remainingMinutes: 45,
    sourceFingerprint: "sha256:confirmed-source",
  }, NOW)]);
  assert.deepEqual(navigated, [{
    target: {
      key: "nl-task-0",
      ownerId: "nl-task-0",
      path: PATH,
      sourceOrder: 0,
      label: "Prepare release evidence",
      startMinutes: 600,
      endMinutes: 645,
      remainingMinutes: 45,
      sourceFingerprint: "sha256:confirmed-source",
    },
    location: "main",
  }]);
});

test("up-next card is bilingual and disables Clock In while pending or write-blocked", () => {
  const plan = confirmedPlan([{
    task: flexibleTask(0, "准备发布证据"),
    startMinutes: 600,
    endMinutes: 645,
  }]);
  const chinese = renderIdle({ plan, locale: "zh-CN" });
  const [card] = byClass(chinese.document, "spiral-day-execution__up-next");
  assert.ok(card);
  assert.ok(byClass(chinese.document, "spiral-day-execution__section-label").some((element) =>
    element.textContent === "接下来"));
  const meta = byClass(chinese.document, "spiral-day-execution__row-meta").find((element) =>
    element.textContent.includes("10:00–10:45"));
  assert.ok(meta);
  assert.match(meta.textContent, /剩余 45分钟/);
  const pending = renderIdle({ plan, pending: new Set(["task:nl-task-0"]) });
  const [pendingClockIn] = byClass(pending.document, "spiral-day-execution__primary-action");
  assert.equal(pendingClockIn?.disabled, true);
  assert.equal(pendingClockIn?.attributes.get("aria-busy"), "true");
  const blocked = renderIdle({ plan, snapshot: idleSnapshot({ writeBlocked: true }) });
  const [blockedClockIn] = byClass(blocked.document, "spiral-day-execution__primary-action");
  assert.equal(blockedClockIn?.disabled, true);
});
