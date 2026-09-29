import assert from "node:assert/strict";
import test from "node:test";
import { MarkdownView, TFile } from "obsidian";

import {
  ACTIVE_TASK_VIEW_TYPE,
  openActiveTaskView,
} from "../../../src/adapters/active-task-view";
import { createLoadedMarkdownEditorResolver } from "../../../src/adapters/editor-buffer";
import { ObsidianSourceNavigator } from "../../../src/adapters/source-navigation";

function markdownView(
  path: string,
  bufferText: string,
  loadedText: string | null,
  persistedBytes: number,
): {
  readonly view: MarkdownView;
  readonly editor: MarkdownView["editor"];
  readonly setBufferText: (value: string) => void;
} {
  let currentBufferText = bufferText;
  const editor = {
    getValue: () => currentBufferText,
    transaction() {},
  } as never;
  const file = Object.assign(Object.create(TFile.prototype), {
    path,
    stat: { size: persistedBytes },
  }) as TFile;
  const view = Object.assign(Object.create(MarkdownView.prototype), {
    editor,
    data: loadedText,
    file,
  }) as MarkdownView;
  return { view, editor, setBufferText: (value) => { currentBufferText = value; } };
}

test("restoring Markdown views become editor-authoritative only after their public buffer state is loaded", () => {
  const loading = markdownView("Daily/today.md", "", null, 596);
  let activeView: MarkdownView | null = loading.view;
  const workspace = {
    getActiveViewOfType() { return activeView; },
    getLeavesOfType(type: string) {
      assert.equal(type, "markdown");
      return [{ view: loading.view }];
    },
  };
  const resolver = createLoadedMarkdownEditorResolver(workspace as never);
  assert.equal(resolver.editorForPath("Daily/today.md"), undefined);

  loading.view.data = "";
  assert.equal(resolver.editorForPath("Daily/today.md"), undefined);

  loading.view.data = "persisted source";
  loading.setBufferText("persisted source");
  assert.equal(resolver.editorForPath("Daily/today.md"), loading.editor);

  loading.view.data = "";
  loading.setBufferText("");
  resolver.onFileOpen(loading.view.file);
  assert.equal(resolver.editorForPath("Daily/today.md"), loading.editor);

  const originalFile = loading.view.file;
  const switched = markdownView("Daily/other.md", "", "", 400);
  loading.view.file = switched.view.file;
  assert.equal(resolver.editorForPath("Daily/today.md"), undefined);
  loading.view.file = originalFile;
  assert.equal(resolver.editorForPath("Daily/today.md"), undefined);

  loading.view.data = "persisted source";
  loading.setBufferText("persisted source");
  assert.equal(resolver.editorForPath("Daily/today.md"), loading.editor);
  loading.view.data = "";
  loading.setBufferText("");
  loading.view.file = switched.view.file;
  resolver.onFileOpen(switched.view.file);
  loading.view.file = originalFile;
  resolver.onFileOpen(originalFile);
  assert.equal(resolver.editorForPath("Daily/today.md"), undefined);

  const empty = markdownView("Daily/today.md", "", "", 0);
  activeView = empty.view;
  workspace.getLeavesOfType = () => [{ view: empty.view }];
  const emptyResolver = createLoadedMarkdownEditorResolver(workspace as never);
  assert.equal(emptyResolver.editorForPath("Daily/today.md"), empty.editor);

  const populated = markdownView("Daily/today.md", "current source", "", 596);
  activeView = populated.view;
  workspace.getLeavesOfType = () => [{ view: populated.view }];
  const populatedResolver = createLoadedMarkdownEditorResolver(workspace as never);
  assert.equal(populatedResolver.editorForPath("Daily/today.md"), populated.editor);
});

test("TC-UP-CLK-10 singleton Active Task reuses the right leaf and removes duplicates", async () => {
  let duplicateDetached = 0;
  const primary = { detach() { throw new Error("primary detached"); } };
  const duplicate = { detach() { duplicateDetached += 1; } };
  const revealed: unknown[] = [];
  const focused: unknown[] = [];
  const workspace = {
    getLeavesOfType(type: string) {
      assert.equal(type, ACTIVE_TASK_VIEW_TYPE);
      return [primary, duplicate];
    },
    async ensureSideLeaf(type: string, side: string, options: unknown) {
      assert.equal(type, ACTIVE_TASK_VIEW_TYPE);
      assert.equal(side, "right");
      assert.deepEqual(options, { active: true, reveal: true, split: false });
      return primary;
    },
    async revealLeaf(leaf: unknown) { revealed.push(leaf); },
    setActiveLeaf(leaf: unknown, options: unknown) { focused.push([leaf, options]); },
  };

  const result = await openActiveTaskView({ workspace } as never);
  assert.equal(result.leaf, primary);
  assert.equal(result.reused, true);
  assert.equal(duplicateDetached, 1);
  assert.deepEqual(revealed, [primary]);
  assert.deepEqual(focused, [[primary, { focus: true }]]);
});

test("TC-UP-EXE-05/12 source navigation selects the fresh line briefly and disposes timers", async () => {
  const source = ["heading", "", "- [ ] Focus me ^nl-id"];
  let selection = { from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } };
  const cursorCalls: Array<{ line: number; ch: number }> = [];
  const timers = new Map<number, () => void>();
  const cleared: number[] = [];
  const ownerWindow = {
    setTimeout(callback: () => void) { timers.set(1, callback); return 1; },
    clearTimeout(handle: number) { cleared.push(handle); timers.delete(handle); },
  };
  const editor = {
    lineCount: () => source.length,
    getLine: (line: number) => source[line] ?? "",
    setCursor(position: { line: number; ch: number }) {
      cursorCalls.push(position);
      selection = { from: position, to: position };
    },
    setSelection(from: { line: number; ch: number }, to: { line: number; ch: number }) {
      selection = { from, to };
    },
    getCursor(side: "from" | "to") { return selection[side]; },
    scrollIntoView() {},
    focus() {},
  };
  const view = Object.assign(Object.create(MarkdownView.prototype), {
    editor,
    containerEl: { ownerDocument: { defaultView: ownerWindow } },
  }) as MarkdownView;
  const file = Object.assign(Object.create(TFile.prototype), {
    path: "Daily/2026-08-29.md",
    extension: "md",
  }) as TFile;
  const leaf = {
    view,
    async openFile() {},
  };
  const navigator = new ObsidianSourceNavigator({
    app: {
      vault: { getAbstractFileByPath: () => file },
      workspace: {
        getLeaf: () => leaf,
        async revealLeaf() {},
        setActiveLeaf() {},
      },
    } as never,
    locateTask: () => ({ kind: "available", path: file.path, line: 2 }),
    unavailableMessage: (code) => code,
  });

  const result = await navigator.openTask({ path: file.path, ownerId: "nl-id", sourceOrder: 0 });
  assert.deepEqual(result, { kind: "opened", path: file.path, line: 2, location: "main" });
  assert.deepEqual(selection, {
    from: { line: 2, ch: 0 },
    to: { line: 2, ch: source[2]!.length },
  });
  timers.get(1)?.();
  assert.deepEqual(cursorCalls.at(-1), { line: 2, ch: 0 });

  await navigator.openTask({ path: file.path, ownerId: "nl-id", sourceOrder: 0 });
  navigator.dispose();
  assert.deepEqual(cleared, [1]);
});

test("TC-UP-EXE-05 source navigation reports the clamped line it actually opened", async () => {
  const cursorCalls: Array<{ line: number; ch: number }> = [];
  const editor = {
    lineCount: () => 1,
    getLine: () => "only line",
    setCursor(position: { line: number; ch: number }) { cursorCalls.push(position); },
    setSelection() {},
    getCursor: () => ({ line: 0, ch: 0 }),
    scrollIntoView() {},
    focus() {},
  };
  const view = Object.assign(Object.create(MarkdownView.prototype), {
    editor,
    containerEl: { ownerDocument: { defaultView: undefined } },
  }) as MarkdownView;
  const file = Object.assign(Object.create(TFile.prototype), {
    path: "Daily/2026-08-29.md",
    extension: "md",
  }) as TFile;
  const navigator = new ObsidianSourceNavigator({
    app: {
      vault: { getAbstractFileByPath: () => file },
      workspace: {
        getLeaf: () => ({ view, async openFile() {} }),
        async revealLeaf() {},
        setActiveLeaf() {},
      },
    } as never,
    locateTask: () => ({ kind: "available", path: file.path, line: 99 }),
    unavailableMessage: (code) => code,
  });

  const result = await navigator.openTask({ path: file.path, ownerId: "nl-id", sourceOrder: 0 });
  assert.deepEqual(result, { kind: "opened", path: file.path, line: 0, location: "main" });
  assert.deepEqual(cursorCalls[0], { line: 0, ch: 0 });
});

test("source navigation disposal cancels pending task lookup before host UI work", async () => {
  let resolveLocation!: (value: { kind: "available"; path: string; line: number }) => void;
  const location = new Promise<{ kind: "available"; path: string; line: number }>((resolve) => {
    resolveLocation = resolve;
  });
  let leafRequests = 0;
  const navigator = new ObsidianSourceNavigator({
    app: {
      vault: { getAbstractFileByPath: () => { throw new Error("vault lookup after disposal"); } },
      workspace: { getLeaf: () => { leafRequests += 1; throw new Error("leaf after disposal"); } },
    } as never,
    locateTask: () => location,
    unavailableMessage: () => { throw new Error("notice after disposal"); },
  });

  const opening = navigator.openTask({ path: "Daily/2026-08-29.md", ownerId: "nl-id", sourceOrder: 0 });
  navigator.dispose();
  resolveLocation({ kind: "available", path: "Daily/2026-08-29.md", line: 2 });

  assert.deepEqual(await opening, { kind: "unavailable", code: "navigation-disposed" });
  assert.equal(leafRequests, 0);
});

test("source navigation disposal during openFile prevents reveal and focus", async () => {
  let finishOpen!: () => void;
  const opened = new Promise<void>((resolve) => { finishOpen = resolve; });
  let openStarted!: () => void;
  const started = new Promise<void>((resolve) => { openStarted = resolve; });
  let reveals = 0;
  let focuses = 0;
  const file = Object.assign(Object.create(TFile.prototype), {
    path: "Daily/2026-08-29.md",
    extension: "md",
  }) as TFile;
  const leaf = {
    view: {},
    async openFile() {
      openStarted();
      await opened;
    },
  };
  const navigator = new ObsidianSourceNavigator({
    app: {
      vault: { getAbstractFileByPath: () => file },
      workspace: {
        getLeaf: () => leaf,
        async revealLeaf() { reveals += 1; },
        setActiveLeaf() { focuses += 1; },
      },
    } as never,
    locateTask: () => ({ kind: "available", path: file.path, line: 0 }),
    unavailableMessage: (code) => code,
  });

  const opening = navigator.openPrimary(file.path);
  await started;
  navigator.dispose();
  finishOpen();

  assert.deepEqual(await opening, { kind: "unavailable", code: "navigation-disposed" });
  assert.equal(reveals, 0);
  assert.equal(focuses, 0);
});
