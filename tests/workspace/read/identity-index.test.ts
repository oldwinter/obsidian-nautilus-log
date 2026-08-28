import assert from "node:assert/strict";
import test from "node:test";

import {
  WorkspaceIndex,
  type SourceChange,
  type WorkspaceIndexTextAccess,
} from "../../../src/workspace/identity-index.ts";

const OWNER = "nl-9f4de6a0-4d94-4b44-a7c4-c41127068e83";
const CLOCK = "nl-clock-4d80fd42-ecbd-402f-af68-973fda5cce14";

class MemoryAccess implements WorkspaceIndexTextAccess {
  readonly files = new Map<string, string>();
  readonly writes: string[] = [];
  #listeners = new Set<(change: SourceChange) => void>();

  async listMarkdownPaths(): Promise<readonly string[]> {
    return [...this.files.keys()];
  }

  async readText(path: string): Promise<string | undefined> {
    return this.files.get(path);
  }

  onChange(listener: (change: SourceChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(change: SourceChange): void {
    for (const listener of this.#listeners) listener(change);
  }
}

test("identity index adopts every terminal Markdown block ID and never chooses a collision winner", async () => {
  const access = new MemoryAccess();
  access.files.set("a.md", [
    "paragraph ^shared",
    "```md",
    "example ^ignored",
    "```",
    "standalone",
    "^solo",
  ].join("\n"));
  access.files.set("nested/b.md", "- [ ] duplicate ^shared\n- [ ] case ^Shared\n");
  access.files.set("asset.png", "not markdown ^asset");
  const before = new Map(access.files);
  const index = new WorkspaceIndex(access);

  const snapshot = await index.rebuild();
  assert.equal(snapshot.complete, true);
  assert.deepEqual(index.identity("shared"), {
    kind: "collision",
    locations: [
      { id: "shared", path: "a.md", fromOffset: 10, toOffset: 17, line: 0, column: 10 },
      { id: "shared", path: "nested/b.md", fromOffset: 16, toOffset: 23, line: 0, column: 16 },
    ],
  });
  assert.equal(index.identity("solo").kind, "unique");
  assert.equal(index.identity("Shared").kind, "unique");
  assert.equal(index.identity("ignored").kind, "missing");
  assert.equal(index.identity("asset").kind, "missing");
  assert.deepEqual(access.files, before);
  assert.deepEqual(access.writes, []);

  index.clear();
  const rebuilt = await index.rebuild();
  assert.equal(rebuilt.complete, true);
  assert.equal(index.identity("shared").kind, "collision");
  index.dispose();
});

test("create/modify/delete/rename/editor/cache all invalidate the generation", async () => {
  const access = new MemoryAccess();
  access.files.set("a.md", "text ^one");
  const index = new WorkspaceIndex(access);
  await index.rebuild();
  assert.equal(index.dirty, false);

  for (const kind of ["create", "modify", "delete", "rename", "editor", "cache"] as const) {
    access.emit({ kind, path: "a.md", ...(kind === "rename" ? { oldPath: "old.md" } : {}) });
    assert.equal(index.dirty, true, kind);
    assert.equal(index.snapshot.complete, false, kind);
    assert.equal(index.identity("one").kind, "unavailable", kind);
    await index.rebuild();
    assert.equal(index.dirty, false, kind);
  }
  index.dispose();
});

test("identity follows its terminal ID through edit and move, while copied IDs collide", async () => {
  const access = new MemoryAccess();
  access.files.set("old.md", "- [ ] Original ^stable-id");
  const index = new WorkspaceIndex(access);
  await index.rebuild();
  assert.equal(index.identity("stable-id").kind, "unique");

  access.files.set("old.md", "- [ ] Edited title 30m ^stable-id");
  access.emit({ kind: "editor", path: "old.md" });
  await index.rebuild();
  const edited = index.identity("stable-id");
  assert.equal(edited.kind, "unique");
  if (edited.kind === "unique") assert.equal(edited.location.path, "old.md");

  const moved = access.files.get("old.md")!;
  access.files.delete("old.md");
  access.files.set("Archive/moved.md", moved);
  access.emit({ kind: "rename", path: "Archive/moved.md", oldPath: "old.md" });
  await index.rebuild();
  const relocated = index.identity("stable-id");
  assert.equal(relocated.kind, "unique");
  if (relocated.kind === "unique") assert.equal(relocated.location.path, "Archive/moved.md");

  access.files.set("copy.md", "- [ ] Same text without an ID\n- [ ] Copied source ^stable-id");
  access.emit({ kind: "create", path: "copy.md" });
  await index.rebuild();
  assert.equal(index.identity("stable-id").kind, "collision");

  access.files.set("copy.md", "- [ ] Same text without an ID");
  access.emit({ kind: "modify", path: "copy.md" });
  await index.rebuild();
  assert.equal(index.identity("stable-id").kind, "unique");
  index.dispose();
});

test("index bounds fail closed without publishing a partial winner", async () => {
  const access = new MemoryAccess();
  access.files.set("a.md", "a ^one");
  access.files.set("b.md", "b ^two");
  const index = new WorkspaceIndex(access, {
    limits: { maxMarkdownFiles: 1, maxMarkdownBytes: 100, maxBlockIds: 10, maxClockRecords: 10 },
  });
  const result = await index.rebuild();
  assert.equal(result.complete, false);
  assert.equal(result.reason, "markdown-file-limit");
  assert.equal(index.identity("one").kind, "unavailable");
  index.dispose();
});

test("CLOCK safety index finds canonical IDs globally and gates potential-running records by unique owner", async () => {
  const access = new MemoryAccess();
  access.files.set("outside.md", `moved CLOCK: [2026-08-28 Fri 09:15:42.137 +08:00] ^${CLOCK}`);
  access.files.set("valid.md", [
    "<!-- nautilus-log:plan/v1 -->",
    `- [ ] Unique ^${OWNER}`,
    "  - LOGBOOK::",
    "    - CLOCK: [2026-08-28 10:10]",
    "<!-- /nautilus-log:plan -->",
  ].join("\n"));
  access.files.set("collision.md", [
    `- [ ] Duplicate owner ^${OWNER}`,
    "  - LOGBOOK::",
    "    - CLOCK: [2026-08-28 11:10]",
  ].join("\n"));

  const index = new WorkspaceIndex(access);
  const result = await index.rebuild();
  assert.equal(result.complete, true);
  assert.equal(result.clocks.some((entry) => entry.clockId === CLOCK && entry.path === "outside.md"), true);
  assert.equal(result.potentialRunning.length, 0, "colliding owner must not adopt legacy CLOCK text");

  access.files.delete("collision.md");
  access.emit({ kind: "delete", path: "collision.md" });
  const unique = await index.rebuild();
  assert.equal(unique.complete, true);
  assert.equal(unique.potentialRunning.length, 1);
  assert.equal(unique.potentialRunning[0]!.path, "valid.md");
  index.dispose();
});

test("CLOCK record limit leaves the safety generation incomplete", async () => {
  const access = new MemoryAccess();
  access.files.set("a.md", [
    `CLOCK: [2026-08-28 Fri 09:15:42.137 +08:00] ^${CLOCK}`,
    "CLOCK: [2026-08-28 Fri 09:16:42.137 +08:00] ^nl-clock-31a093da-375a-4d78-969e-c217974af30e",
  ].join("\n"));
  const index = new WorkspaceIndex(access, {
    limits: { maxMarkdownFiles: 20_000, maxMarkdownBytes: 2_147_483_648, maxBlockIds: 100, maxClockRecords: 1 },
  });
  const result = await index.rebuild();
  assert.equal(result.complete, false);
  assert.equal(result.reason, "clock-record-limit");
  assert.equal(result.clocks.length, 0);
  index.dispose();
});
