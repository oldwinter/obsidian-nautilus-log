import assert from "node:assert/strict";
import test from "node:test";

import {
  ExecutionRovingTabs,
  formatExecutionDuration,
  formatExecutionMinutes,
} from "../../../src/ui/execution/shared-controls";

class ElementStub {
  readonly attributes = new Map<string, string>();
  readonly children: ElementStub[] = [];
  readonly listeners = new Map<string, Array<(event: unknown) => void>>();
  className = "";
  hidden = false;
  id = "";
  tabIndex = 0;
  textContent = "";
  type = "";
  focused = false;

  constructor(readonly ownerDocument: DocumentStub) {}

  append(...children: ElementStub[]): void {
    this.children.push(...children);
  }

  addEventListener(name: string, listener: (event: unknown) => void): void {
    const existing = this.listeners.get(name) ?? [];
    existing.push(listener);
    this.listeners.set(name, existing);
  }

  dispatch(name: string, event: unknown): void {
    for (const listener of this.listeners.get(name) ?? []) listener(event);
  }

  focus(): void {
    this.focused = true;
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

class DocumentStub {
  createElement(): ElementStub {
    return new ElementStub(this);
  }
}

function tabsHarness(names: readonly string[], active: string, onChange = () => {}) {
  const document = new DocumentStub();
  const root = document.createElement();
  const tabs = names.map((name) => ({
    name,
    label: `Tab ${name}`,
    panel: document.createElement() as unknown as HTMLElement,
  }));
  const roving = new ExecutionRovingTabs({
    root: root as unknown as HTMLElement,
    active,
    tabs,
    onChange,
  });
  return { roving, root, tabs };
}

function keydown(key: string) {
  let prevented = false;
  return {
    event: { key, preventDefault: () => { prevented = true; } },
    get prevented() { return prevented; },
  };
}

test("formatExecutionDuration clamps invalid input and renders mm:ss", () => {
  assert.equal(formatExecutionDuration(Number.NaN), "00:00");
  assert.equal(formatExecutionDuration(-5_000), "00:00");
  assert.equal(formatExecutionDuration(0), "00:00");
  assert.equal(formatExecutionDuration(65_400), "01:05");
  assert.equal(formatExecutionDuration(3_599_999), "59:59");
});

test("formatExecutionDuration renders hh:mm:ss once an hour elapses", () => {
  assert.equal(formatExecutionDuration(3_600_000), "01:00:00");
  assert.equal(formatExecutionDuration(9_845_000), "02:44:05");
});

test("formatExecutionMinutes renders compact hour and minute labels", () => {
  assert.equal(formatExecutionMinutes(0), "0m");
  assert.equal(formatExecutionMinutes(45), "45m");
  assert.equal(formatExecutionMinutes(60), "1h");
  assert.equal(formatExecutionMinutes(150), "2h 30m");
  assert.equal(formatExecutionMinutes(Number.NaN), "0m");
  assert.equal(formatExecutionMinutes(-10), "0m");
});

test("roving tabs require at least one tab", () => {
  const document = new DocumentStub();
  assert.throws(
    () => new ExecutionRovingTabs({
      root: document.createElement() as unknown as HTMLElement,
      active: "timing",
      tabs: [],
      onChange: () => {},
    }),
    /at least one tab/,
  );
});

test("roving tabs reject an active tab that is not a member", () => {
  const document = new DocumentStub();
  assert.throws(
    () => tabsHarness(["timing", "plan"], "review"),
    /active tab "review" to exist/,
  );
});

test("roving tabs select marks the chosen tab and hides the rest", () => {
  const announced: string[] = [];
  const { roving, tabs } = tabsHarness(["timing", "plan", "review"], "timing", (name) => announced.push(name));

  roving.select("plan");
  assert.equal(roving.active, "plan");
  assert.deepEqual(announced, ["plan"]);
  const panels = tabs.map((tab) => tab.panel as unknown as ElementStub);
  assert.equal(panels[0]!.hidden, true);
  assert.equal(panels[1]!.hidden, false);
  assert.equal(panels[2]!.hidden, true);

  roving.select("missing");
  assert.equal(roving.active, "plan");
});

test("roving tabs arrow keys wrap around and move focus", () => {
  const { roving, root } = tabsHarness(["timing", "plan", "review"], "timing");
  const buttons = root.children;

  const left = keydown("ArrowLeft");
  buttons[0]!.dispatch("keydown", left.event);
  assert.equal(left.prevented, true);
  assert.equal(roving.active, "review");
  assert.equal(buttons[2]!.focused, true);

  const right = keydown("ArrowRight");
  buttons[2]!.dispatch("keydown", right.event);
  assert.equal(roving.active, "timing");

  const end = keydown("End");
  buttons[0]!.dispatch("keydown", end.event);
  assert.equal(roving.active, "review");

  const home = keydown("Home");
  buttons[2]!.dispatch("keydown", home.event);
  assert.equal(roving.active, "timing");
});

test("roving tabs ignore keys outside the navigation set", () => {
  const { roving, root } = tabsHarness(["timing", "plan"], "timing");
  const letter = keydown("a");
  root.children[0]!.dispatch("keydown", letter.event);
  assert.equal(letter.prevented, false);
  assert.equal(roving.active, "timing");
});

test("roving tabs setLabel retitles an existing tab only", () => {
  const { roving, root } = tabsHarness(["timing", "plan"], "timing");
  roving.setLabel("plan", "Renamed");
  assert.equal(root.children[1]!.textContent, "Renamed");
  roving.setLabel("missing", "Ignored");
  assert.equal(root.children[0]!.textContent, "Tab timing");
});
