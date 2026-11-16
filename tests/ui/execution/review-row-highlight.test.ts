import assert from "node:assert/strict";
import test from "node:test";

import type { ReviewRow } from "../../../src/core/review";
import { enReview } from "../../../src/i18n/locales/en/review";
import { zhCNReview } from "../../../src/i18n/locales/zh-CN/review";
import { createMessages, defineLocaleNamespace } from "../../../src/i18n/resolver";
import type { RuntimeReviewTask } from "../../../src/runtime/review/coordinator";
import {
  ReviewRowView,
  type ReviewMessages,
  splitReviewTitleHighlight,
} from "../../../src/ui/execution/review-row";

class TextStub {
  constructor(readonly text: string) {}
}

class ElementStub {
  className = "";
  dataset: Record<string, string> = {};
  disabled = false;
  hidden = false;
  children: Array<ElementStub | TextStub> = [];
  readonly attributes = new Map<string, string>();
  readonly listeners = new Map<string, () => void>();
  #text: string | null = null;

  constructor(readonly ownerDocument: DocumentStub, readonly tagName: string) {}

  get textContent(): string {
    if (this.#text !== null) return this.#text;
    return this.children
      .map((child) => (child instanceof ElementStub ? child.textContent : child.text))
      .join("");
  }

  set textContent(value: string) {
    this.#text = value;
    this.children = [];
  }

  append(...children: Array<ElementStub | TextStub>): void {
    this.#text = null;
    this.children.push(...children);
  }

  replaceChildren(...children: Array<ElementStub | TextStub>): void {
    this.#text = null;
    this.children = [...children];
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  addEventListener(event: string, listener: () => void): void {
    this.listeners.set(event, listener);
  }

  get classList(): { toggle(): void; add(): void } {
    return { toggle(): void {}, add(): void {} };
  }

  contains(): boolean {
    return false;
  }

  focus(): void {}
}

class DocumentStub {
  activeElement: ElementStub | null = null;
  readonly elements: ElementStub[] = [];

  createElement(tagName: string): ElementStub {
    const element = new ElementStub(this, tagName);
    this.elements.push(element);
    return element;
  }

  createTextNode(text: string): TextStub {
    return new TextStub(text);
  }
}

interface TitleDriver {
  readonly document: DocumentStub;
  readonly view: ReviewRowView;
  readonly row: ReviewRow<RuntimeReviewTask>;
  readonly messages: ReviewMessages;
}

function createDriver(label: string): TitleDriver {
  const document = new DocumentStub();
  const messages = createMessages({
    locale: "en",
    namespaces: { review: defineLocaleNamespace("review", enReview, zhCNReview) },
  });
  const task = {
    key: "Daily/today.md#task-1",
    ownerId: "task-1",
    sourceOrder: 0,
    direct: true,
    kind: "flexible-task",
    status: "open",
    label,
    plannedMinutes: 30,
  } as RuntimeReviewTask;
  const row = {
    task,
    state: "not-started",
    plannedMinutes: 30,
    actualMinutes: null,
    actualMilliseconds: 0,
    malformedClockCount: 0,
    potentialRunning: false,
  } as ReviewRow<RuntimeReviewTask>;
  const view = new ReviewRowView(document as unknown as Document, () => {});
  return { document, view, row, messages };
}

function titleOf(driver: TitleDriver): ElementStub {
  const title = driver.document.elements.find((element) => element.className === "spiral-day-review__title");
  assert.ok(title);
  return title;
}

test("highlight split keeps plain titles whole without a query", () => {
  assert.deepEqual(splitReviewTitleHighlight("Write a draft", ""), [{ text: "Write a draft", match: false }]);
  assert.deepEqual(splitReviewTitleHighlight("Write a draft", "   "), [{ text: "Write a draft", match: false }]);
  assert.deepEqual(splitReviewTitleHighlight("Write a draft", "missing"), [{ text: "Write a draft", match: false }]);
});

test("highlight split marks every case-insensitive match in source casing", () => {
  assert.deepEqual(splitReviewTitleHighlight("Draft the draft", "draft"), [
    { text: "Draft", match: true },
    { text: " the ", match: false },
    { text: "draft", match: true },
  ]);
  assert.deepEqual(splitReviewTitleHighlight("Review REVIEW", " review "), [
    { text: "Review", match: true },
    { text: " ", match: false },
    { text: "REVIEW", match: true },
  ]);
});

test("review titles wrap each search match in a mark element", () => {
  const driver = createDriver("Write a draft plan");
  driver.view.update(driver.row, driver.messages, true, true, undefined, "draft");
  const title = titleOf(driver);
  assert.equal(title.children.length, 3);
  const [before, mark, after] = title.children;
  assert.ok(before instanceof TextStub && before.text === "Write a ");
  assert.ok(mark instanceof ElementStub && mark.tagName === "mark" && mark.textContent === "draft");
  assert.ok(after instanceof TextStub && after.text === " plan");
  assert.equal(title.textContent, "Write a draft plan");
  assert.equal(title.attributes.get("aria-label"), "Open source for Write a draft plan");
});

test("review titles stay plain text without a search query", () => {
  const driver = createDriver("Write a draft plan");
  driver.view.update(driver.row, driver.messages, true, true, undefined, "");
  const title = titleOf(driver);
  assert.equal(title.children.length, 1);
  assert.ok(title.children[0] instanceof TextStub);
  assert.equal(title.textContent, "Write a draft plan");
});

test("review titles skip DOM churn while label and query are unchanged", () => {
  const driver = createDriver("Write a draft plan");
  driver.view.update(driver.row, driver.messages, true, true, undefined, "draft");
  const first = titleOf(driver).children;
  driver.view.update(driver.row, driver.messages, true, true, undefined, "draft");
  assert.deepEqual(titleOf(driver).children, first);
  driver.view.update(driver.row, driver.messages, true, true, undefined, "plan");
  assert.notDeepEqual(titleOf(driver).children, first);
});
