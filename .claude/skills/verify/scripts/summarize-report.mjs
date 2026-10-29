#!/usr/bin/env node
// Summarize a Spiral Day host-matrix report: host identity, every assertion, the
// screenshots and the limitations the run itself recorded.
//
//   node summarize-report.mjs <report.json>
//
// Exits 0 when every assertion passed, 1 otherwise, so a caller can gate on it.
import { readFile } from "node:fs/promises";

const path = process.argv[2];
if (!path) {
  console.error("usage: summarize-report.mjs <report.json>");
  process.exit(2);
}
const report = JSON.parse(await readFile(path, "utf8"));
const host = report.host ?? {};
const appVersion = host.installerVersion?.stdout?.trim() ?? "?";
const electronVersion = host.runtime?.versions?.electron ?? "?";
console.log(`status: ${report.status}`);
console.log(`host: ${host.executable ?? "?"} · app ${appVersion} · electron ${electronVersion} · runner node ${host.runnerNode ?? "?"}`);
const assertions = report.assertions ?? [];
const failed = assertions.filter((assertion) => !assertion.passed);
for (const assertion of assertions) {
  const verdict = assertion.passed ? "PASS" : "FAIL";
  const observed = assertion.passed ? "" : ` → ${JSON.stringify(assertion.observed)}`;
  console.log(`  ${verdict} ${assertion.id}${observed}`);
}
const screenshots = (report.screenshots ?? []).map((entry) => entry?.name ?? entry?.file ?? entry).filter(Boolean);
if (screenshots.length > 0) console.log(`screenshots: ${screenshots.join(", ")}`);
console.log(`assertions: ${assertions.length - failed.length}/${assertions.length} passed`);
if (failed.length > 0) {
  console.log(`failed: ${failed.map((assertion) => assertion.id).join(", ")}`);
  process.exit(1);
}
