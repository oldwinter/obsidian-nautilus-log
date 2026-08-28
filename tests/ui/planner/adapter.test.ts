import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_PLANNER_LEAVES,
  PLANNER_VIEW_TYPE,
  SpiralDayPlannerView,
  openPlannerView,
} from "../../../src/adapters/planner-view.ts";

function fakeLeaf(date: { year: number; month: number; day: number }) {
  return {
    getViewState: () => ({ type: PLANNER_VIEW_TYPE, state: { logicalDate: date } }),
    setViewStateCalls: [] as unknown[],
    async setViewState(state: unknown) {
      this.setViewStateCalls.push(state);
    },
  };
}

test("UP-INS-03 four leaves are allowed and a fifth reveals an existing leaf", async () => {
  const leaves = Array.from({ length: MAX_PLANNER_LEAVES }, (_, index) =>
    fakeLeaf({ year: 2026, month: 8, day: 25 + index }));
  const calls = { getLeaf: 0, revealed: [] as unknown[], active: [] as unknown[] };
  const app = {
    workspace: {
      getLeavesOfType: () => leaves,
      getLeaf: () => {
        calls.getLeaf += 1;
        return fakeLeaf({ year: 2026, month: 8, day: 30 });
      },
      revealLeaf: async (leaf: unknown) => calls.revealed.push(leaf),
      setActiveLeaf: (leaf: unknown) => calls.active.push(leaf),
    },
  };
  const result = await openPlannerView(app as never, { year: 2026, month: 8, day: 27 });
  assert.equal(result.reused, true);
  assert.equal(result.leaf, leaves[2]);
  assert.equal(calls.getLeaf, 0);
  assert.deepEqual(calls.revealed, [leaves[2]]);
  assert.deepEqual(calls.active, [leaves[2]]);
});

test("UP-INS-03 invalid restored and default dates fail closed to a valid fallback", async () => {
  const leaf = fakeLeaf({ year: 2026, month: 8, day: 28 });
  let resolvedDate: unknown;
  const view = new SpiralDayPlannerView(leaf as never, {
    runtime: { state: "unloaded", connect: () => { throw new Error("not connected"); } },
    defaultLogicalDate: () => ({ year: 2026, month: 2, day: 31 }),
    resolveContext: (logicalDate) => {
      resolvedDate = logicalDate;
      return {
        logicalDate,
        bounds: { startMinutes: 300, endMinutes: 1_440 },
        hostContext: "main",
      };
    },
  });
  await view.setState({ logicalDate: { year: 2026, month: 13, day: 1 } }, {} as never);
  assert.deepEqual(resolvedDate, { year: 1970, month: 1, day: 1 });
});

test("UP-INS-03 requests below the cap open one new dockable view state", async () => {
  const created = fakeLeaf({ year: 2026, month: 8, day: 28 });
  const app = {
    workspace: {
      getLeavesOfType: () => [],
      getLeaf: () => created,
      revealLeaf: async () => {},
      setActiveLeaf: () => {},
    },
  };
  const result = await openPlannerView(app as never, { year: 2026, month: 8, day: 28 });
  assert.equal(result.reused, false);
  assert.deepEqual(created.setViewStateCalls, [{
    type: PLANNER_VIEW_TYPE,
    active: true,
    state: { logicalDate: { year: 2026, month: 8, day: 28 } },
  }]);
});
