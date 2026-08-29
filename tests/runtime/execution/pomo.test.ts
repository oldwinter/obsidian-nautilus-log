import assert from "node:assert/strict";
import test from "node:test";

import { PomoController } from "../../../src/runtime/execution/pomo";
import { InMemoryPluginDataPort, PluginDataStore } from "../../../src/runtime/plugin-data";

async function harness(initial?: { task?: number | null; standalone?: number | null }) {
  const port = new InMemoryPluginDataPort(initial ? {
    schemaVersion: 1,
    settings: undefined,
    taskPomoStartEpochMs: initial.task ?? null,
    standalonePomoStartEpochMs: initial.standalone ?? null,
  } : undefined);
  const store = new PluginDataStore(port);
  await store.load();
  return { port, store, pomo: new PomoController(store) };
}

test("TC-UP-EXE-10-001 standalone POMO starts only while CLOCK and POMO are absent", async () => {
  const { store, pomo } = await harness();
  await pomo.startStandalone(1_000, false);
  assert.equal(store.data.standalonePomoStartEpochMs, 1_000);
});

test("TC-UP-EXE-10-002 standalone POMO start performs no duplicate persistence", async () => {
  const { port, pomo } = await harness();
  await pomo.startStandalone(1_000, false);
  await pomo.startStandalone(2_000, false);
  assert.equal(port.saveCount, 1);
});

test("TC-UP-EXE-10-003 a running CLOCK suppresses standalone start", async () => {
  const { port, store, pomo } = await harness();
  await pomo.startStandalone(1_000, true);
  assert.equal(store.data.standalonePomoStartEpochMs, null);
  assert.equal(port.saveCount, 0);
});

test("TC-UP-EXE-10-004 standalone elapsed clamps negative values and crosses threshold", async () => {
  const { pomo } = await harness();
  await pomo.startStandalone(1_000, false);
  assert.equal(pomo.project(false, 500, 1).elapsedMs, 0);
  assert.equal(pomo.project(false, 61_000, 1).overThreshold, true);
});

test("TC-UP-EXE-10-005 standalone stop clears only plugin data", async () => {
  const { store, pomo } = await harness();
  await pomo.startStandalone(1_000, false);
  await pomo.stopStandalone();
  assert.equal(store.data.standalonePomoStartEpochMs, null);
});

test("TC-UP-EXE-11-001 refresh restores absolute standalone POMO start", async () => {
  const { store, pomo } = await harness({ standalone: 1_000 });
  await pomo.restore();
  assert.equal(store.data.standalonePomoStartEpochMs, 1_000);
});

test("TC-UP-EXE-11-002 confirmed Clock In replaces standalone with task POMO", async () => {
  const { store, pomo } = await harness({ standalone: 500 });
  await pomo.afterClockIn(1_000);
  assert.deepEqual([store.data.taskPomoStartEpochMs, store.data.standalonePomoStartEpochMs], [1_000, null]);
});

test("TC-UP-EXE-11-003 task POMO survives task switches", async () => {
  const { store, pomo } = await harness({ task: 500 });
  await pomo.afterClockIn(2_000);
  assert.equal(store.data.taskPomoStartEpochMs, 500);
});

test("TC-UP-EXE-11-004 CLOCK wins reload and clears stale standalone state", async () => {
  const { store, pomo } = await harness({ standalone: 500 });
  await pomo.restore(1_000);
  assert.deepEqual([store.data.taskPomoStartEpochMs, store.data.standalonePomoStartEpochMs], [1_000, null]);
});

test("TC-UP-EXE-11-005 Clock Out clears task POMO without creating standalone POMO", async () => {
  const { store, pomo } = await harness({ task: 500 });
  await pomo.clearTask();
  assert.deepEqual([store.data.taskPomoStartEpochMs, store.data.standalonePomoStartEpochMs], [null, null]);
});

test("reload replaces an impossible future task POMO with the authoritative CLOCK start", async () => {
  const { store, pomo } = await harness({ task: 20_000 });
  await pomo.restore(1_000, 10_000);
  assert.equal(store.data.taskPomoStartEpochMs, 1_000);
});

test("TC-UP-CLK-08-001 first confirmed task CLOCK starts its POMO cycle", async () => {
  const { store, pomo } = await harness();
  await pomo.afterClockIn(1_000);
  assert.equal(store.data.taskPomoStartEpochMs, 1_000);
});

test("TC-UP-CLK-08-002 reselecting focus preserves task POMO without another save", async () => {
  const { port, store, pomo } = await harness({ task: 500 });
  await pomo.afterClockIn(1_000);
  assert.equal(store.data.taskPomoStartEpochMs, 500);
  assert.equal(port.saveCount, 0);
});

test("TC-UP-CLK-08-003 task POMO survives a seamless task switch", async () => {
  const { store, pomo } = await harness({ task: 500 });
  await pomo.afterClockIn(2_000);
  assert.equal(store.data.taskPomoStartEpochMs, 500);
});

test("TC-UP-CLK-08-004 confirmed Clock Out clears task POMO", async () => {
  const { store, pomo } = await harness({ task: 500 });
  await pomo.clearTask();
  assert.equal(store.data.taskPomoStartEpochMs, null);
});

test("TC-UP-CLK-08-005 POMO threshold changes projection only and never clears time", async () => {
  const { store, pomo } = await harness({ task: 500 });
  const projection = pomo.project(true, 60_500, 1);
  assert.equal(projection.overThreshold, true);
  assert.equal(store.data.taskPomoStartEpochMs, 500);
});
