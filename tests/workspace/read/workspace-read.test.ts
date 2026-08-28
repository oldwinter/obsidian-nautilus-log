import assert from "node:assert/strict";
import test from "node:test";

import {
  readWorkspacePlan,
  type WorkspaceReadLimits,
} from "../../../src/workspace/read.ts";
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

test("GRI-04 workspace read is deterministic, zero-write, byte-preserving, and invokes Grammar v1 once", async () => {
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

  const second = await readWorkspacePlan(
    access,
    { year: 2026, month: 8, day: 28 },
    { folder: "Journal", format: "YYYY/MM/YYYY-MM-DD" },
  );
  assert.deepEqual(second, result);
  assert.deepEqual(access.reads, [path, path]);
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

test("workspace read discards an adapter result cancelled while readText is in flight", async () => {
  const controller = new AbortController();
  const access: TextAccess = {
    async listMarkdownPaths() { return []; },
    async readText() {
      controller.abort();
      return undefined;
    },
    onChange() { return () => undefined; },
  };
  const result = await readWorkspacePlan(
    access,
    { year: 2026, month: 8, day: 28 },
    { folder: "", format: "YYYY-MM-DD" },
    {},
    { signal: controller.signal },
  );
  assert.deepEqual(result, { ok: false, reason: "cancelled", path: "2026-08-28.md" });
});

test("UP-DRF-03/04 and GRI-08 no literal prefix or reference expansion is required", async () => {
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

test("GRI-06/07/09/10/11 workspace candidates retain #18 semantic ownership", async () => {
  const path = "2026-08-28.md";
  const source = `${OPEN}\n- marker-free 30m\n- [ ] invalid 24:00-01:00 then 9-10 45m\n- [x] fixed 9-10 60m d50%\n${CLOSE}`;
  const result = await readWorkspacePlan(
    readonlyAccess(path, source),
    { year: 2026, month: 8, day: 28 },
    { folder: "", format: "YYYY-MM-DD" },
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.grammar.items.map((item) => [
    item.status,
    item.kind,
    item.executionEligible,
    item.durationMinutes,
    item.label,
  ]), [
    ["plain", "flexible-task", false, 30, "marker-free"],
    ["open", "flexible-task", true, 45, "invalid 24:00-01:00 then 9-10"],
    ["done", "fixed-event", false, 60, "fixed"],
  ]);
});

test("GRI-18 read-side contribution never materializes an identity", async () => {
  const path = "2026-08-28.md";
  const source = `${OPEN}\n- [ ] anonymous 15m\n${CLOSE}\n`;
  const access = readonlyAccess(path, source);
  const result = await readWorkspacePlan(
    access,
    { year: 2026, month: 8, day: 28 },
    { folder: "", format: "YYYY-MM-DD" },
  );
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.sourceText, source);
    assert.equal(result.candidates[0]!.source.blockId, undefined);
  }
  assert.deepEqual(access.reads, [path]);
});

test("GRI-20 /v1 dispatch stays versioned and unsupported versions never fall back", async () => {
  for (const [opening, supported] of [[OPEN, true], [OPEN.replace("v1", "v2"), false]] as const) {
    const path = "2026-08-28.md";
    const source = `${opening}\n- [ ] item 30m\n${CLOSE}`;
    const result = await readWorkspacePlan(
      readonlyAccess(path, source),
      { year: 2026, month: 8, day: 28 },
      { folder: "", format: "YYYY-MM-DD" },
    );
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.grammar.supported, supported);
      assert.equal(result.grammar.items.length, supported ? 1 : 0);
    }
  }
});

test("workspace read fails closed at every local planning boundary", async () => {
  const configuration = { folder: "", format: "YYYY-MM-DD" };
  const date = { year: 2026, month: 8, day: 28 };
  const limits: WorkspaceReadLimits = {
    maxActiveNoteBytes: 200,
    maxPlanRegionBytes: 80,
    maxPlanItems: 2,
    maxPlanItemBytes: 40,
    maxListDepth: 2,
  };
  const cases = [
    {
      kind: "active-note-bytes",
      source: "x".repeat(201),
      limits,
    },
    {
      kind: "plan-region-bytes",
      source: `${OPEN}\n${"x".repeat(81)}\n${CLOSE}`,
      limits,
    },
    {
      kind: "plan-items",
      source: `${OPEN}\n- one\n- two\n- three\n${CLOSE}`,
      limits,
    },
    {
      kind: "plan-item-bytes",
      source: `${OPEN}\n- ${"x".repeat(41)}\n${CLOSE}`,
      limits,
    },
    {
      kind: "list-depth",
      source: `${OPEN}\n- root\n  - child\n    - grandchild\n${CLOSE}`,
      limits,
    },
  ] as const;

  for (const entry of cases) {
    const result = await readWorkspacePlan(
      readonlyAccess("2026-08-28.md", entry.source),
      date,
      configuration,
      {},
      { limits: entry.limits },
    );
    assert.equal(result.ok, false, entry.kind);
    if (!result.ok) {
      assert.equal(result.reason, "input-limit", entry.kind);
      if (result.reason === "input-limit") assert.equal(result.kind, entry.kind);
    }
  }
});

test("dense Plan discovery stops at the first item beyond the default bound", async () => {
  const denseItems = Array.from({ length: 50_000 }, (_, index) => `- item ${index}`).join("\n");
  const source = `${OPEN}\n${denseItems}\n${CLOSE}`;
  const result = await readWorkspacePlan(
    readonlyAccess("2026-08-28.md", source),
    { year: 2026, month: 8, day: 28 },
    { folder: "", format: "YYYY-MM-DD" },
  );
  assert.equal(result.ok, false);
  if (!result.ok && result.reason === "input-limit") {
    assert.equal(result.kind, "plan-items");
    assert.equal(result.actual, 1_001);
    assert.equal(result.limit, 1_000);
  }
});
