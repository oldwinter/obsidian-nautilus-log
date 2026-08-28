import { execFileSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const PROFILE_PATH = resolve(ROOT, "tests/ui/planner-controls/env-vis-profile.json");
const GOLDEN_DIRECTORY = resolve(ROOT, "tests/ui/planner-controls/goldens");
const INIT_SCRIPT = resolve(ROOT, "tests/ui/planner-controls/visual-clock-init.js");
const PORT = 43_127;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const outputIndex = process.argv.indexOf("--output");
if (outputIndex < 0 || !process.argv[outputIndex + 1]) {
  throw new Error("ENV-VIS container runner requires --output <directory>");
}
const OUTPUT_DIRECTORY = resolve(process.argv[outputIndex + 1]);
const update = process.argv.includes("--update");
const profile = JSON.parse(await readFile(PROFILE_PATH, "utf8"));
const require = createRequire("/env-vis/package.json");
const { chromium } = require("playwright");
const playwrightVersion = require("playwright/package.json").version;
const esbuildVersion = require("esbuild/package.json").version;

function parseOsRelease(source) {
  return Object.fromEntries(source.trim().split("\n").map((line) => {
    const separator = line.indexOf("=");
    const raw = line.slice(separator + 1);
    return [line.slice(0, separator), raw.replace(/^"|"$/g, "")];
  }));
}

function failUnless(condition, message) {
  if (!condition) throw new Error(message);
}

function goldenRelativePath(capture) {
  for (const value of [profile.fixture, capture.state, capture.locale, capture.theme, profile.revision]) {
    failUnless(/^[a-zA-Z0-9-]+$/.test(value), `Unsafe ENV-VIS path component: ${String(value)}`);
  }
  failUnless(Number.isInteger(capture.width), `Unsafe ENV-VIS width: ${String(capture.width)}`);
  return join(
    profile.fixture,
    capture.state,
    capture.locale,
    capture.theme,
    `width-${capture.width}`,
    `${profile.revision}.png`,
  );
}

async function waitForHarness(server) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Visual harness exited with ${server.exitCode}`);
    try {
      const response = await fetch(BASE_URL);
      if (response.ok) return;
    } catch {
      // The disposable loopback server may still be binding its port.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`Visual harness did not become ready on port ${PORT}`);
}

async function applyCaptureState(page, capture) {
  await page.evaluate(async (next) => {
    const harness = window.issue24Harness;
    harness.setZoom(1);
    harness.setWidth(next.width);
    harness.setLocale(next.locale);
    harness.setTheme(next.theme);
    harness.setReducedMotion(next.reducedMotion);
    await new Promise((resolvePromise) => requestAnimationFrame(() => resolvePromise(undefined)));
    if ([320, 360].includes(next.width)) harness.openDisclosure("overview");
    if (next.state === "dense") {
      for (const key of ["overview", "schedule", "overflow", "warnings"]) {
        harness.openDisclosure(key);
        await new Promise((resolvePromise) => requestAnimationFrame(() => resolvePromise(undefined)));
      }
    }
    if (next.state === "playback") {
      document.querySelector("#primary-planner [data-control='play']")?.click();
    }
    if (next.state === "tooltip") {
      harness.openDisclosure("schedule");
      const targets = [...document.querySelectorAll("#primary-planner [aria-describedby]")];
      targets.find((target) => target.getClientRects().length > 0)?.focus();
    }
    await new Promise((resolvePromise) => requestAnimationFrame(() => resolvePromise(undefined)));
    harness.assertAcceptance();
  }, capture);

  const root = page.locator("#primary-planner");
  const captureState = await page.evaluate(() => window.issue24Harness.state());
  if (capture.state === "temporal") {
    failUnless(await root.locator(".spiral-day-planner__needle").count() === 1, "Temporal capture lacks the now needle");
  } else if (capture.state === "topbar") {
    failUnless(await root.locator(".spiral-day-planner__header").count() === 1, "Topbar capture lacks the plugin header");
  } else if (capture.state === "playback") {
    failUnless(captureState.primary.playbackRunning, "Playback capture is not running");
  } else if (capture.state === "tooltip") {
    failUnless(captureState.primary.tooltipVisible, "Tooltip capture is not visible");
  } else if (capture.state === "dense") {
    failUnless(await root.locator("details[open]").count() >= 3, "Dense capture lacks expanded disclosures");
  } else if (capture.state === "reduced-motion") {
    failUnless(captureState.reducedMotion && captureState.primary.motionTransitionsDisabled,
      "Reduced-motion capture is not reduced");
  }
  return root;
}

const osRelease = parseOsRelease(await readFile("/etc/os-release", "utf8"));
failUnless(profile.schema === "spiral-day-env-vis-v1", "Unknown ENV-VIS schema");
failUnless(process.env.SPIRAL_DAY_ENV_VIS_NETWORK === "none", "Normative ENV-VIS capture requires network=none");
failUnless(osRelease.ID === profile.os.id
    && osRelease.VERSION_ID === profile.os.versionId
    && osRelease.PRETTY_NAME === profile.os.prettyName,
  `ENV-VIS OS mismatch: ${osRelease.ID} ${osRelease.VERSION_ID} ${osRelease.PRETTY_NAME}`);
failUnless(process.versions.node === profile.node,
  `ENV-VIS Node mismatch: expected ${profile.node}, received ${process.versions.node}`);
failUnless(playwrightVersion === profile.playwright,
  `ENV-VIS Playwright mismatch: expected ${profile.playwright}, received ${playwrightVersion}`);
failUnless(esbuildVersion === profile.esbuild,
  `ENV-VIS esbuild mismatch: expected ${profile.esbuild}, received ${esbuildVersion}`);
await access(profile.browser.executable, constants.X_OK);
const [resolvedFamily, resolvedFile] = execFileSync("fc-match", ["--format", "%{family}|%{file}", "Arial"], {
  encoding: "utf8",
}).split("|");
failUnless(resolvedFamily === profile.font.resolvedFamily && resolvedFile === profile.font.resolvedFile,
  `ENV-VIS font mismatch: ${resolvedFamily}|${resolvedFile}`);

const server = spawn(process.execPath, ["tests/ui/planner-controls/serve-visual-harness.mjs"], {
  cwd: ROOT,
  env: { ...process.env, SPIRAL_DAY_ISSUE24_HARNESS_PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverError = "";
server.stderr?.on("data", (chunk) => { serverError += String(chunk); });
let browser;
try {
  await waitForHarness(server);
  browser = await chromium.launch({
    executablePath: profile.browser.executable,
    headless: true,
    args: ["--disable-lcd-text", "--no-sandbox"],
  });
  failUnless(browser.version() === profile.browser.version,
    `ENV-VIS Chromium mismatch: expected ${profile.browser.version}, received ${browser.version()}`);
  const context = await browser.newContext({
    viewport: profile.viewport,
    deviceScaleFactor: profile.deviceScaleFactor,
    locale: "en-US",
    serviceWorkers: "block",
    timezoneId: "Asia/Shanghai",
  });
  await context.addInitScript({ path: INIT_SCRIPT });
  const pluginRequests = [];
  await context.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    const allowed = url.origin === BASE_URL
      && ["/", "/harness.js", "/harness.css", "/favicon.ico"].includes(url.pathname);
    if (allowed) await route.continue();
    else {
      pluginRequests.push(route.request().url());
      await route.abort("blockedbyclient");
    }
  });
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.issue24Harness !== undefined);
  await page.evaluate(() => document.fonts.ready);

  const environment = await page.evaluate(() => ({
    clock: globalThis.__issue24VisualClock,
    dpr: devicePixelRatio,
    font: getComputedStyle(document.body).fontFamily,
    height: innerHeight,
    width: innerWidth,
  }));
  failUnless(environment.dpr === profile.deviceScaleFactor
      && environment.width === profile.viewport.width
      && environment.height === profile.viewport.height
      && environment.font === profile.font.css
      && environment.clock?.epochMilliseconds === profile.clock.epochMilliseconds
      && environment.clock?.performanceMilliseconds === profile.clock.performanceMilliseconds,
  `ENV-VIS browser mismatch: ${JSON.stringify(environment)}`);

  const adapterLifecycle = await page.evaluate(() => window.issue24Harness.assertAdapterLifecycle());
  failUnless(adapterLifecycle === true, "Production adapter lifecycle seam failed");
  await page.evaluate(() => window.issue24Harness.closeAdapterEvidence());
  const matrix = await page.evaluate(() => window.issue24Harness.runMatrix());
  failUnless(matrix.length === 168, `Canonical matrix returned ${matrix.length} states instead of 168`);
  await page.evaluate(() => window.issue24Harness.assertAcceptance());

  for (const capture of profile.captures) {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.issue24Harness !== undefined);
    await page.evaluate(() => document.fonts.ready);
    const root = await applyCaptureState(page, capture);
    const titleBottom = await page.locator(".planner-leaf__title").first().evaluate((element) => (
      element.getBoundingClientRect().bottom
    ));
    const rootBox = await root.boundingBox();
    failUnless(rootBox !== null && rootBox.y >= titleBottom,
      `Plugin crop intersects harness chrome: ${JSON.stringify({ rootBox, titleBottom })}`);
    const relative = goldenRelativePath(capture);
    const actual = join(OUTPUT_DIRECTORY, "goldens", relative);
    await mkdir(dirname(actual), { recursive: true });
    await page.addStyleTag({
      content: ".harness-toolbar, .planner-leaf__title { visibility: hidden !important; }",
    });
    await root.screenshot({
      path: actual,
      animations: "disabled",
      caret: "hide",
      scale: "device",
    });
    if (!update) {
      const golden = join(GOLDEN_DIRECTORY, relative);
      let expected;
      try {
        expected = await readFile(golden);
      } catch {
        throw new Error(`Missing ENV-VIS golden ${golden}; run with --update and inspect every capture`);
      }
      const received = await readFile(actual);
      failUnless(received.equals(expected), `ENV-VIS golden differs: ${relative}`);
      console.log(`exact ${relative}`);
    } else {
      console.log(`captured ${relative}`);
    }
  }
  failUnless(pluginRequests.length === 0,
    `Plugin emitted requests during capture: ${JSON.stringify(pluginRequests)}`);
  await writeFile(join(OUTPUT_DIRECTORY, "env-vis-result.json"), `${JSON.stringify({
    adapterLifecycle,
    matrixStates: matrix.length,
    pluginRequests: pluginRequests.length,
    profileRevision: profile.revision,
    captures: profile.captures.length,
  }, null, 2)}\n`);
  console.log(`ENV-VIS passed: adapter=true matrix=168 captures=${profile.captures.length} pluginRequests=0`);
} catch (error) {
  if (serverError.trim()) console.error(serverError.trim());
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
