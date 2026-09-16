import { createMessages, defineLocaleNamespace } from "../../src/i18n/resolver";
import { enExecution } from "../../src/i18n/locales/en/execution";
import { zhCNExecution } from "../../src/i18n/locales/zh-CN/execution";
import { enReview } from "../../src/i18n/locales/en/review";
import { zhCNReview } from "../../src/i18n/locales/zh-CN/review";
import { PRIMARY_PLAN_MARKERS } from "../../src/ui/onboarding/first-run";
import {
  confirmedSnapshot,
  createProjectionRevision,
  missingSnapshot,
} from "../../src/runtime/snapshots";
import {
  mountPlannerSurface,
  type PlannerRuntimePort,
  type PlannerViewContext,
} from "../../src/ui/planner/view";
import { BOUNDS, DISPLAYED_DATE, plannerProjection } from "../../tests/ui/planner/fixtures";
import { renderPlanView } from "../../src/ui/execution/plan-view";
import { renderTimingView } from "../../src/ui/execution/timing-view";
import { renderActiveTaskSurface } from "../../src/ui/execution/active-task-view";
import { ReviewView } from "../../src/ui/execution/review-view";
import type { ExecutionApplicationSnapshot } from "../../src/runtime/execution/application";
import type { RuntimePlanProjection } from "../../src/runtime/projection-runtime";
import type { RuntimeSnapshot } from "../../src/runtime/snapshots";
import type { ReviewCoordinatorSnapshot } from "../../src/runtime/review/coordinator";

const SCENES = [
  "enable-plugin",
  "settings-first-run",
  "open-planner-ribbon",
  "daily-note-markers",
  "planner-empty-guidance",
  "planner-scheduled-day",
  "enable-execution",
  "timing-idle",
  "plan-tab",
  "review-tab",
  "active-task",
  "daily-loop",
] as const;

type Scene = (typeof SCENES)[number];

const messages = createMessages({
  locale: "en",
  namespaces: {
    execution: defineLocaleNamespace("execution", enExecution, zhCNExecution),
    review: defineLocaleNamespace("review", enReview, zhCNReview),
  },
});

const params = new URLSearchParams(window.location.search);
const scene = (params.get("scene") ?? "enable-plugin") as Scene;
if (params.get("capture") === "1") document.body.classList.add("capture");

const picker = document.querySelector("#picker");
if (picker) {
  for (const name of SCENES) {
    const link = document.createElement("a");
    link.href = `/?scene=${name}`;
    link.textContent = name;
    picker.append(link);
  }
}

const root = document.querySelector("#root")!;

function el<K extends keyof HTMLElementTagNameMap>(name: K, className?: string, text?: string) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function shell(options: {
  title: string;
  file?: string;
  ribbon?: "planner" | "execution";
  caption: string;
}): HTMLElement {
  const app = el("div", "obsidian");
  const ribbon = el("aside", "ribbon");
  const files = el("button", options.ribbon === "execution" ? "" : "active", "☰");
  const planner = el("button", options.ribbon === "execution" ? "" : "active", "🐚");
  planner.title = "Open Spiral Day";
  const timing = el("button", options.ribbon === "execution" ? "active" : "", "◷");
  timing.title = "Execution";
  ribbon.append(files, planner, timing);
  const sidebar = el("aside", "sidebar");
  sidebar.append(el("h2", undefined, "Files"));
  for (const name of ["2026-08-28.md", "Inbox.md", "Projects.md"]) {
    const file = el("div", name === (options.file ?? "2026-08-28.md") ? "file active" : "file", name);
    sidebar.append(file);
  }
  const workspace = el("main", "workspace");
  workspace.append(el("div", "workspace-title", options.title));
  const body = el("div", "workspace-body");
  workspace.append(body);
  app.append(ribbon, sidebar, workspace);
  const wrap = el("div");
  wrap.append(app, el("p", "caption", options.caption));
  root.append(wrap);
  return body;
}

function revision() {
  return createProjectionRevision({
    generation: 1,
    path: "2026-08-28.md",
    sourceFingerprint: "sha256:guide",
    settingsVersion: 1,
    logicalDate: DISPLAYED_DATE,
    minuteBucket: 1,
    timeZone: "Asia/Shanghai",
    grammarVersion: "v1",
  });
}

function plannerContext(): PlannerViewContext {
  return { logicalDate: DISPLAYED_DATE, bounds: BOUNDS, hostContext: "main" };
}

function mountPlanner(target: HTMLElement, snapshot: RuntimeSnapshot<RuntimePlanProjection>) {
  const runtime: PlannerRuntimePort = {
    state: "ready",
    connect(_context, listener) {
      listener(snapshot);
      return { setContext() {}, setVisible() {}, refresh() {}, disconnect() {} };
    },
  };
  mountPlannerSurface(target, runtime, plannerContext(), {
    locale: "en",
    onInsertPrimaryPlan: () => undefined,
    renderIcon(button, icon) {
      button.textContent = ({
        collapse: "⌃",
        expand: "⌄",
        copy: "⧉",
        debug: "#",
        "hide-completed": "◌",
        "show-completed": "●",
        play: "▶",
        refresh: "↻",
      } as Record<string, string>)[icon] ?? "·";
    },
  });
}

function idleExecution(): ExecutionApplicationSnapshot {
  return {
    generation: 2,
    status: "ready",
    runtime: { status: "ready", clocks: { kind: "idle", generation: 2 }, writeBlocked: false, pluginDataRevision: 1 },
    execution: { kind: "idle" },
    writeBlocked: false,
    pomoThresholdMinutes: 45,
    standalonePomoStartEpochMs: null,
  } as ExecutionApplicationSnapshot;
}

function confirmedPlanSnapshot() {
  return confirmedSnapshot(revision(), plannerProjection());
}

function missingPlanSnapshot() {
  return missingSnapshot(revision());
}

function renderIcon(element: HTMLElement, icon: string) {
  element.textContent = ({
    check: "✓", clock: "◷", refresh: "↻", timer: "◴", x: "×",
  } as Record<string, string>)[icon] ?? "·";
}

function settingsScene(executionOn: boolean) {
  const body = shell({
    title: "Settings · Spiral Day",
    caption: executionOn
      ? "Enable Execution Layer to reveal Timing, Plan, Review, and commands."
      : "First-run checklist in Settings → Spiral Day.",
  });
  const card = el("section", "spiral-day-settings-onboarding");
  card.append(el("h3", undefined, messages.t("execution", "settings.onboardingTitle")));
  const steps = el("ol");
  for (const key of [
    "status.missingStepNote",
    "status.missingStepMarkers",
    "status.missingStepItems",
    "status.missingStepRefresh",
  ] as const) {
    steps.append(el("li", undefined, messages.t("planner", key)));
  }
  const markers = el("pre", "spiral-day-onboarding__markers");
  markers.append(el("code", undefined, PRIMARY_PLAN_MARKERS));
  const actions = el("div", "spiral-day-onboarding__actions");
  actions.append(el("button", "spiral-day-onboarding__copy", messages.t("planner", "status.missingCopyMarkers")));
  actions.append(el("button", "spiral-day-onboarding__insert", messages.t("planner", "status.missingInsert")));
  card.append(steps, markers, actions, el("p", undefined, messages.t("execution", "settings.onboardingExecution")));
  const rows = el("div", "settings-card");
  rows.append(card);
  const row = el("div", "setting-row");
  row.append(el("strong", undefined, "Execution Layer"), el("div", executionOn ? "toggle" : "toggle off"));
  rows.append(row);
  body.append(rows);
}

function communityPluginsScene() {
  const body = shell({
    title: "Settings · Community plugins",
    caption: "Enable Spiral Day. The plugin folder and ID are spiral-day.",
  });
  const card = el("div", "settings-card");
  card.append(el("h3", undefined, "Installed plugins"));
  const row = el("div", "setting-row");
  row.append(el("div", undefined, "Spiral Day  0.1.0"), el("div", "toggle"));
  card.append(row);
  body.append(card);
}

switch (scene) {
  case "enable-plugin":
    communityPluginsScene();
    break;
  case "settings-first-run":
    settingsScene(false);
    break;
  case "enable-execution":
    settingsScene(true);
    break;
  case "open-planner-ribbon": {
    const body = shell({
      title: "Spiral Day - 2026-08-28",
      ribbon: "planner",
      caption: "Ribbon shell icon Open Spiral Day opens today's Planner.",
    });
    const hint = el("div", "settings-card");
    hint.append(
      el("h3", undefined, "Open Spiral Day"),
      el("p", undefined, "The highlighted shell-ribbon icon opens today's Planner. Execution Layer stays off until you enable it in Settings."),
    );
    body.append(hint);
    break;
  }
  case "daily-note-markers": {
    const body = shell({
      title: "2026-08-28.md",
      caption: "Primary Plan markers must sit at column zero in today's Daily Note.",
    });
    body.append(el("pre", "note", `${PRIMARY_PLAN_MARKERS.split("\n")[0]}
- [ ] 09:00-09:30 Stand-up ^stand-up
- [ ] Write the release note 45m
- Lunch 12:00-13:00
${PRIMARY_PLAN_MARKERS.split("\n")[1]}`));
    break;
  }
  case "planner-empty-guidance": {
    const body = shell({
      title: "Spiral Day - 2026-08-28",
      caption: "Empty Planner lists the HTML markers and the next action.",
    });
    const surface = el("div", "surface-card");
    body.append(surface);
    mountPlanner(surface, missingPlanSnapshot());
    break;
  }
  case "planner-scheduled-day": {
    const body = shell({
      title: "Spiral Day - 2026-08-28",
      caption: "A valid Primary Plan projects capacity, the spiral, and overflow.",
    });
    const surface = el("div", "surface-card");
    surface.style.minHeight = "640px";
    body.append(surface);
    mountPlanner(surface, confirmedPlanSnapshot());
    break;
  }
  case "timing-idle": {
    const body = shell({
      title: "Execution · Timing",
      ribbon: "execution",
      caption: "Timing idle state now says how to Clock In.",
    });
    const surface = el("div", "surface-card");
    body.append(surface);
    renderTimingView(surface, {
      nowEpochMs: Date.UTC(2026, 7, 28, 10, 0),
      snapshot: idleExecution(),
      recent: [],
      pending: new Set(),
      messages,
      renderIcon,
      dispatch() {},
      refresh() {},
      openActiveTask() {},
      navigateTask() {},
      requestDelete() {},
    });
    break;
  }
  case "plan-tab": {
    const body = shell({
      title: "Execution · Plan",
      ribbon: "execution",
      caption: "Plan tab Clock In / Complete actions for open flexible tasks.",
    });
    const surface = el("div", "surface-card");
    body.append(surface);
    renderPlanView(surface, {
      nowEpochMs: Date.UTC(2026, 7, 28, 10, 0),
      snapshot: confirmedPlanSnapshot(),
      execution: idleExecution(),
      pending: new Set(),
      messages,
      renderIcon,
      dispatch() {},
      navigateTask() {},
    });
    break;
  }
  case "review-tab": {
    const body = shell({
      title: "Execution · Review",
      ribbon: "execution",
      caption: "Review explains a missing Primary Plan instead of a blank panel.",
    });
    const surface = el("div", "surface-card");
    body.append(surface);
    const view = new ReviewView(surface, {
      today: () => DISPLAYED_DATE,
      selectDate() {},
      refresh() {},
      setOnlyOverruns() {},
      activate() {},
      insertPrimaryPlan: () => undefined,
    });
    const review = {
      state: "ready",
      generation: 1,
      displayedDate: DISPLAYED_DATE,
      availability: "missing-plan",
      projectedAtEpochMilliseconds: 0,
      historyGeneration: 1,
      historyDiagnostics: [],
      completedHistory: [],
      pastUnplanned: [],
      projection: {
        rows: [],
        summary: {
          completed: 0,
          total: 0,
          compared: 0,
          plannedMinutes: 0,
          actualMinutes: 0,
          varianceMinutes: 0,
        },
        diagnostics: { malformedClocks: 0, potentialRunningClocks: 0 },
      },
    } as ReviewCoordinatorSnapshot;
    view.render({
      review,
      execution: idleExecution(),
      messages,
      pending: false,
      error: false,
      onlyOverruns: false,
    });
    break;
  }
  case "active-task": {
    const body = shell({
      title: "Active Task",
      ribbon: "execution",
      caption: "Right-sidebar Active Task tells you how to start a CLOCK.",
    });
    const surface = el("div", "surface-card");
    body.append(surface);
    renderActiveTaskSurface(surface, {
      snapshot: idleExecution(),
      nowEpochMs: Date.UTC(2026, 7, 28, 10, 0),
      messages,
      renderIcon,
      onOpenSource() {},
      onCopyLink() {},
      onClockOut() {},
    });
    break;
  }
  case "daily-loop": {
    const body = shell({
      title: "Daily loop",
      caption: "Plan in the Daily Note → Planner → Execution Timing / Plan / Review.",
    });
    const grid = el("div", "loop");
    const cards = [
      ["1. Daily Note", "Write the Primary Plan markers and today's list items."],
      ["2. Planner", "Open the shell ribbon to see the spiral schedule and capacity."],
      ["3. Execution", "Enable Execution Layer, then Clock In from Plan or the editor."],
      ["4. Review", "Compare planned vs recorded time, including completed overruns."],
    ] as const;
    for (const [title, text] of cards) {
      const article = el("article");
      article.append(el("h3", undefined, title), el("p", undefined, text));
      grid.append(article);
    }
    body.append(grid);
    break;
  }
  default:
    communityPluginsScene();
}
