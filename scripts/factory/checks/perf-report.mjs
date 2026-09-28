#!/usr/bin/env node
// FAC-101 AC2: the performance report must record a terminal PASS and retain
// its stated limitations. Reads the report written by perf-lane.mjs inside the
// current FACTORY_EVIDENCE_DIR (or the newest performance-* evidence dir).

import path from "node:path";
import { REPO_ROOT, assertFile, evidenceDir, fail, newestDirectory, readJson } from "./lib.mjs";

const envDir = process.env.FACTORY_EVIDENCE_DIR;
const reportFile = envDir
  ? path.join(envDir, "performance", "report.json")
  : path.join(
      newestDirectory(path.join(REPO_ROOT, ".codex", "runtime", "devin-factory", "evidence"), "performance")
        ?? fail("no performance-* evidence directory"),
      "performance",
      "report.json",
    );

assertFile(reportFile, "performance report");
const report = readJson(reportFile);

if (report.result !== "PASS") {
  fail(`performance result is ${report.result}: ${(report.failures ?? []).map((f) => f.id ?? f).join("; ")}`);
}
if (!Array.isArray(report.limitations) || report.limitations.length === 0) {
  fail("performance report retains no limitations");
}

const measured = Array.isArray(report.measurements) ? report.measurements.length : 0;
const assertions = Array.isArray(report.assertions) ? report.assertions.length : 0;
const failed = (report.assertions ?? []).filter((row) => row.passed === false).length;
console.log(
  `perf-report: PASS — ${measured} measurements, ${assertions} assertions ` +
  `(${failed} failed), ${report.limitations.length} limitations retained`,
);
