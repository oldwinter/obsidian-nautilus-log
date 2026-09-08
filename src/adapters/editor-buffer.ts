import { MarkdownView, type Editor, type TFile, type Workspace } from "obsidian";

type EditorBuffer = Pick<Editor, "getValue" | "transaction">;
type MarkdownWorkspace = Pick<Workspace, "getActiveViewOfType" | "getLeavesOfType">;

interface LoadedMarkdownEditorResolver {
  readonly editorForPath: (path: string) => EditorBuffer | undefined;
  readonly onFileOpen: (file: TFile | null) => void;
}

export function createLoadedMarkdownEditorResolver(
  workspace: MarkdownWorkspace,
): LoadedMarkdownEditorResolver {
  const loadedFiles = new WeakMap<MarkdownView, NonNullable<MarkdownView["file"]>>();
  const observedFiles = new WeakMap<MarkdownView, MarkdownView["file"]>();
  const observeFile = (view: MarkdownView, file: MarkdownView["file"]): void => {
    if (observedFiles.has(view) && observedFiles.get(view) !== file) loadedFiles.delete(view);
    observedFiles.set(view, file);
  };
  const editorForPath = (path: string): EditorBuffer | undefined => {
    for (const leaf of workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView)) continue;
      const file = view.file;
      observeFile(view, file);
      if (!file || file.path !== path) continue;
      const editor = view.editor;
      if (loadedFiles.get(view) === file) return editor;
      const data = view.data;
      if (typeof data !== "string") continue;
      if (editor.getValue().length === 0 && data.length === 0 && file.stat.size > 0) continue;
      loadedFiles.set(view, file);
      return editor;
    }
    return undefined;
  };
  const onFileOpen = (file: TFile | null): void => {
    const view = workspace.getActiveViewOfType(MarkdownView);
    if (view) observeFile(view, file);
  };
  return Object.freeze({ editorForPath, onFileOpen });
}
