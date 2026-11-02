import assert from "node:assert/strict";
import test from "node:test";

import type { ExecutionApplicationSnapshot } from "../../../src/runtime/execution/application";
import { enExecution } from "../../../src/i18n/locales/en/execution";
import { zhCNExecution } from "../../../src/i18n/locales/zh-CN/execution";
import { createMessages, defineLocaleNamespace } from "../../../src/i18n/resolver";
import { renderActiveTaskSurface } from "../../../src/ui/execution/active-task-view";

class ElementStub {
  className = "";
  textContent = "";
  title = "";
  disabled = false;
  readonly dataset: Record<string, string> = {};
  readonly children: ElementStub[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, () => void>();
  readonly classList = { add: (name: string) => { this.className = name; } };

  constructor(
    readonly ownerDocument: DocumentStub,
    readonly tagName: string,
  ) {}

  append(...children: ElementStub[]): void { this.children.push(...children); }
  replaceChildren(...children: ElementStub[]): void {
    this.children.splice(0, this.children.length, ...children);
  }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  addEventListener(name: string, listener: () => void): void { this.listeners.set(name, listener); }
  querySelector(selector: string): ElementStub | null {
    if (!selector.startsWith(".")) return null;
    const className = selector.slice(1);
    return this.children.find((child) => child.className === className)
      ?? this.children.map((child) => child.querySelector(selector)).find(Boolean)
      ?? null;
  }
}

class DocumentStub {
  createElement(name: string): ElementStub { return new ElementStub(this, name); }
}

const PATH = "项目/2026-08-29 <release>&验收.md";

function activeSnapshot(): ExecutionApplicationSnapshot {
  return {
    status: "ready",
    execution: { kind: "active", ownerId: "task-1", startEpochMs: 0, elapsedMs: 0, taskPomoStartEpochMs: 0 },
    focused: {
      ownerId: "task-1",
      path: PATH,
      sourceOrder: 0,
      label: "Prepare the release",
      clock: {
        path: PATH,
        ownerId: "task-1",
        clockId: "clock-1",
        fromOffset: 0,
        startEpochMs: 0,
        targetKey: "clock-1",
      },
    },
    standalonePomoStartEpochMs: null,
    pomoThresholdMinutes: 0,
    writeBlocked: false,
  } as ExecutionApplicationSnapshot;
}

function render(locale: "en" | "zh-CN"): ElementStub {
  const document = new DocumentStub();
  const root = document.createElement("div");
  const messages = createMessages({
    locale,
    namespaces: { execution: defineLocaleNamespace("execution", enExecution, zhCNExecution) },
  });
  renderActiveTaskSurface(root as unknown as HTMLElement, {
    snapshot: activeSnapshot(),
    nowEpochMs: 0,
    messages,
    renderIcon: () => undefined,
    onOpenSource: () => undefined,
    onCopyLink: () => undefined,
    onClockOut: () => undefined,
  });
  return root;
}

for (const locale of ["en", "zh-CN"] as const) {
  test(`Active Task shows the source note as plain text in ${locale}`, () => {
    const root = render(locale);
    const article = root.children[0]!;
    const source = article.children.find((child) => child.className === "spiral-day-active-task__source");
    assert.ok(source);
    assert.equal(source.tagName, "p");
    assert.equal(source.textContent, PATH);
    assert.equal(source.title, PATH);
    assert.equal(source.children.length, 0);
    assert.equal(source.listeners.size, 0);
  });
}
