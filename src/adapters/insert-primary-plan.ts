import { MarkdownView, TFile, type App, type Editor } from "obsidian";
import { resolveDailyNotePath, type DailyNoteConfiguration, type LogicalDate } from "../workspace/daily-notes";
import {
  preparePrimaryPlanInsertion,
  type PrimaryPlanInsertion,
} from "../workspace/insert-primary-plan";

export type InsertPrimaryPlanOutcome =
  | { readonly kind: "created"; readonly path: string }
  | { readonly kind: "appended"; readonly path: string }
  | { readonly kind: "already-present"; readonly path: string }
  | { readonly kind: "blocked"; readonly reason: "malformed-region" | "invalid-path" | "folder-conflict" };

export interface InsertPrimaryPlanDependencies {
  readonly app: App;
  readonly locale: () => string;
  readonly today: () => LogicalDate;
  readonly configuration: () => DailyNoteConfiguration;
  readonly editorForPath: (path: string) => Pick<Editor, "getValue"> & Partial<Pick<Editor, "setValue">> | undefined;
}

function markdownFile(app: App, path: string): TFile | undefined {
  const file = app.vault.getAbstractFileByPath(path);
  return file instanceof TFile && file.extension.toLowerCase() === "md" ? file : undefined;
}

async function ensureParentFolders(app: App, path: string): Promise<"ok" | "folder-conflict"> {
  const segments = path.split("/").slice(0, -1);
  let current = "";
  for (const segment of segments) {
    current = current === "" ? segment : `${current}/${segment}`;
    const existing = app.vault.getAbstractFileByPath(current);
    if (!existing) {
      await app.vault.createFolder(current);
      continue;
    }
    if (existing instanceof TFile) return "folder-conflict";
  }
  return "ok";
}

async function openDailyNote(app: App, file: TFile): Promise<void> {
  const leaf = app.workspace.getLeaf(false);
  await leaf.openFile(file, { active: true });
  await app.workspace.revealLeaf(leaf);
  app.workspace.setActiveLeaf(leaf, { focus: true });
  const view = leaf.view;
  if (view instanceof MarkdownView) {
    const last = Math.max(0, view.editor.lineCount() - 1);
    view.editor.setCursor({ line: last, ch: 0 });
    view.editor.focus();
  }
}

function writeEditor(
  editor: Pick<Editor, "getValue"> & Partial<Pick<Editor, "setValue">>,
  locale: string,
): PrimaryPlanInsertion | undefined {
  if (!editor.setValue) return undefined;
  const prepared = preparePrimaryPlanInsertion(editor.getValue(), locale);
  if (prepared.kind === "create" || prepared.kind === "append") {
    editor.setValue(prepared.nextText);
  }
  return prepared;
}

export async function insertPrimaryPlan(
  dependencies: InsertPrimaryPlanDependencies,
): Promise<InsertPrimaryPlanOutcome> {
  const resolved = resolveDailyNotePath(dependencies.today(), dependencies.configuration());
  if (!resolved.ok) return Object.freeze({ kind: "blocked", reason: "invalid-path" });
  const { path } = resolved;
  const locale = dependencies.locale();
  const existing = markdownFile(dependencies.app, path);
  if (!existing) {
    const folders = await ensureParentFolders(dependencies.app, path);
    if (folders === "folder-conflict") {
      return Object.freeze({ kind: "blocked", reason: "folder-conflict" });
    }
    const created = markdownFile(dependencies.app, path);
    if (created) {
      return insertPrimaryPlan(dependencies);
    }
    const prepared = preparePrimaryPlanInsertion(undefined, locale);
    if (prepared.kind !== "create") {
      return Object.freeze({ kind: "blocked", reason: "malformed-region" });
    }
    const file = await dependencies.app.vault.create(path, prepared.nextText);
    await openDailyNote(dependencies.app, file);
    return Object.freeze({ kind: "created", path });
  }

  const editor = dependencies.editorForPath(path);
  const fromEditor = editor ? writeEditor(editor, locale) : undefined;
  let prepared = fromEditor;
  if (!prepared) {
    let outcome: PrimaryPlanInsertion | undefined;
    await dependencies.app.vault.process(existing, (current) => {
      outcome = preparePrimaryPlanInsertion(current, locale);
      return outcome.kind === "create" || outcome.kind === "append" ? outcome.nextText : current;
    });
    prepared = outcome ?? preparePrimaryPlanInsertion(undefined, locale);
  }
  if (prepared.kind === "already-present") {
    await openDailyNote(dependencies.app, existing);
    return Object.freeze({ kind: "already-present", path });
  }
  if (prepared.kind === "blocked") {
    await openDailyNote(dependencies.app, existing);
    return Object.freeze({ kind: "blocked", reason: prepared.reason });
  }
  await openDailyNote(dependencies.app, existing);
  return Object.freeze({ kind: prepared.kind === "create" ? "created" : "appended", path });
}

export function insertPrimaryPlanNoticeKey(
  outcome: InsertPrimaryPlanOutcome,
):
  | "status.missingInserted"
  | "status.missingAlreadyPresent"
  | "status.missingInsertBlocked"
  | "status.missingInvalidPath"
  | "status.missingFolderConflict"
  | "status.missingInsertFailed" {
  if (outcome.kind === "created" || outcome.kind === "appended") return "status.missingInserted";
  if (outcome.kind === "already-present") return "status.missingAlreadyPresent";
  if (outcome.reason === "malformed-region") return "status.missingInsertBlocked";
  if (outcome.reason === "invalid-path") return "status.missingInvalidPath";
  if (outcome.reason === "folder-conflict") return "status.missingFolderConflict";
  return "status.missingInsertFailed";
}
