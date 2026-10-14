import assert from "node:assert/strict";
import test from "node:test";

import { enExecution } from "../../../src/i18n/locales/en/execution";
import { zhCNExecution } from "../../../src/i18n/locales/zh-CN/execution";
import { createMessages, defineLocaleNamespace } from "../../../src/i18n/resolver";
import {
  renderTimingView,
  recentTaskClockInIntent,
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

class TimingElementStub {
  className = "";
  textContent = "";
  type = "";
  title = "";
  dateTime = "";
  disabled = false;
  readonly dataset: Record<string, string> = {};
  readonly children: TimingElementStub[] = [];
  readonly listeners = new Map<string, () => void>();
  constructor(readonly ownerDocument: TimingDocumentStub) {}
  append(...children: Array<TimingElementStub | string>): void {
    for (const child of children) if (typeof child !== "string") this.children.push(child);
  }
  replaceChildren(...children: TimingElementStub[]): void {
    this.children.splice(0, this.children.length, ...children);
  }
  setAttribute(): void {}
  addEventListener(event: string, listener: () => void): void {
    this.listeners.set(event, listener);
  }
}

class TimingDocumentStub {
  activeElement: TimingElementStub | null = null;
  readonly elements: TimingElementStub[] = [];
  createElement(): TimingElementStub {
    const element = new TimingElementStub(this);
    this.elements.push(element);
    return element;
  }
}

const TIMING_OWNER = "nl-11111111-1111-4111-8111-111111111111";
const TIMING_PATH = "Daily/2026-08-29.md";
const TIMING_START = Date.UTC(2026, 7, 29, 1, 37, 0);
const TIMING_NOW = TIMING_START + 25 * 60_000;

function renderTiming(locale: "en" | "zh-CN", startEpochMs: number | null): TimingDocumentStub {
  const document = new TimingDocumentStub();
  const root = document.createElement();
  const messages = createMessages({
    locale,
    namespaces: { execution: defineLocaleNamespace("execution", enExecution, zhCNExecution) },
  });
  const snapshot = {
    status: "ready",
    writeBlocked: false,
    pomoThresholdMinutes: 0,
    standalonePomoStartEpochMs: null,
    execution: { kind: "active", taskPomoStartEpochMs: null },
    ...(startEpochMs === null
      ? { execution: { kind: "idle" as const } }
      : {
          focused: {
            ownerId: TIMING_OWNER,
            path: TIMING_PATH,
            sourceOrder: 0,
            label: "Prepare release evidence",
            clock: { startEpochMs },
          },
        }),
  } as unknown as TimingViewOptions["snapshot"];
  renderTimingView(root as unknown as HTMLElement, {
    nowEpochMs: TIMING_NOW,
    snapshot,
    recent: [],
    pending: new Set(),
    messages,
    renderIcon: () => {},
    dispatch: () => assert.fail("Rendering must not dispatch an execution intent"),
    refresh: () => assert.fail("Rendering must not refresh"),
    openActiveTask: () => assert.fail("Rendering must not open the active task"),
    navigateTask: () => assert.fail("Rendering must not navigate"),
    requestDelete: () => assert.fail("Rendering must not delete"),
  });
  return document;
}

function localClock(epochMs: number): string {
  const date = new Date(epochMs);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function startedTime(document: TimingDocumentStub): TimingElementStub[] {
  return document.elements.filter((element) => element.className === "spiral-day-execution__row-meta");
}

test("timing names the CLOCK start time beside elapsed", () => {
  const document = renderTiming("en", TIMING_START);
  const [started] = startedTime(document);
  assert.ok(started);
  assert.equal(started.textContent, `Started at ${localClock(TIMING_START)}`);
  assert.equal(started.dateTime, new Date(TIMING_START).toISOString());
  const elapsed = document.elements.find((element) => element.className === "spiral-day-execution__elapsed");
  assert.ok(elapsed);
  assert.equal(elapsed.textContent, "25:00");
});

test("timing start time is localized", () => {
  const document = renderTiming("zh-CN", TIMING_START);
  const [started] = startedTime(document);
  assert.ok(started);
  assert.equal(started.textContent, `开始于 ${localClock(TIMING_START)}`);
});

test("timing omits the start time when the CLOCK start is not finite", () => {
  const document = renderTiming("en", Number.NaN);
  assert.equal(startedTime(document).length, 0);
  assert.ok(document.elements.find((element) => element.className === "spiral-day-execution__elapsed"));
});

test("idle timing renders without a start time", () => {
  const document = renderTiming("en", null);
  assert.equal(startedTime(document).length, 0);
  assert.ok(document.elements.find((element) => element.className === "spiral-day-execution__empty"));
});
