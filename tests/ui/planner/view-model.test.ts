import assert from "node:assert/strict";
import test from "node:test";

import {
  confirmedSnapshot,
  createProjectionRevision,
  errorSnapshot,
  hiddenSnapshot,
  loadingSnapshot,
  missingSnapshot,
  overLimitSnapshot,
  staleSnapshot,
} from "../../../src/runtime/snapshots.ts";
import { plannerLayoutForWidth } from "../../../src/ui/planner/responsive-layout.ts";
import { plannerSurfaceStateModel } from "../../../src/ui/planner/view.ts";
import { DISPLAYED_DATE, plannerProjection } from "./fixtures.ts";

function revision(generation: number) {
  return createProjectionRevision({
    generation,
    path: "Journal/2026-08-28.md",
    sourceFingerprint: "sha256:fixture",
    settingsVersion: 1,
    logicalDate: DISPLAYED_DATE,
    minuteBucket: 1,
    timeZone: "Asia/Shanghai",
    grammarVersion: "v1",
  });
}

test("TC-UP-INS-03-001 every frozen non-confirmed state stays fail-closed", () => {
  const confirmed = confirmedSnapshot(revision(1), plannerProjection());
  const states = [
    loadingSnapshot(revision(2)),
    missingSnapshot(revision(2)),
    overLimitSnapshot(revision(2), { kind: "plan-items", actual: 1_001, limit: 1_000 }),
    errorSnapshot(revision(2), { code: "read-failed", retry: "explicit" }),
    staleSnapshot(confirmed, revision(2), "invalidated"),
    hiddenSnapshot(revision(2)),
  ];
  for (const snapshot of states) {
    const model = plannerSurfaceStateModel(snapshot, plannerLayoutForWidth(900));
    assert.equal(model.authoritative, false);
    assert.equal(model.mutationEnabled, false);
    assert.deepEqual(model.hierarchy, ["status"]);
  }
});

test("TC-UP-VIS-01-002 confirmed hierarchy remains flat and Spiral-first", () => {
  const snapshot = confirmedSnapshot(revision(3), plannerProjection());
  const wide = plannerSurfaceStateModel(snapshot, plannerLayoutForWidth(900));
  assert.deepEqual(wide.hierarchy, [
    "capacity-controls-legend",
    "spiral",
    "overflow",
    "warnings",
  ]);
  const compact = plannerSurfaceStateModel(snapshot, plannerLayoutForWidth(520));
  assert.deepEqual(compact.hierarchy, [
    "capacity-controls-legend",
    "spiral",
    "overview",
    "schedule",
    "overflow",
    "warnings",
  ]);
});

test("UP-INS-03 runtime-unavailable model embeds no recovery mutation", () => {
  const model = plannerSurfaceStateModel(undefined, plannerLayoutForWidth(900));
  assert.equal(model.state, "runtime-unavailable");
  assert.equal(model.mutationEnabled, false);
  assert.match(model.message, /not ready/);
});
