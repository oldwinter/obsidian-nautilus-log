import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function luminance(hex: string): number {
  const channels = hex.match(/[0-9a-f]{2}/gi)!.map((channel) => Number.parseInt(channel, 16) / 255);
  const [red, green, blue] = channels.map((channel) => channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red! + 0.7152 * green! + 0.0722 * blue!;
}

function contrast(first: string, second: string): number {
  const firstLuminance = luminance(first);
  const secondLuminance = luminance(second);
  return (Math.max(firstLuminance, secondLuminance) + 0.05)
    / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

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
  assert.match(css, /animation: none !important/);
  assert.match(css, /transition: none !important/);
  assert.match(css, /@media \(forced-colors: active\)/);
});

test("TC-OBS-VIS-002-001 fallback semantic text and focus/control boundaries meet contrast floors", () => {
  for (const color of ["0b668f", "b42334", "765200", "805800", "505967", "245fbd"]) {
    assert.ok(contrast("ffffff", color) >= 4.5, `light ${color} is below 4.5:1`);
  }
  for (const color of ["70c8ea", "ff8993", "f2ce72", "efbd5f", "b9c0cb", "8bb7ff"]) {
    assert.ok(contrast("202328", color) >= 4.5, `dark ${color} is below 4.5:1`);
  }
  assert.ok(contrast("ffffff", "707985") >= 3);
  assert.ok(contrast("202328", "949eac") >= 3);
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
