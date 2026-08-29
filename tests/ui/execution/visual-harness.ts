import { enExecution } from "../../../src/i18n/locales/en/execution";
import { zhCNExecution } from "../../../src/i18n/locales/zh-CN/execution";
import { createMessages, defineLocaleNamespace } from "../../../src/i18n/resolver";
import type {
  ExecutionApplicationIntent,
  ExecutionApplicationSnapshot,
} from "../../../src/runtime/execution/application";
import type { RuntimePlanProjection } from "../../../src/runtime/projection-runtime";
import type { RuntimeSnapshot } from "../../../src/runtime/snapshots";
import { renderActiveTaskSurface } from "../../../src/ui/execution/active-task-view";
import { mountExecutionPanel } from "../../../src/ui/execution/panel";

const NOW = Date.UTC(2026, 7, 29, 2, 14, 35);
const PATH = "Daily/2026-08-29.md";
const OWNER = "nl-11111111-1111-4111-8111-111111111111";
const messages = createMessages({
  locale: "en",
  namespaces: { execution: defineLocaleNamespace("execution", enExecution, zhCNExecution) },
});

function runtime(kind: "idle" | "active" | "pomo"): ExecutionApplicationSnapshot {
  const focused = kind === "active" ? {
    ownerId: OWNER,
    path: PATH,
    sourceOrder: 0,
    label: "Prepare exact-SHA release evidence",
    clock: {
      path: PATH,
      ownerId: OWNER,
      clockId: "nl-clock-11111111-1111-4111-8111-111111111111",
      fromOffset: 120,
      startEpochMs: NOW - 37 * 60_000,
      targetKey: "nl-clock-11111111-1111-4111-8111-111111111111",
    },
  } as const : undefined;
  return Object.freeze({
    generation: kind === "active" ? 3 : 2,
    status: "ready" as const,
    runtime: Object.freeze({
      status: "ready" as const,
      clocks: kind === "active"
        ? Object.freeze({
            kind: "active" as const,
            generation: 3,
            ownerId: OWNER,
            startEpochMs: focused!.clock.startEpochMs,
            clock: Object.freeze({
              path: PATH,
              fromOffset: 120,
              toOffset: 180,
              text: "CLOCK",
              ownerId: OWNER,
              clockId: focused!.clock.clockId,
              scope: "accepted-logbook" as const,
              parsed: Object.freeze({ kind: "record" as const, record: Object.freeze({
                format: "canonical" as const,
                state: "running" as const,
                startEpochMs: focused!.clock.startEpochMs,
                clockId: focused!.clock.clockId,
              }) }),
            }),
          })
        : Object.freeze({ kind: "idle" as const, generation: 2 }),
      writeBlocked: false,
      pluginDataRevision: 4,
    }),
    execution: kind === "active"
      ? Object.freeze({
          kind: "active" as const,
          ownerId: OWNER,
          clockId: focused!.clock.clockId,
          startEpochMs: focused!.clock.startEpochMs,
          elapsedMs: 37 * 60_000,
          taskPomoStartEpochMs: focused!.clock.startEpochMs,
        })
      : Object.freeze({ kind: "idle" as const }),
    writeBlocked: false,
    pomoThresholdMinutes: 30,
    standalonePomoStartEpochMs: kind === "pomo" ? NOW - 18 * 60_000 : null,
    ...(focused ? { focused } : {}),
  });
}

const items = [
  {
    kind: "flexible-task",
    status: "open",
    executionEligible: true,
    label: "Prepare exact-SHA release evidence",
    durationMinutes: 45,
    remainingDurationMinutes: 45,
    progressPercent: 0,
    urgent: true,
    sourceOrder: 0,
    source: { path: PATH, blockId: OWNER, sourceOrder: 0 },
  },
  {
    kind: "flexible-task",
    status: "open",
    executionEligible: true,
    label: "Verify keyboard and screen-reader states",
    durationMinutes: 30,
    remainingDurationMinutes: 20,
    progressPercent: 30,
    urgent: false,
    sourceOrder: 1,
    source: {
      path: PATH,
      blockId: "nl-22222222-2222-4222-8222-222222222222",
      sourceOrder: 1,
    },
  },
] as const;

const plan = Object.freeze({
  state: "confirmed" as const,
  authoritative: true as const,
  revision: Object.freeze({
    generation: 4,
    path: PATH,
    sourceFingerprint: "visual-harness",
    settingsVersion: 4,
    logicalDate: { year: 2026, month: 8, day: 29 },
    minuteBucket: Math.floor(NOW / 60_000),
    timeZone: "Asia/Shanghai",
    grammarVersion: "v1",
  }),
  mutationCapability: null,
  projection: Object.freeze({
    contextKey: "2026-08-29",
    sourcePath: PATH,
    sourceFingerprint: "visual-harness",
    displayedDate: { year: 2026, month: 8, day: 29 },
    today: { year: 2026, month: 8, day: 29 },
    items,
    diagnostics: [],
    day: {},
    schedule: {
      fixedEvents: [],
      plannedSlots: [{ task: items[0], startMinutes: 570, endMinutes: 615 }],
    },
    capacity: { metrics: [
      { kind: "available", minutes: 155 },
      { kind: "planned", minutes: 75 },
    ] },
  }),
}) as unknown as RuntimeSnapshot<RuntimePlanProjection>;

let snapshot = runtime("active");
const executionListeners = new Set<(value: ExecutionApplicationSnapshot) => void>();
const planListeners = new Set<(value: RuntimeSnapshot<RuntimePlanProjection>) => void>();
const trigger = document.querySelector<HTMLButtonElement>("#execution-trigger")!;
const activeTask = document.querySelector<HTMLElement>("#active-task")!;

function renderIcon(element: HTMLElement, icon: string): void {
  element.dataset.icon = icon;
  const glyph = document.createElement("span");
  glyph.className = "harness-icon";
  glyph.setAttribute("aria-hidden", "true");
  glyph.textContent = ({
    check: "✓", clock: "◷", "external-link": "↗", square: "■", timer: "◴", trash: "×", x: "×",
    "chevron-down": "⌄", "chevron-right": "›", focus: "◎", refresh: "↻",
  } as Record<string, string>)[icon] ?? "·";
  element.replaceChildren(glyph);
}

function publish(next: ExecutionApplicationSnapshot): void {
  snapshot = next;
  for (const listener of executionListeners) listener(snapshot);
  renderActive();
}

function renderActive(): void {
  renderActiveTaskSurface(activeTask, {
    snapshot,
    nowEpochMs: NOW,
    messages,
    renderIcon,
    onOpenSource: () => undefined,
  });
}

const surface = mountExecutionPanel({
  now: () => NOW,
  subscribeExecution(listener) {
    executionListeners.add(listener);
    listener(snapshot);
    return () => executionListeners.delete(listener);
  },
  subscribePlan(listener) {
    planListeners.add(listener);
    listener(plan);
    return () => planListeners.delete(listener);
  },
  async dispatch(intent: ExecutionApplicationIntent) {
    if (intent.type === "clock-out" || intent.type === "delete-clock") publish(runtime("idle"));
    else if (intent.type === "start-standalone-pomo") publish(runtime("pomo"));
    else if (intent.type === "stop-standalone-pomo") publish(runtime("idle"));
    else if (intent.type === "clock-in") publish(runtime("active"));
    return {
      intentId: intent.intentId,
      outcome: "applied" as const,
      snapshot: snapshot.runtime,
      pluginDataWarning: false,
    };
  },
  outcomeFeedback(outcome) {
    return {
      message: outcome.outcome === "applied"
        ? messages.t("execution", "notice.applied")
        : messages.t("execution", "notice.failed"),
      level: outcome.outcome === "applied" ? "info" : "warning",
    };
  },
  recent: () => [{
    key: "recent-1",
    ownerId: "nl-33333333-3333-4333-8333-333333333333",
    path: PATH,
    sourceOrder: 2,
    label: "Check release artifact hashes",
    actualMinutes: 12,
  }],
  navigatePrimary: () => undefined,
  navigateTask: () => undefined,
}, { trigger, messages, renderIcon });

for (const button of document.querySelectorAll<HTMLButtonElement>("[data-state]")) {
  button.addEventListener("click", () => publish(runtime(button.dataset.state as "active" | "idle" | "pomo")));
}
document.querySelector<HTMLButtonElement>("#locale")!.addEventListener("click", (event) => {
  const next = messages.locale === "en" ? "zh" : "en";
  messages.setLocale(next);
  (event.currentTarget as HTMLButtonElement).textContent = next === "zh" ? "English" : "中文";
  surface.setLocale();
  renderActive();
});
document.querySelector<HTMLButtonElement>("#theme")!.addEventListener("click", (event) => {
  document.body.classList.toggle("theme-dark");
  (event.currentTarget as HTMLButtonElement).textContent = document.body.classList.contains("theme-dark")
    ? "Light"
    : "Dark";
});
document.querySelector<HTMLButtonElement>("#width")!.addEventListener("click", (event) => {
  document.body.classList.toggle("harness-narrow");
  (event.currentTarget as HTMLButtonElement).textContent = document.body.classList.contains("harness-narrow")
    ? "Wide"
    : "Narrow";
});

renderActive();
surface.open();

Object.assign(window, {
  executionHarness: {
    inspect() {
      const panel = document.querySelector<HTMLElement>(".spiral-day-execution")!;
      const rect = panel.getBoundingClientRect();
      return {
        bottom: rect.bottom,
        height: rect.height,
        horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        open: surface.isOpen,
        right: rect.right,
        viewportHeight: document.documentElement.clientHeight,
        viewportWidth: document.documentElement.clientWidth,
      };
    },
    surface,
  },
});
