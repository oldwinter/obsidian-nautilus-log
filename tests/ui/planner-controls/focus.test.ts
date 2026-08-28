import assert from "node:assert/strict";
import test from "node:test";

import {
  bindPlannerTooltip,
  bindRovingTabs,
  isPlannerActivationKey,
  nextRovingIndex,
} from "../../../src/ui/planner/focus.ts";

class FakeElement extends EventTarget {
  id = "";
  hidden = false;
  tabIndex = 0;
  parentElement: FakeElement | null = null;
  readonly attributes = new Map<string, string>();
  focusCount = 0;

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  focus(): void {
    this.focusCount += 1;
  }
}

test("TC-OBS-A11Y-001-001 Enter and Space are equal activation keys", () => {
  assert.equal(isPlannerActivationKey("Enter"), true);
  assert.equal(isPlannerActivationKey(" "), true);
  assert.equal(isPlannerActivationKey("Spacebar"), true);
  assert.equal(isPlannerActivationKey("Escape"), false);
});

test("TC-UP-ERR-09-001 roving focus wraps and supports Home/End deterministically", () => {
  assert.equal(nextRovingIndex(0, "ArrowLeft", 3), 2);
  assert.equal(nextRovingIndex(2, "ArrowRight", 3), 0);
  assert.equal(nextRovingIndex(1, "Home", 3), 0);
  assert.equal(nextRovingIndex(1, "End", 3), 2);
  assert.equal(nextRovingIndex(1, "Escape", 3), 1);
  assert.equal(nextRovingIndex(0, "ArrowRight", 0), -1);
});

test("TC-UP-ERR-09-001 roving keys consume browser defaults at selected boundaries", () => {
  const parent = new FakeElement();
  const tab = new FakeElement();
  const panel = new FakeElement();
  tab.parentElement = parent;
  const tabs = bindRovingTabs([{
    panel: panel as unknown as HTMLElement,
    tab: tab as unknown as HTMLElement,
  }]);
  for (const key of ["Home", "End", "ArrowLeft", "ArrowRight"]) {
    const event = new Event("keydown", { cancelable: true });
    Object.defineProperty(event, "key", { value: key });
    assert.equal(tab.dispatchEvent(event), false);
    assert.equal(event.defaultPrevented, true);
  }
  assert.equal(tab.focusCount, 4);
  tabs.destroy();
});

test("TC-UP-ERR-09-001 invalid initial roving indices fail safe to the first tab", () => {
  for (const initialIndex of [Number.NaN, 0.5, Number.POSITIVE_INFINITY]) {
    const parent = new FakeElement();
    const firstTab = new FakeElement();
    const secondTab = new FakeElement();
    const firstPanel = new FakeElement();
    const secondPanel = new FakeElement();
    firstTab.parentElement = parent;
    secondTab.parentElement = parent;
    const tabs = bindRovingTabs([
      {
        panel: firstPanel as unknown as HTMLElement,
        tab: firstTab as unknown as HTMLElement,
      },
      {
        panel: secondPanel as unknown as HTMLElement,
        tab: secondTab as unknown as HTMLElement,
      },
    ], initialIndex);

    assert.equal(tabs.selectedIndex, 0);
    assert.equal(firstTab.tabIndex, 0);
    assert.equal(firstTab.attributes.get("aria-selected"), "true");
    assert.equal(firstPanel.hidden, false);
    assert.equal(secondTab.tabIndex, -1);
    assert.equal(secondPanel.hidden, true);
    tabs.destroy();
  }
});

test("TC-OBS-A11Y-001-003 tooltip coordinates compensate for a zoomed fixed containing block", () => {
  class FakeViewport extends EventTarget {
    readonly innerHeight = 1_200;
    readonly innerWidth = 1_600;
  }
  const viewport = new FakeViewport();
  class FakeTooltipTarget extends EventTarget {
    readonly attributes = new Map<string, string>();
    readonly ownerDocument = { defaultView: viewport };
    box = { bottom: 901, height: 18, left: 686, right: 724, top: 883, width: 38 };

    getBoundingClientRect(): DOMRect {
      return this.box as DOMRect;
    }

    removeAttribute(name: string): void {
      this.attributes.delete(name);
    }

    setAttribute(name: string, value: string): void {
      this.attributes.set(name, value);
    }
  }

  class FakeTooltip extends EventTarget {
    readonly dataset: Record<string, string> = {};
    hidden = true;
    id = "planner-tooltip";
    offsetWidth = 120;
    readonly style: Record<string, string> = {};
    textContent = "";

    getBoundingClientRect(): DOMRect {
      return { bottom: 102, height: 102, left: 0, right: 240, top: 0, width: 240 } as DOMRect;
    }

    setAttribute(): void {}
  }

  const target = new FakeTooltipTarget();
  const tooltip = new FakeTooltip();
  const unbind = bindPlannerTooltip(
    target as unknown as HTMLElement,
    tooltip as unknown as HTMLElement,
    "Urgent item",
  );
  target.dispatchEvent(new Event("focus"));
  assert.equal(tooltip.hidden, false);
  assert.equal(tooltip.style.left, "293px");
  assert.equal(tooltip.style.top, "387px");
  assert.equal(tooltip.dataset.side, "top");

  target.box = { bottom: 28, height: 18, left: 0, right: 18, top: 10, width: 18 };
  viewport.dispatchEvent(new Event("scroll"));
  assert.equal(tooltip.style.left, "4px");
  assert.equal(tooltip.style.top, "18px");
  assert.equal(tooltip.dataset.side, "bottom");

  target.box = { bottom: 1_118, height: 18, left: 1_580, right: 1_598, top: 1_100, width: 18 };
  viewport.dispatchEvent(new Event("resize"));
  assert.equal(tooltip.style.left, "676px");
  assert.equal(tooltip.style.top, "495px");
  assert.equal(tooltip.dataset.side, "top");

  unbind();
  assert.equal(tooltip.hidden, true);
  assert.equal(target.attributes.has("aria-describedby"), false);
  target.box = { bottom: 118, height: 18, left: 100, right: 118, top: 100, width: 18 };
  viewport.dispatchEvent(new Event("scroll"));
  assert.equal(tooltip.style.left, "676px");
});
