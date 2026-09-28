#!/usr/bin/env node
// FAC-101 AC1: run tests/performance/run.mjs under pinned Node 24.20.0.
//
// The lane refuses output inside either repository root, so its raw output
// goes to a fresh external directory and the review-relevant artifacts
// (report.json, run.log, pointer to the external location) are copied into
// the factory evidence dir afterwards. The lane is an ENV-PURE contribution;
// it is not a release gate and its own stated limitations apply.

import { copyFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { evidenceDir, fail, findNode24, runLogged } from "./lib.mjs";

const evidence = evidenceDir("performance");
const staged = path.join(evidence, "performance");
if (existsSync(staged)) fail(`staged evidence already exists: ${staged}`);

const node24 = findNode24();
const external = mkdtempSync(path.join(tmpdir(), "spiral-day-perf-"));
const output = path.join(external, "out");

const result = runLogged(node24, ["tests/performance/run.mjs", "--output", output], {
  log: path.join(evidence, "run.log"),
});

// Copy report artifacts into the factory evidence dir; keep the external
// source directory immutable for the lane's own isolation contract.
if (existsSync(path.join(output, "report.json"))) {
  const { mkdirSync } = await import("node:fs");
  mkdirSync(staged, { recursive: true });
  for (const file of ["report.json", "diagnostics.json"]) {
    const source = path.join(output, file);
    if (existsSync(source)) copyFileSync(source, path.join(staged, file));
  }
  writeFileSync(path.join(staged, "external-output.txt"), `${output}\n`);
}

console.log(`perf-lane exit ${result.status ?? "timeout"} -> ${output}`);
process.exitCode = result.status ?? 1;
