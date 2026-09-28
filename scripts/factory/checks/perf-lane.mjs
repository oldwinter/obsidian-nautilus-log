#!/usr/bin/env node
// FAC-101 AC1: run tests/performance/run.mjs under pinned Node 24.20.0 into a
// fresh factory evidence directory. The lane is an ENV-PURE contribution; it
// is not a release gate and its own stated limitations apply.

import { existsSync } from "node:fs";
import path from "node:path";
import { evidenceDir, findNode24, fail, runLogged } from "./lib.mjs";

const evidence = evidenceDir("performance");
const output = path.join(evidence, "performance");
if (existsSync(output)) fail(`output directory already exists: ${output}`);

const node24 = findNode24();
const result = runLogged(node24, ["tests/performance/run.mjs", "--output", output], {
  log: path.join(evidence, "run.log"),
});
console.log(`perf-lane exit ${result.status ?? "timeout"} -> ${output}`);
process.exitCode = result.status ?? 1;
