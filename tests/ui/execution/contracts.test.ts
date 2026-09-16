import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { enExecution } from "../../../src/i18n/locales/en/execution";
import { zhCNExecution } from "../../../src/i18n/locales/zh-CN/execution";
import { createMessages, defineLocaleNamespace } from "../../../src/i18n/resolver";
import type { PlanItem } from "../../../src/core/model";
import type { ExecutionApplicationSnapshot } from "../../../src/runtime/execution/application";
import type { RuntimePlanItemSource } from "../../../src/runtime/projection-runtime";
import { activeTaskSurfaceMode } from "../../../src/ui/execution/active-task-view";
import { isCurrentExecutionItem } from "../../../src/ui/execution/plan-view";

function snapshot(
  overrides: Partial<ExecutionApplicationSnapshot> = {},
): ExecutionApplicationSnapshot {
  return {
    status: "ready",
    standalonePomoStartEpochMs: null,
    ...overrides,
  } as ExecutionApplicationSnapshot;
}

test("execution locale catalogs have exact keys and switch without fallback", () => {
  assert.deepEqual(Object.keys(enExecution).sort(), Object.keys(zhCNExecution).sort());
  const messages = createMessages({
    locale: "en",
    namespaces: { execution: defineLocaleNamespace("execution", enExecution, zhCNExecution) },
  });
  assert.equal(messages.t("execution", "tab.timing"), "Timing");
  assert.equal(messages.t("execution", "surface.identity"), "Spiral Day");
  assert.equal(messages.t("execution", "error.generic"), "Spiral Day could not complete that action.");
  assert.match(messages.t("execution", "error.noPrimary"), /No Primary Plan was found today/);
  assert.match(messages.t("execution", "error.noPrimary"), /Insert into today's Daily Note/);
  assert.match(messages.t("execution", "error.missingDailyNote"), /does not exist yet/);
  assert.equal(messages.t("execution", "plan.noPrimary"), "No Primary Plan was found today.");
  assert.equal(messages.setLocale("zh"), true);
  assert.equal(messages.t("execution", "tab.timing"), "计时");
  assert.equal(messages.t("execution", "surface.identity"), "Spiral Day");
  assert.equal(messages.t("execution", "error.generic"), "Spiral Day 无法完成该操作。");
  assert.match(messages.t("execution", "error.noPrimary"), /今天没有找到主计划/);
  assert.match(messages.t("execution", "error.noPrimary"), /写入今日日记/);
  assert.match(messages.t("execution", "error.missingDailyNote"), /还不存在/);
  assert.equal(messages.t("execution", "plan.noPrimary"), "今天没有找到主计划。");
  assert.equal(messages.t("execution", "error.focusTodo").length > 0, true);
});

test("locale refresh updates static execution panel controls", async () => {
  const panel = await readFile("src/ui/execution/panel.ts", "utf8");
  for (const staticControl of [
    'identity.textContent = options.messages.t("execution", "surface.identity")',
    'close.setAttribute("aria-label", closeLabel)',
    'tabs.setLabel("timing", options.messages.t("execution", "tab.timing"))',
    'tabs.setLabel("plan", options.messages.t("execution", "tab.plan"))',
    'tabs.setLabel("review", options.messages.t("execution", "tab.review"))',
  ]) assert.equal(panel.includes(staticControl), true, staticControl);
  assert.match(panel, /if \(opened\) place\(\)/);
});

test("execution panel remembers the last tab while preserving explicit opens", async () => {
  const panel = await readFile("src/ui/execution/panel.ts", "utf8");
  assert.match(panel, /let lastTab: ExecutionPanelTab = options\.initialTab \?\? "timing"/);
  assert.match(panel, /onChange: \(name\) => \{\s*lastTab = name;\s*render\(\);\s*\}/);
  assert.match(panel, /tabs\.select\(tab \?\? lastTab, false\)/);
});

test("non-button ribbon triggers expose keyboard activation and focus return", async () => {
  const panel = await readFile("src/ui/execution/panel.ts", "utf8");
  assert.match(panel, /trigger\.setAttribute\("role", "button"\)/);
  assert.match(panel, /trigger\.tabIndex = 0/);
  assert.match(panel, /trigger\.setAttribute\("aria-controls", popover\.id\)/);
  assert.match(panel, /trigger\.setAttribute\("aria-haspopup", "dialog"\)/);
  assert.match(panel, /execution\.focused\.label/);
  assert.match(panel, /event\.key !== "Enter" && event\.key !== " "/);
  assert.match(panel, /if \(restoreFocus\) trigger\.focus\(\)/);
});

test("active task surface distinguishes idle, standalone POMO, active, and unavailable", () => {
  assert.equal(activeTaskSurfaceMode(snapshot()), "idle");
  assert.equal(activeTaskSurfaceMode(snapshot({ standalonePomoStartEpochMs: 1_000 })), "pomo");
  assert.equal(activeTaskSurfaceMode(snapshot({ focused: {} as never })), "active");
  assert.equal(activeTaskSurfaceMode(snapshot({ status: "degraded" })), "unavailable");
  assert.equal(activeTaskSurfaceMode(snapshot({ status: "stopped", focused: {} as never })), "unavailable");
});

test("plan marks only the exact focused task as current", () => {
  const focused = {
    ownerId: "task-1",
    path: "Daily/2026-08-30.md",
    sourceOrder: 2,
  } as NonNullable<ExecutionApplicationSnapshot["focused"]>;
  const item = {
    source: { path: focused.path, blockId: focused.ownerId, sourceOrder: focused.sourceOrder },
  } as PlanItem<RuntimePlanItemSource>;
  const execution = snapshot({ focused });
  assert.equal(isCurrentExecutionItem(item, execution), true);
  assert.equal(isCurrentExecutionItem({
    source: { ...item.source, sourceOrder: 3 },
  } as PlanItem<RuntimePlanItemSource>, execution), false);
  assert.equal(isCurrentExecutionItem({
    source: { ...item.source, blockId: "task-2" },
  } as PlanItem<RuntimePlanItemSource>, execution), false);
});

test("delete confirmation expires and clears its armed visual state", async () => {
  const panel = await readFile("src/ui/execution/panel.ts", "utf8");
  assert.match(panel, /const DELETE_CONFIRMATION_WINDOW_MS = 2_500/);
  assert.match(panel, /popover\.dataset\.deleteArmed = "true"/);
  assert.match(panel, /setTimeout\(\(\) => \{/);
  assert.match(panel, /clearDeleteActivation\(true\)/);
});

test("execution styles cover interaction states and the build discovers every styles CSS file", async () => {
  const [styles, build] = await Promise.all([
    readFile("styles/execution.css", "utf8"),
    readFile("esbuild.config.mjs", "utf8"),
  ]);
  for (const selector of [
    ".spiral-day-execution__tabpanel",
    ".spiral-day-execution__tab[aria-selected=\"true\"]",
    ".spiral-day-active-task-view",
    ".spiral-day-execution-pomo-stop[hidden]",
    ".spiral-day-execution[data-delete-armed=\"true\"]",
    "max-width: calc(100vw - 24px)",
    ".theme-dark .spiral-day-execution-trigger",
    "button[aria-busy=\"true\"]",
    "@media (pointer: coarse)",
    "@media (prefers-reduced-motion: reduce)",
    "@media (forced-colors: active)",
  ]) assert.equal(styles.includes(selector), true, selector);
  assert.match(build, /listFiles\("styles", \(file\) => path\.extname\(file\) === "\.css"\)/);
  assert.doesNotMatch(build, /readText\("styles\/(?:planner|execution|review)\.css"\)/);
});

test("standalone POMO keeps a dedicated ribbon stop action", async () => {
  const entry = await readFile("src/adapters/execution-entry.ts", "utf8");
  assert.match(entry, /addRibbonIcon\(\s*"x",\s*this\.#dependencies\.messages\.t\("execution", "action\.stopPomo"\)/);
  assert.match(entry, /type: "stop-standalone-pomo"/);
  assert.match(entry, /snapshot\.focused !== undefined \|\| snapshot\.standalonePomoStartEpochMs === null/);
});

test("elapsed timers update in place without replacing focused controls", async () => {
  const [panel, activeTask] = await Promise.all([
    readFile("src/ui/execution/panel.ts", "utf8"),
    readFile("src/adapters/active-task-view.ts", "utf8"),
  ]);
  assert.match(panel, /setInterval\(\(\) => updateElapsed\(\), 1_000\)/);
  assert.doesNotMatch(panel, /setInterval\(\(\) => render\(\), 1_000\)/);
  assert.match(activeTask, /setInterval\(\(\) => this\.#tick\(\), 1_000\)/);
  assert.doesNotMatch(activeTask, /setInterval\(\(\) => this\.#render\(\), 1_000\)/);
});

test("plan refresh preserves the unscheduled disclosure state", async () => {
  const planView = await readFile("src/ui/execution/plan-view.ts", "utf8");
  assert.match(planView, /querySelector<HTMLDetailsElement>\("\.spiral-day-execution__unscheduled"\)/);
  assert.match(planView, /unscheduled\.open = unscheduledOpen/);
});

test("plan omits the redundant clock-in action for the current task", async () => {
  const planView = await readFile("src/ui/execution/plan-view.ts", "utf8");
  assert.match(planView, /const current = isCurrentExecutionItem\(item, options\.execution\)/);
  assert.match(planView, /if \(!current\) \{[\s\S]*?type: "clock-in"/);
  assert.match(planView, /row\.dataset\.current = String\(current\)/);
});

test("active task surface uses explicit commands instead of a focusable article shortcut", async () => {
  const activeTask = await readFile("src/ui/execution/active-task-view.ts", "utf8");
  assert.doesNotMatch(activeTask, /article\.tabIndex/);
  assert.doesNotMatch(activeTask, /keyboardHint/);
  assert.match(activeTask, /className: "spiral-day-active-task__action spiral-day-active-task__open"/);
});

test("unavailable and working execution states disable mutation controls", async () => {
  const [timingView, planView] = await Promise.all([
    readFile("src/ui/execution/timing-view.ts", "utf8"),
    readFile("src/ui/execution/plan-view.ts", "utf8"),
  ]);
  assert.match(timingView, /snapshot\.status === "degraded"/);
  assert.match(timingView, /snapshot\.writeBlocked/);
  assert.match(planView, /pending \|\| options\.execution\.writeBlocked/);
});

test("timing recovery exposes a guarded localized retry without a mutation intent", async () => {
  const [panel, timingView, main, execution] = await Promise.all([
    readFile("src/ui/execution/panel.ts", "utf8"),
    readFile("src/ui/execution/timing-view.ts", "utf8"),
    readFile("src/main.ts", "utf8"),
    readFile("src/i18n/locales/en/execution.ts", "utf8"),
  ]);
  assert.match(panel, /readonly refresh: \(\) => Promise<ExecutionApplicationSnapshot>/);
  assert.match(panel, /if \(pending\.has\("refresh"\) \|\| destroyed\) return/);
  assert.match(panel, /Promise\.resolve\(\)\.then\(\(\) => port\.refresh\(\)\)/);
  assert.match(panel, /pending\.add\("refresh"\)/);
  assert.match(panel, /pending\.delete\("refresh"\)/);
  assert.match(timingView, /messages\.t\("execution", "action\.retry"\)/);
  assert.match(timingView, /icon: "refresh"/);
  assert.match(timingView, /options\.pending\.has\("refresh"\)/);
  assert.match(main, /refresh: \(\) => application\.refresh\(\)/);
  assert.match(execution, /"notice\.refreshed": string/);
});

test("active Timing exposes the singleton Active Task view without coupling it to a mutation", async () => {
  const [panel, timingView, main] = await Promise.all([
    readFile("src/ui/execution/panel.ts", "utf8"),
    readFile("src/ui/execution/timing-view.ts", "utf8"),
    readFile("src/main.ts", "utf8"),
  ]);
  assert.match(panel, /openActiveTask: \(\) => void Promise\.resolve\(port\.openActiveTask\(\)\)/);
  assert.match(timingView, /messages\.t\("execution", "action\.openActiveTask"\)/);
  assert.match(timingView, /actions\.append\(openActiveTask, clockOut, complete, remove\)/);
  assert.match(main, /openActiveTask: async \(\) => \{\s*await openActiveTaskView\(this\.app\);/);
});

test("Active Task copy links use an explicit accessible action in narrow sidebars", async () => {
  const [surface, activeTask, styles, main] = await Promise.all([
    readFile("src/ui/execution/active-task-view.ts", "utf8"),
    readFile("src/adapters/active-task-view.ts", "utf8"),
    readFile("styles/execution.css", "utf8"),
    readFile("src/main.ts", "utf8"),
  ]);
  assert.match(surface, /messages\.t\("execution", "action\.copyTaskLink"\)/);
  assert.match(surface, /className: "spiral-day-active-task__action spiral-day-active-task__copy"/);
  assert.doesNotMatch(surface, /article\.addEventListener\("keydown"/);
  assert.match(activeTask, /"notice\.taskLinkCopied" : "error\.copyTaskLink"/);
  assert.match(styles, /\.spiral-day-active-task__actions \{\s*display: flex;\s*gap: 6px;/);
  assert.match(styles, /@media \(pointer: coarse\)[\s\S]*?\.spiral-day-active-task__action \{[\s\S]*?height: 44px;/);
  assert.match(main, /copyLink: \(target, label\) => copyTaskMarkdownLink\(\{/);
});

test("Active Task clocks out through the guarded execution path", async () => {
  const [surface, activeTask, styles, main] = await Promise.all([
    readFile("src/ui/execution/active-task-view.ts", "utf8"),
    readFile("src/adapters/active-task-view.ts", "utf8"),
    readFile("styles/execution.css", "utf8"),
    readFile("src/main.ts", "utf8"),
  ]);
  assert.match(surface, /messages\.t\("execution", "action\.clockOut"\)/);
  assert.match(surface, /className: "spiral-day-active-task__action spiral-day-active-task__clock-out"/);
  assert.match(surface, /clockOut\.disabled = options\.snapshot\.writeBlocked/);
  assert.match(activeTask, /this\.#clockOutPending \|\| this\.#snapshot\.writeBlocked \|\| !this\.#snapshot\.focused/);
  assert.match(activeTask, /button\.setAttribute\("aria-busy", "true"\)/);
  assert.match(activeTask, /Promise\.resolve\(\)\.then\(\(\) => this\.#dependencies\.clockOut\(\)\)/);
  assert.match(activeTask, /current\.focus\(\)/);
  assert.match(styles, /\.spiral-day-active-task__clock-out \{/);
  assert.match(styles, /:is\(\.spiral-day-execution, \.spiral-day-active-task\) button\[aria-busy="true"\]/);
  assert.match(main, /intentId: this\.#intentId\("active-task-clock-out"\)/);
});

test("Recent rebuilds after host invalidation and reaches the panel as a projected subscription", async () => {
  const [panel, main] = await Promise.all([
    readFile("src/ui/execution/panel.ts", "utf8"),
    readFile("src/main.ts", "utf8"),
  ]);
  assert.match(panel, /port\.subscribeRecent\(\(snapshot\) => \{/);
  assert.match(main, /snapshot\.state !== "dirty" \|\| this\.#historyRefreshQueued/);
  assert.match(main, /this\.#historyIndex\?\.snapshot\.state === "dirty"/);
  assert.match(main, /listener\(this\.#recentExecutionTasks\(\)\)/);
  assert.match(main, /new HistoryIndex\(this\.#atomicAccess\)/);
  assert.doesNotMatch(main, /new HistoryIndex\(this\.#atomicAccess, \{ identityIndex:/);
});
