import assert from "node:assert/strict";
import test from "node:test";

import {
  createSourceSpan,
  createSourceVersion,
  sourceSpanText,
} from "../../../src/workspace/source-version.ts";
import {
  MemoryTextAccess,
  SOURCE_CHANGE_KINDS,
  type SourceChange,
} from "../../../src/workspace/text-access.ts";

test("WSR-TEXT-001 creates immutable SHA-256 source versions without changing text", async () => {
  const content = "abc";
  const version = await createSourceVersion("Daily/2026-08-28.md", content);

  assert.deepEqual(version, {
    file: "Daily/2026-08-28.md",
    contentDigest: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    contentLength: 3,
  });
  assert.equal(Object.isFrozen(version), true);
  assert.equal(content, "abc");
});

test("WSR-TEXT-002 spans use half-open UTF-16 offsets and zero-based lines and columns", () => {
  const content = "a\ud83d\udca1\r\n\u03b2\nlast";
  const span = createSourceSpan(content, 1, 6);

  assert.deepEqual(span, {
    fromOffset: 1,
    toOffset: 6,
    fromLine: 0,
    fromColumn: 1,
    toLine: 1,
    toColumn: 1,
  });
  assert.equal(sourceSpanText(content, span), "\ud83d\udca1\r\n\u03b2");
  assert.equal(Object.isFrozen(span), true);

  assert.throws(() => createSourceSpan(content, -1, 1), /offset/i);
  assert.throws(() => createSourceSpan(content, 4, 3), /offset/i);
  assert.throws(() => createSourceSpan(content, 0, content.length + 1), /offset/i);
});

test("WSR-TEXT-003 MemoryTextAccess reads exact bytes and lists only normalized Markdown paths", async () => {
  const access = new MemoryTextAccess([
    ["z.md", "z\r\n"],
    ["nested\\a.md", "a\n"],
    ["asset.png", "binary sentinel"],
  ]);

  assert.deepEqual(await access.listMarkdownPaths(), ["nested/a.md", "z.md"]);
  assert.equal(await access.readText("nested/a.md"), "a\n");
  assert.equal(await access.readText("z.md"), "z\r\n");
  assert.equal(await access.readText("missing.md"), undefined);
  assert.deepEqual(await access.listMarkdownPaths(), ["nested/a.md", "z.md"]);
});

test("WSR-TEXT-004 normalizes and emits all six source invalidation event kinds", async () => {
  assert.deepEqual(SOURCE_CHANGE_KINDS, [
    "create",
    "modify",
    "delete",
    "rename",
    "editor",
    "cache",
  ]);

  const access = new MemoryTextAccess({ "today.md": "before" });
  const changes: SourceChange[] = [];
  const unsubscribe = access.onChange((change) => changes.push(change));

  access.create("created.md", "created");
  access.modify("created.md", "modified");
  access.setEditorText("today.md", "unsaved");
  access.notifyCacheChange("today.md");
  access.rename("created.md", "moved/created.md");
  access.delete("moved/created.md");

  assert.deepEqual(changes, [
    { kind: "create", path: "created.md" },
    { kind: "modify", path: "created.md" },
    { kind: "editor", path: "today.md" },
    { kind: "cache", path: "today.md" },
    { kind: "rename", path: "moved/created.md", oldPath: "created.md" },
    { kind: "delete", path: "moved/created.md" },
  ]);
  assert.equal(changes.every(Object.isFrozen), true);
  assert.equal(await access.readText("today.md"), "unsaved");
  assert.equal(await access.readText("moved/created.md"), undefined);

  unsubscribe();
  unsubscribe();
  access.notifyCacheChange("today.md");
  assert.equal(changes.length, 6);
});

test("WSR-TEXT-005 MemoryTextAccess fixture mutations fail closed", () => {
  const access = new MemoryTextAccess({ "one.md": "one" });

  assert.throws(() => access.create("one.md", "duplicate"), /already exists/i);
  assert.throws(() => access.modify("missing.md", "missing"), /does not exist/i);
  assert.throws(() => access.delete("missing.md"), /does not exist/i);
  assert.throws(() => access.rename("missing.md", "other.md"), /does not exist/i);
  assert.throws(() => access.rename("one.md", "one.md"), /same path/i);
  assert.throws(() => access.create("../outside.md", "outside"), /vault-relative/i);
});
