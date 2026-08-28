import assert from "node:assert/strict";
import test from "node:test";

import {
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
