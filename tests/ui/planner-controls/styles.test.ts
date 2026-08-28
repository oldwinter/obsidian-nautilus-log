import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { constrainedPlannerContentWidth } from "./harness-layout.ts";

test("TC-OBS-VIS-002-001 theme layer supports light, dark, custom, high contrast, and non-color cues", async () => {
  const css = await readFile("styles/theme.css", "utf8");
  for (const token of ["--spiral-day-theme-task", "--spiral-day-theme-urgent", "--spiral-day-theme-event", "--spiral-day-theme-focus"]) {
    assert.match(css, new RegExp(token));
  }
  assert.match(css, /\.theme-dark \.spiral-day-planner/);
  assert.match(css, /\.spiral-day-theme-high-contrast \.spiral-day-planner/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /stroke-dasharray/);
  assert.match(css, /text-decoration: line-through/);
});

test("TC-OBS-A11Y-001-002 a11y layer separates focus, stabilizes controls, and removes motion", async () => {
  const css = await readFile("styles/a11y.css", "utf8");
  assert.match(css, /:focus-visible/);
  assert.match(css, /0 0 0 4px var\(--spiral-day-focus\)/);
  assert.match(css, /block-size: 32px/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /\[data-reduced-motion="true"\]/);
  assert.match(css, /animation: none !important/);
  assert.match(css, /transition: none !important/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /@container spiral-day-planner \(max-width: 360px\)/);
  assert.match(css, /overview-body[\s\S]*metric-label[\s\S]*white-space: normal/);
  assert.equal(constrainedPlannerContentWidth(900, 800), 777);
  assert.equal(constrainedPlannerContentWidth(521, 800), 521);
  assert.equal(constrainedPlannerContentWidth(520, 800), 520);
  assert.equal(constrainedPlannerContentWidth(900, 2_000), 900);
});

test("TC-UP-DRF-06-001 owned production files contain no Tidy or Undo controls", async () => {
  const paths = [
    "src/ui/planner/controls.ts",
    "src/ui/planner/disclosures.ts",
    "src/ui/planner/focus.ts",
    "src/ui/planner/playback.ts",
  ];
  const source = (await Promise.all(paths.map((path) => readFile(path, "utf8")))).join("\n");
  assert.doesNotMatch(source, /control\.(?:tidy|undo)|\"(?:Tidy|Undo) planner\"/);
});
