import type { Editor, MarkdownFileInfo, MarkdownView, Menu, Plugin } from "obsidian";

export type ExecutionEditorMenuAction = Readonly<{ readonly kind: "clock-in" | "clock-out" }>;

export interface ExecutionEditorMenuDependencies {
  readonly plugin: Plugin;
  readonly enabled: () => boolean;
  readonly resolveAction: (
    editor: Editor,
    info: MarkdownView | MarkdownFileInfo,
  ) => ExecutionEditorMenuAction | undefined;
  readonly dispatch: (
    action: ExecutionEditorMenuAction,
    editor: Editor,
    info: MarkdownView | MarkdownFileInfo,
  ) => void | Promise<void>;
  readonly onError?: (error: unknown) => void;
}

export function registerExecutionEditorMenu(dependencies: ExecutionEditorMenuDependencies): void {
  dependencies.plugin.registerEvent(dependencies.plugin.app.workspace.on(
    "editor-menu",
    (menu: Menu, editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
      if (!dependencies.enabled()) return;
      const action = dependencies.resolveAction(editor, info);
      if (!action) return;
      menu.addItem((item) => item
        .setTitle(action.kind === "clock-in" ? "Nautilus Log: Clock in" : "Nautilus Log: Clock out")
        .setIcon(action.kind === "clock-in" ? "timer" : "square")
        .onClick(() => {
          void Promise.resolve(dependencies.dispatch(action, editor, info)).catch(dependencies.onError);
        }));
    },
  ));
}
