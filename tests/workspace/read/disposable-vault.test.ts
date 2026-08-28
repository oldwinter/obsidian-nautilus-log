import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import test from "node:test";

import {
  WorkspaceIndex,
  type WorkspaceIndexTextAccess,
} from "../../../src/workspace/identity-index.ts";
import type { SourceChange, SourceChangeListener } from "../../../src/workspace/text-access.ts";

const ID = "stable-disposable-id";

class DisposableVaultAccess implements WorkspaceIndexTextAccess {
  readonly #listeners = new Set<SourceChangeListener>();

  constructor(readonly root: string) {}

  async listMarkdownPaths(): Promise<readonly string[]> {
    const paths: string[] = [];
    const visit = async (folder: string): Promise<void> => {
      for (const entry of await readdir(folder, { withFileTypes: true })) {
        const absolute = join(folder, entry.name);
        if (entry.isDirectory()) await visit(absolute);
        else if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
          paths.push(relative(this.root, absolute).split(sep).join("/"));
        }
      }
    };
    await visit(this.root);
    return paths.sort();
  }

  async readText(path: string): Promise<string | undefined> {
    try {
      return await readFile(join(this.root, path), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  onChange(listener: SourceChangeListener): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(change: SourceChange): void {
    for (const listener of this.#listeners) listener(Object.freeze({ ...change }));
  }
}

test("disposable vault preserves bytes across edit, move, duplicate, repair, and delete rebuilds", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "nautilus-issue20-"));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const daily = join(root, "Daily");
  await mkdir(daily, { recursive: true });
  const originalPath = "Daily/2026-08-28.md";
  const originalFile = join(root, originalPath);
  await writeFile(originalFile, `- [ ] Original ^${ID}\r\n- anonymous\r\n`, "utf8");

  const access = new DisposableVaultAccess(root);
  const index = new WorkspaceIndex(access);
  const assertReadOnlyRebuild = async (): Promise<void> => {
    const paths = await access.listMarkdownPaths();
    const before = new Map(await Promise.all(paths.map(async (path) => [path, await access.readText(path)] as const)));
    const snapshot = await index.rebuild();
    assert.equal(snapshot.complete, true);
    const after = new Map(await Promise.all(paths.map(async (path) => [path, await access.readText(path)] as const)));
    assert.deepEqual(after, before);
  };

  await assertReadOnlyRebuild();
  assert.equal(index.identity(ID).kind, "unique");

  await writeFile(originalFile, `- [ ] Edited 30m ^${ID}\r\n- anonymous\r\n`, "utf8");
  access.emit({ kind: "editor", path: originalPath });
  await assertReadOnlyRebuild();

  const movedPath = "Archive/2026-08-28.md";
  await mkdir(join(root, "Archive"));
  await rename(originalFile, join(root, movedPath));
  access.emit({ kind: "rename", path: movedPath, oldPath: originalPath });
  await assertReadOnlyRebuild();
  const moved = index.identity(ID);
  assert.equal(moved.kind, "unique");
  if (moved.kind === "unique") assert.equal(moved.location.path, movedPath);

  const duplicatePath = "Daily/copy.md";
  await writeFile(join(root, duplicatePath), `- [ ] Copied ^${ID}\n`, "utf8");
  access.emit({ kind: "create", path: duplicatePath });
  await assertReadOnlyRebuild();
  assert.equal(index.identity(ID).kind, "collision");

  await writeFile(join(root, duplicatePath), "- [ ] Copy without identity\n", "utf8");
  access.emit({ kind: "modify", path: duplicatePath });
  await assertReadOnlyRebuild();
  assert.equal(index.identity(ID).kind, "unique");

  await unlink(join(root, duplicatePath));
  access.emit({ kind: "delete", path: duplicatePath });
  await assertReadOnlyRebuild();
  assert.equal(index.identity(ID).kind, "unique");
  index.dispose();
});
