import {
  MarkdownView,
  Notice,
  TFile,
  type App,
  type WorkspaceLeaf,
} from "obsidian";

export interface SourceTaskReference {
  readonly path: string;
  readonly ownerId: string | null;
  readonly sourceOrder: number;
}

export type SourceLocationResult =
  | { readonly kind: "available"; readonly path: string; readonly line: number }
  | { readonly kind: "unavailable"; readonly code: string };

export interface SourceNavigationDependencies {
  readonly app: App;
  readonly locateTask: (target: SourceTaskReference) => SourceLocationResult | Promise<SourceLocationResult>;
  readonly unavailableMessage: (code: string) => string;
}

export type SourceNavigationResult =
  | { readonly kind: "opened"; readonly path: string; readonly line: number; readonly location: "main" | "sidebar" }
  | { readonly kind: "unavailable"; readonly code: string };

function markdownFile(app: App, path: string): TFile | undefined {
  const file = app.vault.getAbstractFileByPath(path);
  return file instanceof TFile && file.extension.toLowerCase() === "md" ? file : undefined;
}

async function openLeaf(
  app: App,
  file: TFile,
  location: "main" | "sidebar",
): Promise<WorkspaceLeaf | undefined> {
  const leaf = location === "sidebar"
    ? app.workspace.getRightLeaf(false) ?? app.workspace.getRightLeaf(true)
    : app.workspace.getLeaf(false);
  if (!leaf) return undefined;
  await leaf.openFile(file, { active: true });
  await app.workspace.revealLeaf(leaf);
  app.workspace.setActiveLeaf(leaf, { focus: true });
  return leaf;
}

export class ObsidianSourceNavigator {
  readonly #dependencies: SourceNavigationDependencies;
  readonly #flashTimers = new Set<{ window: Window; handle: number }>();
  #disposed = false;

  constructor(dependencies: SourceNavigationDependencies) {
    this.#dependencies = dependencies;
  }

  async openTask(
    target: SourceTaskReference,
    location: "main" | "sidebar" = "main",
  ): Promise<SourceNavigationResult> {
    const resolved = await this.#dependencies.locateTask(target);
    if (resolved.kind === "unavailable") return this.#unavailable(resolved.code);
    const file = markdownFile(this.#dependencies.app, resolved.path);
    if (!file) return this.#unavailable("source-file-missing");
    const leaf = await openLeaf(this.#dependencies.app, file, location);
    if (!leaf) return this.#unavailable("workspace-unavailable");
    const view = leaf.view;
    let openedLine = Math.max(0, Math.floor(resolved.line));
    if (view instanceof MarkdownView) {
      openedLine = Math.min(
        openedLine,
        Math.max(0, view.editor.lineCount() - 1),
      );
      view.editor.setCursor({ line: openedLine, ch: 0 });
      view.editor.scrollIntoView({
        from: { line: openedLine, ch: 0 },
        to: { line: openedLine, ch: 0 },
      }, true);
      view.editor.focus();
      this.#flash(view, leaf, openedLine);
    }
    return Object.freeze({ kind: "opened", path: resolved.path, line: openedLine, location });
  }

  async openPrimary(path: string | null): Promise<SourceNavigationResult> {
    if (!path) return this.#unavailable("primary-plan-missing");
    const file = markdownFile(this.#dependencies.app, path);
    if (!file) return this.#unavailable("primary-source-missing");
    const leaf = await openLeaf(this.#dependencies.app, file, "main");
    if (!leaf) return this.#unavailable("workspace-unavailable");
    if (leaf.view instanceof MarkdownView) {
      leaf.view.editor.setCursor({ line: 0, ch: 0 });
      leaf.view.editor.scrollIntoView({ from: { line: 0, ch: 0 }, to: { line: 0, ch: 0 } }, true);
      leaf.view.editor.focus();
      this.#flash(leaf.view, leaf, 0);
    }
    return Object.freeze({ kind: "opened", path, line: 0, location: "main" });
  }

  #unavailable(code: string): SourceNavigationResult {
    new Notice(this.#dependencies.unavailableMessage(code), 5_000);
    return Object.freeze({ kind: "unavailable", code });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const timer of this.#flashTimers) timer.window.clearTimeout(timer.handle);
    this.#flashTimers.clear();
  }

  #flash(view: MarkdownView, leaf: WorkspaceLeaf, requestedLine: number): void {
    if (this.#disposed) return;
    const editor = view.editor;
    const line = Math.min(requestedLine, Math.max(0, editor.lineCount() - 1));
    const start = Object.freeze({ line, ch: 0 });
    const text = editor.getLine(line);
    const end = text.length > 0
      ? Object.freeze({ line, ch: text.length })
      : line + 1 < editor.lineCount()
        ? Object.freeze({ line: line + 1, ch: 0 })
        : start;
    editor.setSelection(start, end);
    const ownerWindow = view.containerEl.ownerDocument.defaultView;
    if (!ownerWindow || (start.line === end.line && start.ch === end.ch)) return;
    const timer = { window: ownerWindow, handle: 0 };
    timer.handle = ownerWindow.setTimeout(() => {
      this.#flashTimers.delete(timer);
      if (this.#disposed || leaf.view !== view) return;
      const from = editor.getCursor("from");
      const to = editor.getCursor("to");
      if (from.line === start.line && from.ch === start.ch
        && to.line === end.line && to.ch === end.ch) {
        editor.setCursor(start);
      }
    }, 1_200);
    this.#flashTimers.add(timer);
  }
}
