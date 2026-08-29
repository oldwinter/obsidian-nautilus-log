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
const { PNG } = require("pngjs");
const playwrightVersion = require("playwright/package.json").version;
const esbuildVersion = require("esbuild/package.json").version;
const lucideVersion = require("lucide/package.json").version;
const pngjsVersion = require("pngjs/package.json").version;

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

function comparePng(expectedBuffer, receivedBuffer, comparison, relative) {
  const expected = PNG.sync.read(expectedBuffer);
  const received = PNG.sync.read(receivedBuffer);
  failUnless(expected.width === received.width && expected.height === received.height,
    `ENV-VIS dimensions differ for ${relative}: expected ${expected.width}x${expected.height}, received ${received.width}x${received.height}`);
  let differentPixels = 0;
  for (let offset = 0; offset < expected.data.length; offset += 4) {
    let different = false;
    for (let channel = 0; channel < 4; channel += 1) {
      if (Math.abs(expected.data[offset + channel] - received.data[offset + channel]) > comparison.channelDelta) {
        different = true;
        break;
      }
    }
    if (different) differentPixels += 1;
  }
  const totalPixels = expected.width * expected.height;
  const differentPixelRatio = differentPixels / totalPixels;
  failUnless(differentPixelRatio <= comparison.maxDifferentPixelRatio,
    `ENV-VIS golden differs: ${relative} (${differentPixels}/${totalPixels}, ratio=${differentPixelRatio})`);
  return Object.freeze({ differentPixels, differentPixelRatio, totalPixels });
}

function differentPixelCount(leftBuffer, rightBuffer) {
  const left = PNG.sync.read(leftBuffer);
  const right = PNG.sync.read(rightBuffer);
  failUnless(left.width === right.width && left.height === right.height,
    `Pixel probe dimensions differ: ${left.width}x${left.height} vs ${right.width}x${right.height}`);
  let differentPixels = 0;
  for (let offset = 0; offset < left.data.length; offset += 4) {
    if ([0, 1, 2, 3].some((channel) => Math.abs(left.data[offset + channel] - right.data[offset + channel]) > 16)) {
      differentPixels += 1;
    }
  }
  return differentPixels;
}

function nonUniformPixelCount(buffer) {
  const image = PNG.sync.read(buffer);
  const baseline = image.data.subarray(0, 4);
  let pixels = 0;
  for (let offset = 4; offset < image.data.length; offset += 4) {
    if ([0, 1, 2, 3].some((channel) => Math.abs(image.data[offset + channel] - baseline[channel]) > 16)) {
      pixels += 1;
    }
  }
  return pixels;
}

async function patternedPixelCount(locator) {
  await locator.scrollIntoViewIfNeeded();
  const originalStyle = await locator.getAttribute("style");
  await locator.evaluate((element) => element.style.setProperty("stroke", "none", "important"));
  const visible = await locator.screenshot({ animations: "disabled", caret: "hide", scale: "device" });
  await locator.evaluate((element) => element.style.setProperty("opacity", "0", "important"));
  const hidden = await locator.screenshot({ animations: "disabled", caret: "hide", scale: "device" });
  await locator.evaluate((element, style) => {
    if (style === null) element.removeAttribute("style");
    else element.setAttribute("style", style);
  }, originalStyle);
  return differentPixelCount(visible, hidden);
}

async function collectBrowserNetworkAttempts(page, phase, output) {
  const attempts = await page.evaluate(() => {
    const recorded = [...(globalThis.__issue24NetworkAttempts ?? [])];
    const expectedResources = new Map([
      [`script:${new URL("/harness.js", location.href).href}`, 1],
      [`script:${new URL("/pattern-probe-a.js", location.href).href}`, 1],
      [`script:${new URL("/pattern-probe-b.js", location.href).href}`, 1],
      [`link:${new URL("/harness.css", location.href).href}`, 1],
    ]);
    for (const entry of performance.getEntriesByType("resource")) {
      const resource = entry;
      const key = `${resource.initiatorType}:${resource.name}`;
      const remaining = expectedResources.get(key) ?? 0;
      if (remaining > 0) expectedResources.set(key, remaining - 1);
      else recorded.push({ kind: `resource:${resource.initiatorType}`, value: resource.name });
    }
    return recorded;
  });
  output.push(...attempts.map((attempt) => ({ ...attempt, phase })));
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
    await new Promise((resolvePromise) => requestAnimationFrame(() => resolvePromise(undefined)));
    if ([320, 360].includes(next.width)) harness.openDisclosure("overview");
    if (next.state === "dense") {
      for (const key of ["overview", "schedule", "overflow", "warnings"]) {
        harness.openDisclosure(key);
        await new Promise((resolvePromise) => requestAnimationFrame(() => resolvePromise(undefined)));
        await new Promise((resolvePromise) => requestAnimationFrame(() => resolvePromise(undefined)));
      }
    }
    if (next.state === "playback") {
      document.querySelector("#primary-planner [data-control='play']")?.click();
    }
    if (next.state === "topbar-completed-hidden") {
      document.querySelector("#primary-planner [data-control='completed']")?.click();
    }
    if (next.state === "topbar-collapsed") {
      document.querySelector("#primary-planner [data-control='collapse']")?.click();
    }
    if (next.state === "topbar-debug") {
      harness.setDebugEntry(true);
      document.querySelector("#primary-planner [data-control='debug']")?.click();
    }
    if (next.state === "tooltip") {
      harness.openDisclosure("schedule");
      const targets = [...document.querySelectorAll("#primary-planner [aria-describedby]")];
      targets.find((target) => target.getClientRects().length > 0)?.focus();
    }
    await new Promise((resolvePromise) => requestAnimationFrame(() => resolvePromise(undefined)));
    if (next.state !== "topbar-collapsed") harness.assertAcceptance();
  }, capture);

  const root = page.locator("#primary-planner");
  const captureState = await page.evaluate(() => window.issue24Harness.state());
  failUnless(!captureState.primary.horizontalOverflow
      && captureState.primary.clippedElements === 0
      && captureState.primary.controlOverlaps === 0
      && !captureState.primary.viewportClipped,
  `Capture layout contract failed: ${JSON.stringify(captureState.primary)}`);
  if (capture.width <= 520) {
    failUnless(captureState.primary.scheduleOpen
      && !captureState.secondary.scheduleOpen
      && await root.locator(".spiral-day-planner__schedule[open]").count() === 1,
    `Compact Schedule defaults failed: ${JSON.stringify({
      primary: captureState.primary.scheduleOpen,
      secondary: captureState.secondary.scheduleOpen,
    })}`);
  }
  if (capture.state === "temporal") {
    failUnless(await root.locator(".spiral-day-planner__needle").count() === 1, "Temporal capture lacks the now needle");
  } else if (capture.state === "topbar") {
    failUnless(await root.locator(".spiral-day-planner__header").count() === 1, "Topbar capture lacks the plugin header");
  } else if (capture.state === "topbar-completed-hidden") {
    failUnless(!captureState.primary.completedVisible, "Completed-hidden capture still shows completed items");
  } else if (capture.state === "topbar-collapsed") {
    failUnless(captureState.primary.collapsed
      && await root.locator(".spiral-day-planner__collapsed-control").count() === 1,
    "Collapsed capture lacks the expand-only control");
  } else if (capture.state === "topbar-debug") {
    const debugButton = root.locator('[data-control="debug"]');
    failUnless(captureState.primary.debugEnabled
      && captureState.primary.debugGeometryGroups === 1
      && captureState.primary.debugRectangles === 2
      && captureState.primary.debugCenterMarkers === 1
      && captureState.primary.debugGuideCircles === 1
      && captureState.primary.debugValues
        === "center 300,210; size 600x420; radii 50/150; band 16; minute 780"
      && await debugButton.textContent() === "debug is on"
      && await debugButton.getAttribute("aria-label") === "debug is on"
      && await debugButton.getAttribute("title") === "debug is on"
      && await debugButton.getAttribute("aria-pressed") === "true"
      && await debugButton.locator("svg[aria-hidden='true']").count() === 1,
    `Debug capture lacks complete geometry evidence: ${JSON.stringify(captureState.primary)}`);
  } else if (capture.state === "playback") {
    failUnless(captureState.primary.playbackRunning, "Playback capture is not running");
  } else if (capture.state === "tooltip") {
    failUnless(captureState.primary.tooltipVisible, "Tooltip capture is not visible");
  } else if (capture.state === "dense") {
    for (const disclosure of ["overview", "schedule", "overflow", "warnings"]) {
      failUnless(await root.locator(`.spiral-day-planner__${disclosure}[open]`).count() === 1,
        `Dense capture lacks expanded ${disclosure} disclosure`);
    }
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
failUnless(lucideVersion === profile.lucide,
  `ENV-VIS Lucide mismatch: expected ${profile.lucide}, received ${lucideVersion}`);
failUnless(pngjsVersion === profile.pngjs,
  `ENV-VIS pngjs mismatch: expected ${profile.pngjs}, received ${pngjsVersion}`);
failUnless(profile.pixelComparison.channelDelta === 16
    && profile.pixelComparison.maxDifferentPixelRatio === 0.002,
  `ENV-VIS pixel-comparison mismatch: ${JSON.stringify(profile.pixelComparison)}`);
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
  await context.addInitScript(() => {
    const attempts = [];
    Object.defineProperty(globalThis, "__issue24NetworkAttempts", {
      configurable: false,
      value: attempts,
      writable: false,
    });
    const record = (kind, value) => attempts.push({ kind, value: String(value) });
    const originalFetch = globalThis.fetch.bind(globalThis);
    globalThis.fetch = (input, init) => {
      record("fetch", typeof input === "string" ? input : input?.url);
      return originalFetch(input, init);
    };
    const originalXhrOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function issue24Open(method, url, ...rest) {
      record("xmlhttprequest", url);
      return originalXhrOpen.call(this, method, url, ...rest);
    };
    globalThis.WebSocket = new Proxy(globalThis.WebSocket, {
      construct(target, argumentsList, newTarget) {
        record("websocket", argumentsList[0]);
        return Reflect.construct(target, argumentsList, newTarget);
      },
    });
    globalThis.EventSource = new Proxy(globalThis.EventSource, {
      construct(target, argumentsList, newTarget) {
        record("eventsource", argumentsList[0]);
        return Reflect.construct(target, argumentsList, newTarget);
      },
    });
    const originalSendBeacon = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => {
      record("sendbeacon", url);
      return originalSendBeacon(url, data);
    };
  });
  const blockedRequests = [];
  const browserNetworkAttempts = [];
  await context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const allowed = url.origin === BASE_URL && (
      (url.pathname === "/" && request.isNavigationRequest() && request.resourceType() === "document")
      || (url.pathname === "/harness.js" && request.resourceType() === "script")
      || (["/pattern-probe-a.js", "/pattern-probe-b.js"].includes(url.pathname)
        && request.resourceType() === "script")
      || (url.pathname === "/harness.css" && request.resourceType() === "stylesheet")
    );
    if (allowed) await route.continue();
    else {
      blockedRequests.push(route.request().url());
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
  failUnless(Object.values(adapterLifecycle).every(Boolean),
    `Production adapter lifecycle seam failed: ${JSON.stringify(adapterLifecycle)}`);
  const adapterWrapper = page.locator(
    "#adapter-planner > .spiral-day-planner-view__surface.spiral-day-planner",
  );
  const adapterWrapperEvidence = [];
  for (const width of [320, 519, 520, 521]) {
    const contract = await page.evaluate(
      (nextWidth) => window.issue24Harness.setAdapterEvidenceWidth(nextWidth),
      width,
    );
    failUnless(contract.contentWidth === width
        && contract.outerWidth === width + 20
        && contract.paddingLeft === "10px"
        && contract.paddingRight === "10px"
        && contract.layout === (width <= 520 ? "compact" : "wide")
        && contract.height > 0
        && !contract.horizontalOverflow
        && contract.focusedWithin,
    `Production adapter wrapper geometry failed at ${width}: ${JSON.stringify(contract)}`);
    const image = await adapterWrapper.screenshot({
      path: join(OUTPUT_DIRECTORY, `adapter-production-wrapper-${width}.png`),
      animations: "disabled",
      caret: "hide",
      scale: "device",
    });
    const pixels = nonUniformPixelCount(image);
    failUnless(pixels > 1_000,
      `Production adapter wrapper is visually blank at ${width}: ${pixels}`);
    adapterWrapperEvidence.push({ contract, pixels, width });
  }
  await page.evaluate(() => window.issue24Harness.closeAdapterEvidence());
  const patternIsolation = await page.evaluate(() => window.issue24Harness.assertPatternIsolation());
  failUnless(Object.values(patternIsolation).every(Boolean),
    `Production adapter pattern isolation failed: ${JSON.stringify(patternIsolation)}`);
  const elapsedPatternPixels = await patternedPixelCount(
    page.locator("#pattern-evidence-visible .spiral-day-planner__elapsed"),
  );
  const progressPatternPixels = await patternedPixelCount(
    page.locator("#pattern-evidence-visible .spiral-day-planner__progress").first(),
  );
  failUnless(elapsedPatternPixels > 20 && progressPatternPixels > 20,
    `Visible later leaf lacks patterned pixels: ${JSON.stringify({ elapsedPatternPixels, progressPatternPixels })}`);
  await page.locator("#pattern-evidence-visible").screenshot({
    path: join(OUTPUT_DIRECTORY, "pattern-evidence-visible.png"),
    animations: "disabled",
    caret: "hide",
    scale: "device",
  });
  await page.evaluate(() => window.issue24Harness.closePatternEvidence());
  const patternRegistryHostility = await page.evaluate(() => window.issue24Harness.assertPatternRegistryHostility());
  failUnless(Object.values(patternRegistryHostility).every(Boolean),
    `Production pattern registry hostility failed: ${JSON.stringify(patternRegistryHostility)}`);
  const hostileElapsedPatternPixels = await patternedPixelCount(
    page.locator("#pattern-hostile-visible .spiral-day-planner__elapsed"),
  );
  const hostileProgressPatternPixels = await patternedPixelCount(
    page.locator("#pattern-hostile-visible .spiral-day-planner__progress").first(),
  );
  failUnless(hostileElapsedPatternPixels > 20 && hostileProgressPatternPixels > 20,
    `Hostile-registry surface lacks patterned pixels: ${JSON.stringify({ hostileElapsedPatternPixels, hostileProgressPatternPixels })}`);
  await page.evaluate(() => window.issue24Harness.closePatternEvidence());
  const patternReloadIsolation = await page.evaluate(() => window.issue24Harness.assertPatternReloadIsolation());
  failUnless(Object.values(patternReloadIsolation).every(Boolean),
    `Production adapter module-reload pattern isolation failed: ${JSON.stringify(patternReloadIsolation)}`);
  const reloadElapsedPatternPixels = await patternedPixelCount(
    page.locator("#pattern-reload-visible .spiral-day-planner__elapsed"),
  );
  const reloadProgressPatternPixels = await patternedPixelCount(
    page.locator("#pattern-reload-visible .spiral-day-planner__progress").first(),
  );
  failUnless(reloadElapsedPatternPixels > 20 && reloadProgressPatternPixels > 20,
    `Visible module-reload leaf lacks patterned pixels: ${JSON.stringify({ reloadElapsedPatternPixels, reloadProgressPatternPixels })}`);
  await page.locator("#pattern-reload-visible").screenshot({
    path: join(OUTPUT_DIRECTORY, "pattern-reload-visible.png"),
    animations: "disabled",
    caret: "hide",
    scale: "device",
  });
  await page.evaluate(() => window.issue24Harness.closePatternEvidence());
  const interactionNames = [
    "assertConnectFailureState",
    "assertContextTransaction",
    "assertRuntimeProbeInterval",
    "assertExternalFocusPreserved",
    "assertKeyboardPointerParity",
    "assertLayoutFocusRestoration",
    "assertLifecycleReparenting",
    "assertMediaQueryLifecycle",
    "assertPlaybackStopsOnContextChange",
    "assertPlaybackStopsOnRuntimeState",
    "assertReplicaRemount",
    "assertTooltipClearsWhenHidden",
  ];
  const interactions = await page.evaluate(async (names) => {
    const results = [];
    for (const name of names) {
      results.push({ name, passed: await window.issue24Harness[name]() });
    }
    return results;
  }, interactionNames);
  failUnless(interactions.every(({ passed }) => passed),
    `Planner interaction evidence failed: ${JSON.stringify(interactions)}`);
  await collectBrowserNetworkAttempts(page, "adapter-interactions", browserNetworkAttempts);
  await page.goto(BASE_URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.issue24Harness !== undefined);
  await page.evaluate(() => document.fonts.ready);
  const matrix = await page.evaluate(() => window.issue24Harness.runMatrix());
  failUnless(matrix.length === 168, `Canonical matrix returned ${matrix.length} states instead of 168`);
  await page.evaluate(() => window.issue24Harness.assertAcceptance());
  await collectBrowserNetworkAttempts(page, "matrix", browserNetworkAttempts);

  const pixelComparisons = [];
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
      const comparison = comparePng(expected, received, profile.pixelComparison, relative);
      pixelComparisons.push({ relative, ...comparison });
      console.log(`pixels ${relative} ${comparison.differentPixels}/${comparison.totalPixels} ratio=${comparison.differentPixelRatio}`);
    } else {
      console.log(`captured ${relative}`);
    }
    await collectBrowserNetworkAttempts(page, `capture:${relative}`, browserNetworkAttempts);
  }
  failUnless(blockedRequests.length === 0,
    `Plugin emitted blocked requests during capture: ${JSON.stringify(blockedRequests)}`);
  failUnless(browserNetworkAttempts.length === 0,
    `Plugin initiated browser network requests: ${JSON.stringify(browserNetworkAttempts)}`);
  await writeFile(join(OUTPUT_DIRECTORY, "env-vis-result.json"), `${JSON.stringify({
    adapterLifecycle,
    adapterWrapperEvidence,
    patternIsolation,
    patternReloadIsolation,
    patternRegistryHostility,
    patternPixels: { elapsed: elapsedPatternPixels, progress: progressPatternPixels },
    reloadPatternPixels: { elapsed: reloadElapsedPatternPixels, progress: reloadProgressPatternPixels },
    hostilePatternPixels: { elapsed: hostileElapsedPatternPixels, progress: hostileProgressPatternPixels },
    interactionChecks: interactions.length,
    matrixStates: matrix.length,
    pluginRequests: browserNetworkAttempts.length,
    blockedRequests: blockedRequests.length,
    pixelComparisons,
    profileRevision: profile.revision,
    captures: profile.captures.length,
  }, null, 2)}\n`);
  console.log(`ENV-VIS passed: adapter=true adapterWrapperPixels=${adapterWrapperEvidence.map(({ pixels }) => pixels).join("/")} patterns=true patternPixels=${elapsedPatternPixels}/${progressPatternPixels} reloadPatternPixels=${reloadElapsedPatternPixels}/${reloadProgressPatternPixels} hostilePatternPixels=${hostileElapsedPatternPixels}/${hostileProgressPatternPixels} interactions=${interactions.length} matrix=168 captures=${profile.captures.length} pluginRequests=0`);
} catch (error) {
  if (serverError.trim()) console.error(serverError.trim());
  throw error;
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
