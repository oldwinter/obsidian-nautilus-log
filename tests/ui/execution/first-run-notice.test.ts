import assert from "node:assert/strict";
import test from "node:test";

import { firstRunNoticeKey } from "../../../src/adapters/notices";
import { enExecution } from "../../../src/i18n/locales/en/execution";
import { zhCNExecution } from "../../../src/i18n/locales/zh-CN/execution";

test("first-run ribbon notice names Review only after Execution Layer is on", () => {
  assert.equal(firstRunNoticeKey(false), "notice.firstRun");
  assert.equal(firstRunNoticeKey(true), "notice.firstRunExecution");
  assert.equal(enExecution["notice.firstRun"].includes("Review"), false);
  assert.equal(zhCNExecution["notice.firstRun"].includes("回顾"), false);
  assert.match(enExecution["notice.firstRunExecution"], /Review \(today\)/);
  assert.match(zhCNExecution["notice.firstRunExecution"], /回顾（今天）/);
});
