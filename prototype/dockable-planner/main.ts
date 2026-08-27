import {
  ItemView,
  Notice,
  Plugin,
  TFile,
  WorkspaceLeaf,
  setIcon,
} from "obsidian";

const VIEW_TYPE = "spiral-day-planner-prototype";
const SOURCE_PATH = "2026-08-28.md";
const TARGET_ID = "demo-release";

type VariantKey = "A" | "B" | "C";
type LayoutMode = "compact" | "wide";
type DemoStage =
  | "idle"
  | "preview"
  | "conflict-injected"
  | "rejected"
  | "fresh"
  | "applied"
  | "recovered"
  | "error";

type ItemKind = "event" | "task" | "urgent" | "done" | "overflow";

interface PlanItem {
  id: string;
  kind: ItemKind;
  title: string;
  time: string;
  minutes: number;
  startMinute?: number;
  endMinute?: number;
  progress?: number;
}

interface SourceAnalysis {
  lines: string[];
  lineEnding: "\n" | "\r\n";
  openMarkerIndex: number;
  closeMarkerIndex: number;
  targetLineIndex: number;
  targetBoundaryIndex: number;
  targetLine: string;
  runningClockLine: string | null;
}

interface WriteExpectation {
  digest: string;
  targetLine: string;
  source: string;
}

const VARIANTS: ReadonlyArray<{ key: VariantKey; name: string }> = [
  { key: "A", name: "Spiral first" },
  { key: "B", name: "Chronological rail" },
  { key: "C", name: "Operations columns" },
];

const PLAN_ITEMS: ReadonlyArray<PlanItem> = [
  {
    id: "fixed-design-sync",
    kind: "event",
    title: "Design sync / 设计同步",
    time: "09:00–09:45",
    minutes: 45,
    startMinute: 9 * 60,
    endMinute: 9 * 60 + 45,
  },
  {
    id: "deep-work",
    kind: "task",
    title: "Deep work on renderer semantics / 深度工作",
    time: "09:45–10:53",
    minutes: 68,
    startMinute: 9 * 60 + 45,
    endMinute: 10 * 60 + 53,
    progress: 25,
  },
  {
    id: "urgent-layout",
    kind: "urgent",
    title: "Ship bilingual layout before 18:00 / 完成双语布局",
    time: "10:53–11:38",
    minutes: 45,
    startMinute: 10 * 60 + 53,
    endMinute: 11 * 60 + 38,
  },
  {
    id: "lunch",
    kind: "event",
    title: "Lunch and walk / 午餐与散步",
    time: "12:00–13:00",
    minutes: 60,
    startMinute: 12 * 60,
    endMinute: 13 * 60,
  },
  {
    id: "source-spans",
    kind: "done",
    title: "Audit source spans / 检查源区间",
    time: "13:00–13:30",
    minutes: 30,
    startMinute: 13 * 60,
    endMinute: 13 * 60 + 30,
    progress: 100,
  },
  {
    id: "release-notes",
    kind: "task",
    title: "Write release notes with an unusually long English and 中文混合标题",
    time: "13:30–14:15",
    minutes: 45,
    startMinute: 13 * 60 + 30,
    endMinute: 14 * 60 + 15,
  },
  {
    id: "customer-follow-up",
    kind: "task",
    title: "Customer follow-up / 客户跟进",
    time: "14:15–14:45",
    minutes: 30,
    startMinute: 14 * 60 + 15,
    endMinute: 14 * 60 + 45,
  },
  {
    id: "overflow-refactor",
    kind: "overflow",
    title: "Refactor every scheduler edge case / 重构所有调度边界",
    time: "Unscheduled",
    minutes: 180,
  },
  {
    id: "overflow-review",
    kind: "overflow",
    title: "Review custom-theme contrast / 检查主题对比度",
    time: "Unscheduled",
    minutes: 40,
  },
];

function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  return element;
}

function iconButton(
  icon: string,
  label: string,
  onClick: () => void,
  options: { text?: string; className?: string } = {},
): HTMLButtonElement {
  const button = createElement("button", `sd-button ${options.className ?? ""}`.trim());
  button.type = "button";
  button.ariaLabel = label;
  button.title = label;
  const iconSlot = createElement("span", "sd-button__icon");
  setIcon(iconSlot, icon);
  button.append(iconSlot);
  if (options.text) button.append(createElement("span", "sd-button__text", options.text));
  button.addEventListener("click", onClick);
  return button;
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? `${hours}h ${String(remainder).padStart(2, "0")}m` : `${remainder}m`;
}

function spiralLabel(item: PlanItem): string {
  const labels: Record<string, string> = {
    "fixed-design-sync": "Design / 设计同步",
    "deep-work": "Render / 渲染",
    "urgent-layout": "Layout / 双语",
    lunch: "Lunch / 午餐散步",
    "source-spans": "Source / 源区间",
    "release-notes": "Release / 发布",
    "customer-follow-up": "Client / 客户",
  };
  return labels[item.id] ?? item.title;
}

function formatClockTimestamp(date: Date): string {
  const pad = (value: number, length = 2) => String(value).padStart(length, "0");
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    weekday,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`,
    `${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`,
  ].join(" ");
}

async function sha256(source: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function analyzeSource(source: string): SourceAnalysis {
  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  const openMarkerIndex = lines.findIndex((line) => line.trimEnd() === "<!-- nautilus-log:plan/v1 -->");
  if (openMarkerIndex < 0) throw new Error("The exact Plan Region opening marker is missing.");
  const closeMarkerIndex = lines.findIndex(
    (line, index) => index > openMarkerIndex && line.trimEnd() === "<!-- /nautilus-log:plan -->",
  );
  if (closeMarkerIndex < 0) throw new Error("The exact Plan Region closing marker is missing.");

  const targetPattern = new RegExp(`^[-+*] \\[ \\] .+ \\^${TARGET_ID}[ \\t]*$`);
  const targetLineIndex = lines.findIndex(
    (line, index) => index > openMarkerIndex && index < closeMarkerIndex && targetPattern.test(line),
  );
  if (targetLineIndex < 0) throw new Error(`Open Flexible Task ^${TARGET_ID} is missing or ineligible.`);

  const idOccurrences = source.match(new RegExp(`\\^${TARGET_ID}(?=[ \\t]*(?:\\r?\\n|$))`, "g"))?.length ?? 0;
  if (idOccurrences !== 1) throw new Error(`Plan Item ID ^${TARGET_ID} is not unique in the source.`);

  let targetBoundaryIndex = closeMarkerIndex;
  for (let index = targetLineIndex + 1; index < closeMarkerIndex; index += 1) {
    if (/^[-+*] (?:\[[ xX]\] )?/.test(lines[index])) {
      targetBoundaryIndex = index;
      break;
    }
  }
  const targetBody = lines.slice(targetLineIndex + 1, targetBoundaryIndex);
  const runningPattern = /^\s+- CLOCK: \[[^\]]+ [+-]\d{2}:\d{2}\] \^nl-clock-[0-9a-f-]{36}\s*$/;
  const runningClockLine = targetBody.find((line) => runningPattern.test(line)) ?? null;

  return {
    lines,
    lineEnding,
    openMarkerIndex,
    closeMarkerIndex,
    targetLineIndex,
    targetBoundaryIndex,
    targetLine: lines[targetLineIndex],
    runningClockLine,
  };
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

class PlannerPrototypeView extends ItemView {
  private root!: HTMLElement;
  private headerHost!: HTMLElement;
  private variantHost!: HTMLElement;
  private proofHost!: HTMLElement;
  private stateOutput!: HTMLElement;
  private switchLabel!: HTMLElement;
  private resizeObserver: ResizeObserver | null = null;
  private layoutMutationObserver: MutationObserver | null = null;
  private themeObserver: MutationObserver | null = null;
  private variantIndex = 0;
  private layout: LayoutMode = "wide";
  private measuredWidth = 0;
  private filter = "";
  private demoStage: DemoStage = "idle";
  private expectation: WriteExpectation | null = null;
  private exactPreview = "";
  private trace: string[] = [];
  private busy = false;
  private recoveredClock: string | null = null;
  private collapsed = false;
  private showCompleted = true;
  private overviewOpen = false;
  private scheduleOpen = false;
  private overflowOpen = false;
  private playback = false;
  private playbackStartedAt = 0;
  private playbackTimer: number | null = null;

  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Spiral Day planner prototype";
  }

  getIcon(): string {
    return "calendar-clock";
  }

  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("spiral-day-prototype-view");
    this.root = createElement("main", "sd-planner");
    this.root.tabIndex = -1;
    this.root.dataset.layout = this.layout;
    this.contentEl.append(this.root);
    this.scheduleOpen = !this.contentEl.closest(".mod-sidedock");

    this.renderShell();
    this.resizeObserver = new ResizeObserver(() => this.measureLayout());
    this.resizeObserver.observe(this.root);
    const dock = this.contentEl.closest(".mod-sidedock");
    if (dock) {
      this.layoutMutationObserver = new MutationObserver(() => this.measureLayout());
      this.layoutMutationObserver.observe(dock, { attributes: true, attributeFilter: ["style"] });
    }
    this.measureLayout();
    window.requestAnimationFrame(() => this.measureLayout());
    this.registerInterval(window.setInterval(() => this.measureLayout(), 150));
    this.registerDomEvent(window, "resize", () => this.measureLayout());

    this.themeObserver = new MutationObserver(() => this.updateStateOutput());
    this.themeObserver.observe(document.body, { attributes: true, attributeFilter: ["class"] });

    this.registerDomEvent(document, "keydown", (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (isEditableTarget(event.target)) return;
      if (!this.root.isConnected) return;
      event.preventDefault();
      this.cycleVariant(event.key === "ArrowRight" ? 1 : -1);
    });

    await this.recoverFromMarkdown(false);
  }

  private measureLayout(): void {
    if (!this.root?.isConnected) return;
    const nextWidth = Math.round(this.root.getBoundingClientRect().width);
    const nextLayout: LayoutMode = nextWidth <= 520 ? "compact" : "wide";
    const changed = nextLayout !== this.layout;
    if (!changed && nextWidth === this.measuredWidth) return;
    this.measuredWidth = nextWidth;
    this.layout = nextLayout;
    this.root.dataset.layout = nextLayout;
    if (changed) this.renderVariant();
    this.updateStateOutput();
  }

  async onClose(): Promise<void> {
    if (this.playbackTimer !== null) window.clearInterval(this.playbackTimer);
    this.resizeObserver?.disconnect();
    this.layoutMutationObserver?.disconnect();
    this.themeObserver?.disconnect();
    this.contentEl.removeClass("spiral-day-prototype-view");
    this.contentEl.empty();
  }

  private renderShell(): void {
    this.root.empty();
    this.headerHost = createElement("div", "sd-header-host");
    this.root.append(this.headerHost);
    this.renderCurrentHeader();
    this.root.append(this.renderExecutionStrip());

    this.variantHost = createElement("section", "sd-variant-host");
    this.root.append(this.variantHost);

    this.proofHost = createElement("section", "sd-proof-host");
    this.root.append(this.proofHost);

    const stateDetails = createElement("details", "sd-state");
    stateDetails.append(createElement("summary", "sd-state__summary", "Visible state"));
    this.stateOutput = createElement("pre", "sd-state__output");
    stateDetails.append(this.stateOutput);
    this.root.append(stateDetails);

    const harness = createElement("footer", "sd-harness-rail");
    harness.append(createElement("span", "sd-harness-rail__label", "Prototype variants"));
    harness.append(this.renderSwitcher());
    this.contentEl.append(harness);
    this.renderVariant();
    this.renderWriteProof();
    this.updateStateOutput();
  }

  private renderCurrentHeader(): void {
    if (!this.headerHost) return;
    this.headerHost.replaceChildren(
      VARIANTS[this.variantIndex].key === "A" ? this.renderParityHeader() : this.renderPrototypeHeader(),
    );
  }

  private renderPrototypeHeader(): HTMLElement {
    const header = createElement("header", "sd-header");
    const identity = createElement("div", "sd-header__identity");
    identity.append(createElement("div", "sd-kicker", "FRIDAY · 28 AUG 2026"));
    identity.append(createElement("h1", "sd-title", "Spiral Day / 螺旋日程"));
    header.append(identity);

    const search = createElement("label", "sd-filter");
    const icon = createElement("span", "sd-filter__icon");
    setIcon(icon, "search");
    search.append(icon);
    const input = createElement("input", "sd-filter__input");
    input.type = "search";
    input.placeholder = "Filter plan / 筛选";
    input.ariaLabel = "Filter planner items";
    input.value = this.filter;
    input.addEventListener("input", () => {
      this.filter = input.value;
      this.renderVariant();
      this.updateStateOutput();
    });
    search.append(input);
    header.append(search);
    return header;
  }

  private renderParityHeader(): HTMLElement {
    const header = createElement("header", "sd-parity-header");
    header.setAttribute("aria-label", "Spiral Day planner capacity and controls");
    if (this.collapsed) header.classList.add("sd-parity-header--collapsed");

    const controls = createElement("div", "sd-parity-controls");
    const collapse = iconButton(
      this.collapsed ? "chevrons-up-down" : "chevrons-down-up",
      this.collapsed ? "Expand planner" : "Collapse planner",
      () => {
        this.collapsed = !this.collapsed;
        this.renderCurrentHeader();
        this.renderVariant();
        this.updateStateOutput();
      },
      { className: "sd-parity-control" },
    );
    controls.append(collapse);

    if (this.collapsed) {
      header.append(controls);
      return header;
    }

    const completed = iconButton(
      this.showCompleted ? "eye" : "eye-off",
      this.showCompleted ? "Hide completed items" : "Show completed items",
      () => {
        this.showCompleted = !this.showCompleted;
        this.renderCurrentHeader();
        this.renderVariant();
        this.updateStateOutput();
      },
      { className: "sd-parity-control" },
    );
    completed.setAttribute("aria-pressed", String(this.showCompleted));

    const playback = iconButton(
      this.playback ? "loader-circle" : "play",
      this.playback ? "Playback in progress" : "Play six-second day preview",
      () => this.startPlayback(),
      { className: "sd-parity-control" },
    );
    playback.disabled = this.playback;
    controls.append(completed, playback);

    const metrics = this.renderMetrics(false);
    metrics.classList.add("sd-parity-metrics");
    const actions = createElement("div", "sd-parity-actions");
    actions.append(controls, this.renderLegend());
    header.append(metrics, actions);
    return header;
  }

  private startPlayback(): void {
    if (this.playback) return;
    this.playback = true;
    this.playbackStartedAt = Date.now();
    this.renderCurrentHeader();
    this.renderVariant();
    this.updateStateOutput();
    this.playbackTimer = window.setInterval(() => {
      if (Date.now() - this.playbackStartedAt >= 6000) {
        if (this.playbackTimer !== null) window.clearInterval(this.playbackTimer);
        this.playbackTimer = null;
        this.playback = false;
      }
      this.renderCurrentHeader();
      this.renderVariant();
      this.updateStateOutput();
    }, 250);
  }

  private playbackLabel(): string {
    if (!this.playback) return "11:42";
    const progress = Math.min(1, (Date.now() - this.playbackStartedAt) / 6000);
    const minute = 9 * 60 + Math.round(progress * 9 * 60);
    return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  }

  private renderExecutionStrip(): HTMLElement {
    const strip = createElement("section", "sd-execution");
    strip.setAttribute("aria-label", "Active execution status");

    const clock = createElement("div", "sd-execution__item sd-execution__item--clock");
    const clockIcon = createElement("span", "sd-execution__icon");
    setIcon(clockIcon, "timer");
    clock.append(clockIcon);
    const clockText = createElement("div", "sd-execution__copy");
    clockText.append(createElement("span", "sd-execution__label", "CLOCK · 00:42:18"));
    clockText.append(createElement("strong", "sd-execution__title", "Deep work / 深度工作"));
    clock.append(clockText);

    const pomo = createElement("div", "sd-execution__item sd-execution__item--pomo");
    const pomoIcon = createElement("span", "sd-execution__icon");
    setIcon(pomoIcon, "circle-dot-dashed");
    pomo.append(pomoIcon);
    const pomoText = createElement("div", "sd-execution__copy");
    pomoText.append(createElement("span", "sd-execution__label", "POMO · 12:07"));
    pomoText.append(createElement("strong", "sd-execution__title", "Focus cycle 3 / 专注周期 3"));
    pomo.append(pomoText);

    strip.append(clock, pomo);
    return strip;
  }

  private renderSwitcher(): HTMLElement {
    const switcher = createElement("nav", "sd-switcher");
    switcher.setAttribute("aria-label", "Prototype variant switcher");
    const previous = iconButton("chevron-left", "Previous variant", () => this.cycleVariant(-1), {
      className: "sd-switcher__arrow",
    });
    this.switchLabel = createElement("div", "sd-switcher__label");
    this.switchLabel.setAttribute("aria-live", "polite");
    const next = iconButton("chevron-right", "Next variant", () => this.cycleVariant(1), {
      className: "sd-switcher__arrow",
    });
    switcher.append(previous, this.switchLabel, next);
    this.updateSwitcherLabel();
    return switcher;
  }

  private cycleVariant(delta: number): void {
    this.variantIndex = (this.variantIndex + delta + VARIANTS.length) % VARIANTS.length;
    this.renderCurrentHeader();
    this.renderVariant();
    this.updateSwitcherLabel();
    this.updateStateOutput();
  }

  private updateSwitcherLabel(): void {
    if (!this.switchLabel) return;
    const current = VARIANTS[this.variantIndex];
    this.switchLabel.replaceChildren(
      createElement("strong", "sd-switcher__key", current.key),
      createElement("span", "sd-switcher__name", current.name),
    );
  }

  private filteredItems(): PlanItem[] {
    const query = this.filter.trim().toLocaleLowerCase();
    return PLAN_ITEMS.filter(
      (item) => (this.showCompleted || item.kind !== "done")
        && (!query || item.title.toLocaleLowerCase().includes(query)),
    );
  }

  private renderVariant(): void {
    if (!this.variantHost) return;
    this.variantHost.empty();
    const key = VARIANTS[this.variantIndex].key;
    this.variantHost.classList.toggle("is-collapsed", key === "A" && this.collapsed);
    if (key === "A") this.variantHost.append(this.renderVariantA());
    if (key === "B") this.variantHost.append(this.renderVariantB());
    if (key === "C") this.variantHost.append(this.renderVariantC());
  }

  private renderVariantA(): HTMLElement {
    const section = createElement("div", "sd-variant sd-variant-a");
    section.dataset.variant = "A";
    if (this.collapsed) return section;
    section.append(this.renderSpiral());

    const compactOverview = createElement("details", "sd-disclosure sd-compact-overview");
    compactOverview.open = this.overviewOpen;
    compactOverview.addEventListener("toggle", () => {
      this.overviewOpen = compactOverview.open;
    });
    compactOverview.append(createElement("summary", "sd-disclosure__summary", "Overview · 2h 07m open / 概览"));
    compactOverview.append(this.renderMetrics());
    section.append(compactOverview);

    const compactSchedule = createElement("details", "sd-disclosure sd-compact-schedule");
    compactSchedule.open = this.scheduleOpen;
    compactSchedule.addEventListener("toggle", () => {
      this.scheduleOpen = compactSchedule.open;
    });
    const scheduleItems = this.filteredItems().filter((item) => item.kind !== "overflow");
    compactSchedule.append(
      createElement("summary", "sd-disclosure__summary", `Schedule · ${scheduleItems.length} items / 日程`),
    );
    compactSchedule.append(this.renderScheduleList(scheduleItems));
    section.append(compactSchedule);
    section.append(this.renderOverflowDisclosure());
    return section;
  }

  private renderMetrics(includeLegend = true): HTMLElement {
    const metrics = createElement("section", "sd-metrics");
    metrics.setAttribute("aria-label", "Capacity overview");
    const values = [
      ["Window", "09:00–18:00"],
      ["Fixed", "1h 45m"],
      ["Flexible", "3h 08m"],
      ["Available", "2h 07m"],
    ];
    for (const [label, value] of values) {
      const metric = createElement("div", "sd-metric");
      metric.append(createElement("span", "sd-metric__label", label));
      metric.append(createElement("strong", "sd-metric__value", value));
      metrics.append(metric);
    }
    if (includeLegend) metrics.append(this.renderLegend());
    return metrics;
  }

  private renderLegend(): HTMLElement {
    const legend = createElement("div", "sd-legend");
    legend.setAttribute("aria-label", "Planner legend");
    for (const [kind, label] of [
      ["urgent", "Urgent"],
      ["event", "Fixed"],
      ["task", "Flexible"],
    ]) {
      const entry = createElement("span", "sd-legend__entry");
      const dot = createElement("span", `sd-dot sd-dot--${kind}`);
      entry.append(dot, document.createTextNode(label));
      legend.append(entry);
    }
    return legend;
  }

  private renderSpiral(): HTMLElement {
    const frame = createElement("div", "sd-spiral-frame");
    const svg = createSvgElement("svg", {
      class: "sd-spiral",
      viewBox: this.layout === "compact" ? "105 20 390 390" : "0 0 600 420",
      role: "img",
      "aria-label": "Spiral schedule from 09:00 to 18:00",
    });
    const grid = createSvgElement("g", { class: "sd-spiral__grid", "aria-hidden": "true" });
    for (const radius of [58, 92, 126, 160]) {
      grid.append(createSvgElement("circle", { cx: "300", cy: "210", r: String(radius) }));
    }
    for (let hour = 9; hour <= 18; hour += 1) {
      const angle = ((hour - 9) / 9) * Math.PI * 6.2 - Math.PI / 2;
      const radius = 52 + ((hour - 9) / 9) * 116;
      const x = 300 + Math.cos(angle) * radius;
      const y = 210 + Math.sin(angle) * radius;
      const label = createSvgElement("text", { x: String(x), y: String(y), class: "sd-spiral__hour" });
      label.textContent = String(hour).padStart(2, "0");
      grid.append(label);
    }
    svg.append(grid);

    const background = createSvgElement("path", {
      d: this.spiralPath(9 * 60, 18 * 60),
      class: "sd-spiral__track",
      "aria-hidden": "true",
    });
    svg.append(background);

    const visible = this.filteredItems().filter(
      (item) => item.kind !== "overflow" && item.startMinute !== undefined && item.endMinute !== undefined,
    );
    visible.forEach((item) => {
      const group = createSvgElement("g", {
        class: `sd-spiral-item sd-spiral-item--${item.kind}`,
        role: "img",
        tabindex: "0",
        "aria-label": `${item.title}. ${item.time}. ${formatMinutes(item.minutes)}.`,
      });
      const title = createSvgElement("title", {});
      title.textContent = `${item.title} · ${item.time} · ${formatMinutes(item.minutes)}`;
      const focusHalo = createSvgElement("path", {
        d: this.spiralPath(item.startMinute!, item.endMinute!),
        class: "sd-spiral-item__focus-halo",
        "aria-hidden": "true",
      });
      const path = createSvgElement("path", {
        d: this.spiralPath(item.startMinute!, item.endMinute!),
        class: "sd-spiral-item__segment",
      });
      group.append(title, focusHalo, path);
      if (item.progress && item.progress < 100) {
        group.append(
          createSvgElement("path", {
            d: this.spiralPath(item.startMinute!, item.startMinute! + item.minutes * (item.progress / 100)),
            class: "sd-spiral-item__progress",
          }),
        );
      }
      svg.append(group);
    });

    if (this.layout === "wide") this.renderOutsideLabels(svg, visible);

    const center = createSvgElement("g", { class: "sd-spiral__center", "aria-hidden": "true" });
    const centerDate = createSvgElement("text", { x: "300", y: "203" });
    centerDate.textContent = "AUG 28";
    const centerTime = createSvgElement("text", { x: "300", y: "225", class: "sd-spiral__now" });
    centerTime.textContent = this.playbackLabel();
    center.append(centerDate, centerTime);
    svg.append(center);
    frame.append(svg);
    return frame;
  }

  private renderOutsideLabels(svg: SVGSVGElement, items: PlanItem[]): void {
    const leftTracks = [92, 168, 244, 320];
    const rightTracks = [120, 206, 292];
    let leftIndex = 0;
    let rightIndex = 0;

    items.forEach((item, index) => {
      const isLeft = index % 2 === 0;
      const y = isLeft ? leftTracks[leftIndex++] : rightTracks[rightIndex++];
      const x = isLeft ? 115 : 485;
      const group = createSvgElement("g", {
        class: `sd-outside-label sd-outside-label--${item.kind}`,
        "aria-hidden": "true",
      });
      const dot = createSvgElement("circle", {
        cx: String(isLeft ? 124 : 476),
        cy: String(y - 3),
        r: "3.5",
        class: "sd-outside-label__dot",
      });
      const text = createSvgElement("text", {
        x: String(x),
        y: String(y),
        "text-anchor": isLeft ? "end" : "start",
        class: "sd-outside-label__title",
      });
      text.textContent = spiralLabel(item);
      const time = createSvgElement("text", {
        x: String(x),
        y: String(y + 15),
        "text-anchor": isLeft ? "end" : "start",
        class: "sd-outside-label__time",
      });
      time.textContent = item.time;
      group.append(dot, text, time);
      svg.append(group);
    });
  }

  private spiralPoint(minute: number): { x: number; y: number } {
    const normalized = Math.max(0, Math.min(1, (minute - 9 * 60) / (9 * 60)));
    const angle = normalized * Math.PI * 6.2 - Math.PI / 2;
    const radius = 52 + normalized * 116;
    return { x: 300 + Math.cos(angle) * radius, y: 210 + Math.sin(angle) * radius };
  }

  private spiralPath(startMinute: number, endMinute: number): string {
    const steps = Math.max(8, Math.ceil((endMinute - startMinute) / 4));
    const points: string[] = [];
    for (let index = 0; index <= steps; index += 1) {
      const minute = startMinute + ((endMinute - startMinute) * index) / steps;
      const point = this.spiralPoint(minute);
      points.push(`${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`);
    }
    return points.join(" ");
  }

  private renderVariantB(): HTMLElement {
    const section = createElement("div", "sd-variant sd-variant-b");
    section.dataset.variant = "B";
    const heading = createElement("div", "sd-section-heading");
    heading.append(createElement("h2", "sd-section-title", "Day rail / 时间轴"));
    heading.append(createElement("span", "sd-section-meta", "09:00–18:00 · 53% planned"));
    section.append(heading);

    const rail = createElement("div", "sd-day-rail");
    const timed = this.filteredItems().filter((item) => item.startMinute !== undefined);
    for (let hour = 9; hour <= 18; hour += 1) {
      const row = createElement("div", "sd-day-rail__hour");
      row.append(createElement("time", "sd-day-rail__time", `${String(hour).padStart(2, "0")}:00`));
      const slot = createElement("div", "sd-day-rail__slot");
      const matches = timed.filter((item) => Math.floor(item.startMinute! / 60) === hour);
      if (matches.length === 0) {
        slot.append(createElement("span", "sd-day-rail__available", hour < 15 ? "Available / 可用" : "Open capacity"));
      } else {
        for (const item of matches) slot.append(this.renderRailItem(item));
      }
      row.append(slot);
      rail.append(row);
    }
    section.append(rail);
    section.append(this.renderOverflowDisclosure());
    return section;
  }

  private renderRailItem(item: PlanItem): HTMLElement {
    const row = createElement("div", `sd-rail-item sd-rail-item--${item.kind}`);
    row.tabIndex = 0;
    row.setAttribute("aria-label", `${item.title}. ${item.time}.`);
    row.append(createElement("span", "sd-rail-item__bar"));
    const copy = createElement("div", "sd-rail-item__copy");
    copy.append(createElement("strong", "sd-rail-item__title", item.title));
    copy.append(createElement("span", "sd-rail-item__meta", `${item.time} · ${formatMinutes(item.minutes)}`));
    row.append(copy);
    if (item.progress !== undefined) {
      row.append(createElement("span", "sd-rail-item__progress", `${item.progress}%`));
    }
    return row;
  }

  private renderVariantC(): HTMLElement {
    const section = createElement("div", "sd-variant sd-variant-c");
    section.dataset.variant = "C";
    const capacity = createElement("div", "sd-capacity-band");
    capacity.append(createElement("strong", "sd-capacity-band__value", "2h 07m"));
    capacity.append(createElement("span", "sd-capacity-band__label", "open capacity / 剩余容量"));
    const meter = createElement("div", "sd-capacity-band__meter");
    meter.append(createElement("span", "sd-capacity-band__fixed"));
    meter.append(createElement("span", "sd-capacity-band__flex"));
    meter.append(createElement("span", "sd-capacity-band__open"));
    capacity.append(meter);
    section.append(capacity);

    const columns = createElement("div", "sd-ops-columns");
    const groups: Array<{ title: string; icon: string; items: PlanItem[]; tone: string }> = [
      {
        title: "Fixed events / 固定事件",
        icon: "calendar-range",
        items: this.filteredItems().filter((item) => item.kind === "event"),
        tone: "event",
      },
      {
        title: "Flexible tasks / 弹性任务",
        icon: "list-checks",
        items: this.filteredItems().filter((item) => ["task", "urgent", "done"].includes(item.kind)),
        tone: "task",
      },
      {
        title: "Overflow / 溢出",
        icon: "archive-restore",
        items: this.filteredItems().filter((item) => item.kind === "overflow"),
        tone: "overflow",
      },
    ];
    for (const group of groups) columns.append(this.renderOpsColumn(group));
    section.append(columns);
    return section;
  }

  private renderOpsColumn(group: {
    title: string;
    icon: string;
    items: PlanItem[];
    tone: string;
  }): HTMLElement {
    const column = createElement("section", `sd-ops-column sd-ops-column--${group.tone}`);
    const header = createElement("header", "sd-ops-column__header");
    const icon = createElement("span", "sd-ops-column__icon");
    setIcon(icon, group.icon);
    header.append(icon, createElement("h2", "sd-ops-column__title", group.title));
    header.append(createElement("span", "sd-ops-column__count", String(group.items.length)));
    column.append(header);
    const list = createElement("div", "sd-ops-list");
    for (const item of group.items) {
      const row = createElement("div", `sd-ops-row sd-ops-row--${item.kind}`);
      row.tabIndex = 0;
      row.append(createElement("strong", "sd-ops-row__title", item.title));
      row.append(createElement("span", "sd-ops-row__meta", `${item.time} · ${formatMinutes(item.minutes)}`));
      list.append(row);
    }
    column.append(list);
    return column;
  }

  private renderScheduleList(items: PlanItem[]): HTMLElement {
    const list = createElement("div", "sd-schedule-list");
    for (const item of items) {
      const row = createElement("div", `sd-schedule-row sd-schedule-row--${item.kind}`);
      row.append(createElement("span", `sd-dot sd-dot--${item.kind}`));
      row.append(createElement("time", "sd-schedule-row__time", item.time));
      row.append(createElement("span", "sd-schedule-row__title", item.title));
      list.append(row);
    }
    return list;
  }

  private renderOverflowDisclosure(): HTMLElement {
    const overflowItems = this.filteredItems().filter((item) => item.kind === "overflow");
    const details = createElement("details", "sd-disclosure sd-overflow");
    details.open = this.overflowOpen;
    details.addEventListener("toggle", () => {
      this.overflowOpen = details.open;
    });
    const total = overflowItems.reduce((sum, item) => sum + item.minutes, 0);
    details.append(
      createElement(
        "summary",
        "sd-disclosure__summary",
        `Unscheduled today / 今日未排 · ${formatMinutes(total)} · ${overflowItems.length}`,
      ),
    );
    details.append(this.renderScheduleList(overflowItems));
    return details;
  }

  private renderWriteProof(): void {
    if (!this.proofHost) return;
    this.proofHost.empty();
    const header = createElement("div", "sd-proof__header");
    const heading = createElement("div", "sd-proof__heading");
    heading.append(createElement("h2", "sd-section-title", "Markdown write proof"));
    heading.append(createElement("span", "sd-proof__path", SOURCE_PATH));
    header.append(heading);
    header.append(
      createElement(
        "span",
        `sd-proof__status sd-proof__status--${this.demoStage}`,
        this.demoStatusLabel(),
      ),
    );
    this.proofHost.append(header);

    const actions = createElement("div", "sd-proof__actions");
    const preview = iconButton("scan-text", "Preview exact source", () => void this.runAction(() => this.previewSource(false)), {
      text: "Preview source",
    });
    const inject = iconButton("file-warning", "Inject watched-line conflict", () => void this.runAction(() => this.injectConflict()), {
      text: "Inject conflict",
    });
    const stale = iconButton("shield-x", "Attempt stale write", () => void this.runAction(() => this.attemptStaleWrite()), {
      text: "Attempt stale write",
    });
    const refresh = iconButton("refresh-cw", "Refresh write intent", () => void this.runAction(() => this.previewSource(true)), {
      text: "Refresh intent",
    });
    const apply = iconButton("timer-reset", "Write one canonical CLOCK", () => void this.runAction(() => this.applyFreshWrite()), {
      text: "Write CLOCK",
      className: "mod-cta",
    });
    const reread = iconButton("rotate-ccw", "Re-read recovery state from Markdown", () => void this.runAction(() => this.recoverFromMarkdown(true)), {
      text: "Re-read Markdown",
    });

    preview.disabled = this.busy || this.demoStage === "applied" || this.demoStage === "recovered";
    inject.disabled = this.busy || this.demoStage !== "preview";
    stale.disabled = this.busy || this.demoStage !== "conflict-injected";
    refresh.disabled = this.busy || this.demoStage !== "rejected";
    apply.disabled = this.busy || this.demoStage !== "fresh";
    reread.disabled = this.busy;
    actions.append(preview, inject, stale, refresh, apply, reread);
    this.proofHost.append(actions);

    if (this.exactPreview) {
      const sourceDetails = createElement("details", "sd-source-preview");
      sourceDetails.open = true;
      sourceDetails.append(createElement("summary", "sd-source-preview__summary", "Exact source preview"));
      sourceDetails.append(createElement("pre", "sd-source-preview__code", this.exactPreview));
      this.proofHost.append(sourceDetails);
    }

    if (this.trace.length > 0) {
      const trace = createElement("ol", "sd-proof__trace");
      for (const entry of this.trace) trace.append(createElement("li", "sd-proof__trace-entry", entry));
      this.proofHost.append(trace);
    }
  }

  private demoStatusLabel(): string {
    const labels: Record<DemoStage, string> = {
      idle: "Idle · source-derived",
      preview: "Previewed · expectation captured",
      "conflict-injected": "Conflict injected",
      rejected: "Rejected safely · zero plugin bytes",
      fresh: "Fresh intent · ready",
      applied: "Applied · confirmed",
      recovered: "Recovered from Markdown",
      error: "Blocked · inspect trace",
    };
    return labels[this.demoStage];
  }

  private async runAction(action: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.renderWriteProof();
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.demoStage = "error";
      this.trace.push(`Blocked: ${message}`);
      new Notice(`Spiral Day prototype: ${message}`);
    } finally {
      this.busy = false;
      this.renderWriteProof();
      this.updateStateOutput();
    }
  }

  private getSourceFile(): TFile {
    const file = this.app.vault.getAbstractFileByPath(SOURCE_PATH);
    if (!(file instanceof TFile)) throw new Error(`Disposable fixture ${SOURCE_PATH} was not found.`);
    return file;
  }

  private async assertVaultUniqueTargetId(): Promise<void> {
    let occurrences = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      const source = await this.app.vault.cachedRead(file);
      occurrences += source.match(new RegExp(`\\^${TARGET_ID}(?=[ \\t]*(?:\\r?\\n|$))`, "g"))?.length ?? 0;
    }
    if (occurrences !== 1) throw new Error(`Plan Item ID ^${TARGET_ID} occurs ${occurrences} times in the vault.`);
  }

  private async previewSource(isRefresh: boolean): Promise<void> {
    const file = this.getSourceFile();
    const source = await this.app.vault.read(file);
    const analysis = analyzeSource(source);
    await this.assertVaultUniqueTargetId();
    if (analysis.runningClockLine) throw new Error("The target already owns a running CLOCK.");
    const digest = await sha256(source);
    this.expectation = { digest, targetLine: analysis.targetLine, source };
    this.exactPreview = source;
    this.demoStage = isRefresh ? "fresh" : "preview";
    this.trace.push(
      isRefresh
        ? `Fresh intent: SHA-256 ${digest.slice(0, 12)}…, ID unique, open Flexible Task revalidated.`
        : `Preview: exact ${source.length} bytes, SHA-256 ${digest.slice(0, 12)}…, target ^${TARGET_ID}.`,
    );
  }

  private async injectConflict(): Promise<void> {
    if (!this.expectation) throw new Error("Preview the source before injecting a conflict.");
    const file = this.getSourceFile();
    let injected = false;
    await this.app.vault.process(file, (current) => {
      const analysis = analyzeSource(current);
      if (analysis.targetLine !== this.expectation!.targetLine) return current;
      const changedLine = analysis.targetLine.replace(
        ` #launch ^${TARGET_ID}`,
        ` #launch conflict-injected ^${TARGET_ID}`,
      );
      if (changedLine === analysis.targetLine) return current;
      const nextLines = [...analysis.lines];
      nextLines[analysis.targetLineIndex] = changedLine;
      injected = true;
      return nextLines.join(analysis.lineEnding);
    });
    if (!injected) throw new Error("Conflict injection could not target the watched line.");
    this.demoStage = "conflict-injected";
    this.trace.push("Conflict fixture: changed only unowned watched text before the terminal ID.");
  }

  private async attemptStaleWrite(): Promise<void> {
    if (!this.expectation) throw new Error("No stale expectation exists.");
    const file = this.getSourceFile();
    const beforeAttempt = await this.app.vault.read(file);
    const beforeDigest = await sha256(beforeAttempt);
    let rejectedInsideTransform = false;

    await this.app.vault.process(file, (current) => {
      const analysis = analyzeSource(current);
      if (analysis.targetLine !== this.expectation!.targetLine) {
        rejectedInsideTransform = true;
        return current;
      }
      throw new Error("The stale fixture unexpectedly matched inside Vault.process().");
    });

    const afterAttempt = await this.app.vault.read(file);
    const afterDigest = await sha256(afterAttempt);
    if (!rejectedInsideTransform || beforeAttempt !== afterAttempt || beforeDigest !== afterDigest) {
      throw new Error("Safe rejection could not prove byte-identical before and after source.");
    }
    this.demoStage = "rejected";
    this.exactPreview = afterAttempt;
    this.trace.push(
      `Safe rejection: Vault.process() reparse saw changed watched bytes; SHA-256 stayed ${afterDigest.slice(0, 12)}…; zero plugin-write bytes.`,
    );
  }

  private async applyFreshWrite(): Promise<void> {
    if (!this.expectation || this.demoStage !== "fresh") throw new Error("Refresh the intent before writing.");
    const file = this.getSourceFile();
    const queueHeadSource = await this.app.vault.read(file);
    const queueHeadDigest = await sha256(queueHeadSource);
    if (queueHeadDigest !== this.expectation.digest) throw new Error("The refreshed source changed before commit.");
    await this.assertVaultUniqueTargetId();

    const clockId = `nl-clock-${crypto.randomUUID()}`;
    const clockLine = `    - CLOCK: [${formatClockTimestamp(new Date())}] ^${clockId}`;
    let applied = false;
    await this.app.vault.process(file, (current) => {
      const analysis = analyzeSource(current);
      if (analysis.targetLine !== this.expectation!.targetLine || analysis.runningClockLine) return current;

      const nextLines = [...analysis.lines];
      const targetBody = nextLines.slice(analysis.targetLineIndex + 1, analysis.targetBoundaryIndex);
      const drawerOffset = targetBody.findIndex((line) => /^\s+- LOGBOOK::$/.test(line));
      if (drawerOffset >= 0) {
        nextLines.splice(analysis.targetLineIndex + 2 + drawerOffset, 0, clockLine);
      } else {
        nextLines.splice(analysis.targetBoundaryIndex, 0, "  - LOGBOOK::", clockLine);
      }
      applied = true;
      return nextLines.join(analysis.lineEnding);
    });

    if (!applied) throw new Error("The atomic transform rejected the fresh intent.");
    const confirmed = await this.app.vault.read(file);
    const confirmedAnalysis = analyzeSource(confirmed);
    if (!confirmedAnalysis.runningClockLine?.includes(`^${clockId}`)) {
      throw new Error("Authoritative read-after-write could not confirm the CLOCK.");
    }
    const confirmedDigest = await sha256(confirmed);
    this.demoStage = "applied";
    this.exactPreview = confirmed;
    this.recoveredClock = confirmedAnalysis.runningClockLine;
    this.trace.push(
      `Applied: one Vault.process() transform inserted LOGBOOK/CLOCK; read-after-write confirmed ${clockId}; SHA-256 ${confirmedDigest.slice(0, 12)}….`,
    );
  }

  private async recoverFromMarkdown(addTrace: boolean): Promise<void> {
    const file = this.getSourceFile();
    const source = await this.app.vault.read(file);
    const analysis = analyzeSource(source);
    this.exactPreview = this.demoStage === "idle" ? "" : source;
    this.expectation = null;
    this.recoveredClock = analysis.runningClockLine;
    this.demoStage = analysis.runningClockLine ? "recovered" : "idle";
    if (addTrace || analysis.runningClockLine) {
      this.trace.push(
        analysis.runningClockLine
          ? `Recovery: active CLOCK derived from ${SOURCE_PATH}; no hidden receipt or startup write.`
          : `Recovery: no running CLOCK found in ${SOURCE_PATH}; derived Idle without a write.`,
      );
    }
    this.renderWriteProof();
    this.updateStateOutput();
  }

  private updateStateOutput(): void {
    if (!this.stateOutput) return;
    const current = VARIANTS[this.variantIndex];
    const active = document.activeElement;
    const activeDescription = active instanceof HTMLElement
      ? active.getAttribute("aria-label") || active.getAttribute("placeholder") || active.tagName.toLowerCase()
      : "none";
    this.stateOutput.textContent = JSON.stringify(
      {
        variant: `${current.key} · ${current.name}`,
        variantStorage: "memory-only",
        theme: document.body.classList.contains("theme-dark") ? "dark" : "light",
        measuredLeafWidth: this.measuredWidth,
        breakpoint: "compact <= 520px",
        layout: this.layout,
        filter: this.filter,
        collapsed: this.collapsed,
        completedVisible: this.showCompleted,
        playback: this.playback ? `active · ${this.playbackLabel()}` : "idle",
        overviewOpen: this.overviewOpen,
        scheduleOpen: this.scheduleOpen,
        overflowOpen: this.overflowOpen,
        clock: "active · 00:42:18",
        pomo: "cycle 3 · 12:07",
        markdownStage: this.demoStage,
        recoveredClock: this.recoveredClock,
        focused: activeDescription,
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      },
      null,
      2,
    );
  }
}

export default class SpiralDayPlannerPrototypePlugin extends Plugin {
  async onload(): Promise<void> {
    this.registerView(VIEW_TYPE, (leaf) => new PlannerPrototypeView(leaf));
    this.addRibbonIcon("calendar-clock", "Open Spiral Day planner prototype", () => {
      void this.activateView();
    });
    this.addCommand({
      id: "open-planner",
      name: "Open Spiral Day planner prototype",
      callback: () => void this.activateView(),
    });
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  private async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing ?? await this.app.workspace.ensureSideLeaf(VIEW_TYPE, "right", { active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
}
