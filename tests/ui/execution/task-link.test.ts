import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "obsidian";

import { copyTaskMarkdownLink } from "../../../src/adapters/task-link";

function markdownFile(path = "Daily/2026-08-30.md"): TFile {
  return Object.assign(Object.create(TFile.prototype), { path, extension: "md" }) as TFile;
}

test("copy task link delegates block-link formatting to Obsidian and writes the result", async () => {
  const file = markdownFile();
  const generated: unknown[][] = [];
  const copied: string[] = [];
  const result = await copyTaskMarkdownLink({
    app: {
      vault: { getAbstractFileByPath: () => file },
      fileManager: {
        generateMarkdownLink(...args: unknown[]) {
          generated.push(args);
          return "[[Daily/2026-08-30#^nl-task|Ship the feature]]";
        },
      },
    } as never,
    target: { path: file.path, ownerId: "nl-task", sourceOrder: 3 },
    label: "Ship the feature",
    clipboard: { async writeText(value) { copied.push(value); } },
  });

  assert.deepEqual(generated, [[file, "", "#^nl-task", "Ship the feature"]]);
  assert.deepEqual(copied, ["[[Daily/2026-08-30#^nl-task|Ship the feature]]"]);
  assert.deepEqual(result, {
    kind: "copied",
    link: "[[Daily/2026-08-30#^nl-task|Ship the feature]]",
  });
});

test("copy task link fails closed before touching the clipboard when source identity is unavailable", async () => {
  let writes = 0;
  const app = {
    vault: { getAbstractFileByPath: () => markdownFile() },
    fileManager: { generateMarkdownLink() { throw new Error("not reached"); } },
  } as never;
  const clipboard = { async writeText() { writes += 1; } };

  assert.deepEqual(await copyTaskMarkdownLink({
    app,
    target: { path: "Daily/2026-08-30.md", ownerId: null, sourceOrder: 3 },
    label: "Anonymous",
    clipboard,
  }), { kind: "unavailable", code: "task-identity-missing" });
  assert.deepEqual(await copyTaskMarkdownLink({
    app: {
      vault: { getAbstractFileByPath: () => undefined },
      fileManager: app.fileManager,
    } as never,
    target: { path: "Missing.md", ownerId: "nl-task", sourceOrder: 3 },
    label: "Missing",
    clipboard,
  }), { kind: "unavailable", code: "source-file-missing" });
  assert.equal(writes, 0);
});

test("copy task link reports clipboard failures without throwing", async () => {
  const file = markdownFile();
  const result = await copyTaskMarkdownLink({
    app: {
      vault: { getAbstractFileByPath: () => file },
      fileManager: { generateMarkdownLink: () => "[[Daily/2026-08-30#^nl-task]]" },
    } as never,
    target: { path: file.path, ownerId: "nl-task", sourceOrder: 0 },
    label: "Task",
    clipboard: { async writeText() { throw new Error("permission denied"); } },
  });

  assert.deepEqual(result, { kind: "unavailable", code: "copy-failed" });
});
