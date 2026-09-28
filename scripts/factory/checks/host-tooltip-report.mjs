#!/usr/bin/env node
// FAC-102 AC2: planner tooltip evidence must record an accessible Alpha label,
// a real hover on the plugin's external label, the observed >=900ms tooltip
// delay, and zero new page errors.

import path from "node:path";
import { assertFile, evidenceDir, fail, readJson } from "./lib.mjs";

const envDir = process.env.FACTORY_EVIDENCE_DIR ?? evidenceDir("host-probe");
const tooltipFile = path.join(envDir, "host-tooltip", "evidence", "planner-tooltip.json");
assertFile(tooltipFile, "planner-tooltip.json");
const report = readJson(tooltipFile);

const name = report.target?.ariaLabel ?? report.target?.title;
if (!name) fail("tooltip target records no aria-label or title");
if (typeof report.accessibleTree !== "string" || !report.accessibleTree.includes(`img ${JSON.stringify(name)}`)) {
  fail("accessible tree does not name the planner Alpha label");
}
if (!Array.isArray(report.hovered) || !report.hovered.some((el) => el.class?.includes("spiral-day-planner__external-label"))) {
  fail("hover did not reach the planner external label element");
}
if (!(report.elapsedMilliseconds >= 900)) {
  fail(`tooltip delay not observed: ${report.elapsedMilliseconds}ms`);
}
if (!Array.isArray(report.newPageErrors) || report.newPageErrors.length !== 0) {
  fail(`page errors during hover: ${JSON.stringify(report.newPageErrors)}`);
}
console.log(`host-tooltip: accessible name ${JSON.stringify(name)}, ${report.elapsedMilliseconds}ms delay, 0 page errors`);
