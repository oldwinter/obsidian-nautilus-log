import assert from "node:assert/strict";
import test from "node:test";

import { ExecutionCommandRegistry } from "../../../src/adapters/commands";
import { registerExecutionEditorMenu } from "../../../src/adapters/editor-menu";
import { createReviewEntryPort } from "../../../src/adapters/review-entry";
import { executionOutcomeNotice } from "../../../src/adapters/notices";

test("TC-UP-CMD-01-001..003 registers exactly three no-hotkey commands and removes them", async () => {
  const registered: Array<Record<string, unknown>> = [];
  const removed: string[] = [];
  const calls: string[] = [];
  const plugin = {
    addCommand(command: Record<string, unknown>) {
      registered.push(command);
      return command;
    },
    removeCommand(id: string) {
      removed.push(id);
    },
  };
  const registry = new ExecutionCommandRegistry({
    plugin: plugin as never,
    focusCurrent: () => { calls.push("focus"); },
    clockOut: () => { calls.push("out"); },
    locatePrimary: () => { calls.push("locate"); },
  });

  registry.start();
  registry.start();
  assert.equal(registry.active, true);
  assert.deepEqual(registered.map((command) => command.name), [
    "Nautilus Log: 1. Focus current block",
    "Nautilus Log: 2. Clock out Timing Line",
    "Nautilus Log: 3. Locate Primary Plan",
  ]);
  assert.deepEqual(registered.map((command) => command.id), ["execution-1", "execution-2", "execution-3"]);
  assert.equal(registered.some((command) => Object.hasOwn(command, "hotkeys")), false);
  for (const command of registered) (command.callback as () => void)();
  await Promise.resolve();
  assert.deepEqual(calls, ["focus", "out", "locate"]);

  registry.stop();
  registry.stop();
  assert.equal(registry.active, false);
  assert.deepEqual(removed, ["execution-1", "execution-2", "execution-3"]);
});

test("TC-UP-CMD-02-001..003 editor menu stays absent when disabled and dispatches only the resolved action", async () => {
  let enabled = false;
  let editorMenu: ((menu: unknown, editor: unknown, info: unknown) => void) | undefined;
  const dispatched: string[] = [];
  const plugin = {
    app: {
      workspace: {
        on(_name: string, callback: (menu: unknown, editor: unknown, info: unknown) => void) {
          editorMenu = callback;
          return {};
        },
      },
    },
    registerEvent() {},
  };
  registerExecutionEditorMenu({
    plugin: plugin as never,
    enabled: () => enabled,
    resolveAction: () => ({ kind: "clock-in" }),
    dispatch: (action) => { dispatched.push(action.kind); },
  });
  assert.ok(editorMenu);

  const items: Array<{ title?: string; icon?: string; activate?: () => void }> = [];
  const menu = {
    addItem(configure: (item: unknown) => void) {
      const record: { title?: string; icon?: string; activate?: () => void } = {};
      const item = {
        setTitle(value: string) { record.title = value; return item; },
        setIcon(value: string) { record.icon = value; return item; },
        onClick(value: () => void) { record.activate = value; return item; },
      };
      configure(item);
      items.push(record);
    },
  };
  editorMenu!(menu, {}, {});
  assert.equal(items.length, 0);
  enabled = true;
  editorMenu!(menu, {}, {});
  assert.deepEqual(items.map((item) => [item.title, item.icon]), [["Nautilus Log: Clock in", "timer"]]);
  items[0]!.activate?.();
  await Promise.resolve();
  assert.deepEqual(dispatched, ["clock-in"]);
});

test("review handoff port owns a replaceable placeholder surface without importing Review UI", () => {
  const children: unknown[] = [];
  const root = {
    ownerDocument: {
      createElement() {
        return { className: "", textContent: "" };
      },
    },
    append(child: unknown) { children.push(child); },
    replaceChildren() { children.length = 0; },
  };
  const port = createReviewEntryPort({
    dispatch: async () => { throw new Error("not used"); },
    executionSnapshot: () => { throw new Error("not used"); },
    subscribeExecution: () => () => undefined,
    reviewSnapshot: () => ({ state: "absent", generation: 0 }),
    subscribeReview: () => () => undefined,
    navigateTask: () => undefined,
    messages: { t: () => "Review is being prepared." } as never,
    addDisposer: () => undefined,
  });
  const surface = port.createSurface(root as never);
  surface.render(root as never, false);
  assert.equal(children.length, 0);
  surface.render(root as never, true);
  assert.equal(children.length, 1);
  assert.equal((children[0] as { textContent: string }).textContent, "Review is being prepared.");
  surface.destroy();
  assert.equal(children.length, 0);
});

test("UP-ERR-05/06 maps runtime failures to specific localized feedback", () => {
  const messages = {
    t(_namespace: string, key: string) { return key; },
  } as never;
  const outcome = (code: "plugin-data-failed" | "source-over-limit" | "multiple-running-clocks") => ({
    intentId: code,
    outcome: "rejected" as const,
    snapshot: {} as never,
    code,
    pluginDataWarning: false,
  });
  assert.equal(executionOutcomeNotice(outcome("plugin-data-failed"), messages).message, "error.unconfirmed");
  assert.equal(executionOutcomeNotice(outcome("source-over-limit"), messages).message, "error.refresh");
  assert.equal(executionOutcomeNotice(outcome("multiple-running-clocks"), messages).message, "error.overlap");
});
