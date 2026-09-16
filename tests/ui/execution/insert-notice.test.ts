import assert from "node:assert/strict";
import test from "node:test";

import { insertPrimaryPlanNoticeKey } from "../../../src/adapters/insert-primary-plan";
import { enPlanner } from "../../../src/i18n/locales/en/planner";
import { zhCNPlanner } from "../../../src/i18n/locales/zh-CN/planner";

test("Insert notices distinguish invalid path from a file blocking a folder", () => {
  assert.equal(
    insertPrimaryPlanNoticeKey({ kind: "blocked", reason: "invalid-path" }),
    "status.missingInvalidPath",
  );
  assert.equal(
    insertPrimaryPlanNoticeKey({ kind: "blocked", reason: "folder-conflict" }),
    "status.missingFolderConflict",
  );
  assert.notEqual(
    enPlanner["status.missingFolderConflict"],
    enPlanner["status.missingInvalidPath"],
  );
  assert.match(enPlanner["status.missingFolderConflict"], /file is blocking a folder/);
  assert.match(zhCNPlanner["status.missingFolderConflict"], /文件挡住了需要的文件夹/);
  assert.match(enPlanner["status.missingInvalidPath"], /path is invalid/);
});

test("already-present Insert notice names Copy sample task", () => {
  assert.equal(
    insertPrimaryPlanNoticeKey({ kind: "already-present", path: "2026-09-16.md" }),
    "status.missingAlreadyPresent",
  );
  assert.match(enPlanner["status.missingAlreadyPresent"], /Copy sample task/);
  assert.match(zhCNPlanner["status.missingAlreadyPresent"], /复制示例任务/);
});
