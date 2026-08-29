import assert from "node:assert/strict";
import test from "node:test";

import { projectClockIndex } from "../../../src/runtime/execution/clock-index";
import type { IndexedClockSource, WorkspaceIndexSnapshot } from "../../../src/workspace/identity-index";

function running(ownerId = "task-a", startEpochMs = 1_000, clockId = "nl-clock-00000000-0000-4000-8000-000000000001"): IndexedClockSource {
  return Object.freeze({
    path: "Daily/2026-08-29.md",
    fromOffset: 10,
    toOffset: 20,
    text: "CLOCK",
    ownerId,
    clockId,
    scope: "accepted-logbook",
    parsed: Object.freeze({
      kind: "record",
      record: Object.freeze({ format: "canonical", state: "running", startEpochMs, clockId }),
      diagnostics: Object.freeze([]),
    }),
  });
}

function potential(ownerId = "task-a"): IndexedClockSource {
  return Object.freeze({
    path: "Daily/2026-08-29.md",
    fromOffset: 30,
    toOffset: 40,
    text: "CLOCK: [broken",
    ownerId,
    scope: "accepted-logbook",
    parsed: Object.freeze({
      kind: "malformed",
      potentialRunning: true,
      diagnostics: Object.freeze([{ code: "invalid-clock-syntax" } as const]),
    }),
  });
}

function snapshot(input: Partial<WorkspaceIndexSnapshot> = {}): WorkspaceIndexSnapshot {
  return Object.freeze({
    generation: 1,
    complete: true,
    markdownFiles: 1,
    markdownBytes: 100,
    blockIds: 1,
    clocks: Object.freeze([]),
    running: Object.freeze([]),
    potentialRunning: Object.freeze([]),
    ...input,
  });
}

const eligible = async (clock: IndexedClockSource) => ({ state: "eligible" as const, ownerId: clock.ownerId });

test("TC-UP-CLK-04-001 one eligible running CLOCK resumes without startup writes", async () => {
  const clock = running();
  const state = await projectClockIndex(snapshot({ clocks: [clock], running: [clock] }), eligible);
  assert.deepEqual({ kind: state.kind, ownerId: state.kind === "active" ? state.ownerId : undefined }, { kind: "active", ownerId: "task-a" });
});

test("TC-UP-CLK-04-002 zero running CLOCKs yields Idle", async () => {
  assert.equal((await projectClockIndex(snapshot(), eligible)).kind, "idle");
});

test("TC-UP-CLK-04-003 multiple running CLOCKs stay read-only degraded", async () => {
  const clocks = [running("task-a", 1_000), running("task-b", 2_000, "nl-clock-00000000-0000-4000-8000-000000000002")];
  const state = await projectClockIndex(snapshot({ clocks, running: clocks }), eligible);
  assert.deepEqual(state.kind === "degraded" ? [state.code, state.count] : [], ["multiple-running-clocks", 2]);
});

test("TC-UP-CLK-04-004 malformed potential CLOCKs stay read-only degraded", async () => {
  const malformed = potential();
  const state = await projectClockIndex(snapshot({ clocks: [malformed], potentialRunning: [malformed] }), eligible);
  assert.equal(state.kind === "degraded" ? state.code : undefined, "potential-running-clock");
});

test("TC-UP-CLK-04-005 DONE missing ineligible duplicate and stale owners never auto-repair", async () => {
  for (const ownerState of ["done", "missing", "ineligible", "collision", "stale"] as const) {
    const clock = running();
    const state = await projectClockIndex(
      snapshot({ clocks: [clock], running: [clock] }),
      () => ({ state: ownerState, ownerId: "task-a" }),
    );
    assert.equal(state.kind, "degraded", ownerState);
  }
});

test("an incomplete safety index fails closed with its bounded reason", async () => {
  const state = await projectClockIndex(snapshot({ complete: false, reason: "clock-record-limit" }), eligible);
  assert.deepEqual(state.kind === "degraded" ? [state.code, state.reason] : [], ["clock-index-unavailable", "clock-record-limit"]);
});
