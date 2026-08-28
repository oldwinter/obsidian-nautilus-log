import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { constrainedPlannerContentWidth } from "./harness-layout.ts";

test("TC-OBS-VIS-002-001 theme layer supports light, dark, custom, high contrast, and non-color cues", async () => {
  const css = await readFile("styles/theme.css", "utf8");
  const viewSource = await readFile("src/ui/planner/view.ts", "utf8");
  const profile = JSON.parse(await readFile(
    "tests/ui/planner-controls/env-vis-profile.json",
    "utf8",
  )) as {
    readonly browser: Readonly<{ executable: string; version: string }>;
    readonly captures: readonly Readonly<{
      readonly locale: string;
      readonly state: string;
      readonly theme: string;
      readonly width: number;
    }>[];
    readonly clock: Readonly<{ epochMilliseconds: number; performanceMilliseconds: number }>;
    readonly deviceScaleFactor: number;
    readonly esbuild: string;
    readonly lucide: string;
    readonly pngjs: string;
    readonly font: Readonly<{ css: string; resolvedFamily: string; resolvedFile: string }>;
    readonly image: Readonly<{ digest: string; repository: string; tag: string }>;
    readonly node: string;
    readonly os: Readonly<{ id: string; prettyName: string; versionId: string }>;
    readonly playwright: string;
    readonly pixelComparison: Readonly<{ channelDelta: number; maxDifferentPixelRatio: number }>;
    readonly revision: string;
    readonly viewport: Readonly<{ height: number; width: number }>;
  };
  const runner = await readFile("tests/ui/planner-controls/run-visual-evidence.mjs", "utf8");
  const containerRunner = await readFile(
    "tests/ui/planner-controls/run-visual-evidence-container.mjs",
    "utf8",
  );
  for (const token of ["--spiral-day-theme-task", "--spiral-day-theme-urgent", "--spiral-day-theme-event", "--spiral-day-theme-focus"]) {
    assert.match(css, new RegExp(token));
  }
  assert.match(css, /\.theme-dark \.spiral-day-planner/);
  assert.match(css, /\.spiral-day-theme-high-contrast \.spiral-day-planner/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /stroke-dasharray/);
  assert.match(css, /text-decoration: line-through/);
  for (const className of [
    "spiral-day-planner__debug-geometry",
    "spiral-day-planner__debug-rectangle",
    "spiral-day-planner__debug-center-marker",
    "spiral-day-planner__debug-guide-circle",
  ]) {
    assert.match(viewSource, new RegExp(className));
    assert.match(css, new RegExp(`\\.${className}`));
  }
  for (const marker of ["canvas-bounds", "radial-bounds", "center", "guide-circle"]) {
    assert.match(viewSource, new RegExp(`debugMarker = \\"${marker}\\"`));
  }
  assert.match(viewSource, /debug\.geometry[\s\S]*width:[\s\S]*height:[\s\S]*innerRadius:[\s\S]*outerRadius:[\s\S]*bandWidth:/);
  assert.deepEqual(profile.image, {
    repository: "mcr.microsoft.com/playwright",
    tag: "v1.62.1-noble",
    digest: "sha256:dcc5531e97840b9b5e794f2814476b21571c5124a3fca2267d73041f56e7580e",
  });
  assert.deepEqual(profile.os, {
    id: "ubuntu",
    versionId: "24.04",
    prettyName: "Ubuntu 24.04.4 LTS",
  });
  assert.equal(profile.node, "24.18.1");
  assert.equal(profile.playwright, "1.62.1");
  assert.equal(profile.esbuild, "0.28.2");
  assert.equal(profile.lucide, "1.35.0");
  assert.equal(profile.pngjs, "7.0.0");
  assert.deepEqual(profile.pixelComparison, { channelDelta: 16, maxDifferentPixelRatio: 0.002 });
  assert.deepEqual(profile.browser, {
    executable: "/ms-playwright/chromium-1234/chrome-linux/chrome",
    version: "151.0.7922.34",
  });
  assert.deepEqual(profile.viewport, { width: 1_440, height: 1_000 });
  assert.equal(profile.deviceScaleFactor, 1);
  assert.deepEqual(profile.font, {
    css: "Arial, sans-serif",
    resolvedFamily: "Liberation Sans",
    resolvedFile: "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
  });
  assert.deepEqual(profile.clock, {
    epochMilliseconds: 1_777_344_000_000,
    performanceMilliseconds: 1_000,
  });
  assert.match(profile.revision, /^r[1-9][0-9]*$/);
  assert.deepEqual(new Set(profile.captures.map((capture) => capture.width)), new Set([900, 521, 520, 519, 360, 320]));
  assert.deepEqual(new Set(profile.captures.map((capture) => capture.locale)), new Set(["en", "zh-CN"]));
  assert.deepEqual(new Set(profile.captures.map((capture) => capture.theme)), new Set(["light", "dark"]));
  for (const state of [
    "temporal",
    "playback",
    "tooltip",
    "dense",
    "topbar",
    "topbar-completed-hidden",
    "topbar-collapsed",
    "topbar-debug",
    "reduced-motion",
  ]) {
    assert.ok(profile.captures.some((capture) => capture.state === state), `missing ${state} capture`);
  }
  assert.ok(profile.captures.length <= 12, "capture set must stay bounded");
  assert.match(runner, /--network[", ]+none/);
  assert.doesNotMatch(runner, /agent-browser|(?:^|["'])magick(?:["']|$)/m);
  assert.match(
    containerRunner,
    /assertAdapterLifecycle\(\)[\s\S]*runMatrix\(\)[\s\S]*assertAcceptance\(\)/,
  );
  for (const interaction of [
    "assertConnectFailureState",
    "assertRuntimeProbeInterval",
    "assertExternalFocusPreserved",
    "assertKeyboardPointerParity",
    "assertLayoutFocusRestoration",
    "assertLifecycleReparenting",
    "assertMediaQueryLifecycle",
    "assertPlaybackStopsOnContextChange",
    "assertPlaybackStopsOnRuntimeState",
    "assertReplicaRemount",
    "assertTooltipClearsWhenHidden",
  ]) {
    assert.match(containerRunner, new RegExp(`\\"${interaction}\\"`));
  }
  assert.match(await readFile("tests/ui/planner-controls/visual-harness.ts", "utf8"), /probeDelay === 5_000/);
  for (const initiationApi of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon"]) {
    assert.match(containerRunner, new RegExp(initiationApi));
  }
  assert.match(containerRunner, /performance\.getEntriesByType\("resource"\)/);
  assert.match(containerRunner, /request\.resourceType\(\)/);
  assert.match(containerRunner, /PNG\.sync\.read/);
  assert.match(containerRunner, /differentPixelRatio <= comparison\.maxDifferentPixelRatio/);
  assert.doesNotMatch(containerRunner, /\.equals\(expected\)/);
  assert.match(containerRunner, /locator\(["']#primary-planner["']\)/);
  assert.doesNotMatch(containerRunner, /locator\(["']#primary-leaf["']\)/);
  assert.match(
    containerRunner,
    /\.harness-toolbar, \.planner-leaf__title \{ visibility: hidden !important; \}/,
  );
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
