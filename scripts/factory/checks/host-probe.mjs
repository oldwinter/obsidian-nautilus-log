#!/usr/bin/env node
// FAC-102/FAC-103: drive the real installed Obsidian host through
// tests/host-matrix/run.mjs inside a disposable profile+vault, using a
// borrowed Playwright module. Evidence lands in the factory evidence dir.
//
// Modes: --mode tooltip (FAC-102 short read-only probe), --mode full
// (FAC-103 lifecycle cycles + real CLOCK write), --mode review (adds the
// Review read/write scenario), --mode privacy (adds the local-only privacy
// assertion scenario), --mode bound (tooltip scenario plus expected
// app/Electron version and candidate-SHA binding assertions), --mode
// forgotten (FAC-161 stale running-CLOCK recovery scenario).

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  REPO_ROOT, assertFile, evidenceDir, fail, findNode24, nextEvidenceDir, runLogged,
} from "./lib.mjs";

const { values } = parseArgs({ options: { mode: { type: "string", default: "tooltip" } } });
assertMode(values.mode);

const SCENARIO_FLAGS = { tooltip: "--planner-tooltip-only", review: "--review", privacy: "--privacy", bound: "--planner-tooltip-only", forgotten: "--forgotten" };
function assertMode(mode) {
  if (!["tooltip", "full", "review", "privacy", "bound", "forgotten"].includes(mode)) fail(`unknown --mode ${mode}`);
}

const evidence = evidenceDir("host-probe");
const output = nextEvidenceDir(evidence, `host-${values.mode}`);

// Built package assets are required; build only when absent so the check stays
// cheap under `verify` (the bundle is already validated upstream of the item).
const pkgDir = path.join(evidence, "plugin-pkg");
mkdirSync(pkgDir, { recursive: true });
for (const asset of ["main.js", "styles.css"]) {
  if (!existsSync(path.join(REPO_ROOT, asset))) {
    // Scoped inside pkgDir so the log always describes the pkg currently there.
    runLogged(process.execPath, ["esbuild.config.mjs", "build"], { log: path.join(pkgDir, "build.log") });
    break;
  }
}
for (const asset of ["main.js", "manifest.json", "styles.css"]) {
  const source = path.join(REPO_ROOT, asset);
  assertFile(source, `package asset ${asset}; run npm run build first`);
  copyFileSync(source, path.join(pkgDir, asset));
}

const executable = process.env.OBSIDIAN_EXECUTABLE
  ?? "/Applications/Obsidian.app/Contents/MacOS/Obsidian";
assertFile(executable, "installed Obsidian executable (set OBSIDIAN_EXECUTABLE)");

const playwright = process.env.PLAYWRIGHT_MODULE
  ?? path.join(process.env.HOME ?? "", "Code", "theme-hospital-hd", "node_modules", "playwright");
assertFile(path.join(playwright, "package.json"), "Playwright module (set PLAYWRIGHT_MODULE)");

const node24 = findNode24();
const args = [
  "tests/host-matrix/run.mjs",
  "--executable", executable,
  "--plugin-dir", pkgDir,
  "--output", output,
];
if (SCENARIO_FLAGS[values.mode]) args.push(SCENARIO_FLAGS[values.mode]);
if (values.mode === "bound") {
  const { OBSIDIAN_APP_VERSION = "1.13.7", OBSIDIAN_ELECTRON_VERSION = "43.3.0" } = process.env;
  args.push(
    "--expected-app-version", OBSIDIAN_APP_VERSION,
    "--expected-electron-version", OBSIDIAN_ELECTRON_VERSION,
    "--candidate-sha", execFileSync("git", ["rev-parse", "HEAD"], { cwd: REPO_ROOT, encoding: "utf8" }).trim(),
  );
}

const result = runLogged(node24, args, {
  env: { PLAYWRIGHT_MODULE: playwright },
  timeout: ["tooltip", "bound", "forgotten"].includes(values.mode) ? 240_000 : 600_000,
  // Versioned sibling of the output dir; a fixed name at the evidence root
  // silently overwrote the previous run's log on a same-attempt re-verify.
  log: `${output}.log`,
});
console.log(`host-probe(${values.mode}) exit ${result.status ?? "timeout"} -> ${output}`);
process.exitCode = result.status ?? 1;
