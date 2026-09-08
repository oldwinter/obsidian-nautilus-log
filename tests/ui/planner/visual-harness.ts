import {
  confirmedSnapshot,
  createProjectionRevision,
  errorSnapshot,
  loadingSnapshot,
  missingSnapshot,
  overLimitSnapshot,
  staleSnapshot,
  type RuntimeSnapshot,
} from "../../../src/runtime/snapshots.ts";
import {
  mountPlannerSurface,
  type PlannerRuntimePort,
  type PlannerViewContext,
} from "../../../src/ui/planner/view.ts";
import { BOUNDS, DISPLAYED_DATE, plannerProjection } from "./fixtures.ts";

type Story = "confirmed" | "loading" | "missing" | "over-limit" | "error" | "stale" | "past" | "future";

const leaf = document.querySelector<HTMLElement>("#planner-leaf")!;
const surfaceRoot = document.querySelector<HTMLElement>("#planner-surface")!;
const widthSelect = document.querySelector<HTMLSelectElement>("#width")!;
const storySelect = document.querySelector<HTMLSelectElement>("#story")!;
const themeSelect = document.querySelector<HTMLSelectElement>("#theme")!;
const contextSelect = document.querySelector<HTMLSelectElement>("#context")!;

let listener: ((snapshot: RuntimeSnapshot<ReturnType<typeof plannerProjection>>) => void) | undefined;
let generation = 0;
const runtimeVisibility: boolean[] = [];

function revision() {
  generation += 1;
  return createProjectionRevision({
    generation,
    path: "Journal/2026-08-28.md",
    sourceFingerprint: "sha256:visual-harness",
    settingsVersion: 1,
    logicalDate: DISPLAYED_DATE,
    minuteBucket: 1,
    timeZone: "Asia/Shanghai",
    grammarVersion: "v1",
  });
}

function snapshotFor(story: Story): RuntimeSnapshot<ReturnType<typeof plannerProjection>> {
  if (story === "confirmed") return confirmedSnapshot(revision(), plannerProjection());
  if (story === "past") return confirmedSnapshot(revision(), plannerProjection("past"));
  if (story === "future") return confirmedSnapshot(revision(), plannerProjection("future"));
  if (story === "loading") return loadingSnapshot(revision());
  if (story === "missing") return missingSnapshot(revision());
  if (story === "over-limit") {
    return overLimitSnapshot(revision(), { kind: "plan-items", actual: 1_001, limit: 1_000 });
  }
  if (story === "error") {
    return errorSnapshot(revision(), { code: "source-read-failed", retry: "explicit" });
  }
  const confirmed = confirmedSnapshot(revision(), plannerProjection());
  return staleSnapshot(confirmed, revision(), "invalidated");
}

const runtime: PlannerRuntimePort = {
  state: "ready",
  connect(_context, nextListener, visible = true) {
    runtimeVisibility.push(visible);
    listener = nextListener as typeof listener;
    if (visible) nextListener(snapshotFor(storySelect.value as Story));
    return Object.freeze({
      setContext() {},
      setVisible(nextVisible: boolean) {
        runtimeVisibility.push(nextVisible);
        if (nextVisible) nextListener(snapshotFor(storySelect.value as Story));
      },
      refresh() {},
      disconnect() {
        listener = undefined;
      },
    });
  },
};

function viewContext(): PlannerViewContext {
  return {
    logicalDate: DISPLAYED_DATE,
    bounds: BOUNDS,
    hostContext: contextSelect.value === "sidebar" ? "sidebar" : "main",
  };
}

const icons = {
  collapse: "^",
  expand: "v",
  "hide-completed": "o",
  "show-completed": "x",
  play: ">",
} as const;

const surface = mountPlannerSurface(surfaceRoot, runtime, viewContext(), {
  now: () => Date.now(),
  renderIcon: (button, icon) => {
    const glyph = document.createElement("span");
    glyph.className = "harness-icon";
    glyph.textContent = icons[icon];
    glyph.setAttribute("aria-hidden", "true");
    button.append(glyph);
  },
});

function setLeafWidth(width: number): void {
  leaf.style.width = `${width + 26}px`;
  leaf.dataset.width = String(width);
}

function applyWidth(): void {
  const width = Number(widthSelect.value);
  setLeafWidth(width);
  surface.measure();
}

function measuredSurfaceWidth(): number {
  const style = getComputedStyle(surfaceRoot);
  return surfaceRoot.clientWidth
    - Number.parseFloat(style.paddingLeft)
    - Number.parseFloat(style.paddingRight);
}

function overlaps(left: DOMRect, right: DOMRect, gap = 0): boolean {
  return left.left < right.right + gap
    && left.right + gap > right.left
    && left.top < right.bottom + gap
    && left.bottom + gap > right.top;
}

function assertWideBoundary() {
  const rootBounds = surfaceRoot.getBoundingClientRect();
  const svg = surfaceRoot.querySelector<SVGSVGElement>(".spiral-day-planner__spiral")!;
  const grid = surfaceRoot.querySelector<SVGPathElement>(".spiral-day-planner__grid-band")!;
  const labels = [...surfaceRoot.querySelectorAll<SVGGElement>(".spiral-day-planner__external-label")];
  const connectors = [...surfaceRoot.querySelectorAll<SVGPathElement>(".spiral-day-planner__connector")];
  const labelBounds = labels.map((label) => label.getBoundingClientRect());
  const connectorBounds = connectors.map((connector) => connector.getBoundingClientRect());
  const effectiveFonts = labels.map((label) => {
    const text = label.querySelector<SVGTextElement>("text")!;
    return Number.parseFloat(getComputedStyle(text).fontSize) * Math.abs(text.getScreenCTM()?.a ?? 1);
  });
  const collisions = labelBounds.flatMap((left, leftIndex) => labelBounds
    .slice(leftIndex + 1)
    .filter((right) => overlaps(left, right, 1)));
  const gridBounds = grid.getBoundingClientRect();
  const fittedRailKinds = new Set(labels.flatMap((label) => {
    const text = label.querySelector<SVGTextElement>("text")!;
    const title = label.querySelector("title")?.textContent ?? "";
    if (!text.textContent?.endsWith("…") || title.length <= text.textContent.length) return [];
    const script = /[\u3400-\u9fff]/u.test(title) ? "cjk" : "latin";
    return [`${text.getAttribute("text-anchor")}:${script}`];
  }));
  const expectedRailKinds = ["end:latin", "end:cjk", "start:latin", "start:cjk"];
  const result = Object.freeze({
    width: measuredSurfaceWidth(),
    layout: surfaceRoot.dataset.layout,
    effectiveFont: Math.min(...effectiveFonts),
    chartWidth: gridBounds.width,
    chartHeight: gridBounds.height,
    labelsInside: labelBounds.every((bounds) => bounds.left >= rootBounds.left && bounds.right <= rootBounds.right),
    connectorsInside: connectorBounds.every(
      (bounds) => bounds.left >= rootBounds.left && bounds.right <= rootBounds.right,
    ),
    fittedRailKinds: [...fittedRailKinds].sort(),
    collisions: collisions.length,
    horizontalOverflow: surfaceRoot.scrollWidth > surfaceRoot.clientWidth,
    viewBox: svg.getAttribute("viewBox"),
  });
  if (result.width !== 521 || result.layout !== "wide" || result.effectiveFont < 10
    || result.chartWidth < 200 || result.chartHeight < 225 || !result.labelsInside
    || !result.connectorsInside
    || expectedRailKinds.some((kind) => !fittedRailKinds.has(kind))
    || result.collisions !== 0 || result.horizontalOverflow) {
    throw new Error(`521px wide visual contract failed: ${JSON.stringify(result)}`);
  }
  return result;
}

function assertCompactBoundary(expectedWidth: 519 | 520) {
  const result = Object.freeze({
    width: measuredSurfaceWidth(),
    layout: surfaceRoot.dataset.layout,
    labels: surfaceRoot.querySelectorAll(".spiral-day-planner__external-label").length,
    focusableSvg: surfaceRoot.querySelectorAll("svg [tabindex]").length,
    overview: Boolean(surfaceRoot.querySelector(".spiral-day-planner__overview")),
    schedule: Boolean(surfaceRoot.querySelector(".spiral-day-planner__schedule")),
    horizontalOverflow: surfaceRoot.scrollWidth > surfaceRoot.clientWidth,
  });
  if (result.width !== expectedWidth || result.layout !== "compact" || result.labels !== 0
    || result.focusableSvg !== 0 || !result.overview || !result.schedule || result.horizontalOverflow) {
    throw new Error(`${expectedWidth}px compact visual contract failed: ${JSON.stringify(result)}`);
  }
  return result;
}

widthSelect.addEventListener("change", applyWidth);
storySelect.addEventListener("change", () => listener?.(snapshotFor(storySelect.value as Story)));
themeSelect.addEventListener("change", () => {
  document.body.classList.toggle("theme-dark", themeSelect.value === "dark");
});
contextSelect.addEventListener("change", () => surface.setContext(viewContext()));
applyWidth();

Object.assign(window, {
  plannerHarness: {
    setWidth(width: number) {
      widthSelect.value = String(width);
      applyWidth();
    },
    setWidthBeforeObserver(width: number) {
      widthSelect.value = String(width);
      setLeafWidth(width);
    },
    setStory(story: Story) {
      storySelect.value = story;
      listener?.(snapshotFor(story));
    },
    setTheme(theme: "light" | "dark") {
      themeSelect.value = theme;
      document.body.classList.toggle("theme-dark", theme === "dark");
    },
    setLeafVisible(visible: boolean) {
      leaf.style.display = visible ? "" : "none";
    },
    runtimeVisibility() {
      return [...runtimeVisibility];
    },
    assertWideBoundary,
    assertCompactBoundary,
  },
});
