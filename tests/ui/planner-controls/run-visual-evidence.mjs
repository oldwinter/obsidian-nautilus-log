import { execFileSync, spawn } from "node:child_process";
import { access, copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import process from "node:process";

const MAX_CHANGED_FRACTION = 0.002;
const MAX_CHANNEL_DELTA = 16;
const PORT = 43_127;
const SESSION = `issue24-visual-goldens-${process.pid}`;
const ROOT = process.cwd();
const GOLDEN_DIRECTORY = resolve(ROOT, "tests/ui/planner-controls/goldens");
const INIT_SCRIPT = resolve(ROOT, "tests/ui/planner-controls/visual-clock-init.js");
const update = process.argv.includes("--update");

function executable(name) {
  try {
    return execFileSync("/usr/bin/env", ["which", name], { encoding: "utf8" }).trim();
  } catch {
    throw new Error(
      `Issue #24 visual evidence requires '${name}' on PATH. Install agent-browser and ImageMagick before retrying.`,
    );
  }
}

const agentBrowser = executable("agent-browser");
const magick = executable("magick");

function browser(...arguments_) {
  return execFileSync(agentBrowser, ["--session", SESSION, ...arguments_], {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function image(...arguments_) {
  return execFileSync(magick, arguments_, { cwd: ROOT, encoding: "utf8" }).trim();
}

async function waitForHarness(server) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw new Error(`Visual harness exited with ${server.exitCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}`);
      if (response.ok) return;
    } catch {
      // The disposable server may still be binding its port.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  }
  throw new Error(`Visual harness did not become ready on port ${PORT}`);
}

function parseJson(output, label) {
  try {
    const parsed = JSON.parse(output);
    return typeof parsed === "string" ? JSON.parse(parsed) : parsed;
  } catch {
    throw new Error(`Could not parse ${label}: ${output}`);
  }
}

async function capture(theme, directory) {
  browser("eval", `window.issue24Harness.setLocale("en")`);
  browser("eval", `window.issue24Harness.setZoom(1)`);
  browser("eval", `window.issue24Harness.setWidth(900)`);
  browser("eval", `window.issue24Harness.setTheme("${theme}")`);
  browser("eval", `window.issue24Harness.setReducedMotion(true)`);
  browser("eval", "window.issue24Harness.assertAcceptance()");
  const environment = parseJson(browser("eval", `JSON.stringify({
    clock: globalThis.__issue24VisualClock,
    dpr: devicePixelRatio,
    font: getComputedStyle(document.body).fontFamily,
    height: innerHeight,
    width: innerWidth
  })`), `${theme} browser environment`);
  if (environment.dpr !== 1 || environment.width !== 1_600 || environment.height !== 1_200
    || environment.font !== "Arial, sans-serif"
    || environment.clock?.epochMilliseconds !== 1_777_344_000_000
    || environment.clock?.performanceMilliseconds !== 1_000) {
    throw new Error(`Nondeterministic ${theme} browser environment: ${JSON.stringify(environment)}`);
  }
  const bounds = parseJson(browser("eval", `JSON.stringify((() => {
    const box = document.querySelector("#primary-leaf").getBoundingClientRect();
    return {
      height: Math.ceil(box.bottom) - Math.floor(box.top),
      width: Math.ceil(box.right) - Math.floor(box.left),
      x: Math.floor(box.left),
      y: Math.floor(box.top)
    };
  })())`), `${theme} crop bounds`);
  for (const key of ["height", "width", "x", "y"]) {
    if (!Number.isInteger(bounds[key]) || bounds[key] < 0) {
      throw new Error(`Invalid ${theme} crop bounds: ${JSON.stringify(bounds)}`);
    }
  }
  const viewport = join(directory, `${theme}-viewport.png`);
  const crop = join(directory, `${theme}.png`);
  browser("screenshot", viewport);
  image(viewport, "-crop", `${bounds.width}x${bounds.height}+${bounds.x}+${bounds.y}`, "+repage", crop);
  return crop;
}

async function compareGolden(theme, actual) {
  const golden = join(GOLDEN_DIRECTORY, `planner-controls-${theme}.png`);
  if (update) {
    await mkdir(GOLDEN_DIRECTORY, { recursive: true });
    await copyFile(actual, golden);
    console.log(`updated ${golden}`);
    return;
  }
  try {
    await access(golden, constants.R_OK);
  } catch {
    throw new Error(`Missing immutable golden ${golden}. Run this script once with --update, inspect it, then commit it.`);
  }
  const goldenSize = image("identify", "-format", "%wx%h", golden);
  const actualSize = image("identify", "-format", "%wx%h", actual);
  if (goldenSize !== actualSize) {
    throw new Error(`${theme} golden dimensions changed: expected ${goldenSize}, received ${actualSize}`);
  }
  const fraction = Number(image(
    golden,
    actual,
    "-compose", "difference",
    "-composite",
    "-alpha", "off",
    "-fx", `max(r,max(g,b))>${MAX_CHANNEL_DELTA}/255?1:0`,
    "-format", "%[fx:mean]",
    "info:",
  ));
  if (!Number.isFinite(fraction) || fraction > MAX_CHANGED_FRACTION) {
    throw new Error(
      `${theme} golden differs in ${(fraction * 100).toFixed(4)}% of pixels `
        + `(allowed ${(MAX_CHANGED_FRACTION * 100).toFixed(1)}%, channel delta ${MAX_CHANNEL_DELTA})`,
    );
  }
  console.log(`${theme}: ${(fraction * 100).toFixed(4)}% pixels changed`);
}

const directory = await mkdtemp(join(tmpdir(), "spiral-day-issue24-goldens-"));
const server = spawn(process.execPath, ["tests/ui/planner-controls/serve-visual-harness.mjs"], {
  cwd: ROOT,
  env: { ...process.env, SPIRAL_DAY_ISSUE24_HARNESS_PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverError = "";
server.stderr?.on("data", (chunk) => { serverError += String(chunk); });

try {
  await readFile(INIT_SCRIPT, "utf8");
  await waitForHarness(server);
  try { browser("close"); } catch {}
  browser("open", "--init-script", INIT_SCRIPT);
  browser("set", "viewport", "1600", "1200", "1");
  browser("navigate", `http://127.0.0.1:${PORT}`);
  browser("wait", "--fn", "window.issue24Harness !== undefined");
  for (const theme of ["light", "dark"]) {
    const actual = await capture(theme, directory);
    await compareGolden(theme, actual);
  }
} catch (error) {
  if (serverError.trim()) console.error(serverError.trim());
  throw error;
} finally {
  try { browser("close"); } catch {}
  server.kill("SIGTERM");
  await rm(directory, { force: true, recursive: true });
}
