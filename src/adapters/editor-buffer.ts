import { MarkdownView, type Editor, type Workspace } from "obsidian";

type EditorBuffer = Pick<Editor, "getValue" | "transaction">;
type MarkdownWorkspace = Pick<Workspace, "getLeavesOfType">;

export function createLoadedMarkdownEditorResolver(
  workspace: MarkdownWorkspace,
): (path: string) => EditorBuffer | undefined {
  const loadedFiles = new WeakMap<MarkdownView, NonNullable<MarkdownView["file"]>>();
  return (path) => {
    for (const leaf of workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      const file = view.file;
      if (!file || file.path !== path) continue;
      const editor = view.editor;
      if (loadedFiles.get(view) === file) return editor;
      if (editor.getValue().length === 0 && view.data.length === 0 && file.stat.size > 0) continue;
      loadedFiles.set(view, file);
      return editor;
    }
    return undefined;
  };
}
