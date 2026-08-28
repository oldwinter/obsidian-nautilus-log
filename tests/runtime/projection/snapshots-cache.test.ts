import assert from "node:assert/strict";
import test from "node:test";

import {
  CLOCK_FALLBACK_TTL_MILLISECONDS,
  ClockFallbackCache,
  DisposableLruCache,
  type CacheDisposalReason,
} from "../../../src/runtime/cache.ts";
import {
  confirmedSnapshot,
  createProjectionRevision,
  errorSnapshot,
  hiddenSnapshot,
  isRevisionNewer,
  loadingSnapshot,
  missingSnapshot,
  overLimitSnapshot,
  staleSnapshot,
  type ProjectionRevisionInput,
  type RuntimeSnapshot,
} from "../../../src/runtime/snapshots.ts";

function revision(generation: number, overrides: Partial<ProjectionRevisionInput> = {}) {
  return createProjectionRevision({
    generation,
    path: "Journal\\2026/./2026-08-28.md",
    sourceFingerprint: "sha256:source-a",
    settingsVersion: 4,
    logicalDate: { year: 2026, month: 8, day: 28 },
    minuteBucket: 29_799_000,
    timeZone: "Asia/Shanghai",
    grammarVersion: "v1",
    ...overrides,
  });
}

test("OBS-LIFE-001 contribution: derived LRU cache is bounded, disposable, and clearable", () => {
  const disposed: Array<readonly [string, string, CacheDisposalReason]> = [];
  const cache = new DisposableLruCache<string, string>({
    maxEntries: 2,
    maxWeight: 5,
    weightOf: (value) => value.length,
    dispose: (value, key, reason) => disposed.push([key, value, reason]),
  });

  assert.equal(cache.set("a", "aa"), true);
  assert.equal(cache.set("b", "bb"), true);
  assert.equal(cache.get("a"), "aa");
  assert.equal(cache.set("c", "cc"), true);
  assert.deepEqual(cache.keys(), ["a", "c"]);
  assert.deepEqual(disposed, [["b", "bb", "evicted"]]);

  assert.equal(cache.set("a", "A"), true);
  assert.deepEqual(cache.keys(), ["c", "a"]);
  assert.deepEqual(disposed.at(-1), ["a", "aa", "replaced"]);
  assert.equal(cache.set("too-heavy", "123456"), false);
  assert.equal(cache.has("too-heavy"), false);
  assert.equal(cache.totalWeight, 3);

  assert.equal(cache.deleteWhere((_value, key) => key === "c"), 1);
  cache.clear();
  assert.equal(cache.size, 0);
  assert.equal(cache.totalWeight, 0);
  assert.deepEqual(disposed.slice(-2), [
    ["c", "cc", "deleted"],
    ["a", "A", "cleared"],
  ]);
});

test("OBS-LIFE-001 contribution: cache remains empty even when a disposer reports failure", () => {
  const disposed: string[] = [];
  const cache = new DisposableLruCache<string, string>({
    maxEntries: 3,
    dispose: (value) => {
      disposed.push(value);
      if (value === "first") throw new Error("dispose failed");
    },
  });
  cache.set("a", "first");
  cache.set("b", "second");

  assert.throws(() => cache.clear(), /dispose failed/);
  assert.deepEqual(disposed, ["first", "second"]);
  assert.equal(cache.size, 0);
  assert.equal(cache.totalWeight, 0);
});

test("UP-INS-04 fallback CLOCK cache expires at 15 seconds without sliding", () => {
  const cache = new ClockFallbackCache<string, { readonly running: boolean }>(2);
  const observedAt = 10_000;
  const facts = Object.freeze({ running: true });
  cache.set("today", facts, observedAt);

  assert.equal(cache.get("today", observedAt), facts);
  assert.equal(
    cache.get("today", observedAt + CLOCK_FALLBACK_TTL_MILLISECONDS - 1),
    facts,
  );
  assert.equal(
    cache.get("today", observedAt + CLOCK_FALLBACK_TTL_MILLISECONDS),
    undefined,
  );
  assert.equal(cache.size, 0);
});

test("UP-INS-04 fallback CLOCK cache fails closed on wall-clock reversal and stays bounded", () => {
  const cache = new ClockFallbackCache<string, number>(2);
  cache.set("a", 1, 1_000);
  assert.equal(cache.get("a", 999), undefined);

  cache.set("a", 1, 1_000);
  cache.set("b", 2, 1_000);
  assert.equal(cache.get("a", 1_001), 1);
  cache.set("c", 3, 1_001);
  assert.equal(cache.get("b", 1_001), undefined);
  assert.equal(cache.get("a", 1_001), 1);
  assert.equal(cache.get("c", 1_001), 3);
  cache.clear();
  assert.equal(cache.size, 0);
});

test("issue #21 revisions normalize complete metadata and compare generation only", () => {
  const first = revision(7);
  const second = revision(8, {
    sourceFingerprint: "sha256:source-b",
    minuteBucket: first.minuteBucket + 1,
  });

  assert.equal(first.path, "Journal/2026/2026-08-28.md");
  assert.deepEqual(first.logicalDate, { year: 2026, month: 8, day: 28 });
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.logicalDate), true);
  assert.equal(isRevisionNewer(second, first), true);
  assert.equal(isRevisionNewer(first, second), false);
  assert.equal(isRevisionNewer(first, first), false);
});

test("issue #21 confirmed snapshots are detached deeply immutable data without source text", () => {
  const projection = {
    title: "Today",
    schedule: [{ label: "Write proposal", minutes: [30, 45] }],
  };
  const snapshot = confirmedSnapshot(revision(10), projection, {
    code: "projection.warning",
    retry: "event",
    context: { count: 1 },
  });

  projection.title = "mutated";
  projection.schedule[0]!.label = "changed";
  projection.schedule[0]!.minutes.push(60);
  assert.deepEqual(snapshot.projection, {
    title: "Today",
    schedule: [{ label: "Write proposal", minutes: [30, 45] }],
  });
  assert.notEqual(snapshot.projection, projection);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.projection), true);
  assert.equal(Object.isFrozen(snapshot.projection.schedule), true);
  assert.equal(Object.isFrozen(snapshot.projection.schedule[0]!.minutes), true);
  assert.equal(Reflect.set(snapshot.projection, "title", "write"), false);
  assert.equal(snapshot.authoritative, true);
  assert.equal(snapshot.mutationCapability, null);

  assert.throws(
    () => confirmedSnapshot(revision(11), { source: { firstLineText: "raw Markdown" } }),
    /exposes source material/,
  );
  assert.throws(
    () => confirmedSnapshot(revision(11), { sourceText: "whole note" }),
    /exposes source material/,
  );
  assert.throws(
    () => confirmedSnapshot(revision(11), {
      tokens: { segmentIndex: 0, fromOffset: 1, toOffset: 2 },
    }),
    /exposes source material/,
  );
});

test("issue #21 every non-confirmed snapshot fails closed and stale drops projection", () => {
  const confirmed = confirmedSnapshot(revision(20), { rows: [{ id: "task-a" }] });
  const diagnostic = {
    code: "runtime.read-failed",
    retry: "event" as const,
    context: { path: confirmed.revision.path },
  };
  const snapshots: readonly RuntimeSnapshot[] = [
    loadingSnapshot(revision(21)),
    staleSnapshot(confirmed, revision(21), "read-failed"),
    missingSnapshot(revision(21)),
    overLimitSnapshot(revision(21), { kind: "plan-items", actual: 1_001, limit: 1_000 }),
    errorSnapshot(revision(21), diagnostic),
    hiddenSnapshot(revision(21)),
  ];

  for (const snapshot of snapshots) {
    assert.equal(snapshot.authoritative, false, snapshot.state);
    assert.equal(snapshot.mutationCapability, null, snapshot.state);
    assert.equal("projection" in snapshot, false, snapshot.state);
    assert.equal(Object.isFrozen(snapshot), true, snapshot.state);
  }
  assert.equal(snapshots[1]!.state, "stale");
  assert.equal(snapshots[5]!.state, "hidden");
  if (snapshots[5]!.state === "hidden") assert.equal(snapshots[5]!.dirty, true);
  assert.equal(Object.isFrozen(diagnostic.context), false);
  assert.notEqual(snapshots[4]!.diagnostic, diagnostic);
  assert.equal(Object.isFrozen(snapshots[4]!.diagnostic), true);
  assert.throws(() => staleSnapshot(confirmed, revision(19)), /older generation/);
});

test("issue #21 snapshot builders reject incomplete or unsafe revision/context data", () => {
  assert.throws(() => revision(-1), /generation/);
  assert.throws(() => revision(1, { path: "../outside.md" }), /vault-relative/);
  assert.throws(() => revision(1, { sourceFingerprint: "" }), /sourceFingerprint/);
  assert.throws(
    () => revision(1, { logicalDate: { year: 2026, month: 2, day: 30 } }),
    /logicalDate/,
  );
  assert.throws(
    () => errorSnapshot(revision(1), {
      code: "runtime.error",
      retry: "none",
      context: { sourceText: "raw" },
    }),
    /exposes source material/,
  );
  assert.throws(
    () => errorSnapshot(revision(1), {
      code: "runtime.error",
      retry: "none",
      context: { duration: Number.POSITIVE_INFINITY },
    }),
    /finite scalar/,
  );
});
