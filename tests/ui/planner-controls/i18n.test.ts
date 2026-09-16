import assert from "node:assert/strict";
import test from "node:test";

import { enExecution } from "../../../src/i18n/locales/en/execution.ts";
import { enPlanner } from "../../../src/i18n/locales/en/planner.ts";
import { enReview } from "../../../src/i18n/locales/en/review.ts";
import { enShared } from "../../../src/i18n/locales/en/shared.ts";
import { zhCNExecution } from "../../../src/i18n/locales/zh-CN/execution.ts";
import { zhCNPlanner } from "../../../src/i18n/locales/zh-CN/planner.ts";
import { zhCNReview } from "../../../src/i18n/locales/zh-CN/review.ts";
import { zhCNShared } from "../../../src/i18n/locales/zh-CN/shared.ts";
import {
  MessageContractError,
  createMessages,
  defineLocaleNamespace,
} from "../../../src/i18n/resolver.ts";
import type { PlannerLimitKind } from "../../../src/i18n/types.ts";

test("TC-OBS-I18N-001-001 en and zh-CN shared/planner key sets are exactly equal", () => {
  assert.deepEqual(Object.keys(enShared).sort(), Object.keys(zhCNShared).sort());
  assert.deepEqual(Object.keys(enPlanner).sort(), Object.keys(zhCNPlanner).sort());
});

test("missing-plan copy names the required HTML markers in both locales", () => {
  assert.match(enPlanner["status.missingDetail"], /<!-- nautilus-log:plan\/v1 -->/);
  assert.match(enPlanner["status.missingDetail"], /<!-- \/nautilus-log:plan -->/);
  assert.match(zhCNPlanner["status.missingDetail"], /<!-- nautilus-log:plan\/v1 -->/);
  assert.match(zhCNPlanner["status.missingDetail"], /<!-- \/nautilus-log:plan -->/);
});

test("review overrun filter label matches the bilingual handbook", () => {
  assert.equal(enReview["filter.overruns"], "Only completed overruns");
  assert.equal(zhCNReview["filter.overruns"], "只看已完成的超时任务");
});

test("host chrome and empty-state copy stay bilingual after Review insert", () => {
  assert.equal(enPlanner["ribbon.openPlanner"], "Open Spiral Day");
  assert.equal(zhCNPlanner["ribbon.openPlanner"], "打开 Spiral Day");
  assert.equal(enExecution["command.focusCurrent"], "Spiral Day: 1. Clock in current task");
  assert.equal(zhCNExecution["command.focusCurrent"], "Spiral Day: 1. 开始计时当前任务");
  assert.equal(enExecution["command.focusCurrent"].includes("block"), false);
  assert.equal(zhCNExecution["command.focusCurrent"].includes("聚焦"), false);
  assert.equal(enExecution["command.clockOut"], "Spiral Day: 2. Clock out current task");
  assert.equal(zhCNExecution["command.clockOut"], "Spiral Day: 2. 结束计时当前任务");
  assert.equal(enExecution["command.clockOut"].includes("Timing Line"), false);
  assert.equal(zhCNExecution["command.clockOut"].includes("计时线"), false);
  assert.match(enExecution["settings.keepTimingFirst"], /Active Task/);
  assert.equal(enExecution["settings.keepTimingFirst"].includes("Timing Line"), false);
  assert.match(zhCNExecution["settings.keepTimingFirst"], /当前任务/);
  assert.equal(zhCNExecution["settings.keepTimingFirst"].includes("计时线"), false);
  assert.match(enExecution["error.sidebarOrder"], /Active Task/);
  assert.equal(enExecution["error.sidebarOrder"].includes("Timing Line"), false);
  assert.match(zhCNExecution["error.sidebarOrder"], /当前任务/);
  assert.equal(zhCNExecution["error.sidebarOrder"].includes("计时线"), false);
  assert.equal(enExecution["menu.clockIn"], "Spiral Day: Clock in");
  assert.equal(zhCNExecution["menu.clockIn"], "Spiral Day: 开始计时");
  assert.match(enExecution["notice.firstRun"], /Planner or Settings/);
  assert.equal(enExecution["notice.firstRun"].includes("Review"), false);
  assert.match(enExecution["notice.firstRun"], /plan starter/);
  assert.match(zhCNExecution["notice.firstRun"], /规划器或设置/);
  assert.equal(zhCNExecution["notice.firstRun"].includes("回顾"), false);
  assert.match(zhCNExecution["notice.firstRun"], /计划模板/);
  assert.match(enExecution["notice.firstRunExecution"], /Plan tab, or Review \(today\)/);
  assert.match(zhCNExecution["notice.firstRunExecution"], /「计划」标签或回顾（今天）/);
  assert.match(enReview["state.emptyPlan"], /no list items/);
  assert.match(enReview["state.emptyPlan"], /Copy sample task/);
  assert.match(zhCNReview["state.emptyPlan"], /还没有列表项/);
  assert.match(zhCNReview["state.emptyPlan"], /复制示例任务/);
  assert.match(enExecution["plan.emptyReady"], /no list items/);
  assert.match(enExecution["plan.emptyReady"], /Copy sample task/);
  assert.match(zhCNExecution["plan.emptyReady"], /还没有列表项/);
  assert.match(zhCNExecution["plan.emptyReady"], /复制示例任务/);
  assert.match(enPlanner["status.emptyPlan"], /no list items/);
  assert.match(enPlanner["status.emptyPlan"], /Copy sample task/);
  assert.equal(enPlanner["status.emptyCopySample"], "Copy sample task");
  assert.match(enPlanner["status.missingAlreadyPresent"], /Copy sample task/);
  assert.match(enPlanner["status.missingFolderConflict"], /file is blocking a folder/);
  assert.match(zhCNPlanner["status.emptyPlan"], /还没有列表项/);
  assert.match(zhCNPlanner["status.emptyPlan"], /复制示例任务/);
  assert.equal(zhCNPlanner["status.emptyCopySample"], "复制示例任务");
  assert.match(zhCNPlanner["status.missingAlreadyPresent"], /复制示例任务/);
  assert.match(zhCNPlanner["status.missingFolderConflict"], /文件挡住了需要的文件夹/);
  assert.match(enExecution["error.noPrimary"], /Insert into today's Daily Note/);
  assert.match(zhCNExecution["error.noPrimary"], /写入今日日记/);
  assert.match(enExecution["error.missingDailyNote"], /Insert into today's Daily Note/);
  assert.match(enExecution["error.missingDailyNote"], /the Plan tab/);
  assert.match(zhCNExecution["error.missingDailyNote"], /写入今日日记/);
  assert.match(zhCNExecution["error.missingDailyNote"], /「计划」标签/);
  assert.match(enExecution["error.noBlockId"], /Clock In from the Plan tab/);
  assert.equal(enExecution["error.noBlockId"].includes("UID"), false);
  assert.match(zhCNExecution["error.noBlockId"], /「计划」标签点「开始计时」/);
  assert.equal(zhCNExecution["error.noBlockId"].includes("UID"), false);
  assert.match(enExecution["plan.noPrimaryDetail"], /Insert into today's Daily Note/);
  assert.match(zhCNExecution["plan.noPrimaryDetail"], /写入今日日记/);
  assert.equal(enExecution["plan.noUnscheduled"], "Every open flexible task is already on the schedule.");
  assert.equal(zhCNExecution["plan.noUnscheduled"], "所有未完成的弹性任务都已排进日程。");
  assert.equal(zhCNExecution["plan.scheduled"], "已排期");
  assert.equal(zhCNExecution["plan.unscheduled"], "今日未排期");
  assert.equal(zhCNPlanner["summary.unscheduled"], "未排期");
  assert.match(zhCNPlanner["disclosure.overflow"]({ count: 1, duration: "30m" }), /今日未排期/);
  assert.equal(zhCNExecution["plan.scheduled"].includes("排程"), false);
  assert.equal(zhCNExecution["plan.unscheduled"].includes("排程"), false);
  assert.match(enExecution["plan.noTasks"], /Copy sample task/);
  assert.match(enExecution["plan.noTasks"], /`- \[ \]` flexible task/);
  assert.match(zhCNExecution["plan.noTasks"], /复制示例任务/);
  assert.match(zhCNExecution["plan.noTasks"], /`- \[ \]` 弹性任务/);
  assert.match(enReview["state.missingPlan"], /If this is today, use Insert into today's Daily Note/);
  assert.match(zhCNReview["state.missingPlan"], /如果是今天，请点「写入今日日记」/);
  assert.match(enReview["state.missingNote"], /If this is today, use Insert into today's Daily Note/);
  assert.match(zhCNReview["state.missingNote"], /如果是今天，请点「写入今日日记」/);
  assert.match(enExecution["timing.nextAction"], /If there is no Primary Plan yet, use Insert into today's Daily Note/);
  assert.match(enExecution["timing.nextAction"], /Copy sample task/);
  assert.match(zhCNExecution["timing.nextAction"], /如果还没有主计划，请先在「计划」标签点「写入今日日记」/);
  assert.match(zhCNExecution["timing.nextAction"], /复制示例任务/);
  assert.match(enExecution["error.focusTodo"], /Clock In from the Plan tab/);
  assert.equal(enExecution["error.focusTodo"].includes("TODO"), false);
  assert.match(zhCNExecution["error.focusTodo"], /「计划」标签点「开始计时」/);
  assert.match(enExecution["error.taskOwner"], /open `- \[ \]` flexible task/);
  assert.equal(enExecution["error.taskOwner"].includes("TODO"), false);
  assert.match(zhCNExecution["error.taskOwner"], /`- \[ \]` 弹性任务/);
  assert.match(enExecution["error.completeTask"], /open `- \[ \]` flexible task/);
  assert.equal(enExecution["error.completeTask"].includes("TODO"), false);
  assert.match(enExecution["notice.clockOutIdle"], /Clock In from the Plan tab/);
  assert.match(zhCNExecution["notice.clockOutIdle"], /「计划」标签点「开始计时」/);
  assert.match(enExecution["notice.clockInFocused"], /already being timed/);
  assert.match(enExecution["notice.clockInFocused"], /Clock Out from the Plan tab/);
  assert.match(zhCNExecution["notice.clockInFocused"], /已经在计时中/);
  assert.match(zhCNExecution["notice.clockInFocused"], /「计划」标签点「结束计时」/);
  assert.match(enExecution["error.unconfirmed"], /note change/);
  assert.equal(enExecution["error.unconfirmed"].includes("graph"), false);
  assert.match(zhCNExecution["error.unconfirmed"], /笔记更改/);
  assert.equal(zhCNExecution["error.unconfirmed"].includes("图谱"), false);
});

test("Daily Note settings describe the Insert path in both locales", () => {
  assert.match(enExecution["settings.dailyNoteFolderDesc"], /Insert creates and Planner reads/);
  assert.match(enExecution["settings.dailyNoteFolderDesc"], /last accepted value/);
  assert.match(zhCNExecution["settings.dailyNoteFolderDesc"], /写入今日日记/);
  assert.match(zhCNExecution["settings.dailyNoteFolderDesc"], /上次可用的值/);
  assert.match(enExecution["settings.dailyNoteFormatDesc"], /dddd are rejected/);
  assert.match(zhCNExecution["settings.dailyNoteFormatDesc"], /dddd/);
  assert.match(
    enExecution["settings.dailyNoteFormatHostIgnored"]({ format: "YYYY-MM-DD dddd" }),
    /was not copied/,
  );
  assert.match(
    zhCNExecution["settings.dailyNoteFormatHostIgnored"]({ format: "YYYY-MM-DD dddd" }),
    /没有复制/,
  );
  assert.match(enExecution["settings.componentPrefixDesc"], /does not change Markdown grammar/);
  assert.match(zhCNExecution["settings.componentPrefixDesc"], /不会改变 Markdown 语法/);
  assert.match(enExecution["settings.onboardingDetail"], /If you see No Primary Plan/);
  assert.match(enExecution["settings.onboardingDetail"], /explanation stays and Insert hides/);
  assert.equal(enExecution["settings.onboardingDetail"].includes("checklist stays here"), false);
  assert.match(zhCNExecution["settings.onboardingDetail"], /没有主计划/);
  assert.match(zhCNExecution["settings.onboardingDetail"], /会收起/);
  assert.equal(zhCNExecution["settings.onboardingDetail"].includes("这份清单仍会留在这里"), false);
  assert.match(enExecution["settings.onboardingExecution"], /Enable Execution Layer below/);
  assert.match(enExecution["settings.onboardingExecutionOn"], /Execution Layer is on/);
  assert.equal(enExecution["settings.onboardingExecutionOn"].includes("Enable Execution Layer below"), false);
  assert.match(zhCNExecution["settings.onboardingExecution"], /在下方启用执行层/);
  assert.match(zhCNExecution["settings.onboardingExecutionOn"], /执行层已启用/);
  assert.equal(zhCNExecution["settings.onboardingExecutionOn"].includes("在下方启用执行层"), false);
});

test("TC-UP-INS-03-001 bootstrap copy matches the independent English literals", () => {
  const messages = createMessages({ locale: "en" });
  assert.equal(enShared["status.loading"], "Loading Spiral Day...");
  assert.equal(messages.t("shared", "status.loading"), "Loading Spiral Day...");
  messages.setLocale("zh-CN");
  assert.equal(zhCNShared["status.loading"], "正在载入 Spiral Day...");
  assert.equal(messages.t("shared", "status.loading"), "正在载入 Spiral Day...");
  messages.setLocale("en");
  assert.equal(
    enShared["status.unavailable"],
    "Spiral Day is unavailable in this workspace. Enable the plugin and reload the view.",
  );
  assert.equal(
    messages.t("shared", "status.unavailable"),
    "Spiral Day is unavailable in this workspace. Enable the plugin and reload the view.",
  );
});

test("TC-UP-CTL-05-001 debug state copy matches the independent English literals", () => {
  const messages = createMessages({ locale: "en" });
  assert.equal(enPlanner["control.debugEnable"], "debug is off");
  assert.equal(enPlanner["announcement.debugOff"], "debug is off");
  assert.equal(messages.t("planner", "control.debugEnable"), "debug is off");
  assert.equal(enPlanner["control.debugDisable"], "debug is on");
  assert.equal(enPlanner["announcement.debugOn"], "debug is on");
  assert.equal(messages.t("planner", "control.debugDisable"), "debug is on");
});

test("TC-OBS-I18N-001-001 resolver keeps interpolation typed and falls back to English locale", () => {
  const messages = createMessages({ locale: "fr-FR" });
  assert.equal(messages.locale, "en");
  assert.equal(messages.t("shared", "unit.itemCount", { count: 2 }), "2 items");
  assert.equal(
    messages.t("planner", "announcement.progressRequested", { title: "Draft", percent: 20 }),
    "Draft progress requested at 20%.",
  );
  messages.setLocale("zh_Hans_CN");
  assert.equal(messages.locale, "zh-CN");
  assert.equal(messages.t("shared", "unit.itemCount", { count: 2 }), "2项");
});

test("TC-OBS-I18N-001-001 locale changes notify rerender subscribers without domain input", () => {
  const messages = createMessages();
  const locales: string[] = [];
  const unsubscribe = messages.subscribe((locale) => locales.push(locale));
  assert.equal(messages.setLocale("zh-CN"), true);
  assert.equal(messages.setLocale("zh-CN"), false);
  assert.equal(messages.setLocale("en-US"), true);
  unsubscribe();
  messages.setLocale("zh-CN");
  assert.deepEqual(locales, ["zh-CN", "en"]);
});

test("TC-OBS-I18N-001-001 every over-limit kind is localized without leaking internal keys", () => {
  const kinds: readonly PlannerLimitKind[] = [
    "active-note-bytes",
    "list-depth",
    "plan-item-bytes",
    "plan-items",
    "plan-region-bytes",
  ];
  const messages = createMessages();
  const english = kinds.map((kind) => messages.t("planner", "status.overLimitDetail", {
    actual: 11,
    kind,
    limit: 10,
  }));
  messages.setLocale("zh-CN");
  const chinese = kinds.map((kind) => messages.t("planner", "status.overLimitDetail", {
    actual: 11,
    kind,
    limit: 10,
  }));
  assert.equal(new Set(english).size, kinds.length);
  assert.equal(new Set(chinese).size, kinds.length);
  for (const [index, kind] of kinds.entries()) {
    assert.equal(chinese[index]!.includes(kind), false);
  }
});

test("missing-plan copy offers an explicit insert without rewriting on open", () => {
  assert.match(enPlanner["status.missingInsert"], /Insert into today's Daily Note/);
  assert.match(enPlanner["status.missingDetail"], /Opening Planner does not rewrite/);
  assert.match(enPlanner["status.missingStepNote"], /^Click Insert into today's Daily Note/);
  assert.match(enPlanner["status.missingStepMarkers"], /^Or paste the markers and sample task/);
  assert.equal(enPlanner["status.missingCopyMarkers"], "Copy plan starter");
  assert.match(zhCNPlanner["status.missingInsert"], /写入今日日记/);
  assert.match(zhCNPlanner["status.missingStepNote"], /^点「写入今日日记」/);
  assert.match(zhCNPlanner["status.missingStepMarkers"], /^或者把下面的标记和示例任务/);
  assert.equal(zhCNPlanner["status.missingCopyMarkers"], "复制计划模板");
  assert.match(zhCNPlanner["status.missingStepRefresh"], /刷新日程/);
});

test("TC-UP-ERR-09-001 missing-plan copy names the HTML markers and refresh step", () => {
  const open = "<!-- nautilus-log:plan/v1 -->";
  const close = "<!-- /nautilus-log:plan -->";
  const messages = createMessages({ locale: "en" });
  const english = messages.t("planner", "status.missingDetail");
  const englishRefresh = messages.t("planner", "status.missingStepRefresh");
  assert.match(english, /today's Daily Note/);
  assert.match(englishRefresh, /Refresh plan/);
  assert.equal(english.includes(open), true);
  assert.equal(english.includes(close), true);
  messages.setLocale("zh-CN");
  const chinese = messages.t("planner", "status.missingDetail");
  const chineseRefresh = messages.t("planner", "status.missingStepRefresh");
  assert.match(chinese, /今日日记/);
  assert.match(chineseRefresh, /刷新/);
  assert.equal(chinese.includes(open), true);
  assert.equal(chinese.includes(close), true);
});

test("TC-OBS-I18N-001-001 later equal execution/review namespaces register without changing base catalogs", () => {
  const execution = defineLocaleNamespace(
    "execution",
    Object.freeze({ "action.start": "Start" }),
    Object.freeze({ "action.start": "开始" }),
  );
  const review = defineLocaleNamespace(
    "review",
    Object.freeze({ "state.compared": ({ count }: { readonly count: number }) => `${count} compared` }),
    Object.freeze({ "state.compared": ({ count }: { readonly count: number }) => `已对比${count}项` }),
  );
  const messages = createMessages({ namespaces: { execution, review } });
  assert.equal(messages.t("execution", "action.start"), "Start");
  assert.equal(messages.t("review", "state.compared", { count: 3 }), "3 compared");
  messages.setLocale("zh-CN");
  assert.equal(messages.t("execution", "action.start"), "开始");
  assert.equal(messages.t("review", "state.compared", { count: 3 }), "已对比3项");
  assert.deepEqual(Object.keys(enPlanner).sort(), Object.keys(zhCNPlanner).sort());
});

test("TC-OBS-I18N-001-001 unequal later namespace keys fail closed", () => {
  const english = Object.freeze({ a: "A" });
  const chinese = Object.freeze({ b: "乙" }) as unknown as typeof english;
  assert.throws(
    () => defineLocaleNamespace("execution", english, chinese),
    MessageContractError,
  );
});

test("TC-OBS-I18N-001-001 later registration cannot replace core catalogs", () => {
  const replacement = defineLocaleNamespace(
    "planner-replacement",
    Object.freeze({ key: "replacement" }),
    Object.freeze({ key: "替换" }),
  );
  assert.throws(
    () => createMessages({ namespaces: { planner: replacement } }),
    /core message namespace cannot be replaced/,
  );
  assert.throws(
    () => defineLocaleNamespace(" ", Object.freeze({ key: "A" }), Object.freeze({ key: "甲" })),
    /must not be empty/,
  );
});

test("TC-OBS-I18N-001-001 registered catalogs are immutable snapshots", () => {
  const english: Record<string, string> = { state: "Ready" };
  const chinese: Record<string, string> = { state: "就绪" };
  const later = defineLocaleNamespace("later", english, chinese);
  english.state = "Mutated";
  delete chinese.state;
  const messages = createMessages({ namespaces: { later } });
  assert.equal(messages.t("later", "state"), "Ready");
  messages.setLocale("zh-CN");
  assert.equal(messages.t("later", "state"), "就绪");
});

test("TC-OBS-I18N-001-002 zero-argument message functions match their callable type", () => {
  const execution = defineLocaleNamespace(
    "execution",
    Object.freeze({ "status.ready": () => "Ready" }),
    Object.freeze({ "status.ready": () => "就绪" }),
  );
  const messages = createMessages({ namespaces: { execution } });
  assert.equal(messages.t("execution", "status.ready"), "Ready");
  messages.setLocale("zh-CN");
  assert.equal(messages.t("execution", "status.ready"), "就绪");
});

test("TC-OBS-I18N-001-002 defaulted message parameters still receive supplied interpolation", () => {
  const execution = defineLocaleNamespace(
    "execution",
    Object.freeze({
      "status.named": ({ name }: { readonly name: string } = { name: "fallback" }) => name,
    }),
    Object.freeze({
      "status.named": ({ name }: { readonly name: string } = { name: "后备" }) => name,
    }),
  );
  const messages = createMessages({ namespaces: { execution } });
  assert.equal(messages.t("execution", "status.named", { name: "Ada" }), "Ada");
  assert.equal(messages.t("execution", "status.named"), "fallback");
});

test("TC-OBS-I18N-001-002 callable dispatch follows typed arguments rather than Function.length", () => {
  const execution = defineLocaleNamespace(
    "execution",
    Object.freeze({
      "status.defaulted": ({ name }: { readonly name: string } = { name: "fallback" }) => name,
      "status.optional": (parameters?: { readonly name: string }) => parameters?.name ?? "missing",
      "status.required": ({ name }: { readonly name: string }) => name,
      "status.zero": () => "zero",
    }),
    Object.freeze({
      "status.defaulted": ({ name }: { readonly name: string } = { name: "后备" }) => name,
      "status.optional": (parameters?: { readonly name: string }) => parameters?.name ?? "缺失",
      "status.required": ({ name }: { readonly name: string }) => name,
      "status.zero": () => "零",
    }),
  );
  const messages = createMessages({ namespaces: { execution } });
  assert.equal(messages.t("execution", "status.zero"), "zero");
  assert.equal(messages.t("execution", "status.required", { name: "Ada" }), "Ada");
  assert.equal(messages.t("execution", "status.defaulted"), "fallback");
  assert.equal(messages.t("execution", "status.defaulted", { name: "Grace" }), "Grace");
  assert.equal(messages.t("execution", "status.optional"), "missing");
  assert.equal(messages.t("execution", "status.optional", { name: "Lin" }), "Lin");
});
