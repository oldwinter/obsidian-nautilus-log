import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, copyFile, realpath, readdir, stat } from "node:fs/promises";
import { arch, cpus, platform, release, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { parseArgs } from "node:util";
import { syntheticFixture } from "./fixture.mjs";
import { PLANNER_TYPE, runLifecycleCycles, runClockReload } from "../lifecycle/real-host.mjs";

const { values } = parseArgs({ options: {
  executable: { type: "string" }, "plugin-dir": { type: "string" }, output: { type: "string" },
  "candidate-sha": { type: "string" }, help: { type: "boolean" },
} });
if (values.help) {
  console.log("node tests/host-matrix/run.mjs --executable /path/to/Obsidian --plugin-dir /path/to/built/plugin --output /new/disposable/directory [--candidate-sha <40 hex>]\nSet PLAYWRIGHT_MODULE to an installed playwright module path when it is outside Node module resolution.");
  process.exit(0);
}
for (const name of ["executable", "plugin-dir", "output"]) assert(values[name], `Missing --${name}`);
assert(!values["candidate-sha"] || /^[a-f0-9]{40}$/.test(values["candidate-sha"]), "Candidate SHA must have 40 lowercase hex characters");
const require = createRequire(import.meta.url);
const playwrightModule = process.env.PLAYWRIGHT_MODULE || "playwright";
const { chromium } = require(playwrightModule);
const executable = await realpath(resolve(values.executable));
const pluginDir = await realpath(resolve(values["plugin-dir"]));
const output = resolve(values.output);
await mkdir(output, { recursive: false });
const root = await realpath(output);
const profile = join(root, "profile");
const vault = join(root, "vault");
const evidence = join(root, "evidence");
for (const path of [profile, vault, evidence, join(vault, ".obsidian")]) await mkdir(path);
const manifest = JSON.parse(await readFile(join(pluginDir, "manifest.json"), "utf8"));
assert.equal(manifest.id, "spiral-day", "This runner exercises only Spiral Day");
const installedPlugin = join(vault, ".obsidian", "plugins", manifest.id);
await mkdir(installedPlugin, { recursive: true });
const packageFiles = ["main.js", "manifest.json", "styles.css"];
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (path, data) => writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
async function fileHashes(directory, files) {
  return Object.fromEntries(await Promise.all(files.map(async (file) => {
    const bytes = await readFile(join(directory, file));
    return [file, { bytes: bytes.length, sha256: hash(bytes) }];
  })));
}
async function markdownHashes() {
  const paths = (await readdir(vault, { recursive: true })).filter((path) => path.endsWith(".md")
    && !path.startsWith(".obsidian/") && !path.startsWith(".obsidian\\")).sort();
  return fileHashes(vault, paths);
}
const sourcePackage = await fileHashes(pluginDir, packageFiles);
for (const file of packageFiles) await copyFile(join(pluginDir, file), join(installedPlugin, file));
const installedPackage = await fileHashes(installedPlugin, packageFiles);
assert.deepEqual(installedPackage, sourcePackage, "Installed plugin bytes differ from supplied package");
const fixture = syntheticFixture();
for (const day of fixture.days) await writeFile(join(vault, day.path), day.source);
await json(join(installedPlugin, "data.json"), fixture.pluginData);
await json(join(vault, ".obsidian", "community-plugins.json"), []);
await json(join(vault, ".obsidian", "core-plugins.json"), []);
await json(join(vault, ".obsidian", "appearance.json"), { theme: "obsidian", cssTheme: "" });
await json(join(profile, "obsidian.json"), {
  vaults: { "1111222233334444": { path: vault, ts: Date.now(), open: true } },
  updateDisabled: true,
});
const report = {
  schemaVersion: 1,
  evidenceClass: "real-obsidian-desktop-automated-smoke",
  status: "running",
  startedAt: new Date().toISOString(),
  candidateSha: values["candidate-sha"] ?? null,
  candidateBinding: "Operator-supplied label only. Package SHA256 values identify tested bytes. This runner does not certify Git cleanliness, remote equality, G0-G6, or a freeze.",
  driver: { playwrightVersion: require(`${playwrightModule}/package.json`).version,
    files: await fileHashes(resolve(import.meta.dirname, ".."), ["host-matrix/run.mjs", "host-matrix/fixture.mjs", "lifecycle/real-host.mjs"]) },
  package: { sourceDirectory: pluginDir, manifest, source: sourcePackage, installed: installedPackage },
  fixture: { provenance: "Generated public synthetic notes only", date: fixture.today.logicalDate,
    pluginData: fixture.pluginData, files: await markdownHashes() },
  host: { os: platform(), osRelease: release(), architecture: arch(), cpu: cpus()[0]?.model,
    logicalCpuCount: cpus().length, memoryBytes: totalmem(), runnerNode: process.version, executable,
    executableSha256: hash(await readFile(executable)) },
  paths: { root, profile, vault, evidence },
  assertions: [], console: [], pageErrors: [], network: [], lifecycle: [], screenshots: [],
  limitations: [
    "One installed host and small synthetic fixture only. No minimum-version, other-OS, Intel, or ARM64-emulation qualification.",
    "No VoiceOver or other screen-reader transcript, manual acceptance, visual parity, full theme/zoom/locale matrix, or accessibility certification.",
    "Ten clean view-close/plugin-disable/enable cycles inspect visible registrations. They do not prove heap, timer, event-listener ownership, 100-cycle leaks, queued/entered mutation unload, or performance budgets.",
    "Renderer CDP requests include initiator attribution. Electron NetLog captures process network activity without guaranteed plugin attribution. Native requestUrl traffic cannot be certified plugin-free from renderer events alone.",
    "Automation uses Obsidian host internals to enable plugins and inspect isolation. Production plugin bytes are copied unchanged.",
  ],
};
function check(id, passed, observed) {
  report.assertions.push({ id, passed, observed });
  assert(passed, `${id} failed: ${JSON.stringify(observed)}`);
}
const startupArgs = [`--user-data-dir=${profile}`, "--remote-debugging-port=0", "--remote-debugging-address=127.0.0.1",
  `--log-net-log=${join(evidence, "electron-netlog.json")}`, "--no-first-run", "--no-default-browser-check"];
report.host.launchArguments = startupArgs;
if (platform() === "darwin") {
  report.host.appResources = await fileHashes(join(dirname(dirname(executable)), "Resources"), ["app.asar", "obsidian.asar"]);
  for (const [name, command, args] of [
    ["signatureVerification", "codesign", ["--verify", "--deep", "--strict", dirname(dirname(dirname(executable)))]],
    ["signatureIdentity", "codesign", ["-dv", "--verbose=2", dirname(dirname(dirname(executable)))]],
    ["installerVersion", "plutil", ["-extract", "CFBundleShortVersionString", "raw", "-o", "-", join(dirname(dirname(executable)), "Info.plist")]],
  ]) {
    const result = spawnSync(command, args, { encoding: "utf8" });
    report.host[name] = { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
  }
}
let child;
let browser;
let page;
let childExit;
let exitPromise;
let networkAttached = false;
let isolationVerified = false;
const deadline = setTimeout(() => {
  report.deadlineExceeded = true;
  child?.kill("SIGTERM");
}, 180000);
const stdout = [];
const stderr = [];
async function screenshot(name) {
  const file = `${name}.png`;
  await page.screenshot({ path: join(evidence, file), fullPage: true });
  report.screenshots.push({ file, sha256: hash(await readFile(join(evidence, file))) });
}
async function openPlanner() {
  await page.evaluate(async ({ type, logicalDate }) => {
    const leaf = app.workspace.getLeavesOfType(type)[0] ?? app.workspace.getLeaf("tab");
    await leaf.setViewState({ type, active: true, state: { logicalDate } });
    await app.workspace.revealLeaf(leaf);
    app.workspace.setActiveLeaf(leaf, { focus: true });
  }, { type: PLANNER_TYPE, logicalDate: fixture.today.logicalDate });
  await page.locator(".spiral-day-planner-view [data-control=collapse]").waitFor();
}
async function openExecution() {
  const trigger = page.locator(".spiral-day-execution-trigger");
  if (await trigger.getAttribute("aria-expanded") !== "true") await trigger.click();
  await page.getByRole("dialog", { name: "Execution", exact: true }).waitFor();
}
try {
  child = spawn(executable, startupArgs, { stdio: ["ignore", "pipe", "pipe"] });
  report.host.launchedPid = child.pid;
  exitPromise = new Promise((resolveExit) => {
    child.once("exit", (code, signal) => { childExit = { code, signal }; resolveExit(); });
    child.once("error", (error) => { childExit = { error: error.message }; resolveExit(); });
  });
  child.stdout.on("data", (data) => stdout.push(data.toString()));
  child.stderr.on("data", (data) => stderr.push(data.toString()));
  let port;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    assert(!childExit, `Isolated Obsidian exited before CDP became available: ${JSON.stringify(childExit)}`);
    try { port = (await readFile(join(profile, "DevToolsActivePort"), "utf8")).split("\n")[0]; } catch {}
    if (port) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  assert(/^\d+$/.test(port ?? ""), "No CDP port appeared in the disposable profile within 30 seconds");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = browser.contexts()[0].pages().find((candidate) => candidate.url().startsWith("app://obsidian.md/"));
  assert(page, "The isolated browser has no Obsidian app page");
  page.setDefaultTimeout(15000);
  page.on("console", (message) => report.console.push({ type: message.type(), text: message.text(), location: message.location() }));
  page.on("pageerror", (error) => report.pageErrors.push({ message: error.message, stack: error.stack }));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  networkAttached = true;
  cdp.on("Network.requestWillBeSent", (event) => {
    const initiator = JSON.stringify(event.initiator);
    report.network.push({ requestId: event.requestId, url: event.request.url, method: event.request.method,
      type: event.type, initiator: event.initiator, timestamp: event.timestamp,
      pluginAttributed: initiator.includes(`plugin:${manifest.id}`) || initiator.includes(`/plugins/${manifest.id}/`) });
  });
  await page.waitForFunction(() => globalThis.app?.workspace?.layoutReady === true);
  const runtime = await page.evaluate(() => ({
    vault: app.vault.adapter.getBasePath(), rendererArgv: process.argv,
    versions: process.versions, title: document.title, url: location.href,
    userAgent: navigator.userAgent, platform: process.platform, architecture: process.arch,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    enabledPlugins: [...app.plugins.enabledPlugins],
    loadedPlugins: Object.keys(app.plugins.plugins),
    theme: document.body.classList.contains("theme-dark") ? "dark" : "light",
    devicePixelRatio, innerWidth, innerHeight,
  }));
  report.host.runtime = runtime;
  check("isolated-vault", await realpath(runtime.vault) === await realpath(vault), runtime.vault);
  const actualProfile = runtime.rendererArgv.find((arg) => arg.startsWith("--user-data-dir="))?.slice("--user-data-dir=".length);
  check("isolated-profile", actualProfile && await realpath(actualProfile) === await realpath(profile), actualProfile);
  check("plugin-disabled-before-instrumentation", runtime.loadedPlugins.length === 0 && runtime.enabledPlugins.length === 0, runtime.loadedPlugins);
  check("real-electron-runtime", Boolean(runtime.versions.electron && runtime.versions.chrome), runtime.versions);
  isolationVerified = true;
  await json(join(evidence, "isolation.json"), { vault: runtime.vault, profile: actualProfile, pid: child.pid, runtime });
  console.log(`Isolated host verified. Obsidian ${runtime.title}; Electron ${runtime.versions.electron}.`);
  const trust = page.getByRole("button", { name: /Trust author and enable plugins|信任仓库作者并启用插件/i });
  if (await trust.isVisible()) {
    await trust.click();
    await trust.waitFor({ state: "hidden" });
  }
  await page.evaluate(async (pluginId) => {
    if (app.plugins.setSafeMode) await app.plugins.setSafeMode(false);
    await app.plugins.enablePluginAndSave(pluginId);
  }, manifest.id);
  await page.locator(".spiral-day-execution-trigger").waitFor();
  const beforeNavigation = await markdownHashes();
  report.sourceHashes = { beforeNavigation };
  check("activation-preserves-all-markdown", JSON.stringify(report.fixture.files) === JSON.stringify(beforeNavigation), beforeNavigation);
  await openPlanner();
  await screenshot("planner");
  for (const [name, expected] of [["Collapse planner", "Expand planner"], ["Expand planner", "Collapse planner"],
    ["Hide completed items", "Show completed items"], ["Show completed items", "Hide completed items"]]) {
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByRole("button", { name: expected, exact: true }).waitFor();
    check(`planner-${name}`, true, { activated: name, observedControl: expected });
  }
  await openExecution();
  await screenshot("execution-timing");
  await page.keyboard.press("Escape");
  check("execution-escape-restores-trigger", await page.locator(".spiral-day-execution-trigger")
    .evaluate((element) => element === document.activeElement), "Execution ribbon trigger");
  await page.locator(".spiral-day-execution-trigger").press("Enter");
  const timingTab = page.getByRole("tab", { name: "Timing", exact: true });
  await timingTab.focus();
  await timingTab.press("ArrowRight");
  check("execution-keyboard-plan-tab", await page.getByRole("tab", { name: "Plan", exact: true })
    .getAttribute("aria-selected") === "true", "Plan selected after ArrowRight");
  await page.getByRole("button", { name: "Host fixture Alpha", exact: true }).waitFor();
  await screenshot("execution-plan");
  await page.getByRole("button", { name: "Host fixture Alpha", exact: true }).click();
  await page.waitForFunction((path) => app.workspace.getActiveFile()?.path === path, fixture.today.path);
  check("execution-source-navigation", true, fixture.today.path);
  await page.keyboard.press("Escape");
  const afterNavigation = await markdownHashes();
  report.sourceHashes.afterNavigation = afterNavigation;
  check("read-only-navigation-preserves-all-markdown", JSON.stringify(beforeNavigation) === JSON.stringify(afterNavigation), afterNavigation);
  report.lifecycle = await runLifecycleCycles({ page, pluginId: manifest.id, openPlanner, openExecution, check, screenshot });
  const afterLifecycle = await markdownHashes();
  report.sourceHashes.afterLifecycle = afterLifecycle;
  check("lifecycle-preserves-all-markdown", JSON.stringify(beforeNavigation) === JSON.stringify(afterLifecycle), afterLifecycle);
  const clock = await runClockReload({ page, fixture, openExecution, check, screenshot,
    readSource: async (accept) => {
      for (let attempt = 0; attempt < 100; attempt += 1) {
        const source = await readFile(join(vault, fixture.today.path), "utf8");
        if (accept(source)) return source;
        await new Promise((resolveWait) => setTimeout(resolveWait, 100));
      }
      throw new Error("CLOCK source was not persisted to disk within 10 seconds");
    },
    verifyIsolation: async () => {
      const current = await page.evaluate(() => ({ vault: app.vault.adapter.getBasePath(),
        profile: process.argv.find((arg) => arg.startsWith("--user-data-dir="))?.slice("--user-data-dir=".length) }));
      check("reload-preserves-isolation", await realpath(current.vault) === await realpath(vault)
        && await realpath(current.profile) === await realpath(profile), current);
    },
  });
  await json(join(evidence, "clock-sources.json"), clock);
  const afterClock = await markdownHashes();
  report.sourceHashes.afterClock = afterClock;
  check("clock-writes-only-today", Object.keys(afterClock).length === Object.keys(beforeNavigation).length
    && Object.keys(beforeNavigation).every((path) => path === fixture.today.path
      || beforeNavigation[path].sha256 === afterClock[path]?.sha256), afterClock);
  check("clock-preserves-outside-region", clock.clockOutSource.split("<!-- /nautilus-log:plan -->")[1]
    === fixture.today.source.split("<!-- /nautilus-log:plan -->")[1]
    && clock.clockOutSource.split("<!-- nautilus-log:plan/v1 -->")[0]
    === fixture.today.source.split("<!-- nautilus-log:plan/v1 -->")[0], fixture.today.path);
  check("clock-preserves-all-other-note-bytes", clock.clockOutSource
    .replace(/^  - LOGBOOK::\n    - CLOCK:.*\n/m, "") === fixture.today.source, fixture.today.path);
  report.package.afterRun = await fileHashes(installedPlugin, packageFiles);
  check("plugin-bytes-unchanged", JSON.stringify(sourcePackage) === JSON.stringify(report.package.afterRun), report.package.afterRun);
  await page.keyboard.press("Escape");
  await openPlanner();
  await screenshot("planner-after-ten-cycles");
  check("no-renderer-page-errors", report.pageErrors.length === 0, report.pageErrors);
  const errors = report.console.filter((event) => event.type === "error");
  check("no-renderer-console-errors", errors.length === 0, errors);
  const pluginRequests = report.network.filter((request) => request.pluginAttributed);
  check("no-plugin-attributed-renderer-requests", pluginRequests.length === 0, pluginRequests);
  check("within-runner-deadline", !report.deadlineExceeded, "180 seconds");
  report.status = "passed";
} catch (error) {
  report.status = "failed";
  report.failure = { message: error.message, stack: error.stack };
  if (isolationVerified && page && !page.isClosed()) {
    report.failure.ui = await page.evaluate(() => ({
      activeTaskDiagnostics: [...document.querySelectorAll(".spiral-day-active-task__details p")]
        .map((element) => element.textContent),
      activeTaskStates: [...document.querySelectorAll(".spiral-day-active-task[data-state]")]
        .map((element) => element.dataset.state),
      executionText: [...document.querySelectorAll(".spiral-day-execution")]
        .map((element) => element.textContent),
      executionTriggerLabels: [...document.querySelectorAll(".spiral-day-execution-trigger")]
        .map((element) => element.getAttribute("aria-label")),
    })).catch((captureError) => ({ captureError: captureError.message }));
    report.sourceHashes = { ...report.sourceHashes, atFailure: await markdownHashes() };
    await screenshot("failure").catch(() => {});
  }
  process.exitCode = 1;
} finally {
  if (browser) await Promise.race([browser.close().catch(() => {}),
    new Promise((resolveWait) => setTimeout(resolveWait, 2000))]);
  if (child && !childExit) {
    child.kill("SIGTERM");
    await Promise.race([exitPromise, new Promise((resolveWait) => setTimeout(resolveWait, 5000))]);
    if (!childExit) {
      child.kill("SIGKILL");
      await exitPromise;
    }
  }
  clearTimeout(deadline);
  report.host.processExit = childExit;
  report.finishedAt = new Date().toISOString();
  report.networkCapture = { rendererAttachedBeforePluginEnable: networkAttached,
    electronNetlog: await stat(join(evidence, "electron-netlog.json")).then((info) => ({ file: "electron-netlog.json", bytes: info.size }), () => null) };
  await writeFile(join(evidence, "stdout.log"), stdout.join(""));
  await writeFile(join(evidence, "stderr.log"), stderr.join(""));
  await json(join(evidence, "report.json"), report);
  console.log(`${report.status}: ${report.assertions.filter((result) => result.passed).length}/${report.assertions.length} assertions. ${join(evidence, "report.json")}`);
  if (report.failure) console.error(report.failure.message);
}
