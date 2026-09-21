import assert from "node:assert/strict";
import test from "node:test";

import { enExecution } from "../../../src/i18n/locales/en/execution";
import { zhCNExecution } from "../../../src/i18n/locales/zh-CN/execution";
import { createMessages, defineLocaleNamespace } from "../../../src/i18n/resolver";
import { renderTimingView, type ExecutionRecentTask } from "../../../src/ui/execution/timing-view";

class ElementStub {
  className = "";
  textContent = "";
  title = "";
  disabled = false;
  readonly children: ElementStub[] = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, () => void>();

  constructor(readonly ownerDocument: DocumentStub) {}

  append(...children: ElementStub[]): void { this.children.push(...children); }
  replaceChildren(...children: ElementStub[]): void {
    this.children.splice(0, this.children.length, ...children);
  }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value); }
  addEventListener(name: string, listener: () => void): void { this.listeners.set(name, listener); }
}

class DocumentStub {
  createElement(): ElementStub { return new ElementStub(this); }
}

const recent: ExecutionRecentTask = Object.freeze({
  key: "task-1",
  ownerId: "nl-11111111-1111-4111-8111-111111111111",
  path: "Daily/2026-09-22.md",
  sourceOrder: 0,
  label: "Write release notes",
  actualMinutes: 18,
});

function messages() {
  return createMessages({
    locale: "en",
    namespaces: { execution: defineLocaleNamespace("execution", enExecution, zhCNExecution) },
  });
}

function render(pending = new Set<string>()) {
  const document = new DocumentStub();
  const root = document.createElement();
  const state = { copied: 0 };
  renderTimingView(root as unknown as HTMLElement, {
    nowEpochMs: 0,
    snapshot: {
      status: "ready",
      focused: undefined,
      execution: { kind: "idle" },
      standalonePomoStartEpochMs: null,
      pomoThresholdMinutes: 45,
      writeBlocked: false,
    } as never,
    recent: [recent],
    pending,
    messages: messages(),
    renderIcon: () => undefined,
    dispatch: () => undefined,
    refresh: () => undefined,
    openActiveTask: () => undefined,
    navigateTask: () => undefined,
    copyTaskLink: () => { state.copied += 1; },
    requestDelete: () => undefined,
  });
  return { root, state };
}

test("recent Timing rows expose a localized copy-link action", () => {
  const { root, state } = render();
  const recentSection = root.children[1]!;
  const row = recentSection.children[1]!.children[0]!;
  const actions = row.children[1]!;
  const copy = actions.children[0]!;
  assert.equal(copy.attributes.get("aria-label"), enExecution["action.copyTaskLink"]);
  copy.listeners.get("click")?.();
  assert.equal(state.copied, 1);
  assert.equal(copy.disabled, false);
});

test("recent Timing copy action reports its pending state", () => {
  const { root } = render(new Set(["copy-task-link:task-1"]));
  const copy = root.children[1]!.children[1]!.children[0]!.children[1]!.children[0]!;
  assert.equal(copy.disabled, true);
  assert.equal(copy.attributes.get("aria-busy"), "true");
  assert.equal(copy.title, enExecution["timing.pending"]);
});
