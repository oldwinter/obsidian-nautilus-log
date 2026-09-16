import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import test from "node:test";

const IMAGES = [
  "01-enable-plugin.png",
  "02-settings-first-run.png",
  "03-open-planner-ribbon.png",
  "04-daily-note-markers.png",
  "05-planner-empty-guidance.png",
  "06-planner-scheduled-day.png",
  "07-enable-execution.png",
  "08-timing-idle.png",
  "09-plan-tab.png",
  "10-review-tab.png",
  "11-active-task.png",
  "12-daily-loop.png",
];

test("user-guide screenshots exist and are non-empty", async () => {
  for (const name of IMAGES) {
    const info = await stat(`docs/user-guide/images/${name}`);
    assert.ok(info.isFile(), name);
    assert.ok(info.size > 1_000, `${name} is too small`);
  }
});
