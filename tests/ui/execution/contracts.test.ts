import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { enExecution } from "../../../src/i18n/locales/en/execution";
import { zhCNExecution } from "../../../src/i18n/locales/zh-CN/execution";
import { createMessages, defineLocaleNamespace } from "../../../src/i18n/resolver";

test("execution locale catalogs have exact keys and switch without fallback", () => {
  assert.deepEqual(Object.keys(enExecution).sort(), Object.keys(zhCNExecution).sort());
  const messages = createMessages({
    locale: "en",
    namespaces: { execution: defineLocaleNamespace("execution", enExecution, zhCNExecution) },
  });
  assert.equal(messages.t("execution", "tab.timing"), "Timing");
  assert.equal(messages.setLocale("zh"), true);
  assert.equal(messages.t("execution", "tab.timing"), "计时");
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
