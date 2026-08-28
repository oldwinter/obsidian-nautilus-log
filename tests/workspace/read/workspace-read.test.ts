import assert from "node:assert/strict";
import test from "node:test";

import { readWorkspacePlan } from "../../../src/workspace/read.ts";
import type { TextAccess } from "../../../src/workspace/text-access.ts";

const OPEN = "<!-- nautilus-log:plan/v1 -->";
const CLOSE = "<!-- /nautilus-log:plan -->";

function readonlyAccess(path: string, content: string | undefined): TextAccess & { readonly reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    async listMarkdownPaths() {
      throw new Error("workspace plan reads do not scan the vault");
    },
    async readText(requestedPath) {
      reads.push(requestedPath);
      return requestedPath === path ? content : undefined;
    },
    onChange() {
      return () => undefined;
    },
  };
}

test("workspace read resolves one path, preserves bytes, and invokes Grammar v1 over candidates", async () => {
  const path = "Journal/2026/08/2026-08-28.md";
  const source = `prefix\r\n${OPEN}\r\n- [ ] Write [proposal](Other.md) 30m ^draft  \r\n- plain 9-10\r\n${CLOSE}\r\nsuffix`;
  const access = readonlyAccess(path, source);
  const result = await readWorkspacePlan(
    access,
    { year: 2026, month: 8, day: 28 },
    { folder: "Journal", format: "YYYY/MM/YYYY-MM-DD" },
  );

  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(access.reads, [path]);
  assert.equal(result.sourceText, source);
  assert.deepEqual(result.grammar.items.map(({ label, kind }) => [label, kind]), [
    ["Write proposal", "flexible-task"],
    ["plain", "fixed-event"],
  ]);
  assert.equal(result.candidates[0]!.source.version, result.sourceVersion);
});

test("workspace read fails closed for config and missing source without probing alternatives", async () => {
  const access = readonlyAccess("2026-08-28.md", undefined);
  const invalid = await readWorkspacePlan(access, { year: 2026, month: 8, day: 28 }, undefined);
  assert.deepEqual(invalid, {
    ok: false,
    reason: "daily-note-resolution",
    resolution: {
      ok: false,
      reason: "missing-config",
      message: "Daily Note configuration is required",
    },
  });
  assert.deepEqual(access.reads, []);

  const missing = await readWorkspacePlan(
    access,
    { year: 2026, month: 8, day: 28 },
    { folder: "", format: "YYYY-MM-DD" },
  );
  assert.deepEqual(missing, { ok: false, reason: "missing-source", path: "2026-08-28.md" });
  assert.deepEqual(access.reads, ["2026-08-28.md"]);
});

test("DRF-03/04 no literal Nautilus prefix or reference expansion is required", async () => {
  const path = "2026-08-28.md";
  const source = `${OPEN}\n- [ ] ordinary wrapper [[Nautilus Log]] 15m ^wrapper\n- [ ] ![[Other#^borrowed|45m]]\n${CLOSE}`;
  const result = await readWorkspacePlan(
    readonlyAccess(path, source),
    { year: 2026, month: 8, day: 28 },
    { folder: "", format: "YYYY-MM-DD" },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.grammar.items.map(({ label, durationMinutes }) => [label, durationMinutes]), [
    ["ordinary wrapper Nautilus Log", 15],
    ["45m", 15],
  ]);
  assert.deepEqual(result.candidates.map(({ source: item }) => item.blockId), ["wrapper", undefined]);
});
