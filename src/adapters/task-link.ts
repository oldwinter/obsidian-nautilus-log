import { TFile, type App } from "obsidian";
import type { SourceTaskReference } from "./source-navigation";

export type TaskLinkCopyResult =
  | { readonly kind: "copied"; readonly link: string }
  | {
      readonly kind: "unavailable";
      readonly code: "clipboard-unavailable" | "copy-failed" | "source-file-missing" | "task-identity-missing";
    };

export interface TaskLinkClipboard {
  readonly writeText: (text: string) => Promise<void>;
}

export async function copyTaskMarkdownLink(input: {
  readonly app: App;
  readonly target: SourceTaskReference;
  readonly label: string;
  readonly clipboard?: TaskLinkClipboard;
}): Promise<TaskLinkCopyResult> {
  if (!input.target.ownerId) {
    return Object.freeze({ kind: "unavailable", code: "task-identity-missing" });
  }
  const file = input.app.vault.getAbstractFileByPath(input.target.path);
  if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md") {
    return Object.freeze({ kind: "unavailable", code: "source-file-missing" });
  }
  const clipboard = input.clipboard ?? globalThis.navigator?.clipboard;
  if (!clipboard) {
    return Object.freeze({ kind: "unavailable", code: "clipboard-unavailable" });
  }
  try {
    const link = input.app.fileManager.generateMarkdownLink(
      file,
      "",
      `#^${input.target.ownerId}`,
      input.label,
    );
    await clipboard.writeText(link);
    return Object.freeze({ kind: "copied", link });
  } catch {
    return Object.freeze({ kind: "unavailable", code: "copy-failed" });
  }
}
