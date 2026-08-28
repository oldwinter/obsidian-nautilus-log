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
  reads = 0;
  onRead: ((path: string, readNumber: number) => void) | undefined;
  #listeners = new Set<(change: SourceChange) => void>();

  async listMarkdownPaths(): Promise<readonly string[]> {
    return [...this.files.keys()];
  }

  async readText(path: string): Promise<string | undefined> {
    this.reads += 1;
    this.onRead?.(path, this.reads);
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

test("GRI-16/17 identity index adopts every terminal ID and never chooses a collision winner", async () => {
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

test("identity and canonical CLOCK indexes ignore frontmatter and indented code", async () => {
  const access = new MemoryAccess();
  access.files.set("syntax.md", [
    "---",
    "fake: value ^frontmatter-id",
    `clock: CLOCK: [2026-08-28 Fri 09:15:42.137 +08:00] ^${CLOCK}`,
    "---",
    "    indented code ^code-id",
    `    CLOCK: [2026-08-28 Fri 09:15:42.137 +08:00] ^${CLOCK}`,
    "<div>",
    "html ^html-id",
    `CLOCK: [2026-08-28 Fri 09:15:42.137 +08:00] ^${CLOCK}`,
    "</div>",
    "",
    "- parent",
    "  - nested ^nested-id",
    "    ```md",
    "    fenced ^nested-fenced-id",
    "    ```",
    "> ```md",
    "> quoted code ^quoted-code-id",
    `> CLOCK: [2026-08-28 Fri 09:15:42.137 +08:00] ^${CLOCK}`,
    "> ```",
    "",
    "        nested code ^nested-code-id",
    "- indented code parent",
    "",
    "      first literal code line",
    "      <div>",
    "      later literal code ^later-code-id",
    `      CLOCK: [2026-08-28 Fri 09:15:42.137 +08:00] ^${CLOCK}`,
    "- code parent",
    "",
    "      ```md",
    "- next ^after-indented-fence",
    "paragraph ^real-id",
    "- ```md",
    "  list fenced ^list-fenced-id",
    "  ```",
    "- <div>",
    "  list html ^list-html-id",
    "  </div>",
    "",
    "# reset list context",
    "",
    "    <div>",
    "paragraph ^after-top-code-html",
    "| column |",
    "| --- |",
    "| value ^table-cell-id",
    "standalone ^after-table-id",
  ].join("\n"));
  const index = new WorkspaceIndex(access);

  const snapshot = await index.rebuild();
  assert.equal(snapshot.complete, true);
  assert.equal(index.identity("frontmatter-id").kind, "missing");
  assert.equal(index.identity("code-id").kind, "missing");
  assert.equal(index.identity("html-id").kind, "missing");
  assert.equal(index.identity("nested-code-id").kind, "missing");
  assert.equal(index.identity("later-code-id").kind, "missing");
  assert.equal(index.identity("list-fenced-id").kind, "missing");
  assert.equal(index.identity("list-html-id").kind, "missing");
  assert.equal(index.identity("nested-fenced-id").kind, "missing");
  assert.equal(index.identity("quoted-code-id").kind, "missing");
  assert.equal(index.identity("nested-id").kind, "unique");
  assert.equal(index.identity("after-indented-fence").kind, "unique");
  assert.equal(index.identity("real-id").kind, "unique");
  assert.equal(index.identity("after-top-code-html").kind, "unique");
  assert.equal(index.identity("table-cell-id").kind, "missing");
  assert.equal(index.identity("after-table-id").kind, "unique");
  assert.equal(snapshot.clocks.length, 0);
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

test("GRI-15/16 identity follows edits and moves while copied IDs collide", async () => {
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

test("source invalidation cancels a rebuild before the next file read", async () => {
  const access = new MemoryAccess();
  access.files.set("a.md", "a ^one");
  access.files.set("b.md", "b ^two");
  const index = new WorkspaceIndex(access);
  access.onRead = (path, readNumber) => {
    if (readNumber === 1) access.emit({ kind: "modify", path });
  };

  const result = await index.rebuild();
  assert.equal(result.complete, false);
  assert.equal(result.reason, "source-changed");
  assert.equal(access.reads, 1);
  index.dispose();
});

test("an aborted rebuild is cancelled before any Markdown read", async () => {
  const access = new MemoryAccess();
  access.files.set("a.md", "a ^one");
  const index = new WorkspaceIndex(access);
  const controller = new AbortController();
  controller.abort();

  const result = await index.rebuild(controller.signal);
  assert.equal(result.complete, false);
  assert.equal(result.reason, "cancelled");
  assert.equal(access.reads, 0);
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

test("one canonical LOGBOOK CLOCK is deduplicated before the exact record limit", async () => {
  const access = new MemoryAccess();
  access.files.set("a.md", [
    "<!-- nautilus-log:plan/v1 -->",
    `- [ ] Owner ^${OWNER}`,
    "  - LOGBOOK::",
    `    - CLOCK: [2026-08-28 Fri 09:15:42.137 +08:00] ^${CLOCK}`,
    "<!-- /nautilus-log:plan -->",
  ].join("\n"));
  const index = new WorkspaceIndex(access, {
    limits: { maxMarkdownFiles: 1, maxMarkdownBytes: 10_000, maxBlockIds: 10, maxClockRecords: 1 },
  });
  const result = await index.rebuild();
  assert.equal(result.complete, true);
  assert.equal(result.clocks.length, 1);
  index.dispose();
});

test("one large-file rebuild yields so AbortSignal can cancel within the scan", async () => {
  const access = new MemoryAccess();
  access.files.set("large.md", Array.from({ length: 300_000 }, (_, index) => `line ${index}`).join("\n"));
  const index = new WorkspaceIndex(access, {
    limits: {
      maxMarkdownFiles: 1,
      maxMarkdownBytes: 10_000_000,
      maxBlockIds: 10,
      maxClockRecords: 10,
    },
  });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 0);
  const result = await index.rebuild(controller.signal);
  assert.equal(result.complete, false);
  assert.equal(result.reason, "cancelled");
  index.dispose();
});

test("newline-dense rebuilds also yield so AbortSignal can cancel", async () => {
  const access = new MemoryAccess();
  access.files.set("newlines.md", "\n".repeat(1_000_000));
  const index = new WorkspaceIndex(access, {
    limits: {
      maxMarkdownFiles: 1,
      maxMarkdownBytes: 10_000_000,
      maxBlockIds: 10,
      maxClockRecords: 10,
    },
  });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 0);
  const result = await index.rebuild(controller.signal);
  assert.equal(result.complete, false);
  assert.equal(result.reason, "cancelled");
  index.dispose();
});

test("large ordinary Markdown without a Plan Region remains indexable", async () => {
  const access = new MemoryAccess();
  access.files.set("large-ordinary.md", `${"x".repeat(2 * 1024 * 1024 + 1)}\nordinary ^large-id`);
  const index = new WorkspaceIndex(access, {
    limits: {
      maxMarkdownFiles: 1,
      maxMarkdownBytes: 3 * 1024 * 1024,
      maxBlockIds: 10,
      maxClockRecords: 10,
    },
  });
  const result = await index.rebuild();
  assert.equal(result.complete, true);
  assert.equal(index.identity("large-id").kind, "unique");
  index.dispose();
});

test("dense over-limit Plan input leaves the CLOCK safety index incomplete", async () => {
  const access = new MemoryAccess();
  const items = Array.from({ length: 1_001 }, (_, index) => `- item ${index}`).join("\n");
  access.files.set("dense.md", `<!-- nautilus-log:plan/v1 -->\n${items}\n<!-- /nautilus-log:plan -->`);
  const index = new WorkspaceIndex(access);
  const result = await index.rebuild();
  assert.equal(result.complete, false);
  assert.equal(result.reason, "structured-input-limit");
  index.dispose();
});

test("GRI-19 a cleared index rebuilds identical identities exclusively from Markdown", async () => {
  const access = new MemoryAccess();
  access.files.set("a.md", "task ^stable");
  const index = new WorkspaceIndex(access);
  const first = await index.rebuild();
  const identity = index.identity("stable");
  index.clear();
  const second = await index.rebuild();
  assert.equal(first.complete, true);
  assert.equal(second.complete, true);
  assert.deepEqual(index.identity("stable"), identity);
  assert.deepEqual(access.writes, []);
  index.dispose();
});
