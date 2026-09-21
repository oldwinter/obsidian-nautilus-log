import assert from "node:assert/strict";
import test from "node:test";

import { recentTaskClockInIntent, type ExecutionRecentTask } from "../../../src/ui/execution/timing-view";

const task: ExecutionRecentTask = Object.freeze({
  key: "Daily/2026-08-29.md#task-1",
  ownerId: "nl-11111111-1111-4111-8111-111111111111",
  path: "Daily/2026-08-29.md",
  sourceOrder: 2,
  label: "Review the release note",
  actualMinutes: 18,
});

test("recent task resume targets the stable owner and preserves source location", () => {
  assert.deepEqual(recentTaskClockInIntent(task, 123_000), {
    type: "clock-in",
    intentId: "clock-in-recent-nl-11111111-1111-4111-8111-111111111111-123000",
    target: {
      path: "Daily/2026-08-29.md",
      ownerId: "nl-11111111-1111-4111-8111-111111111111",
      sourceOrder: 2,
      sourceFingerprint: "identified-target",
    },
  });
});
