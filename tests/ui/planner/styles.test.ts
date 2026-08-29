import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function contrastOnWhite(hex: string): number {
  const channels = hex.match(/[0-9a-f]{2}/gi)!.map((channel) => Number.parseInt(channel, 16) / 255);
  const [red, green, blue] = channels.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
  return 1.05 / (luminance + 0.05);
}

test("UP-VIS-05 styles preserve semantic tokens, exact breakpoints, focus, and reduced motion", async () => {
  const css = await readFile("styles/planner.css", "utf8");
  for (const token of ["--spiral-day-task", "--spiral-day-urgent", "--spiral-day-event", "--spiral-day-warning"]) {
    assert.match(css, new RegExp(token));
  }
  assert.match(css, /@container spiral-day-planner \(max-width: 520px\)/);
  assert.match(css, /@container spiral-day-planner \(max-width: 360px\)/);
  assert.match(css, /max-height: 48vh/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /opacity: 0\.38/);
  assert.doesNotMatch(css, /external-label\[data-tone="completed"\][\s\S]*?opacity: 0\.72/);
  assert.match(css, /var\(--spiral-day-border, var\(--background-modifier-border/);
});

test("UP-VIS-05 light semantic text tokens meet WCAG AA contrast", async () => {
  const css = await readFile("styles/planner.css", "utf8");
  for (const token of ["task", "event", "completed"]) {
    const color = css.match(new RegExp(`--spiral-day-${token}: #(\\w{6})`))?.[1];
    assert.ok(color, `missing ${token} token`);
    assert.ok(contrastOnWhite(color) >= 4.5, `${token} contrast is below 4.5:1`);
  }
});

test("UP-VIS-01 planner sections remain uncarded and disclosures are unframed", async () => {
  const css = await readFile("styles/planner.css", "utf8");
  const disclosure = css.match(/\.spiral-day-planner__disclosure \{([\s\S]*?)\n\}/)?.[1] ?? "";
  assert.match(disclosure, /border-radius: 0/);
  assert.match(disclosure, /border-top: 1px/);
  assert.doesNotMatch(disclosure, /box-shadow/);
});
