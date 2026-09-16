import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { locatePrimaryPath, primaryNavigationMessageKey } from "../../../src/adapters/locate-primary";
import { enExecution } from "../../../src/i18n/locales/en/execution";
import { zhCNExecution } from "../../../src/i18n/locales/zh-CN/execution";

test("Locate Primary uses today's resolved path when the plan is still missing", () => {
  assert.equal(locatePrimaryPath("Daily/2026-09-16.md", "ignored.md"), "Daily/2026-09-16.md");
  assert.equal(locatePrimaryPath(undefined, "Journal/2026-09-16.md"), "Journal/2026-09-16.md");
  assert.equal(locatePrimaryPath(undefined, null), null);
});

test("Locate Primary notices distinguish a missing note from a missing plan", () => {
  assert.equal(primaryNavigationMessageKey("primary-plan-missing"), "error.noPrimary");
  assert.equal(primaryNavigationMessageKey("primary-source-missing"), "error.missingDailyNote");
  assert.equal(primaryNavigationMessageKey("source-file-missing"), "notice.sourceUnavailable");
  assert.equal(primaryNavigationMessageKey("no-block-id"), "error.noBlockId");
  assert.match(enExecution["error.noBlockId"], /Clock In from the Plan tab/);
  assert.equal(enExecution["error.noBlockId"].includes("UID"), false);
  assert.match(zhCNExecution["error.noBlockId"], /「计划」标签点「开始计时」/);
  assert.equal(zhCNExecution["error.noBlockId"].includes("UID"), false);
  assert.match(enExecution["error.noPrimary"], /Insert into today's Daily Note/);
  assert.match(enExecution["error.missingDailyNote"], /does not exist yet/);
  assert.match(enExecution["error.missingDailyNote"], /the Plan tab/);
  assert.match(zhCNExecution["error.noPrimary"], /写入今日日记/);
  assert.match(zhCNExecution["error.missingDailyNote"], /还不存在/);
  assert.match(zhCNExecution["error.missingDailyNote"], /「计划」标签/);
});

test("Locate Primary opens the resolved Daily Note path when the snapshot is missing", async () => {
  const [main, navigation] = await Promise.all([
    readFile("src/main.ts", "utf8"),
    readFile("src/adapters/source-navigation.ts", "utf8"),
  ]);
  assert.match(main, /locatePrimaryPath\(/);
  assert.match(main, /#resolvedTodayPath\(\)/);
  assert.match(main, /primaryNavigationMessageKey\(code\)/);
  assert.match(navigation, /primary-source-missing/);
});
