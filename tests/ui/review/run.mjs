import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { access, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const { values } = parseArgs({
  options: {
    "source-root": { type: "string", default: process.cwd() },
    report: { type: "string" },
    executable: { type: "string" },
    help: { type: "boolean" },
  },
});

if (values.help) {
  console.log("PLAYWRIGHT_MODULE=/path/to/playwright node tests/ui/review/run.mjs --report /new/report.json [--source-root /candidate/repo] [--executable /path/to/chrome]");
  process.exit(0);
}

assert(values.report, "Review browser runner requires --report <new JSON path>");
const sourceRoot = await realpath(path.resolve(values["source-root"]));
const sourceRequire = createRequire(path.join(sourceRoot, "package.json"));
const { build } = sourceRequire("esbuild");
const reportPath = path.resolve(values.report);
assert(!existsSync(reportPath), `Review browser report already exists: ${reportPath}`);
await mkdir(path.dirname(reportPath), { recursive: true });
const screenshotRoot = path.join(path.dirname(reportPath), "screenshots");
await mkdir(screenshotRoot, { recursive: true });

const harnessRoot = path.dirname(fileURLToPath(import.meta.url));
const harnessPath = path.join(harnessRoot, "harness.ts");
const reviewStylePath = path.join(sourceRoot, "styles/review.css");
const productionPaths = [
  "src/adapters/review-entry.ts",
  "src/core/review.ts",
  "src/runtime/review/coordinator.ts",
  "src/ui/execution/review-row.ts",
  "src/ui/execution/review-view.ts",
  "src/i18n/locales/en/review.ts",
  "src/i18n/locales/zh-CN/review.ts",
  "styles/review.css",
];
for (const relative of productionPaths) await access(path.join(sourceRoot, relative));

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fileEvidence = async (absolutePath) => {
  const bytes = await readFile(absolutePath);
  return { bytes: bytes.length, sha256: sha256(bytes) };
};

const bundle = await build({
  absWorkingDir: sourceRoot,
  bundle: true,
  entryPoints: [harnessPath],
  format: "esm",
  logLevel: "silent",
  platform: "browser",
  plugins: [{
    name: "review-production-source",
    setup(esbuild) {
      esbuild.onResolve({ filter: /^@review-source\// }, (args) => ({
        path: path.join(sourceRoot, "src", args.path.slice("@review-source/".length)),
      }));
    },
  }],
  target: "es2022",
  write: false,
});
const javascript = bundle.outputFiles[0]?.contents;
assert(javascript, "Review browser harness bundle was empty");
const reviewCss = await readFile(reviewStylePath);
const baseCss = Buffer.from(`
  :root {
    --background-primary: #ffffff;
    --background-secondary: #f4f5f7;
    --background-modifier-border: #d4d8df;
    --color-orange: #ad4e00;
    --font-interface: Inter, ui-sans-serif, system-ui, sans-serif;
    --font-semibold: 650;
    --font-ui-small: 13px;
    --font-ui-smaller: 12px;
    --interactive-accent: #1668c7;
    --text-muted: #5e6875;
    --text-normal: #20262e;
  }
  * { box-sizing: border-box; letter-spacing: 0; }
  body { background: var(--background-secondary); color: var(--text-normal); font-family: var(--font-interface); margin: 0; min-height: 100vh; }
  main { margin: 0 auto; max-width: 760px; padding: 24px 18px 40px; }
  .harness-heading { font-size: 18px; margin: 0 0 12px; }
  #review-root { background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 6px; min-width: 0; padding: 14px; }
  button, input { color: inherit; font: inherit; }
  button { background: var(--background-primary); border: 1px solid var(--background-modifier-border); border-radius: 4px; padding: 4px 8px; }
  button:disabled { cursor: not-allowed; opacity: 0.55; }
  @media (max-width: 420px) { main { padding: 10px; } #review-root { padding: 10px; } }
`);
const html = Buffer.from(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Spiral Day Review Browser Harness</title>
  <link rel="stylesheet" href="/harness.css">
</head>
<body>
  <main>
    <h1 class="harness-heading">Review</h1>
    <section id="review-root" aria-label="Review test surface"></section>
  </main>
  <script type="module" src="/harness.js"></script>
</body>
</html>`);

const require = createRequire(import.meta.url);
const playwrightModule = process.env.PLAYWRIGHT_MODULE || "playwright";
const { chromium } = require(playwrightModule);
const packageJson = require(path.join(playwrightModule, "package.json"));
const bundledExecutable = chromium.executablePath();
const systemChrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const requestedExecutable = values.executable ? path.resolve(values.executable) : undefined;
const executable = [requestedExecutable, bundledExecutable, systemChrome].find((candidate) => candidate && existsSync(candidate));
assert(executable, "No Chromium executable is available; pass --executable explicitly");

const report = {
  schemaVersion: 1,
  evidenceClass: "real-chromium-review-ui-adapter-regression",
  status: "running",
  startedAt: new Date().toISOString(),
  sourceRoot,
  runner: {
    node: process.version,
    playwright: packageJson.version,
    files: {
      "tests/ui/review/harness.ts": await fileEvidence(harnessPath),
      "tests/ui/review/run.mjs": await fileEvidence(new URL(import.meta.url)),
    },
  },
  production: Object.fromEntries(await Promise.all(productionPaths.map(async (relative) => [
    relative,
    await fileEvidence(path.join(sourceRoot, relative)),
  ]))),
  browser: { executable: await realpath(executable) },
  assertions: [],
  scenarios: [],
  console: [],
  pageErrors: [],
  screenshots: [],
  limitations: [
    "This is Chromium DOM and adapter evidence, not native Obsidian, Electron, VoiceOver, or screen-reader acceptance.",
    "The harness supplies deterministic runtime snapshots and mutation outcomes; it does not write a vault or qualify release evidence by itself.",
  ],
};

const server = createServer((request, response) => {
  if (request.url === "/harness.js") {
    response.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
    response.end(javascript);
    return;
  }
  if (request.url === "/harness.css") {
    response.writeHead(200, { "content-type": "text/css; charset=utf-8" });
    response.end(Buffer.concat([baseCss, Buffer.from("\n"), reviewCss]));
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(html);
});
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const address = server.address();
assert(address && typeof address === "object", "Review harness server has no TCP address");
const baseUrl = `http://127.0.0.1:${address.port}`;

function check(id, passed, observed) {
  report.assertions.push({ id, passed: Boolean(passed), observed });
}

async function capture(page, name) {
  const file = `${name}.png`;
  const destination = path.join(screenshotRoot, file);
  await page.screenshot({ path: destination, fullPage: true });
  report.screenshots.push({ file: path.relative(path.dirname(reportPath), destination), ...(await fileEvidence(destination)) });
}

let browser;
let page;
try {
  browser = await chromium.launch({ executablePath: executable, headless: true });
  report.browser.version = browser.version();
  page = await browser.newPage({ viewport: { width: 1080, height: 900 } });
  page.setDefaultTimeout(8_000);
  page.on("console", (message) => report.console.push({ type: message.type(), text: message.text() }));
  page.on("pageerror", (error) => report.pageErrors.push({ message: error.message, stack: error.stack }));

  async function open(mode = "full", viewport = { width: 1080, height: 900 }) {
    await page.setViewportSize(viewport);
    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.reviewHarnessReady === true);
    await page.evaluate((nextMode) => {
      window.reviewHarness.setReviewMode(nextMode, false);
      window.reviewHarness.show();
    }, mode);
    await page.locator("#review-root.spiral-day-review").waitFor();
  }

  async function scenario(id, run) {
    const started = Date.now();
    try {
      await run();
      report.scenarios.push({ id, completed: true, durationMs: Date.now() - started });
    } catch (error) {
      report.scenarios.push({ id, completed: false, durationMs: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
      check(`${id}.runner`, false, error instanceof Error ? error.stack : String(error));
    }
  }

  const row = (title) => page.locator(".spiral-day-review__row").filter({ hasText: title });
  const metric = async (title, name) => (await row(title).locator(`[data-metric=${name}]`).textContent())?.trim();
  const visibleMutationCount = () => page.locator(".spiral-day-review__actions button:visible").count();

  await scenario("states-summary-variance", async () => {
    await open("full");
    await page.locator(".spiral-day-review__row").first().waitFor();
    const states = await page.locator(".spiral-day-review__row").evaluateAll((rows) => rows.map((entry) => entry.dataset.state));
    check("review.all-five-row-states", JSON.stringify([...new Set(states)].sort()) === JSON.stringify(["compared", "live", "not-started", "not-tracked", "paused"]), states);
    check("review.seven-fixture-rows", states.length === 7, states.length);
    check("review.positive-variance", await metric("Positive variance", "variance") === "+15m", await metric("Positive variance", "variance"));
    check("review.negative-variance", await metric("Negative variance", "variance") === "−10m", await metric("Negative variance", "variance"));
    check("review.zero-variance", await metric("Zero variance", "variance") === "0m", await metric("Zero variance", "variance"));
    check("review.untracked-metrics-use-dash", await metric("No recorded time", "actual") === "—" && await metric("No recorded time", "variance") === "—", {
      actual: await metric("No recorded time", "actual"),
      variance: await metric("No recorded time", "variance"),
    });
    const summary = await page.locator(".spiral-day-review__summary > p").allTextContents();
    check("review.summary-counts", summary[0] === "4/7 completed · 3 compared", summary);
    check("review.summary-compared-only", summary[1] === "Planned 1h 30m · Actual 1h 35m · Variance +5m", summary);
    await capture(page, "states-wide-en");
  });

  await scenario("stale-building-over-limit", async () => {
    await open("full");
    await page.evaluate(() => window.reviewHarness.setExecution("stale"));
    await page.getByText("Waiting for confirmed timing data. Task actions are unavailable.", { exact: true }).waitFor();
    check("review.stale-clears-summary", !(await page.locator(".spiral-day-review__summary").isVisible()), {
      hidden: await page.locator(".spiral-day-review__summary").getAttribute("hidden"),
      text: await page.locator(".spiral-day-review__summary").textContent(),
    });
    check("review.stale-clears-actions", await visibleMutationCount() === 0, await visibleMutationCount());

    await page.evaluate(() => window.reviewHarness.setReviewMode("building"));
    await page.getByText("Loading review…", { exact: true }).waitFor();
    check("review.building-clears-summary", !(await page.locator(".spiral-day-review__summary").isVisible()), await page.locator(".spiral-day-review__summary").getAttribute("hidden"));
    check("review.building-clears-actions", await visibleMutationCount() === 0, await visibleMutationCount());

    await page.evaluate(() => window.reviewHarness.setReviewMode("over-limit"));
    await page.getByText("History exceeds the supported limit. No partial totals are shown.", { exact: true }).waitFor();
    check("review.over-limit-clears-summary", !(await page.locator(".spiral-day-review__summary").isVisible()), await page.locator(".spiral-day-review__summary").getAttribute("hidden"));
    check("review.over-limit-clears-actions", await visibleMutationCount() === 0, await visibleMutationCount());
    await capture(page, "over-limit");
  });

  await scenario("working-double-click-target", async () => {
    await open("target");
    const complete = page.getByRole("button", { name: "Complete", exact: true });
    const clockIn = page.getByRole("button", { name: "Clock in", exact: true });
    await page.evaluate(() => window.reviewHarness.setExecution("working"));
    check("review.working-disables-mutations", await complete.isDisabled() && await clockIn.isDisabled(), {
      complete: await complete.isDisabled(), clockIn: await clockIn.isDisabled(),
    });

    await page.evaluate(() => window.reviewHarness.setExecution("ready", { focusedOwner: window.reviewHarness.constants.opaqueTarget.ownerId }));
    check("review.focused-owner-disables-clock-in", await clockIn.isDisabled(), await clockIn.isDisabled());
    await page.evaluate(() => {
      window.reviewHarness.setExecution("ready");
      window.reviewHarness.deferNextDispatch();
    });
    await complete.evaluate((button) => { button.click(); button.click(); });
    await page.waitForFunction(() => window.reviewHarness.stats().dispatches.length === 1);
    const pending = await page.evaluate(() => window.reviewHarness.stats());
    check("review.double-click-dispatches-once", pending.dispatches.length === 1 && pending.deferredDispatchPending, pending);
    check("review.pending-disables-mutations", await complete.isDisabled() && await clockIn.isDisabled(), {
      complete: await complete.isDisabled(), clockIn: await clockIn.isDisabled(),
    });
    const dispatched = pending.dispatches[0];
    const expectedTarget = await page.evaluate(() => window.reviewHarness.constants.opaqueTarget);
    check("review.dispatch-uses-exact-opaque-target", JSON.stringify(dispatched.target) === JSON.stringify(expectedTarget), {
      actual: dispatched.target,
      expected: expectedTarget,
    });
    check("review.dispatch-preserves-source-fingerprint", dispatched.target.sourceFingerprint === expectedTarget.sourceFingerprint, dispatched);
    await page.evaluate(() => window.reviewHarness.resolveDispatch("applied"));
    await page.waitForFunction(() => document.querySelector("#review-root")?.getAttribute("aria-busy") === "false");
  });

  await scenario("rejected-and-uncertain", async () => {
    await open("target");
    await page.evaluate(() => window.reviewHarness.setNextOutcome("rejected"));
    await page.getByRole("button", { name: "Complete", exact: true }).click();
    await page.getByText("The action could not be confirmed. Refresh and try again.", { exact: true }).waitFor();
    check("review.rejected-outcome-shows-failure", true, "failure status visible");

    await open("target");
    await page.evaluate(() => window.reviewHarness.setNextOutcome("uncertain"));
    await page.getByRole("button", { name: "Clock in", exact: true }).click();
    await page.getByText("The action could not be confirmed. Refresh and try again.", { exact: true }).waitFor();
    const actionStats = await page.evaluate(() => window.reviewHarness.stats());
    check("review.uncertain-outcome-shows-failure", actionStats.dispatches.length === 1, actionStats.dispatches);
  });

  await scenario("keyed-focus-tick-locale", async () => {
    await open("full");
    const liveTitle = row("Live timer").locator(".spiral-day-review__title");
    await liveTitle.focus();
    const handle = await liveTitle.elementHandle();
    assert(handle, "Live Review row title was not mounted");
    const before = await metric("Live timer", "actual");
    await page.evaluate(() => window.reviewHarness.tickNow());
    const after = await metric("Live timer", "actual");
    check("review.tick-updates-live-duration", before === "12m" && after === "13m", { before, after });
    check("review.tick-preserves-keyed-focus", await handle.evaluate((element) => element.isConnected && document.activeElement === element), await page.evaluate(() => document.activeElement?.textContent));
    await page.evaluate(() => window.reviewHarness.setLocale("zh-CN"));
    check("review.locale-preserves-keyed-focus", await handle.evaluate((element) => element.isConnected && document.activeElement === element), await page.evaluate(() => document.activeElement?.textContent));
    check("review.locale-updates-accessible-name", await handle.getAttribute("aria-label") === "打开“Live timer”的来源", await handle.getAttribute("aria-label"));
    check("review.locale-updates-state", (await row("Live timer").locator(".spiral-day-review__state").textContent())?.trim() === "计时中", await row("Live timer").locator(".spiral-day-review__state").textContent());
    await page.setViewportSize({ width: 360, height: 900 });
    check("review.narrow-no-horizontal-overflow", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth })));
    await capture(page, "states-narrow-zh-CN");
  });

  await scenario("visibility-and-destroy", async () => {
    await open("full");
    await page.waitForFunction(() => window.reviewHarness.stats().ticks >= 1, undefined, { timeout: 2_500 });
    await page.evaluate(() => window.reviewHarness.hide());
    const hiddenStart = await page.evaluate(() => window.reviewHarness.stats());
    const retainedRows = await page.locator(".spiral-day-review__row").count();
    await page.evaluate(() => window.reviewHarness.setReviewMode("empty"));
    await page.waitForTimeout(1_200);
    const hiddenEnd = await page.evaluate(() => window.reviewHarness.stats());
    check("review.hidden-stops-timer", hiddenEnd.ticks === hiddenStart.ticks, { before: hiddenStart.ticks, after: hiddenEnd.ticks });
    check("review.hidden-stops-render", retainedRows === 7 && await page.locator(".spiral-day-review__row").count() === 7, await page.locator(".spiral-day-review__row").count());
    await page.evaluate(() => window.reviewHarness.show());
    await page.getByText("No tasks to review on this date.", { exact: true }).waitFor();
    const reopened = await page.evaluate(() => window.reviewHarness.stats());
    check("review.reopen-refreshes", reopened.refreshes === hiddenEnd.refreshes + 1, { before: hiddenEnd.refreshes, after: reopened.refreshes });
    check("review.reopen-renders-current-snapshot", await page.locator(".spiral-day-review__row").count() === 0, await page.locator(".spiral-day-review__row").count());

    await page.evaluate(() => window.reviewHarness.destroy());
    const destroyedStart = await page.evaluate(() => window.reviewHarness.stats());
    await page.waitForTimeout(1_200);
    const destroyedEnd = await page.evaluate(() => window.reviewHarness.stats());
    check("review.destroy-disposes-subscriptions", JSON.stringify(destroyedEnd.listeners) === JSON.stringify({ review: 0, execution: 0, locale: 0 }), destroyedEnd.listeners);
    check("review.destroy-stops-timer", destroyedEnd.ticks === destroyedStart.ticks, { before: destroyedStart.ticks, after: destroyedEnd.ticks });
    check("review.destroy-clears-dom", await page.locator("#review-root").evaluate((element) => element.childElementCount === 0 && !element.classList.contains("spiral-day-review")), await page.locator("#review-root").evaluate((element) => ({ children: element.childElementCount, className: element.className })));
    check("review.destroy-was-registered", destroyedEnd.disposerCount === 1, destroyedEnd.disposerCount);
  });

  await scenario("date-controls", async () => {
    await open("target");
    const complete = page.getByRole("button", { name: "Complete", exact: true });
    const clockIn = page.getByRole("button", { name: "Clock in", exact: true });
    const date = page.getByLabel("Review date", { exact: true });
    check("review.today-mutations-enabled", await complete.isEnabled() && await clockIn.isEnabled(), {
      complete: await complete.isEnabled(), clockIn: await clockIn.isEnabled(),
    });

    await page.getByRole("button", { name: "Previous day", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("input[type=date]")?.value === "2026-08-28");
    check("review.past-date-is-read-only", await complete.isDisabled() && await clockIn.isDisabled(), {
      complete: await complete.isDisabled(), clockIn: await clockIn.isDisabled(),
    });
    check("review.past-source-navigation-remains-enabled", await page.getByRole("button", { name: "Open source for Opaque target", exact: true }).isEnabled(), await page.getByRole("button", { name: "Open source for Opaque target", exact: true }).isEnabled());

    await page.getByRole("button", { name: "Next day", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("input[type=date]")?.value === "2026-08-29");
    check("review.current-date-restores-mutations", await complete.isEnabled() && await clockIn.isEnabled(), {
      complete: await complete.isEnabled(), clockIn: await clockIn.isEnabled(),
    });

    await page.getByRole("button", { name: "Next day", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("input[type=date]")?.value === "2026-08-30");
    check("review.future-date-is-read-only", await complete.isDisabled() && await clockIn.isDisabled(), {
      complete: await complete.isDisabled(), clockIn: await clockIn.isDisabled(),
    });
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await page.waitForFunction(() => document.querySelector("input[type=date]")?.value === "2026-08-29");
    check("review.today-control-selects-current-date", await date.inputValue() === "2026-08-29", await date.inputValue());
    const dateStats = await page.evaluate(() => window.reviewHarness.stats());
    check("review.date-selection-does-not-mutate-plan", dateStats.planToken === "plan-generation-17" && dateStats.planMutations === 0 && dateStats.dispatches.length === 0, dateStats);
    check("review.date-controls-forward-null-for-today", dateStats.selectedDates.at(-1) === null, dateStats.selectedDates);
  });

  report.browser.userAgent = await page.evaluate(() => navigator.userAgent);
  report.browser.viewport = page.viewportSize();
  const failed = report.assertions.filter((entry) => !entry.passed);
  const consoleErrors = report.console.filter((entry) => entry.type === "error" || entry.type === "assert");
  report.status = failed.length === 0 && report.pageErrors.length === 0 && consoleErrors.length === 0 ? "passed" : "failed";
  report.completedAt = new Date().toISOString();
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({
    status: report.status,
    assertions: report.assertions.length,
    passed: report.assertions.length - failed.length,
    failed: failed.length,
    scenarios: report.scenarios.length,
    screenshots: report.screenshots.length,
    report: reportPath,
  }, null, 2));
  if (report.status !== "passed") process.exitCode = 1;
} catch (error) {
  report.status = "error";
  report.completedAt = new Date().toISOString();
  report.error = error instanceof Error ? { message: error.message, stack: error.stack } : { message: String(error) };
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx" }).catch(() => undefined);
  throw error;
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
