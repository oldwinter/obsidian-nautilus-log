import assert from "node:assert/strict";
import test from "node:test";

import { createMessages, defineLocaleNamespace } from "../../../src/i18n/resolver";
import { enExecution } from "../../../src/i18n/locales/en/execution";
import { zhCNExecution } from "../../../src/i18n/locales/zh-CN/execution";
import { renderEmptyPlanGuidance, renderPlanMissingGuidance } from "../../../src/ui/onboarding/first-run";
import { CHINESE_SAMPLE_FLEXIBLE_TASK, ENGLISH_SAMPLE_FLEXIBLE_TASK, primaryPlanSeed } from "../../../src/workspace/insert-primary-plan";

class ElementStub {
  className = "";
  textContent = "";
  disabled = false;
  type = "";
  readonly children: ElementStub[] = [];
  readonly listeners = new Map<string, Array<() => void>>();

  constructor(readonly ownerDocument: DocumentStub) {}

  append(...children: ElementStub[]): void {
    this.children.push(...children);
  }

  addEventListener(name: string, listener: () => void): void {
    const existing = this.listeners.get(name) ?? [];
    existing.push(listener);
    this.listeners.set(name, existing);
  }

  click(): void {
    for (const listener of this.listeners.get("click") ?? []) listener();
  }
}

class DocumentStub {
  readonly defaultView = {
    navigator: { clipboard: undefined as { writeText?: (text: string) => Promise<void> } | undefined },
    getSelection: () => ({
      removeAllRanges() {},
      addRange() {},
    }),
  };

  createElement(): ElementStub {
    return new ElementStub(this);
  }

  createRange(): { selectNodeContents(): void } {
    return { selectNodeContents() {} };
  }
}

function collect(element: ElementStub): string[] {
  return [element.textContent, ...element.children.flatMap(collect)].filter((value) => value !== "");
}

function byClass(root: ElementStub, className: string): ElementStub | undefined {
  if (root.className === className) return root;
  for (const child of root.children) {
    const match = byClass(child, className);
    if (match) return match;
  }
  return undefined;
}

test("missing-plan guidance copies markers and inserts only after an explicit click", async () => {
  const document = new DocumentStub();
  const root = document.createElement();
  const messages = createMessages({
    locale: "en",
    namespaces: { execution: defineLocaleNamespace("execution", enExecution, zhCNExecution) },
  });
  let inserted = 0;
  renderPlanMissingGuidance(root as unknown as HTMLElement, messages, {
    onInsertPrimaryPlan: () => {
      inserted += 1;
    },
  });
  const text = collect(root).join("\n");
  assert.match(text, /Insert into today's Daily Note/);
  assert.match(text, /creates today's note if needed/);
  assert.match(text, /Or paste the markers and sample task/);
  assert.equal(text.includes(primaryPlanSeed("en")), true);
  assert.equal(text.includes(ENGLISH_SAMPLE_FLEXIBLE_TASK), true);
  assert.equal(inserted, 0);

  const insert = byClass(root, "spiral-day-onboarding__insert");
  assert.ok(insert);
  insert!.click();
  await Promise.resolve();
  assert.equal(inserted, 1);

  const copy = byClass(root, "spiral-day-onboarding__copy");
  assert.ok(copy);
  copy!.click();
  assert.match(copy!.textContent, /Clipboard is unavailable|Copy plan starter/);
});

test("missing-plan guidance copies the localized plan starter", async () => {
  const document = new DocumentStub();
  const root = document.createElement();
  let copied = "";
  document.defaultView.navigator.clipboard = {
    writeText(text: string) {
      copied = text;
      return Promise.resolve();
    },
  };
  const messages = createMessages({
    locale: "zh-CN",
    namespaces: { execution: defineLocaleNamespace("execution", enExecution, zhCNExecution) },
  });
  renderPlanMissingGuidance(root as unknown as HTMLElement, messages);
  const text = collect(root).join("\n");
  assert.equal(text.includes(primaryPlanSeed("zh-CN")), true);
  assert.equal(text.includes(CHINESE_SAMPLE_FLEXIBLE_TASK), true);
  const copy = byClass(root, "spiral-day-onboarding__copy");
  assert.ok(copy);
  copy!.click();
  await Promise.resolve();
  assert.equal(copied, primaryPlanSeed("zh-CN"));
  assert.equal(copy!.textContent, "已复制计划模板。");
});

test("missing-plan guidance omits insert when the host has no write action", () => {
  const document = new DocumentStub();
  const root = document.createElement();
  const messages = createMessages({
    locale: "zh-CN",
    namespaces: { execution: defineLocaleNamespace("execution", enExecution, zhCNExecution) },
  });
  renderPlanMissingGuidance(root as unknown as HTMLElement, messages);
  assert.equal(byClass(root, "spiral-day-onboarding__insert"), undefined);
  assert.match(collect(root).join("\n"), /复制计划模板/);
});

test("empty-plan guidance copies the localized sample task", async () => {
  const document = new DocumentStub();
  const root = document.createElement();
  let copied = "";
  document.defaultView.navigator.clipboard = {
    writeText(text: string) {
      copied = text;
      return Promise.resolve();
    },
  };
  const messages = createMessages({
    locale: "zh-CN",
    namespaces: { execution: defineLocaleNamespace("execution", enExecution, zhCNExecution) },
  });
  renderEmptyPlanGuidance(root as unknown as HTMLElement, messages);
  const text = collect(root).join("\n");
  assert.match(text, /还没有列表项/);
  assert.equal(text.includes(CHINESE_SAMPLE_FLEXIBLE_TASK), true);
  const copy = byClass(root, "spiral-day-onboarding__copy");
  assert.ok(copy);
  copy!.click();
  await Promise.resolve();
  assert.equal(copied, CHINESE_SAMPLE_FLEXIBLE_TASK);
  assert.equal(copy!.textContent, "已复制示例任务。");
});
