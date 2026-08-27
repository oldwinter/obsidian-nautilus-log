"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// prototype/dockable-planner/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => SpiralDayPlannerPrototypePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var VIEW_TYPE = "spiral-day-planner-prototype";
var SOURCE_PATH = "2026-08-28.md";
var TARGET_ID = "demo-release";
var VARIANTS = [
  { key: "A", name: "Spiral first" },
  { key: "B", name: "Chronological rail" },
  { key: "C", name: "Operations columns" }
];
var PLAN_ITEMS = [
  {
    id: "fixed-design-sync",
    kind: "event",
    title: "Design sync / \u8BBE\u8BA1\u540C\u6B65",
    time: "09:00\u201309:45",
    minutes: 45,
    startMinute: 9 * 60,
    endMinute: 9 * 60 + 45
  },
  {
    id: "deep-work",
    kind: "task",
    title: "Deep work on renderer semantics / \u6DF1\u5EA6\u5DE5\u4F5C",
    time: "09:45\u201310:53",
    minutes: 68,
    startMinute: 9 * 60 + 45,
    endMinute: 10 * 60 + 53,
    progress: 25
  },
  {
    id: "urgent-layout",
    kind: "urgent",
    title: "Ship bilingual layout before 18:00 / \u5B8C\u6210\u53CC\u8BED\u5E03\u5C40",
    time: "10:53\u201311:38",
    minutes: 45,
    startMinute: 10 * 60 + 53,
    endMinute: 11 * 60 + 38
  },
  {
    id: "lunch",
    kind: "event",
    title: "Lunch and walk / \u5348\u9910\u4E0E\u6563\u6B65",
    time: "12:00\u201313:00",
    minutes: 60,
    startMinute: 12 * 60,
    endMinute: 13 * 60
  },
  {
    id: "source-spans",
    kind: "done",
    title: "Audit source spans / \u68C0\u67E5\u6E90\u533A\u95F4",
    time: "13:00\u201313:30",
    minutes: 30,
    startMinute: 13 * 60,
    endMinute: 13 * 60 + 30,
    progress: 100
  },
  {
    id: "release-notes",
    kind: "task",
    title: "Write release notes with an unusually long English and \u4E2D\u6587\u6DF7\u5408\u6807\u9898",
    time: "13:30\u201314:15",
    minutes: 45,
    startMinute: 13 * 60 + 30,
    endMinute: 14 * 60 + 15
  },
  {
    id: "customer-follow-up",
    kind: "task",
    title: "Customer follow-up / \u5BA2\u6237\u8DDF\u8FDB",
    time: "14:15\u201314:45",
    minutes: 30,
    startMinute: 14 * 60 + 15,
    endMinute: 14 * 60 + 45
  },
  {
    id: "overflow-refactor",
    kind: "overflow",
    title: "Refactor every scheduler edge case / \u91CD\u6784\u6240\u6709\u8C03\u5EA6\u8FB9\u754C",
    time: "Unscheduled",
    minutes: 180
  },
  {
    id: "overflow-review",
    kind: "overflow",
    title: "Review custom-theme contrast / \u68C0\u67E5\u4E3B\u9898\u5BF9\u6BD4\u5EA6",
    time: "Unscheduled",
    minutes: 40
  }
];
function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== void 0) element.textContent = text;
  return element;
}
function createSvgElement(tag, attributes) {
  const element = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) {
    element.setAttribute(name, value);
  }
  return element;
}
function iconButton(icon, label, onClick, options = {}) {
  const button = createElement("button", `sd-button ${options.className ?? ""}`.trim());
  button.type = "button";
  button.ariaLabel = label;
  button.title = label;
  const iconSlot = createElement("span", "sd-button__icon");
  (0, import_obsidian.setIcon)(iconSlot, icon);
  button.append(iconSlot);
  if (options.text) button.append(createElement("span", "sd-button__text", options.text));
  button.addEventListener("click", onClick);
  return button;
}
function formatMinutes(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return hours > 0 ? `${hours}h ${String(remainder).padStart(2, "0")}m` : `${remainder}m`;
}
function spiralLabel(item) {
  const labels = {
    "fixed-design-sync": "Design / \u8BBE\u8BA1\u540C\u6B65",
    "deep-work": "Render / \u6E32\u67D3",
    "urgent-layout": "Layout / \u53CC\u8BED",
    lunch: "Lunch / \u5348\u9910\u6563\u6B65",
    "source-spans": "Source / \u6E90\u533A\u95F4",
    "release-notes": "Release / \u53D1\u5E03",
    "customer-follow-up": "Client / \u5BA2\u6237"
  };
  return labels[item.id] ?? item.title;
}
function formatClockTimestamp(date) {
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][date.getDay()];
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    weekday,
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`,
    `${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`
  ].join(" ");
}
async function sha256(source) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function analyzeSource(source) {
  const lineEnding = source.includes("\r\n") ? "\r\n" : "\n";
  const lines = source.split(/\r?\n/);
  const openMarkerIndex = lines.findIndex((line) => line.trimEnd() === "<!-- nautilus-log:plan/v1 -->");
  if (openMarkerIndex < 0) throw new Error("The exact Plan Region opening marker is missing.");
  const closeMarkerIndex = lines.findIndex(
    (line, index) => index > openMarkerIndex && line.trimEnd() === "<!-- /nautilus-log:plan -->"
  );
  if (closeMarkerIndex < 0) throw new Error("The exact Plan Region closing marker is missing.");
  const targetPattern = new RegExp(`^[-+*] \\[ \\] .+ \\^${TARGET_ID}[ \\t]*$`);
  const targetLineIndex = lines.findIndex(
    (line, index) => index > openMarkerIndex && index < closeMarkerIndex && targetPattern.test(line)
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
    runningClockLine
  };
}
function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}
var PlannerPrototypeView = class extends import_obsidian.ItemView {
  root;
  headerHost;
  variantHost;
  proofHost;
  stateOutput;
  switchLabel;
  resizeObserver = null;
  layoutMutationObserver = null;
  themeObserver = null;
  variantIndex = 0;
  layout = "wide";
  measuredWidth = 0;
  filter = "";
  demoStage = "idle";
  expectation = null;
  exactPreview = "";
  trace = [];
  busy = false;
  recoveredClock = null;
  collapsed = false;
  showCompleted = true;
  overviewOpen = false;
  scheduleOpen = false;
  overflowOpen = false;
  playback = false;
  playbackStartedAt = 0;
  playbackTimer = null;
  constructor(leaf) {
    super(leaf);
  }
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "Spiral Day planner prototype";
  }
  getIcon() {
    return "calendar-clock";
  }
  async onOpen() {
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
    this.registerDomEvent(document, "keydown", (event) => {
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      if (isEditableTarget(event.target)) return;
      if (!this.root.isConnected) return;
      event.preventDefault();
      this.cycleVariant(event.key === "ArrowRight" ? 1 : -1);
    });
    await this.recoverFromMarkdown(false);
  }
  measureLayout() {
    if (!this.root?.isConnected) return;
    const nextWidth = Math.round(this.root.getBoundingClientRect().width);
    const nextLayout = nextWidth <= 520 ? "compact" : "wide";
    const changed = nextLayout !== this.layout;
    if (!changed && nextWidth === this.measuredWidth) return;
    this.measuredWidth = nextWidth;
    this.layout = nextLayout;
    this.root.dataset.layout = nextLayout;
    if (changed) this.renderVariant();
    this.updateStateOutput();
  }
  async onClose() {
    if (this.playbackTimer !== null) window.clearInterval(this.playbackTimer);
    this.resizeObserver?.disconnect();
    this.layoutMutationObserver?.disconnect();
    this.themeObserver?.disconnect();
    this.contentEl.removeClass("spiral-day-prototype-view");
    this.contentEl.empty();
  }
  renderShell() {
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
  renderCurrentHeader() {
    if (!this.headerHost) return;
    this.headerHost.replaceChildren(
      VARIANTS[this.variantIndex].key === "A" ? this.renderParityHeader() : this.renderPrototypeHeader()
    );
  }
  renderPrototypeHeader() {
    const header = createElement("header", "sd-header");
    const identity = createElement("div", "sd-header__identity");
    identity.append(createElement("div", "sd-kicker", "FRIDAY \xB7 28 AUG 2026"));
    identity.append(createElement("h1", "sd-title", "Spiral Day / \u87BA\u65CB\u65E5\u7A0B"));
    header.append(identity);
    const search = createElement("label", "sd-filter");
    const icon = createElement("span", "sd-filter__icon");
    (0, import_obsidian.setIcon)(icon, "search");
    search.append(icon);
    const input = createElement("input", "sd-filter__input");
    input.type = "search";
    input.placeholder = "Filter plan / \u7B5B\u9009";
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
  renderParityHeader() {
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
      { className: "sd-parity-control" }
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
      { className: "sd-parity-control" }
    );
    completed.setAttribute("aria-pressed", String(this.showCompleted));
    const playback = iconButton(
      this.playback ? "loader-circle" : "play",
      this.playback ? "Playback in progress" : "Play six-second day preview",
      () => this.startPlayback(),
      { className: "sd-parity-control" }
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
  startPlayback() {
    if (this.playback) return;
    this.playback = true;
    this.playbackStartedAt = Date.now();
    this.renderCurrentHeader();
    this.renderVariant();
    this.updateStateOutput();
    this.playbackTimer = window.setInterval(() => {
      if (Date.now() - this.playbackStartedAt >= 6e3) {
        if (this.playbackTimer !== null) window.clearInterval(this.playbackTimer);
        this.playbackTimer = null;
        this.playback = false;
      }
      this.renderCurrentHeader();
      this.renderVariant();
      this.updateStateOutput();
    }, 250);
  }
  playbackLabel() {
    if (!this.playback) return "11:42";
    const progress = Math.min(1, (Date.now() - this.playbackStartedAt) / 6e3);
    const minute = 9 * 60 + Math.round(progress * 9 * 60);
    return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
  }
  renderExecutionStrip() {
    const strip = createElement("section", "sd-execution");
    strip.setAttribute("aria-label", "Active execution status");
    const clock = createElement("div", "sd-execution__item sd-execution__item--clock");
    const clockIcon = createElement("span", "sd-execution__icon");
    (0, import_obsidian.setIcon)(clockIcon, "timer");
    clock.append(clockIcon);
    const clockText = createElement("div", "sd-execution__copy");
    clockText.append(createElement("span", "sd-execution__label", "CLOCK \xB7 00:42:18"));
    clockText.append(createElement("strong", "sd-execution__title", "Deep work / \u6DF1\u5EA6\u5DE5\u4F5C"));
    clock.append(clockText);
    const pomo = createElement("div", "sd-execution__item sd-execution__item--pomo");
    const pomoIcon = createElement("span", "sd-execution__icon");
    (0, import_obsidian.setIcon)(pomoIcon, "circle-dot-dashed");
    pomo.append(pomoIcon);
    const pomoText = createElement("div", "sd-execution__copy");
    pomoText.append(createElement("span", "sd-execution__label", "POMO \xB7 12:07"));
    pomoText.append(createElement("strong", "sd-execution__title", "Focus cycle 3 / \u4E13\u6CE8\u5468\u671F 3"));
    pomo.append(pomoText);
    strip.append(clock, pomo);
    return strip;
  }
  renderSwitcher() {
    const switcher = createElement("nav", "sd-switcher");
    switcher.setAttribute("aria-label", "Prototype variant switcher");
    const previous = iconButton("chevron-left", "Previous variant", () => this.cycleVariant(-1), {
      className: "sd-switcher__arrow"
    });
    this.switchLabel = createElement("div", "sd-switcher__label");
    this.switchLabel.setAttribute("aria-live", "polite");
    const next = iconButton("chevron-right", "Next variant", () => this.cycleVariant(1), {
      className: "sd-switcher__arrow"
    });
    switcher.append(previous, this.switchLabel, next);
    this.updateSwitcherLabel();
    return switcher;
  }
  cycleVariant(delta) {
    this.variantIndex = (this.variantIndex + delta + VARIANTS.length) % VARIANTS.length;
    this.renderCurrentHeader();
    this.renderVariant();
    this.updateSwitcherLabel();
    this.updateStateOutput();
  }
  updateSwitcherLabel() {
    if (!this.switchLabel) return;
    const current = VARIANTS[this.variantIndex];
    this.switchLabel.replaceChildren(
      createElement("strong", "sd-switcher__key", current.key),
      createElement("span", "sd-switcher__name", current.name)
    );
  }
  filteredItems() {
    const query = this.filter.trim().toLocaleLowerCase();
    return PLAN_ITEMS.filter(
      (item) => (this.showCompleted || item.kind !== "done") && (!query || item.title.toLocaleLowerCase().includes(query))
    );
  }
  renderVariant() {
    if (!this.variantHost) return;
    this.variantHost.empty();
    const key = VARIANTS[this.variantIndex].key;
    this.variantHost.classList.toggle("is-collapsed", key === "A" && this.collapsed);
    if (key === "A") this.variantHost.append(this.renderVariantA());
    if (key === "B") this.variantHost.append(this.renderVariantB());
    if (key === "C") this.variantHost.append(this.renderVariantC());
  }
  renderVariantA() {
    const section = createElement("div", "sd-variant sd-variant-a");
    section.dataset.variant = "A";
    if (this.collapsed) return section;
    section.append(this.renderSpiral());
    const compactOverview = createElement("details", "sd-disclosure sd-compact-overview");
    compactOverview.open = this.overviewOpen;
    compactOverview.addEventListener("toggle", () => {
      this.overviewOpen = compactOverview.open;
    });
    compactOverview.append(createElement("summary", "sd-disclosure__summary", "Overview \xB7 2h 07m open / \u6982\u89C8"));
    compactOverview.append(this.renderMetrics());
    section.append(compactOverview);
    const compactSchedule = createElement("details", "sd-disclosure sd-compact-schedule");
    compactSchedule.open = this.scheduleOpen;
    compactSchedule.addEventListener("toggle", () => {
      this.scheduleOpen = compactSchedule.open;
    });
    const scheduleItems = this.filteredItems().filter((item) => item.kind !== "overflow");
    compactSchedule.append(
      createElement("summary", "sd-disclosure__summary", `Schedule \xB7 ${scheduleItems.length} items / \u65E5\u7A0B`)
    );
    compactSchedule.append(this.renderScheduleList(scheduleItems));
    section.append(compactSchedule);
    section.append(this.renderOverflowDisclosure());
    return section;
  }
  renderMetrics(includeLegend = true) {
    const metrics = createElement("section", "sd-metrics");
    metrics.setAttribute("aria-label", "Capacity overview");
    const values = [
      ["Window", "09:00\u201318:00"],
      ["Fixed", "1h 45m"],
      ["Flexible", "3h 08m"],
      ["Available", "2h 07m"]
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
  renderLegend() {
    const legend = createElement("div", "sd-legend");
    legend.setAttribute("aria-label", "Planner legend");
    for (const [kind, label] of [
      ["urgent", "Urgent"],
      ["event", "Fixed"],
      ["task", "Flexible"]
    ]) {
      const entry = createElement("span", "sd-legend__entry");
      const dot = createElement("span", `sd-dot sd-dot--${kind}`);
      entry.append(dot, document.createTextNode(label));
      legend.append(entry);
    }
    return legend;
  }
  renderSpiral() {
    const frame = createElement("div", "sd-spiral-frame");
    const svg = createSvgElement("svg", {
      class: "sd-spiral",
      viewBox: this.layout === "compact" ? "105 20 390 390" : "0 0 600 420",
      role: "img",
      "aria-label": "Spiral schedule from 09:00 to 18:00"
    });
    const grid = createSvgElement("g", { class: "sd-spiral__grid", "aria-hidden": "true" });
    for (const radius of [58, 92, 126, 160]) {
      grid.append(createSvgElement("circle", { cx: "300", cy: "210", r: String(radius) }));
    }
    for (let hour = 9; hour <= 18; hour += 1) {
      const angle = (hour - 9) / 9 * Math.PI * 6.2 - Math.PI / 2;
      const radius = 52 + (hour - 9) / 9 * 116;
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
      "aria-hidden": "true"
    });
    svg.append(background);
    const visible = this.filteredItems().filter(
      (item) => item.kind !== "overflow" && item.startMinute !== void 0 && item.endMinute !== void 0
    );
    visible.forEach((item) => {
      const group = createSvgElement("g", {
        class: `sd-spiral-item sd-spiral-item--${item.kind}`,
        role: "img",
        tabindex: "0",
        "aria-label": `${item.title}. ${item.time}. ${formatMinutes(item.minutes)}.`
      });
      const title = createSvgElement("title", {});
      title.textContent = `${item.title} \xB7 ${item.time} \xB7 ${formatMinutes(item.minutes)}`;
      const focusHalo = createSvgElement("path", {
        d: this.spiralPath(item.startMinute, item.endMinute),
        class: "sd-spiral-item__focus-halo",
        "aria-hidden": "true"
      });
      const path = createSvgElement("path", {
        d: this.spiralPath(item.startMinute, item.endMinute),
        class: "sd-spiral-item__segment"
      });
      group.append(title, focusHalo, path);
      if (item.progress && item.progress < 100) {
        group.append(
          createSvgElement("path", {
            d: this.spiralPath(item.startMinute, item.startMinute + item.minutes * (item.progress / 100)),
            class: "sd-spiral-item__progress"
          })
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
  renderOutsideLabels(svg, items) {
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
        "aria-hidden": "true"
      });
      const dot = createSvgElement("circle", {
        cx: String(isLeft ? 124 : 476),
        cy: String(y - 3),
        r: "3.5",
        class: "sd-outside-label__dot"
      });
      const text = createSvgElement("text", {
        x: String(x),
        y: String(y),
        "text-anchor": isLeft ? "end" : "start",
        class: "sd-outside-label__title"
      });
      text.textContent = spiralLabel(item);
      const time = createSvgElement("text", {
        x: String(x),
        y: String(y + 15),
        "text-anchor": isLeft ? "end" : "start",
        class: "sd-outside-label__time"
      });
      time.textContent = item.time;
      group.append(dot, text, time);
      svg.append(group);
    });
  }
  spiralPoint(minute) {
    const normalized = Math.max(0, Math.min(1, (minute - 9 * 60) / (9 * 60)));
    const angle = normalized * Math.PI * 6.2 - Math.PI / 2;
    const radius = 52 + normalized * 116;
    return { x: 300 + Math.cos(angle) * radius, y: 210 + Math.sin(angle) * radius };
  }
  spiralPath(startMinute, endMinute) {
    const steps = Math.max(8, Math.ceil((endMinute - startMinute) / 4));
    const points = [];
    for (let index = 0; index <= steps; index += 1) {
      const minute = startMinute + (endMinute - startMinute) * index / steps;
      const point = this.spiralPoint(minute);
      points.push(`${index === 0 ? "M" : "L"}${point.x.toFixed(2)},${point.y.toFixed(2)}`);
    }
    return points.join(" ");
  }
  renderVariantB() {
    const section = createElement("div", "sd-variant sd-variant-b");
    section.dataset.variant = "B";
    const heading = createElement("div", "sd-section-heading");
    heading.append(createElement("h2", "sd-section-title", "Day rail / \u65F6\u95F4\u8F74"));
    heading.append(createElement("span", "sd-section-meta", "09:00\u201318:00 \xB7 53% planned"));
    section.append(heading);
    const rail = createElement("div", "sd-day-rail");
    const timed = this.filteredItems().filter((item) => item.startMinute !== void 0);
    for (let hour = 9; hour <= 18; hour += 1) {
      const row = createElement("div", "sd-day-rail__hour");
      row.append(createElement("time", "sd-day-rail__time", `${String(hour).padStart(2, "0")}:00`));
      const slot = createElement("div", "sd-day-rail__slot");
      const matches = timed.filter((item) => Math.floor(item.startMinute / 60) === hour);
      if (matches.length === 0) {
        slot.append(createElement("span", "sd-day-rail__available", hour < 15 ? "Available / \u53EF\u7528" : "Open capacity"));
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
  renderRailItem(item) {
    const row = createElement("div", `sd-rail-item sd-rail-item--${item.kind}`);
    row.tabIndex = 0;
    row.setAttribute("aria-label", `${item.title}. ${item.time}.`);
    row.append(createElement("span", "sd-rail-item__bar"));
    const copy = createElement("div", "sd-rail-item__copy");
    copy.append(createElement("strong", "sd-rail-item__title", item.title));
    copy.append(createElement("span", "sd-rail-item__meta", `${item.time} \xB7 ${formatMinutes(item.minutes)}`));
    row.append(copy);
    if (item.progress !== void 0) {
      row.append(createElement("span", "sd-rail-item__progress", `${item.progress}%`));
    }
    return row;
  }
  renderVariantC() {
    const section = createElement("div", "sd-variant sd-variant-c");
    section.dataset.variant = "C";
    const capacity = createElement("div", "sd-capacity-band");
    capacity.append(createElement("strong", "sd-capacity-band__value", "2h 07m"));
    capacity.append(createElement("span", "sd-capacity-band__label", "open capacity / \u5269\u4F59\u5BB9\u91CF"));
    const meter = createElement("div", "sd-capacity-band__meter");
    meter.append(createElement("span", "sd-capacity-band__fixed"));
    meter.append(createElement("span", "sd-capacity-band__flex"));
    meter.append(createElement("span", "sd-capacity-band__open"));
    capacity.append(meter);
    section.append(capacity);
    const columns = createElement("div", "sd-ops-columns");
    const groups = [
      {
        title: "Fixed events / \u56FA\u5B9A\u4E8B\u4EF6",
        icon: "calendar-range",
        items: this.filteredItems().filter((item) => item.kind === "event"),
        tone: "event"
      },
      {
        title: "Flexible tasks / \u5F39\u6027\u4EFB\u52A1",
        icon: "list-checks",
        items: this.filteredItems().filter((item) => ["task", "urgent", "done"].includes(item.kind)),
        tone: "task"
      },
      {
        title: "Overflow / \u6EA2\u51FA",
        icon: "archive-restore",
        items: this.filteredItems().filter((item) => item.kind === "overflow"),
        tone: "overflow"
      }
    ];
    for (const group of groups) columns.append(this.renderOpsColumn(group));
    section.append(columns);
    return section;
  }
  renderOpsColumn(group) {
    const column = createElement("section", `sd-ops-column sd-ops-column--${group.tone}`);
    const header = createElement("header", "sd-ops-column__header");
    const icon = createElement("span", "sd-ops-column__icon");
    (0, import_obsidian.setIcon)(icon, group.icon);
    header.append(icon, createElement("h2", "sd-ops-column__title", group.title));
    header.append(createElement("span", "sd-ops-column__count", String(group.items.length)));
    column.append(header);
    const list = createElement("div", "sd-ops-list");
    for (const item of group.items) {
      const row = createElement("div", `sd-ops-row sd-ops-row--${item.kind}`);
      row.tabIndex = 0;
      row.append(createElement("strong", "sd-ops-row__title", item.title));
      row.append(createElement("span", "sd-ops-row__meta", `${item.time} \xB7 ${formatMinutes(item.minutes)}`));
      list.append(row);
    }
    column.append(list);
    return column;
  }
  renderScheduleList(items) {
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
  renderOverflowDisclosure() {
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
        `Unscheduled today / \u4ECA\u65E5\u672A\u6392 \xB7 ${formatMinutes(total)} \xB7 ${overflowItems.length}`
      )
    );
    details.append(this.renderScheduleList(overflowItems));
    return details;
  }
  renderWriteProof() {
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
        this.demoStatusLabel()
      )
    );
    this.proofHost.append(header);
    const actions = createElement("div", "sd-proof__actions");
    const preview = iconButton("scan-text", "Preview exact source", () => void this.runAction(() => this.previewSource(false)), {
      text: "Preview source"
    });
    const inject = iconButton("file-warning", "Inject watched-line conflict", () => void this.runAction(() => this.injectConflict()), {
      text: "Inject conflict"
    });
    const stale = iconButton("shield-x", "Attempt stale write", () => void this.runAction(() => this.attemptStaleWrite()), {
      text: "Attempt stale write"
    });
    const refresh = iconButton("refresh-cw", "Refresh write intent", () => void this.runAction(() => this.previewSource(true)), {
      text: "Refresh intent"
    });
    const apply = iconButton("timer-reset", "Write one canonical CLOCK", () => void this.runAction(() => this.applyFreshWrite()), {
      text: "Write CLOCK",
      className: "mod-cta"
    });
    const reread = iconButton("rotate-ccw", "Re-read recovery state from Markdown", () => void this.runAction(() => this.recoverFromMarkdown(true)), {
      text: "Re-read Markdown"
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
  demoStatusLabel() {
    const labels = {
      idle: "Idle \xB7 source-derived",
      preview: "Previewed \xB7 expectation captured",
      "conflict-injected": "Conflict injected",
      rejected: "Rejected safely \xB7 zero plugin bytes",
      fresh: "Fresh intent \xB7 ready",
      applied: "Applied \xB7 confirmed",
      recovered: "Recovered from Markdown",
      error: "Blocked \xB7 inspect trace"
    };
    return labels[this.demoStage];
  }
  async runAction(action) {
    if (this.busy) return;
    this.busy = true;
    this.renderWriteProof();
    try {
      await action();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.demoStage = "error";
      this.trace.push(`Blocked: ${message}`);
      new import_obsidian.Notice(`Spiral Day prototype: ${message}`);
    } finally {
      this.busy = false;
      this.renderWriteProof();
      this.updateStateOutput();
    }
  }
  getSourceFile() {
    const file = this.app.vault.getAbstractFileByPath(SOURCE_PATH);
    if (!(file instanceof import_obsidian.TFile)) throw new Error(`Disposable fixture ${SOURCE_PATH} was not found.`);
    return file;
  }
  async assertVaultUniqueTargetId() {
    let occurrences = 0;
    for (const file of this.app.vault.getMarkdownFiles()) {
      const source = await this.app.vault.cachedRead(file);
      occurrences += source.match(new RegExp(`\\^${TARGET_ID}(?=[ \\t]*(?:\\r?\\n|$))`, "g"))?.length ?? 0;
    }
    if (occurrences !== 1) throw new Error(`Plan Item ID ^${TARGET_ID} occurs ${occurrences} times in the vault.`);
  }
  async previewSource(isRefresh) {
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
      isRefresh ? `Fresh intent: SHA-256 ${digest.slice(0, 12)}\u2026, ID unique, open Flexible Task revalidated.` : `Preview: exact ${source.length} bytes, SHA-256 ${digest.slice(0, 12)}\u2026, target ^${TARGET_ID}.`
    );
  }
  async injectConflict() {
    if (!this.expectation) throw new Error("Preview the source before injecting a conflict.");
    const file = this.getSourceFile();
    let injected = false;
    await this.app.vault.process(file, (current) => {
      const analysis = analyzeSource(current);
      if (analysis.targetLine !== this.expectation.targetLine) return current;
      const changedLine = analysis.targetLine.replace(
        ` #launch ^${TARGET_ID}`,
        ` #launch conflict-injected ^${TARGET_ID}`
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
  async attemptStaleWrite() {
    if (!this.expectation) throw new Error("No stale expectation exists.");
    const file = this.getSourceFile();
    const beforeAttempt = await this.app.vault.read(file);
    const beforeDigest = await sha256(beforeAttempt);
    let rejectedInsideTransform = false;
    await this.app.vault.process(file, (current) => {
      const analysis = analyzeSource(current);
      if (analysis.targetLine !== this.expectation.targetLine) {
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
      `Safe rejection: Vault.process() reparse saw changed watched bytes; SHA-256 stayed ${afterDigest.slice(0, 12)}\u2026; zero plugin-write bytes.`
    );
  }
  async applyFreshWrite() {
    if (!this.expectation || this.demoStage !== "fresh") throw new Error("Refresh the intent before writing.");
    const file = this.getSourceFile();
    const queueHeadSource = await this.app.vault.read(file);
    const queueHeadDigest = await sha256(queueHeadSource);
    if (queueHeadDigest !== this.expectation.digest) throw new Error("The refreshed source changed before commit.");
    await this.assertVaultUniqueTargetId();
    const clockId = `nl-clock-${crypto.randomUUID()}`;
    const clockLine = `    - CLOCK: [${formatClockTimestamp(/* @__PURE__ */ new Date())}] ^${clockId}`;
    let applied = false;
    await this.app.vault.process(file, (current) => {
      const analysis = analyzeSource(current);
      if (analysis.targetLine !== this.expectation.targetLine || analysis.runningClockLine) return current;
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
      `Applied: one Vault.process() transform inserted LOGBOOK/CLOCK; read-after-write confirmed ${clockId}; SHA-256 ${confirmedDigest.slice(0, 12)}\u2026.`
    );
  }
  async recoverFromMarkdown(addTrace) {
    const file = this.getSourceFile();
    const source = await this.app.vault.read(file);
    const analysis = analyzeSource(source);
    this.exactPreview = this.demoStage === "idle" ? "" : source;
    this.expectation = null;
    this.recoveredClock = analysis.runningClockLine;
    this.demoStage = analysis.runningClockLine ? "recovered" : "idle";
    if (addTrace || analysis.runningClockLine) {
      this.trace.push(
        analysis.runningClockLine ? `Recovery: active CLOCK derived from ${SOURCE_PATH}; no hidden receipt or startup write.` : `Recovery: no running CLOCK found in ${SOURCE_PATH}; derived Idle without a write.`
      );
    }
    this.renderWriteProof();
    this.updateStateOutput();
  }
  updateStateOutput() {
    if (!this.stateOutput) return;
    const current = VARIANTS[this.variantIndex];
    const active = document.activeElement;
    const activeDescription = active instanceof HTMLElement ? active.getAttribute("aria-label") || active.getAttribute("placeholder") || active.tagName.toLowerCase() : "none";
    this.stateOutput.textContent = JSON.stringify(
      {
        variant: `${current.key} \xB7 ${current.name}`,
        variantStorage: "memory-only",
        theme: document.body.classList.contains("theme-dark") ? "dark" : "light",
        measuredLeafWidth: this.measuredWidth,
        breakpoint: "compact <= 520px",
        layout: this.layout,
        filter: this.filter,
        collapsed: this.collapsed,
        completedVisible: this.showCompleted,
        playback: this.playback ? `active \xB7 ${this.playbackLabel()}` : "idle",
        overviewOpen: this.overviewOpen,
        scheduleOpen: this.scheduleOpen,
        overflowOpen: this.overflowOpen,
        clock: "active \xB7 00:42:18",
        pomo: "cycle 3 \xB7 12:07",
        markdownStage: this.demoStage,
        recoveredClock: this.recoveredClock,
        focused: activeDescription,
        reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches
      },
      null,
      2
    );
  }
};
var SpiralDayPlannerPrototypePlugin = class extends import_obsidian.Plugin {
  async onload() {
    this.registerView(VIEW_TYPE, (leaf) => new PlannerPrototypeView(leaf));
    this.addRibbonIcon("calendar-clock", "Open Spiral Day planner prototype", () => {
      void this.activateView();
    });
    this.addCommand({
      id: "open-planner",
      name: "Open Spiral Day planner prototype",
      callback: () => void this.activateView()
    });
  }
  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }
  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE)[0];
    const leaf = existing ?? await this.app.workspace.ensureSideLeaf(VIEW_TYPE, "right", { active: true });
    await this.app.workspace.revealLeaf(leaf);
  }
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsibWFpbi50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHtcbiAgSXRlbVZpZXcsXG4gIE5vdGljZSxcbiAgUGx1Z2luLFxuICBURmlsZSxcbiAgV29ya3NwYWNlTGVhZixcbiAgc2V0SWNvbixcbn0gZnJvbSBcIm9ic2lkaWFuXCI7XG5cbmNvbnN0IFZJRVdfVFlQRSA9IFwic3BpcmFsLWRheS1wbGFubmVyLXByb3RvdHlwZVwiO1xuY29uc3QgU09VUkNFX1BBVEggPSBcIjIwMjYtMDgtMjgubWRcIjtcbmNvbnN0IFRBUkdFVF9JRCA9IFwiZGVtby1yZWxlYXNlXCI7XG5cbnR5cGUgVmFyaWFudEtleSA9IFwiQVwiIHwgXCJCXCIgfCBcIkNcIjtcbnR5cGUgTGF5b3V0TW9kZSA9IFwiY29tcGFjdFwiIHwgXCJ3aWRlXCI7XG50eXBlIERlbW9TdGFnZSA9XG4gIHwgXCJpZGxlXCJcbiAgfCBcInByZXZpZXdcIlxuICB8IFwiY29uZmxpY3QtaW5qZWN0ZWRcIlxuICB8IFwicmVqZWN0ZWRcIlxuICB8IFwiZnJlc2hcIlxuICB8IFwiYXBwbGllZFwiXG4gIHwgXCJyZWNvdmVyZWRcIlxuICB8IFwiZXJyb3JcIjtcblxudHlwZSBJdGVtS2luZCA9IFwiZXZlbnRcIiB8IFwidGFza1wiIHwgXCJ1cmdlbnRcIiB8IFwiZG9uZVwiIHwgXCJvdmVyZmxvd1wiO1xuXG5pbnRlcmZhY2UgUGxhbkl0ZW0ge1xuICBpZDogc3RyaW5nO1xuICBraW5kOiBJdGVtS2luZDtcbiAgdGl0bGU6IHN0cmluZztcbiAgdGltZTogc3RyaW5nO1xuICBtaW51dGVzOiBudW1iZXI7XG4gIHN0YXJ0TWludXRlPzogbnVtYmVyO1xuICBlbmRNaW51dGU/OiBudW1iZXI7XG4gIHByb2dyZXNzPzogbnVtYmVyO1xufVxuXG5pbnRlcmZhY2UgU291cmNlQW5hbHlzaXMge1xuICBsaW5lczogc3RyaW5nW107XG4gIGxpbmVFbmRpbmc6IFwiXFxuXCIgfCBcIlxcclxcblwiO1xuICBvcGVuTWFya2VySW5kZXg6IG51bWJlcjtcbiAgY2xvc2VNYXJrZXJJbmRleDogbnVtYmVyO1xuICB0YXJnZXRMaW5lSW5kZXg6IG51bWJlcjtcbiAgdGFyZ2V0Qm91bmRhcnlJbmRleDogbnVtYmVyO1xuICB0YXJnZXRMaW5lOiBzdHJpbmc7XG4gIHJ1bm5pbmdDbG9ja0xpbmU6IHN0cmluZyB8IG51bGw7XG59XG5cbmludGVyZmFjZSBXcml0ZUV4cGVjdGF0aW9uIHtcbiAgZGlnZXN0OiBzdHJpbmc7XG4gIHRhcmdldExpbmU6IHN0cmluZztcbiAgc291cmNlOiBzdHJpbmc7XG59XG5cbmNvbnN0IFZBUklBTlRTOiBSZWFkb25seUFycmF5PHsga2V5OiBWYXJpYW50S2V5OyBuYW1lOiBzdHJpbmcgfT4gPSBbXG4gIHsga2V5OiBcIkFcIiwgbmFtZTogXCJTcGlyYWwgZmlyc3RcIiB9LFxuICB7IGtleTogXCJCXCIsIG5hbWU6IFwiQ2hyb25vbG9naWNhbCByYWlsXCIgfSxcbiAgeyBrZXk6IFwiQ1wiLCBuYW1lOiBcIk9wZXJhdGlvbnMgY29sdW1uc1wiIH0sXG5dO1xuXG5jb25zdCBQTEFOX0lURU1TOiBSZWFkb25seUFycmF5PFBsYW5JdGVtPiA9IFtcbiAge1xuICAgIGlkOiBcImZpeGVkLWRlc2lnbi1zeW5jXCIsXG4gICAga2luZDogXCJldmVudFwiLFxuICAgIHRpdGxlOiBcIkRlc2lnbiBzeW5jIC8gXHU4QkJFXHU4QkExXHU1NDBDXHU2QjY1XCIsXG4gICAgdGltZTogXCIwOTowMFx1MjAxMzA5OjQ1XCIsXG4gICAgbWludXRlczogNDUsXG4gICAgc3RhcnRNaW51dGU6IDkgKiA2MCxcbiAgICBlbmRNaW51dGU6IDkgKiA2MCArIDQ1LFxuICB9LFxuICB7XG4gICAgaWQ6IFwiZGVlcC13b3JrXCIsXG4gICAga2luZDogXCJ0YXNrXCIsXG4gICAgdGl0bGU6IFwiRGVlcCB3b3JrIG9uIHJlbmRlcmVyIHNlbWFudGljcyAvIFx1NkRGMVx1NUVBNlx1NURFNVx1NEY1Q1wiLFxuICAgIHRpbWU6IFwiMDk6NDVcdTIwMTMxMDo1M1wiLFxuICAgIG1pbnV0ZXM6IDY4LFxuICAgIHN0YXJ0TWludXRlOiA5ICogNjAgKyA0NSxcbiAgICBlbmRNaW51dGU6IDEwICogNjAgKyA1MyxcbiAgICBwcm9ncmVzczogMjUsXG4gIH0sXG4gIHtcbiAgICBpZDogXCJ1cmdlbnQtbGF5b3V0XCIsXG4gICAga2luZDogXCJ1cmdlbnRcIixcbiAgICB0aXRsZTogXCJTaGlwIGJpbGluZ3VhbCBsYXlvdXQgYmVmb3JlIDE4OjAwIC8gXHU1QjhDXHU2MjEwXHU1M0NDXHU4QkVEXHU1RTAzXHU1QzQwXCIsXG4gICAgdGltZTogXCIxMDo1M1x1MjAxMzExOjM4XCIsXG4gICAgbWludXRlczogNDUsXG4gICAgc3RhcnRNaW51dGU6IDEwICogNjAgKyA1MyxcbiAgICBlbmRNaW51dGU6IDExICogNjAgKyAzOCxcbiAgfSxcbiAge1xuICAgIGlkOiBcImx1bmNoXCIsXG4gICAga2luZDogXCJldmVudFwiLFxuICAgIHRpdGxlOiBcIkx1bmNoIGFuZCB3YWxrIC8gXHU1MzQ4XHU5OTEwXHU0RTBFXHU2NTYzXHU2QjY1XCIsXG4gICAgdGltZTogXCIxMjowMFx1MjAxMzEzOjAwXCIsXG4gICAgbWludXRlczogNjAsXG4gICAgc3RhcnRNaW51dGU6IDEyICogNjAsXG4gICAgZW5kTWludXRlOiAxMyAqIDYwLFxuICB9LFxuICB7XG4gICAgaWQ6IFwic291cmNlLXNwYW5zXCIsXG4gICAga2luZDogXCJkb25lXCIsXG4gICAgdGl0bGU6IFwiQXVkaXQgc291cmNlIHNwYW5zIC8gXHU2OEMwXHU2N0U1XHU2RTkwXHU1MzNBXHU5NUY0XCIsXG4gICAgdGltZTogXCIxMzowMFx1MjAxMzEzOjMwXCIsXG4gICAgbWludXRlczogMzAsXG4gICAgc3RhcnRNaW51dGU6IDEzICogNjAsXG4gICAgZW5kTWludXRlOiAxMyAqIDYwICsgMzAsXG4gICAgcHJvZ3Jlc3M6IDEwMCxcbiAgfSxcbiAge1xuICAgIGlkOiBcInJlbGVhc2Utbm90ZXNcIixcbiAgICBraW5kOiBcInRhc2tcIixcbiAgICB0aXRsZTogXCJXcml0ZSByZWxlYXNlIG5vdGVzIHdpdGggYW4gdW51c3VhbGx5IGxvbmcgRW5nbGlzaCBhbmQgXHU0RTJEXHU2NTg3XHU2REY3XHU1NDA4XHU2ODA3XHU5ODk4XCIsXG4gICAgdGltZTogXCIxMzozMFx1MjAxMzE0OjE1XCIsXG4gICAgbWludXRlczogNDUsXG4gICAgc3RhcnRNaW51dGU6IDEzICogNjAgKyAzMCxcbiAgICBlbmRNaW51dGU6IDE0ICogNjAgKyAxNSxcbiAgfSxcbiAge1xuICAgIGlkOiBcImN1c3RvbWVyLWZvbGxvdy11cFwiLFxuICAgIGtpbmQ6IFwidGFza1wiLFxuICAgIHRpdGxlOiBcIkN1c3RvbWVyIGZvbGxvdy11cCAvIFx1NUJBMlx1NjIzN1x1OERERlx1OEZEQlwiLFxuICAgIHRpbWU6IFwiMTQ6MTVcdTIwMTMxNDo0NVwiLFxuICAgIG1pbnV0ZXM6IDMwLFxuICAgIHN0YXJ0TWludXRlOiAxNCAqIDYwICsgMTUsXG4gICAgZW5kTWludXRlOiAxNCAqIDYwICsgNDUsXG4gIH0sXG4gIHtcbiAgICBpZDogXCJvdmVyZmxvdy1yZWZhY3RvclwiLFxuICAgIGtpbmQ6IFwib3ZlcmZsb3dcIixcbiAgICB0aXRsZTogXCJSZWZhY3RvciBldmVyeSBzY2hlZHVsZXIgZWRnZSBjYXNlIC8gXHU5MUNEXHU2Nzg0XHU2MjQwXHU2NzA5XHU4QzAzXHU1RUE2XHU4RkI5XHU3NTRDXCIsXG4gICAgdGltZTogXCJVbnNjaGVkdWxlZFwiLFxuICAgIG1pbnV0ZXM6IDE4MCxcbiAgfSxcbiAge1xuICAgIGlkOiBcIm92ZXJmbG93LXJldmlld1wiLFxuICAgIGtpbmQ6IFwib3ZlcmZsb3dcIixcbiAgICB0aXRsZTogXCJSZXZpZXcgY3VzdG9tLXRoZW1lIGNvbnRyYXN0IC8gXHU2OEMwXHU2N0U1XHU0RTNCXHU5ODk4XHU1QkY5XHU2QkQ0XHU1RUE2XCIsXG4gICAgdGltZTogXCJVbnNjaGVkdWxlZFwiLFxuICAgIG1pbnV0ZXM6IDQwLFxuICB9LFxuXTtcblxuZnVuY3Rpb24gY3JlYXRlRWxlbWVudDxLIGV4dGVuZHMga2V5b2YgSFRNTEVsZW1lbnRUYWdOYW1lTWFwPihcbiAgdGFnOiBLLFxuICBjbGFzc05hbWU/OiBzdHJpbmcsXG4gIHRleHQ/OiBzdHJpbmcsXG4pOiBIVE1MRWxlbWVudFRhZ05hbWVNYXBbS10ge1xuICBjb25zdCBlbGVtZW50ID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCh0YWcpO1xuICBpZiAoY2xhc3NOYW1lKSBlbGVtZW50LmNsYXNzTmFtZSA9IGNsYXNzTmFtZTtcbiAgaWYgKHRleHQgIT09IHVuZGVmaW5lZCkgZWxlbWVudC50ZXh0Q29udGVudCA9IHRleHQ7XG4gIHJldHVybiBlbGVtZW50O1xufVxuXG5mdW5jdGlvbiBjcmVhdGVTdmdFbGVtZW50PEsgZXh0ZW5kcyBrZXlvZiBTVkdFbGVtZW50VGFnTmFtZU1hcD4oXG4gIHRhZzogSyxcbiAgYXR0cmlidXRlczogUmVjb3JkPHN0cmluZywgc3RyaW5nPixcbik6IFNWR0VsZW1lbnRUYWdOYW1lTWFwW0tdIHtcbiAgY29uc3QgZWxlbWVudCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnROUyhcImh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnXCIsIHRhZyk7XG4gIGZvciAoY29uc3QgW25hbWUsIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhhdHRyaWJ1dGVzKSkge1xuICAgIGVsZW1lbnQuc2V0QXR0cmlidXRlKG5hbWUsIHZhbHVlKTtcbiAgfVxuICByZXR1cm4gZWxlbWVudDtcbn1cblxuZnVuY3Rpb24gaWNvbkJ1dHRvbihcbiAgaWNvbjogc3RyaW5nLFxuICBsYWJlbDogc3RyaW5nLFxuICBvbkNsaWNrOiAoKSA9PiB2b2lkLFxuICBvcHRpb25zOiB7IHRleHQ/OiBzdHJpbmc7IGNsYXNzTmFtZT86IHN0cmluZyB9ID0ge30sXG4pOiBIVE1MQnV0dG9uRWxlbWVudCB7XG4gIGNvbnN0IGJ1dHRvbiA9IGNyZWF0ZUVsZW1lbnQoXCJidXR0b25cIiwgYHNkLWJ1dHRvbiAke29wdGlvbnMuY2xhc3NOYW1lID8/IFwiXCJ9YC50cmltKCkpO1xuICBidXR0b24udHlwZSA9IFwiYnV0dG9uXCI7XG4gIGJ1dHRvbi5hcmlhTGFiZWwgPSBsYWJlbDtcbiAgYnV0dG9uLnRpdGxlID0gbGFiZWw7XG4gIGNvbnN0IGljb25TbG90ID0gY3JlYXRlRWxlbWVudChcInNwYW5cIiwgXCJzZC1idXR0b25fX2ljb25cIik7XG4gIHNldEljb24oaWNvblNsb3QsIGljb24pO1xuICBidXR0b24uYXBwZW5kKGljb25TbG90KTtcbiAgaWYgKG9wdGlvbnMudGV4dCkgYnV0dG9uLmFwcGVuZChjcmVhdGVFbGVtZW50KFwic3BhblwiLCBcInNkLWJ1dHRvbl9fdGV4dFwiLCBvcHRpb25zLnRleHQpKTtcbiAgYnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBvbkNsaWNrKTtcbiAgcmV0dXJuIGJ1dHRvbjtcbn1cblxuZnVuY3Rpb24gZm9ybWF0TWludXRlcyhtaW51dGVzOiBudW1iZXIpOiBzdHJpbmcge1xuICBjb25zdCBob3VycyA9IE1hdGguZmxvb3IobWludXRlcyAvIDYwKTtcbiAgY29uc3QgcmVtYWluZGVyID0gbWludXRlcyAlIDYwO1xuICByZXR1cm4gaG91cnMgPiAwID8gYCR7aG91cnN9aCAke1N0cmluZyhyZW1haW5kZXIpLnBhZFN0YXJ0KDIsIFwiMFwiKX1tYCA6IGAke3JlbWFpbmRlcn1tYDtcbn1cblxuZnVuY3Rpb24gc3BpcmFsTGFiZWwoaXRlbTogUGxhbkl0ZW0pOiBzdHJpbmcge1xuICBjb25zdCBsYWJlbHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgXCJmaXhlZC1kZXNpZ24tc3luY1wiOiBcIkRlc2lnbiAvIFx1OEJCRVx1OEJBMVx1NTQwQ1x1NkI2NVwiLFxuICAgIFwiZGVlcC13b3JrXCI6IFwiUmVuZGVyIC8gXHU2RTMyXHU2N0QzXCIsXG4gICAgXCJ1cmdlbnQtbGF5b3V0XCI6IFwiTGF5b3V0IC8gXHU1M0NDXHU4QkVEXCIsXG4gICAgbHVuY2g6IFwiTHVuY2ggLyBcdTUzNDhcdTk5MTBcdTY1NjNcdTZCNjVcIixcbiAgICBcInNvdXJjZS1zcGFuc1wiOiBcIlNvdXJjZSAvIFx1NkU5MFx1NTMzQVx1OTVGNFwiLFxuICAgIFwicmVsZWFzZS1ub3Rlc1wiOiBcIlJlbGVhc2UgLyBcdTUzRDFcdTVFMDNcIixcbiAgICBcImN1c3RvbWVyLWZvbGxvdy11cFwiOiBcIkNsaWVudCAvIFx1NUJBMlx1NjIzN1wiLFxuICB9O1xuICByZXR1cm4gbGFiZWxzW2l0ZW0uaWRdID8/IGl0ZW0udGl0bGU7XG59XG5cbmZ1bmN0aW9uIGZvcm1hdENsb2NrVGltZXN0YW1wKGRhdGU6IERhdGUpOiBzdHJpbmcge1xuICBjb25zdCBwYWQgPSAodmFsdWU6IG51bWJlciwgbGVuZ3RoID0gMikgPT4gU3RyaW5nKHZhbHVlKS5wYWRTdGFydChsZW5ndGgsIFwiMFwiKTtcbiAgY29uc3Qgd2Vla2RheSA9IFtcIlN1blwiLCBcIk1vblwiLCBcIlR1ZVwiLCBcIldlZFwiLCBcIlRodVwiLCBcIkZyaVwiLCBcIlNhdFwiXVtkYXRlLmdldERheSgpXTtcbiAgY29uc3Qgb2Zmc2V0TWludXRlcyA9IC1kYXRlLmdldFRpbWV6b25lT2Zmc2V0KCk7XG4gIGNvbnN0IHNpZ24gPSBvZmZzZXRNaW51dGVzID49IDAgPyBcIitcIiA6IFwiLVwiO1xuICBjb25zdCBhYnNvbHV0ZU9mZnNldCA9IE1hdGguYWJzKG9mZnNldE1pbnV0ZXMpO1xuICByZXR1cm4gW1xuICAgIGAke2RhdGUuZ2V0RnVsbFllYXIoKX0tJHtwYWQoZGF0ZS5nZXRNb250aCgpICsgMSl9LSR7cGFkKGRhdGUuZ2V0RGF0ZSgpKX1gLFxuICAgIHdlZWtkYXksXG4gICAgYCR7cGFkKGRhdGUuZ2V0SG91cnMoKSl9OiR7cGFkKGRhdGUuZ2V0TWludXRlcygpKX06JHtwYWQoZGF0ZS5nZXRTZWNvbmRzKCkpfS4ke3BhZChkYXRlLmdldE1pbGxpc2Vjb25kcygpLCAzKX1gLFxuICAgIGAke3NpZ259JHtwYWQoTWF0aC5mbG9vcihhYnNvbHV0ZU9mZnNldCAvIDYwKSl9OiR7cGFkKGFic29sdXRlT2Zmc2V0ICUgNjApfWAsXG4gIF0uam9pbihcIiBcIik7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHNoYTI1Nihzb3VyY2U6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IGRpZ2VzdCA9IGF3YWl0IGNyeXB0by5zdWJ0bGUuZGlnZXN0KFwiU0hBLTI1NlwiLCBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoc291cmNlKSk7XG4gIHJldHVybiBBcnJheS5mcm9tKG5ldyBVaW50OEFycmF5KGRpZ2VzdCksIChieXRlKSA9PiBieXRlLnRvU3RyaW5nKDE2KS5wYWRTdGFydCgyLCBcIjBcIikpLmpvaW4oXCJcIik7XG59XG5cbmZ1bmN0aW9uIGFuYWx5emVTb3VyY2Uoc291cmNlOiBzdHJpbmcpOiBTb3VyY2VBbmFseXNpcyB7XG4gIGNvbnN0IGxpbmVFbmRpbmcgPSBzb3VyY2UuaW5jbHVkZXMoXCJcXHJcXG5cIikgPyBcIlxcclxcblwiIDogXCJcXG5cIjtcbiAgY29uc3QgbGluZXMgPSBzb3VyY2Uuc3BsaXQoL1xccj9cXG4vKTtcbiAgY29uc3Qgb3Blbk1hcmtlckluZGV4ID0gbGluZXMuZmluZEluZGV4KChsaW5lKSA9PiBsaW5lLnRyaW1FbmQoKSA9PT0gXCI8IS0tIG5hdXRpbHVzLWxvZzpwbGFuL3YxIC0tPlwiKTtcbiAgaWYgKG9wZW5NYXJrZXJJbmRleCA8IDApIHRocm93IG5ldyBFcnJvcihcIlRoZSBleGFjdCBQbGFuIFJlZ2lvbiBvcGVuaW5nIG1hcmtlciBpcyBtaXNzaW5nLlwiKTtcbiAgY29uc3QgY2xvc2VNYXJrZXJJbmRleCA9IGxpbmVzLmZpbmRJbmRleChcbiAgICAobGluZSwgaW5kZXgpID0+IGluZGV4ID4gb3Blbk1hcmtlckluZGV4ICYmIGxpbmUudHJpbUVuZCgpID09PSBcIjwhLS0gL25hdXRpbHVzLWxvZzpwbGFuIC0tPlwiLFxuICApO1xuICBpZiAoY2xvc2VNYXJrZXJJbmRleCA8IDApIHRocm93IG5ldyBFcnJvcihcIlRoZSBleGFjdCBQbGFuIFJlZ2lvbiBjbG9zaW5nIG1hcmtlciBpcyBtaXNzaW5nLlwiKTtcblxuICBjb25zdCB0YXJnZXRQYXR0ZXJuID0gbmV3IFJlZ0V4cChgXlstKypdIFxcXFxbIFxcXFxdIC4rIFxcXFxeJHtUQVJHRVRfSUR9WyBcXFxcdF0qJGApO1xuICBjb25zdCB0YXJnZXRMaW5lSW5kZXggPSBsaW5lcy5maW5kSW5kZXgoXG4gICAgKGxpbmUsIGluZGV4KSA9PiBpbmRleCA+IG9wZW5NYXJrZXJJbmRleCAmJiBpbmRleCA8IGNsb3NlTWFya2VySW5kZXggJiYgdGFyZ2V0UGF0dGVybi50ZXN0KGxpbmUpLFxuICApO1xuICBpZiAodGFyZ2V0TGluZUluZGV4IDwgMCkgdGhyb3cgbmV3IEVycm9yKGBPcGVuIEZsZXhpYmxlIFRhc2sgXiR7VEFSR0VUX0lEfSBpcyBtaXNzaW5nIG9yIGluZWxpZ2libGUuYCk7XG5cbiAgY29uc3QgaWRPY2N1cnJlbmNlcyA9IHNvdXJjZS5tYXRjaChuZXcgUmVnRXhwKGBcXFxcXiR7VEFSR0VUX0lEfSg/PVsgXFxcXHRdKig/OlxcXFxyP1xcXFxufCQpKWAsIFwiZ1wiKSk/Lmxlbmd0aCA/PyAwO1xuICBpZiAoaWRPY2N1cnJlbmNlcyAhPT0gMSkgdGhyb3cgbmV3IEVycm9yKGBQbGFuIEl0ZW0gSUQgXiR7VEFSR0VUX0lEfSBpcyBub3QgdW5pcXVlIGluIHRoZSBzb3VyY2UuYCk7XG5cbiAgbGV0IHRhcmdldEJvdW5kYXJ5SW5kZXggPSBjbG9zZU1hcmtlckluZGV4O1xuICBmb3IgKGxldCBpbmRleCA9IHRhcmdldExpbmVJbmRleCArIDE7IGluZGV4IDwgY2xvc2VNYXJrZXJJbmRleDsgaW5kZXggKz0gMSkge1xuICAgIGlmICgvXlstKypdICg/OlxcW1sgeFhdXFxdICk/Ly50ZXN0KGxpbmVzW2luZGV4XSkpIHtcbiAgICAgIHRhcmdldEJvdW5kYXJ5SW5kZXggPSBpbmRleDtcbiAgICAgIGJyZWFrO1xuICAgIH1cbiAgfVxuICBjb25zdCB0YXJnZXRCb2R5ID0gbGluZXMuc2xpY2UodGFyZ2V0TGluZUluZGV4ICsgMSwgdGFyZ2V0Qm91bmRhcnlJbmRleCk7XG4gIGNvbnN0IHJ1bm5pbmdQYXR0ZXJuID0gL15cXHMrLSBDTE9DSzogXFxbW15cXF1dKyBbKy1dXFxkezJ9OlxcZHsyfVxcXSBcXF5ubC1jbG9jay1bMC05YS1mLV17MzZ9XFxzKiQvO1xuICBjb25zdCBydW5uaW5nQ2xvY2tMaW5lID0gdGFyZ2V0Qm9keS5maW5kKChsaW5lKSA9PiBydW5uaW5nUGF0dGVybi50ZXN0KGxpbmUpKSA/PyBudWxsO1xuXG4gIHJldHVybiB7XG4gICAgbGluZXMsXG4gICAgbGluZUVuZGluZyxcbiAgICBvcGVuTWFya2VySW5kZXgsXG4gICAgY2xvc2VNYXJrZXJJbmRleCxcbiAgICB0YXJnZXRMaW5lSW5kZXgsXG4gICAgdGFyZ2V0Qm91bmRhcnlJbmRleCxcbiAgICB0YXJnZXRMaW5lOiBsaW5lc1t0YXJnZXRMaW5lSW5kZXhdLFxuICAgIHJ1bm5pbmdDbG9ja0xpbmUsXG4gIH07XG59XG5cbmZ1bmN0aW9uIGlzRWRpdGFibGVUYXJnZXQodGFyZ2V0OiBFdmVudFRhcmdldCB8IG51bGwpOiBib29sZWFuIHtcbiAgaWYgKCEodGFyZ2V0IGluc3RhbmNlb2YgRWxlbWVudCkpIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIEJvb2xlYW4odGFyZ2V0LmNsb3Nlc3QoXCJpbnB1dCwgdGV4dGFyZWEsIHNlbGVjdCwgW2NvbnRlbnRlZGl0YWJsZT0ndHJ1ZSddXCIpKTtcbn1cblxuY2xhc3MgUGxhbm5lclByb3RvdHlwZVZpZXcgZXh0ZW5kcyBJdGVtVmlldyB7XG4gIHByaXZhdGUgcm9vdCE6IEhUTUxFbGVtZW50O1xuICBwcml2YXRlIGhlYWRlckhvc3QhOiBIVE1MRWxlbWVudDtcbiAgcHJpdmF0ZSB2YXJpYW50SG9zdCE6IEhUTUxFbGVtZW50O1xuICBwcml2YXRlIHByb29mSG9zdCE6IEhUTUxFbGVtZW50O1xuICBwcml2YXRlIHN0YXRlT3V0cHV0ITogSFRNTEVsZW1lbnQ7XG4gIHByaXZhdGUgc3dpdGNoTGFiZWwhOiBIVE1MRWxlbWVudDtcbiAgcHJpdmF0ZSByZXNpemVPYnNlcnZlcjogUmVzaXplT2JzZXJ2ZXIgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBsYXlvdXRNdXRhdGlvbk9ic2VydmVyOiBNdXRhdGlvbk9ic2VydmVyIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgdGhlbWVPYnNlcnZlcjogTXV0YXRpb25PYnNlcnZlciB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHZhcmlhbnRJbmRleCA9IDA7XG4gIHByaXZhdGUgbGF5b3V0OiBMYXlvdXRNb2RlID0gXCJ3aWRlXCI7XG4gIHByaXZhdGUgbWVhc3VyZWRXaWR0aCA9IDA7XG4gIHByaXZhdGUgZmlsdGVyID0gXCJcIjtcbiAgcHJpdmF0ZSBkZW1vU3RhZ2U6IERlbW9TdGFnZSA9IFwiaWRsZVwiO1xuICBwcml2YXRlIGV4cGVjdGF0aW9uOiBXcml0ZUV4cGVjdGF0aW9uIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgZXhhY3RQcmV2aWV3ID0gXCJcIjtcbiAgcHJpdmF0ZSB0cmFjZTogc3RyaW5nW10gPSBbXTtcbiAgcHJpdmF0ZSBidXN5ID0gZmFsc2U7XG4gIHByaXZhdGUgcmVjb3ZlcmVkQ2xvY2s6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGNvbGxhcHNlZCA9IGZhbHNlO1xuICBwcml2YXRlIHNob3dDb21wbGV0ZWQgPSB0cnVlO1xuICBwcml2YXRlIG92ZXJ2aWV3T3BlbiA9IGZhbHNlO1xuICBwcml2YXRlIHNjaGVkdWxlT3BlbiA9IGZhbHNlO1xuICBwcml2YXRlIG92ZXJmbG93T3BlbiA9IGZhbHNlO1xuICBwcml2YXRlIHBsYXliYWNrID0gZmFsc2U7XG4gIHByaXZhdGUgcGxheWJhY2tTdGFydGVkQXQgPSAwO1xuICBwcml2YXRlIHBsYXliYWNrVGltZXI6IG51bWJlciB8IG51bGwgPSBudWxsO1xuXG4gIGNvbnN0cnVjdG9yKGxlYWY6IFdvcmtzcGFjZUxlYWYpIHtcbiAgICBzdXBlcihsZWFmKTtcbiAgfVxuXG4gIGdldFZpZXdUeXBlKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIFZJRVdfVFlQRTtcbiAgfVxuXG4gIGdldERpc3BsYXlUZXh0KCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIFwiU3BpcmFsIERheSBwbGFubmVyIHByb3RvdHlwZVwiO1xuICB9XG5cbiAgZ2V0SWNvbigpOiBzdHJpbmcge1xuICAgIHJldHVybiBcImNhbGVuZGFyLWNsb2NrXCI7XG4gIH1cblxuICBhc3luYyBvbk9wZW4oKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5jb250ZW50RWwuZW1wdHkoKTtcbiAgICB0aGlzLmNvbnRlbnRFbC5hZGRDbGFzcyhcInNwaXJhbC1kYXktcHJvdG90eXBlLXZpZXdcIik7XG4gICAgdGhpcy5yb290ID0gY3JlYXRlRWxlbWVudChcIm1haW5cIiwgXCJzZC1wbGFubmVyXCIpO1xuICAgIHRoaXMucm9vdC50YWJJbmRleCA9IC0xO1xuICAgIHRoaXMucm9vdC5kYXRhc2V0LmxheW91dCA9IHRoaXMubGF5b3V0O1xuICAgIHRoaXMuY29udGVudEVsLmFwcGVuZCh0aGlzLnJvb3QpO1xuICAgIHRoaXMuc2NoZWR1bGVPcGVuID0gIXRoaXMuY29udGVudEVsLmNsb3Nlc3QoXCIubW9kLXNpZGVkb2NrXCIpO1xuXG4gICAgdGhpcy5yZW5kZXJTaGVsbCgpO1xuICAgIHRoaXMucmVzaXplT2JzZXJ2ZXIgPSBuZXcgUmVzaXplT2JzZXJ2ZXIoKCkgPT4gdGhpcy5tZWFzdXJlTGF5b3V0KCkpO1xuICAgIHRoaXMucmVzaXplT2JzZXJ2ZXIub2JzZXJ2ZSh0aGlzLnJvb3QpO1xuICAgIGNvbnN0IGRvY2sgPSB0aGlzLmNvbnRlbnRFbC5jbG9zZXN0KFwiLm1vZC1zaWRlZG9ja1wiKTtcbiAgICBpZiAoZG9jaykge1xuICAgICAgdGhpcy5sYXlvdXRNdXRhdGlvbk9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIoKCkgPT4gdGhpcy5tZWFzdXJlTGF5b3V0KCkpO1xuICAgICAgdGhpcy5sYXlvdXRNdXRhdGlvbk9ic2VydmVyLm9ic2VydmUoZG9jaywgeyBhdHRyaWJ1dGVzOiB0cnVlLCBhdHRyaWJ1dGVGaWx0ZXI6IFtcInN0eWxlXCJdIH0pO1xuICAgIH1cbiAgICB0aGlzLm1lYXN1cmVMYXlvdXQoKTtcbiAgICB3aW5kb3cucmVxdWVzdEFuaW1hdGlvbkZyYW1lKCgpID0+IHRoaXMubWVhc3VyZUxheW91dCgpKTtcbiAgICB0aGlzLnJlZ2lzdGVySW50ZXJ2YWwod2luZG93LnNldEludGVydmFsKCgpID0+IHRoaXMubWVhc3VyZUxheW91dCgpLCAxNTApKTtcbiAgICB0aGlzLnJlZ2lzdGVyRG9tRXZlbnQod2luZG93LCBcInJlc2l6ZVwiLCAoKSA9PiB0aGlzLm1lYXN1cmVMYXlvdXQoKSk7XG5cbiAgICB0aGlzLnRoZW1lT2JzZXJ2ZXIgPSBuZXcgTXV0YXRpb25PYnNlcnZlcigoKSA9PiB0aGlzLnVwZGF0ZVN0YXRlT3V0cHV0KCkpO1xuICAgIHRoaXMudGhlbWVPYnNlcnZlci5vYnNlcnZlKGRvY3VtZW50LmJvZHksIHsgYXR0cmlidXRlczogdHJ1ZSwgYXR0cmlidXRlRmlsdGVyOiBbXCJjbGFzc1wiXSB9KTtcblxuICAgIHRoaXMucmVnaXN0ZXJEb21FdmVudChkb2N1bWVudCwgXCJrZXlkb3duXCIsIChldmVudDogS2V5Ym9hcmRFdmVudCkgPT4ge1xuICAgICAgaWYgKGV2ZW50LmRlZmF1bHRQcmV2ZW50ZWQgfHwgZXZlbnQuYWx0S2V5IHx8IGV2ZW50LmN0cmxLZXkgfHwgZXZlbnQubWV0YUtleSB8fCBldmVudC5zaGlmdEtleSkgcmV0dXJuO1xuICAgICAgaWYgKGV2ZW50LmtleSAhPT0gXCJBcnJvd0xlZnRcIiAmJiBldmVudC5rZXkgIT09IFwiQXJyb3dSaWdodFwiKSByZXR1cm47XG4gICAgICBpZiAoaXNFZGl0YWJsZVRhcmdldChldmVudC50YXJnZXQpKSByZXR1cm47XG4gICAgICBpZiAoIXRoaXMucm9vdC5pc0Nvbm5lY3RlZCkgcmV0dXJuO1xuICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgIHRoaXMuY3ljbGVWYXJpYW50KGV2ZW50LmtleSA9PT0gXCJBcnJvd1JpZ2h0XCIgPyAxIDogLTEpO1xuICAgIH0pO1xuXG4gICAgYXdhaXQgdGhpcy5yZWNvdmVyRnJvbU1hcmtkb3duKGZhbHNlKTtcbiAgfVxuXG4gIHByaXZhdGUgbWVhc3VyZUxheW91dCgpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMucm9vdD8uaXNDb25uZWN0ZWQpIHJldHVybjtcbiAgICBjb25zdCBuZXh0V2lkdGggPSBNYXRoLnJvdW5kKHRoaXMucm9vdC5nZXRCb3VuZGluZ0NsaWVudFJlY3QoKS53aWR0aCk7XG4gICAgY29uc3QgbmV4dExheW91dDogTGF5b3V0TW9kZSA9IG5leHRXaWR0aCA8PSA1MjAgPyBcImNvbXBhY3RcIiA6IFwid2lkZVwiO1xuICAgIGNvbnN0IGNoYW5nZWQgPSBuZXh0TGF5b3V0ICE9PSB0aGlzLmxheW91dDtcbiAgICBpZiAoIWNoYW5nZWQgJiYgbmV4dFdpZHRoID09PSB0aGlzLm1lYXN1cmVkV2lkdGgpIHJldHVybjtcbiAgICB0aGlzLm1lYXN1cmVkV2lkdGggPSBuZXh0V2lkdGg7XG4gICAgdGhpcy5sYXlvdXQgPSBuZXh0TGF5b3V0O1xuICAgIHRoaXMucm9vdC5kYXRhc2V0LmxheW91dCA9IG5leHRMYXlvdXQ7XG4gICAgaWYgKGNoYW5nZWQpIHRoaXMucmVuZGVyVmFyaWFudCgpO1xuICAgIHRoaXMudXBkYXRlU3RhdGVPdXRwdXQoKTtcbiAgfVxuXG4gIGFzeW5jIG9uQ2xvc2UoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMucGxheWJhY2tUaW1lciAhPT0gbnVsbCkgd2luZG93LmNsZWFySW50ZXJ2YWwodGhpcy5wbGF5YmFja1RpbWVyKTtcbiAgICB0aGlzLnJlc2l6ZU9ic2VydmVyPy5kaXNjb25uZWN0KCk7XG4gICAgdGhpcy5sYXlvdXRNdXRhdGlvbk9ic2VydmVyPy5kaXNjb25uZWN0KCk7XG4gICAgdGhpcy50aGVtZU9ic2VydmVyPy5kaXNjb25uZWN0KCk7XG4gICAgdGhpcy5jb250ZW50RWwucmVtb3ZlQ2xhc3MoXCJzcGlyYWwtZGF5LXByb3RvdHlwZS12aWV3XCIpO1xuICAgIHRoaXMuY29udGVudEVsLmVtcHR5KCk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlclNoZWxsKCk6IHZvaWQge1xuICAgIHRoaXMucm9vdC5lbXB0eSgpO1xuICAgIHRoaXMuaGVhZGVySG9zdCA9IGNyZWF0ZUVsZW1lbnQoXCJkaXZcIiwgXCJzZC1oZWFkZXItaG9zdFwiKTtcbiAgICB0aGlzLnJvb3QuYXBwZW5kKHRoaXMuaGVhZGVySG9zdCk7XG4gICAgdGhpcy5yZW5kZXJDdXJyZW50SGVhZGVyKCk7XG4gICAgdGhpcy5yb290LmFwcGVuZCh0aGlzLnJlbmRlckV4ZWN1dGlvblN0cmlwKCkpO1xuXG4gICAgdGhpcy52YXJpYW50SG9zdCA9IGNyZWF0ZUVsZW1lbnQoXCJzZWN0aW9uXCIsIFwic2QtdmFyaWFudC1ob3N0XCIpO1xuICAgIHRoaXMucm9vdC5hcHBlbmQodGhpcy52YXJpYW50SG9zdCk7XG5cbiAgICB0aGlzLnByb29mSG9zdCA9IGNyZWF0ZUVsZW1lbnQoXCJzZWN0aW9uXCIsIFwic2QtcHJvb2YtaG9zdFwiKTtcbiAgICB0aGlzLnJvb3QuYXBwZW5kKHRoaXMucHJvb2ZIb3N0KTtcblxuICAgIGNvbnN0IHN0YXRlRGV0YWlscyA9IGNyZWF0ZUVsZW1lbnQoXCJkZXRhaWxzXCIsIFwic2Qtc3RhdGVcIik7XG4gICAgc3RhdGVEZXRhaWxzLmFwcGVuZChjcmVhdGVFbGVtZW50KFwic3VtbWFyeVwiLCBcInNkLXN0YXRlX19zdW1tYXJ5XCIsIFwiVmlzaWJsZSBzdGF0ZVwiKSk7XG4gICAgdGhpcy5zdGF0ZU91dHB1dCA9IGNyZWF0ZUVsZW1lbnQoXCJwcmVcIiwgXCJzZC1zdGF0ZV9fb3V0cHV0XCIpO1xuICAgIHN0YXRlRGV0YWlscy5hcHBlbmQodGhpcy5zdGF0ZU91dHB1dCk7XG4gICAgdGhpcy5yb290LmFwcGVuZChzdGF0ZURldGFpbHMpO1xuXG4gICAgY29uc3QgaGFybmVzcyA9IGNyZWF0ZUVsZW1lbnQoXCJmb290ZXJcIiwgXCJzZC1oYXJuZXNzLXJhaWxcIik7XG4gICAgaGFybmVzcy5hcHBlbmQoY3JlYXRlRWxlbWVudChcInNwYW5cIiwgXCJzZC1oYXJuZXNzLXJhaWxfX2xhYmVsXCIsIFwiUHJvdG90eXBlIHZhcmlhbnRzXCIpKTtcbiAgICBoYXJuZXNzLmFwcGVuZCh0aGlzLnJlbmRlclN3aXRjaGVyKCkpO1xuICAgIHRoaXMuY29udGVudEVsLmFwcGVuZChoYXJuZXNzKTtcbiAgICB0aGlzLnJlbmRlclZhcmlhbnQoKTtcbiAgICB0aGlzLnJlbmRlcldyaXRlUHJvb2YoKTtcbiAgICB0aGlzLnVwZGF0ZVN0YXRlT3V0cHV0KCk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckN1cnJlbnRIZWFkZXIoKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmhlYWRlckhvc3QpIHJldHVybjtcbiAgICB0aGlzLmhlYWRlckhvc3QucmVwbGFjZUNoaWxkcmVuKFxuICAgICAgVkFSSUFOVFNbdGhpcy52YXJpYW50SW5kZXhdLmtleSA9PT0gXCJBXCIgPyB0aGlzLnJlbmRlclBhcml0eUhlYWRlcigpIDogdGhpcy5yZW5kZXJQcm90b3R5cGVIZWFkZXIoKSxcbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJQcm90b3R5cGVIZWFkZXIoKTogSFRNTEVsZW1lbnQge1xuICAgIGNvbnN0IGhlYWRlciA9IGNyZWF0ZUVsZW1lbnQoXCJoZWFkZXJcIiwgXCJzZC1oZWFkZXJcIik7XG4gICAgY29uc3QgaWRlbnRpdHkgPSBjcmVhdGVFbGVtZW50KFwiZGl2XCIsIFwic2QtaGVhZGVyX19pZGVudGl0eVwiKTtcbiAgICBpZGVudGl0eS5hcHBlbmQoY3JlYXRlRWxlbWVudChcImRpdlwiLCBcInNkLWtpY2tlclwiLCBcIkZSSURBWSBcdTAwQjcgMjggQVVHIDIwMjZcIikpO1xuICAgIGlkZW50aXR5LmFwcGVuZChjcmVhdGVFbGVtZW50KFwiaDFcIiwgXCJzZC10aXRsZVwiLCBcIlNwaXJhbCBEYXkgLyBcdTg3QkFcdTY1Q0JcdTY1RTVcdTdBMEJcIikpO1xuICAgIGhlYWRlci5hcHBlbmQoaWRlbnRpdHkpO1xuXG4gICAgY29uc3Qgc2VhcmNoID0gY3JlYXRlRWxlbWVudChcImxhYmVsXCIsIFwic2QtZmlsdGVyXCIpO1xuICAgIGNvbnN0IGljb24gPSBjcmVhdGVFbGVtZW50KFwic3BhblwiLCBcInNkLWZpbHRlcl9faWNvblwiKTtcbiAgICBzZXRJY29uKGljb24sIFwic2VhcmNoXCIpO1xuICAgIHNlYXJjaC5hcHBlbmQoaWNvbik7XG4gICAgY29uc3QgaW5wdXQgPSBjcmVhdGVFbGVtZW50KFwiaW5wdXRcIiwgXCJzZC1maWx0ZXJfX2lucHV0XCIpO1xuICAgIGlucHV0LnR5cGUgPSBcInNlYXJjaFwiO1xuICAgIGlucHV0LnBsYWNlaG9sZGVyID0gXCJGaWx0ZXIgcGxhbiAvIFx1N0I1Qlx1OTAwOVwiO1xuICAgIGlucHV0LmFyaWFMYWJlbCA9IFwiRmlsdGVyIHBsYW5uZXIgaXRlbXNcIjtcbiAgICBpbnB1dC52YWx1ZSA9IHRoaXMuZmlsdGVyO1xuICAgIGlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJpbnB1dFwiLCAoKSA9PiB7XG4gICAgICB0aGlzLmZpbHRlciA9IGlucHV0LnZhbHVlO1xuICAgICAgdGhpcy5yZW5kZXJWYXJpYW50KCk7XG4gICAgICB0aGlzLnVwZGF0ZVN0YXRlT3V0cHV0KCk7XG4gICAgfSk7XG4gICAgc2VhcmNoLmFwcGVuZChpbnB1dCk7XG4gICAgaGVhZGVyLmFwcGVuZChzZWFyY2gpO1xuICAgIHJldHVybiBoZWFkZXI7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlclBhcml0eUhlYWRlcigpOiBIVE1MRWxlbWVudCB7XG4gICAgY29uc3QgaGVhZGVyID0gY3JlYXRlRWxlbWVudChcImhlYWRlclwiLCBcInNkLXBhcml0eS1oZWFkZXJcIik7XG4gICAgaGVhZGVyLnNldEF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIiwgXCJTcGlyYWwgRGF5IHBsYW5uZXIgY2FwYWNpdHkgYW5kIGNvbnRyb2xzXCIpO1xuICAgIGlmICh0aGlzLmNvbGxhcHNlZCkgaGVhZGVyLmNsYXNzTGlzdC5hZGQoXCJzZC1wYXJpdHktaGVhZGVyLS1jb2xsYXBzZWRcIik7XG5cbiAgICBjb25zdCBjb250cm9scyA9IGNyZWF0ZUVsZW1lbnQoXCJkaXZcIiwgXCJzZC1wYXJpdHktY29udHJvbHNcIik7XG4gICAgY29uc3QgY29sbGFwc2UgPSBpY29uQnV0dG9uKFxuICAgICAgdGhpcy5jb2xsYXBzZWQgPyBcImNoZXZyb25zLXVwLWRvd25cIiA6IFwiY2hldnJvbnMtZG93bi11cFwiLFxuICAgICAgdGhpcy5jb2xsYXBzZWQgPyBcIkV4cGFuZCBwbGFubmVyXCIgOiBcIkNvbGxhcHNlIHBsYW5uZXJcIixcbiAgICAgICgpID0+IHtcbiAgICAgICAgdGhpcy5jb2xsYXBzZWQgPSAhdGhpcy5jb2xsYXBzZWQ7XG4gICAgICAgIHRoaXMucmVuZGVyQ3VycmVudEhlYWRlcigpO1xuICAgICAgICB0aGlzLnJlbmRlclZhcmlhbnQoKTtcbiAgICAgICAgdGhpcy51cGRhdGVTdGF0ZU91dHB1dCgpO1xuICAgICAgfSxcbiAgICAgIHsgY2xhc3NOYW1lOiBcInNkLXBhcml0eS1jb250cm9sXCIgfSxcbiAgICApO1xuICAgIGNvbnRyb2xzLmFwcGVuZChjb2xsYXBzZSk7XG5cbiAgICBpZiAodGhpcy5jb2xsYXBzZWQpIHtcbiAgICAgIGhlYWRlci5hcHBlbmQoY29udHJvbHMpO1xuICAgICAgcmV0dXJuIGhlYWRlcjtcbiAgICB9XG5cbiAgICBjb25zdCBjb21wbGV0ZWQgPSBpY29uQnV0dG9uKFxuICAgICAgdGhpcy5zaG93Q29tcGxldGVkID8gXCJleWVcIiA6IFwiZXllLW9mZlwiLFxuICAgICAgdGhpcy5zaG93Q29tcGxldGVkID8gXCJIaWRlIGNvbXBsZXRlZCBpdGVtc1wiIDogXCJTaG93IGNvbXBsZXRlZCBpdGVtc1wiLFxuICAgICAgKCkgPT4ge1xuICAgICAgICB0aGlzLnNob3dDb21wbGV0ZWQgPSAhdGhpcy5zaG93Q29tcGxldGVkO1xuICAgICAgICB0aGlzLnJlbmRlckN1cnJlbnRIZWFkZXIoKTtcbiAgICAgICAgdGhpcy5yZW5kZXJWYXJpYW50KCk7XG4gICAgICAgIHRoaXMudXBkYXRlU3RhdGVPdXRwdXQoKTtcbiAgICAgIH0sXG4gICAgICB7IGNsYXNzTmFtZTogXCJzZC1wYXJpdHktY29udHJvbFwiIH0sXG4gICAgKTtcbiAgICBjb21wbGV0ZWQuc2V0QXR0cmlidXRlKFwiYXJpYS1wcmVzc2VkXCIsIFN0cmluZyh0aGlzLnNob3dDb21wbGV0ZWQpKTtcblxuICAgIGNvbnN0IHBsYXliYWNrID0gaWNvbkJ1dHRvbihcbiAgICAgIHRoaXMucGxheWJhY2sgPyBcImxvYWRlci1jaXJjbGVcIiA6IFwicGxheVwiLFxuICAgICAgdGhpcy5wbGF5YmFjayA/IFwiUGxheWJhY2sgaW4gcHJvZ3Jlc3NcIiA6IFwiUGxheSBzaXgtc2Vjb25kIGRheSBwcmV2aWV3XCIsXG4gICAgICAoKSA9PiB0aGlzLnN0YXJ0UGxheWJhY2soKSxcbiAgICAgIHsgY2xhc3NOYW1lOiBcInNkLXBhcml0eS1jb250cm9sXCIgfSxcbiAgICApO1xuICAgIHBsYXliYWNrLmRpc2FibGVkID0gdGhpcy5wbGF5YmFjaztcbiAgICBjb250cm9scy5hcHBlbmQoY29tcGxldGVkLCBwbGF5YmFjayk7XG5cbiAgICBjb25zdCBtZXRyaWNzID0gdGhpcy5yZW5kZXJNZXRyaWNzKGZhbHNlKTtcbiAgICBtZXRyaWNzLmNsYXNzTGlzdC5hZGQoXCJzZC1wYXJpdHktbWV0cmljc1wiKTtcbiAgICBjb25zdCBhY3Rpb25zID0gY3JlYXRlRWxlbWVudChcImRpdlwiLCBcInNkLXBhcml0eS1hY3Rpb25zXCIpO1xuICAgIGFjdGlvbnMuYXBwZW5kKGNvbnRyb2xzLCB0aGlzLnJlbmRlckxlZ2VuZCgpKTtcbiAgICBoZWFkZXIuYXBwZW5kKG1ldHJpY3MsIGFjdGlvbnMpO1xuICAgIHJldHVybiBoZWFkZXI7XG4gIH1cblxuICBwcml2YXRlIHN0YXJ0UGxheWJhY2soKTogdm9pZCB7XG4gICAgaWYgKHRoaXMucGxheWJhY2spIHJldHVybjtcbiAgICB0aGlzLnBsYXliYWNrID0gdHJ1ZTtcbiAgICB0aGlzLnBsYXliYWNrU3RhcnRlZEF0ID0gRGF0ZS5ub3coKTtcbiAgICB0aGlzLnJlbmRlckN1cnJlbnRIZWFkZXIoKTtcbiAgICB0aGlzLnJlbmRlclZhcmlhbnQoKTtcbiAgICB0aGlzLnVwZGF0ZVN0YXRlT3V0cHV0KCk7XG4gICAgdGhpcy5wbGF5YmFja1RpbWVyID0gd2luZG93LnNldEludGVydmFsKCgpID0+IHtcbiAgICAgIGlmIChEYXRlLm5vdygpIC0gdGhpcy5wbGF5YmFja1N0YXJ0ZWRBdCA+PSA2MDAwKSB7XG4gICAgICAgIGlmICh0aGlzLnBsYXliYWNrVGltZXIgIT09IG51bGwpIHdpbmRvdy5jbGVhckludGVydmFsKHRoaXMucGxheWJhY2tUaW1lcik7XG4gICAgICAgIHRoaXMucGxheWJhY2tUaW1lciA9IG51bGw7XG4gICAgICAgIHRoaXMucGxheWJhY2sgPSBmYWxzZTtcbiAgICAgIH1cbiAgICAgIHRoaXMucmVuZGVyQ3VycmVudEhlYWRlcigpO1xuICAgICAgdGhpcy5yZW5kZXJWYXJpYW50KCk7XG4gICAgICB0aGlzLnVwZGF0ZVN0YXRlT3V0cHV0KCk7XG4gICAgfSwgMjUwKTtcbiAgfVxuXG4gIHByaXZhdGUgcGxheWJhY2tMYWJlbCgpOiBzdHJpbmcge1xuICAgIGlmICghdGhpcy5wbGF5YmFjaykgcmV0dXJuIFwiMTE6NDJcIjtcbiAgICBjb25zdCBwcm9ncmVzcyA9IE1hdGgubWluKDEsIChEYXRlLm5vdygpIC0gdGhpcy5wbGF5YmFja1N0YXJ0ZWRBdCkgLyA2MDAwKTtcbiAgICBjb25zdCBtaW51dGUgPSA5ICogNjAgKyBNYXRoLnJvdW5kKHByb2dyZXNzICogOSAqIDYwKTtcbiAgICByZXR1cm4gYCR7U3RyaW5nKE1hdGguZmxvb3IobWludXRlIC8gNjApKS5wYWRTdGFydCgyLCBcIjBcIil9OiR7U3RyaW5nKG1pbnV0ZSAlIDYwKS5wYWRTdGFydCgyLCBcIjBcIil9YDtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyRXhlY3V0aW9uU3RyaXAoKTogSFRNTEVsZW1lbnQge1xuICAgIGNvbnN0IHN0cmlwID0gY3JlYXRlRWxlbWVudChcInNlY3Rpb25cIiwgXCJzZC1leGVjdXRpb25cIik7XG4gICAgc3RyaXAuc2V0QXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiLCBcIkFjdGl2ZSBleGVjdXRpb24gc3RhdHVzXCIpO1xuXG4gICAgY29uc3QgY2xvY2sgPSBjcmVhdGVFbGVtZW50KFwiZGl2XCIsIFwic2QtZXhlY3V0aW9uX19pdGVtIHNkLWV4ZWN1dGlvbl9faXRlbS0tY2xvY2tcIik7XG4gICAgY29uc3QgY2xvY2tJY29uID0gY3JlYXRlRWxlbWVudChcInNwYW5cIiwgXCJzZC1leGVjdXRpb25fX2ljb25cIik7XG4gICAgc2V0SWNvbihjbG9ja0ljb24sIFwidGltZXJcIik7XG4gICAgY2xvY2suYXBwZW5kKGNsb2NrSWNvbik7XG4gICAgY29uc3QgY2xvY2tUZXh0ID0gY3JlYXRlRWxlbWVudChcImRpdlwiLCBcInNkLWV4ZWN1dGlvbl9fY29weVwiKTtcbiAgICBjbG9ja1RleHQuYXBwZW5kKGNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIsIFwic2QtZXhlY3V0aW9uX19sYWJlbFwiLCBcIkNMT0NLIFx1MDBCNyAwMDo0MjoxOFwiKSk7XG4gICAgY2xvY2tUZXh0LmFwcGVuZChjcmVhdGVFbGVtZW50KFwic3Ryb25nXCIsIFwic2QtZXhlY3V0aW9uX190aXRsZVwiLCBcIkRlZXAgd29yayAvIFx1NkRGMVx1NUVBNlx1NURFNVx1NEY1Q1wiKSk7XG4gICAgY2xvY2suYXBwZW5kKGNsb2NrVGV4dCk7XG5cbiAgICBjb25zdCBwb21vID0gY3JlYXRlRWxlbWVudChcImRpdlwiLCBcInNkLWV4ZWN1dGlvbl9faXRlbSBzZC1leGVjdXRpb25fX2l0ZW0tLXBvbW9cIik7XG4gICAgY29uc3QgcG9tb0ljb24gPSBjcmVhdGVFbGVtZW50KFwic3BhblwiLCBcInNkLWV4ZWN1dGlvbl9faWNvblwiKTtcbiAgICBzZXRJY29uKHBvbW9JY29uLCBcImNpcmNsZS1kb3QtZGFzaGVkXCIpO1xuICAgIHBvbW8uYXBwZW5kKHBvbW9JY29uKTtcbiAgICBjb25zdCBwb21vVGV4dCA9IGNyZWF0ZUVsZW1lbnQoXCJkaXZcIiwgXCJzZC1leGVjdXRpb25fX2NvcHlcIik7XG4gICAgcG9tb1RleHQuYXBwZW5kKGNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIsIFwic2QtZXhlY3V0aW9uX19sYWJlbFwiLCBcIlBPTU8gXHUwMEI3IDEyOjA3XCIpKTtcbiAgICBwb21vVGV4dC5hcHBlbmQoY3JlYXRlRWxlbWVudChcInN0cm9uZ1wiLCBcInNkLWV4ZWN1dGlvbl9fdGl0bGVcIiwgXCJGb2N1cyBjeWNsZSAzIC8gXHU0RTEzXHU2Q0U4XHU1NDY4XHU2NzFGIDNcIikpO1xuICAgIHBvbW8uYXBwZW5kKHBvbW9UZXh0KTtcblxuICAgIHN0cmlwLmFwcGVuZChjbG9jaywgcG9tbyk7XG4gICAgcmV0dXJuIHN0cmlwO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJTd2l0Y2hlcigpOiBIVE1MRWxlbWVudCB7XG4gICAgY29uc3Qgc3dpdGNoZXIgPSBjcmVhdGVFbGVtZW50KFwibmF2XCIsIFwic2Qtc3dpdGNoZXJcIik7XG4gICAgc3dpdGNoZXIuc2V0QXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiLCBcIlByb3RvdHlwZSB2YXJpYW50IHN3aXRjaGVyXCIpO1xuICAgIGNvbnN0IHByZXZpb3VzID0gaWNvbkJ1dHRvbihcImNoZXZyb24tbGVmdFwiLCBcIlByZXZpb3VzIHZhcmlhbnRcIiwgKCkgPT4gdGhpcy5jeWNsZVZhcmlhbnQoLTEpLCB7XG4gICAgICBjbGFzc05hbWU6IFwic2Qtc3dpdGNoZXJfX2Fycm93XCIsXG4gICAgfSk7XG4gICAgdGhpcy5zd2l0Y2hMYWJlbCA9IGNyZWF0ZUVsZW1lbnQoXCJkaXZcIiwgXCJzZC1zd2l0Y2hlcl9fbGFiZWxcIik7XG4gICAgdGhpcy5zd2l0Y2hMYWJlbC5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxpdmVcIiwgXCJwb2xpdGVcIik7XG4gICAgY29uc3QgbmV4dCA9IGljb25CdXR0b24oXCJjaGV2cm9uLXJpZ2h0XCIsIFwiTmV4dCB2YXJpYW50XCIsICgpID0+IHRoaXMuY3ljbGVWYXJpYW50KDEpLCB7XG4gICAgICBjbGFzc05hbWU6IFwic2Qtc3dpdGNoZXJfX2Fycm93XCIsXG4gICAgfSk7XG4gICAgc3dpdGNoZXIuYXBwZW5kKHByZXZpb3VzLCB0aGlzLnN3aXRjaExhYmVsLCBuZXh0KTtcbiAgICB0aGlzLnVwZGF0ZVN3aXRjaGVyTGFiZWwoKTtcbiAgICByZXR1cm4gc3dpdGNoZXI7XG4gIH1cblxuICBwcml2YXRlIGN5Y2xlVmFyaWFudChkZWx0YTogbnVtYmVyKTogdm9pZCB7XG4gICAgdGhpcy52YXJpYW50SW5kZXggPSAodGhpcy52YXJpYW50SW5kZXggKyBkZWx0YSArIFZBUklBTlRTLmxlbmd0aCkgJSBWQVJJQU5UUy5sZW5ndGg7XG4gICAgdGhpcy5yZW5kZXJDdXJyZW50SGVhZGVyKCk7XG4gICAgdGhpcy5yZW5kZXJWYXJpYW50KCk7XG4gICAgdGhpcy51cGRhdGVTd2l0Y2hlckxhYmVsKCk7XG4gICAgdGhpcy51cGRhdGVTdGF0ZU91dHB1dCgpO1xuICB9XG5cbiAgcHJpdmF0ZSB1cGRhdGVTd2l0Y2hlckxhYmVsKCk6IHZvaWQge1xuICAgIGlmICghdGhpcy5zd2l0Y2hMYWJlbCkgcmV0dXJuO1xuICAgIGNvbnN0IGN1cnJlbnQgPSBWQVJJQU5UU1t0aGlzLnZhcmlhbnRJbmRleF07XG4gICAgdGhpcy5zd2l0Y2hMYWJlbC5yZXBsYWNlQ2hpbGRyZW4oXG4gICAgICBjcmVhdGVFbGVtZW50KFwic3Ryb25nXCIsIFwic2Qtc3dpdGNoZXJfX2tleVwiLCBjdXJyZW50LmtleSksXG4gICAgICBjcmVhdGVFbGVtZW50KFwic3BhblwiLCBcInNkLXN3aXRjaGVyX19uYW1lXCIsIGN1cnJlbnQubmFtZSksXG4gICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgZmlsdGVyZWRJdGVtcygpOiBQbGFuSXRlbVtdIHtcbiAgICBjb25zdCBxdWVyeSA9IHRoaXMuZmlsdGVyLnRyaW0oKS50b0xvY2FsZUxvd2VyQ2FzZSgpO1xuICAgIHJldHVybiBQTEFOX0lURU1TLmZpbHRlcihcbiAgICAgIChpdGVtKSA9PiAodGhpcy5zaG93Q29tcGxldGVkIHx8IGl0ZW0ua2luZCAhPT0gXCJkb25lXCIpXG4gICAgICAgICYmICghcXVlcnkgfHwgaXRlbS50aXRsZS50b0xvY2FsZUxvd2VyQ2FzZSgpLmluY2x1ZGVzKHF1ZXJ5KSksXG4gICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyVmFyaWFudCgpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMudmFyaWFudEhvc3QpIHJldHVybjtcbiAgICB0aGlzLnZhcmlhbnRIb3N0LmVtcHR5KCk7XG4gICAgY29uc3Qga2V5ID0gVkFSSUFOVFNbdGhpcy52YXJpYW50SW5kZXhdLmtleTtcbiAgICB0aGlzLnZhcmlhbnRIb3N0LmNsYXNzTGlzdC50b2dnbGUoXCJpcy1jb2xsYXBzZWRcIiwga2V5ID09PSBcIkFcIiAmJiB0aGlzLmNvbGxhcHNlZCk7XG4gICAgaWYgKGtleSA9PT0gXCJBXCIpIHRoaXMudmFyaWFudEhvc3QuYXBwZW5kKHRoaXMucmVuZGVyVmFyaWFudEEoKSk7XG4gICAgaWYgKGtleSA9PT0gXCJCXCIpIHRoaXMudmFyaWFudEhvc3QuYXBwZW5kKHRoaXMucmVuZGVyVmFyaWFudEIoKSk7XG4gICAgaWYgKGtleSA9PT0gXCJDXCIpIHRoaXMudmFyaWFudEhvc3QuYXBwZW5kKHRoaXMucmVuZGVyVmFyaWFudEMoKSk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlclZhcmlhbnRBKCk6IEhUTUxFbGVtZW50IHtcbiAgICBjb25zdCBzZWN0aW9uID0gY3JlYXRlRWxlbWVudChcImRpdlwiLCBcInNkLXZhcmlhbnQgc2QtdmFyaWFudC1hXCIpO1xuICAgIHNlY3Rpb24uZGF0YXNldC52YXJpYW50ID0gXCJBXCI7XG4gICAgaWYgKHRoaXMuY29sbGFwc2VkKSByZXR1cm4gc2VjdGlvbjtcbiAgICBzZWN0aW9uLmFwcGVuZCh0aGlzLnJlbmRlclNwaXJhbCgpKTtcblxuICAgIGNvbnN0IGNvbXBhY3RPdmVydmlldyA9IGNyZWF0ZUVsZW1lbnQoXCJkZXRhaWxzXCIsIFwic2QtZGlzY2xvc3VyZSBzZC1jb21wYWN0LW92ZXJ2aWV3XCIpO1xuICAgIGNvbXBhY3RPdmVydmlldy5vcGVuID0gdGhpcy5vdmVydmlld09wZW47XG4gICAgY29tcGFjdE92ZXJ2aWV3LmFkZEV2ZW50TGlzdGVuZXIoXCJ0b2dnbGVcIiwgKCkgPT4ge1xuICAgICAgdGhpcy5vdmVydmlld09wZW4gPSBjb21wYWN0T3ZlcnZpZXcub3BlbjtcbiAgICB9KTtcbiAgICBjb21wYWN0T3ZlcnZpZXcuYXBwZW5kKGNyZWF0ZUVsZW1lbnQoXCJzdW1tYXJ5XCIsIFwic2QtZGlzY2xvc3VyZV9fc3VtbWFyeVwiLCBcIk92ZXJ2aWV3IFx1MDBCNyAyaCAwN20gb3BlbiAvIFx1Njk4Mlx1ODlDOFwiKSk7XG4gICAgY29tcGFjdE92ZXJ2aWV3LmFwcGVuZCh0aGlzLnJlbmRlck1ldHJpY3MoKSk7XG4gICAgc2VjdGlvbi5hcHBlbmQoY29tcGFjdE92ZXJ2aWV3KTtcblxuICAgIGNvbnN0IGNvbXBhY3RTY2hlZHVsZSA9IGNyZWF0ZUVsZW1lbnQoXCJkZXRhaWxzXCIsIFwic2QtZGlzY2xvc3VyZSBzZC1jb21wYWN0LXNjaGVkdWxlXCIpO1xuICAgIGNvbXBhY3RTY2hlZHVsZS5vcGVuID0gdGhpcy5zY2hlZHVsZU9wZW47XG4gICAgY29tcGFjdFNjaGVkdWxlLmFkZEV2ZW50TGlzdGVuZXIoXCJ0b2dnbGVcIiwgKCkgPT4ge1xuICAgICAgdGhpcy5zY2hlZHVsZU9wZW4gPSBjb21wYWN0U2NoZWR1bGUub3BlbjtcbiAgICB9KTtcbiAgICBjb25zdCBzY2hlZHVsZUl0ZW1zID0gdGhpcy5maWx0ZXJlZEl0ZW1zKCkuZmlsdGVyKChpdGVtKSA9PiBpdGVtLmtpbmQgIT09IFwib3ZlcmZsb3dcIik7XG4gICAgY29tcGFjdFNjaGVkdWxlLmFwcGVuZChcbiAgICAgIGNyZWF0ZUVsZW1lbnQoXCJzdW1tYXJ5XCIsIFwic2QtZGlzY2xvc3VyZV9fc3VtbWFyeVwiLCBgU2NoZWR1bGUgXHUwMEI3ICR7c2NoZWR1bGVJdGVtcy5sZW5ndGh9IGl0ZW1zIC8gXHU2NUU1XHU3QTBCYCksXG4gICAgKTtcbiAgICBjb21wYWN0U2NoZWR1bGUuYXBwZW5kKHRoaXMucmVuZGVyU2NoZWR1bGVMaXN0KHNjaGVkdWxlSXRlbXMpKTtcbiAgICBzZWN0aW9uLmFwcGVuZChjb21wYWN0U2NoZWR1bGUpO1xuICAgIHNlY3Rpb24uYXBwZW5kKHRoaXMucmVuZGVyT3ZlcmZsb3dEaXNjbG9zdXJlKCkpO1xuICAgIHJldHVybiBzZWN0aW9uO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJNZXRyaWNzKGluY2x1ZGVMZWdlbmQgPSB0cnVlKTogSFRNTEVsZW1lbnQge1xuICAgIGNvbnN0IG1ldHJpY3MgPSBjcmVhdGVFbGVtZW50KFwic2VjdGlvblwiLCBcInNkLW1ldHJpY3NcIik7XG4gICAgbWV0cmljcy5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIFwiQ2FwYWNpdHkgb3ZlcnZpZXdcIik7XG4gICAgY29uc3QgdmFsdWVzID0gW1xuICAgICAgW1wiV2luZG93XCIsIFwiMDk6MDBcdTIwMTMxODowMFwiXSxcbiAgICAgIFtcIkZpeGVkXCIsIFwiMWggNDVtXCJdLFxuICAgICAgW1wiRmxleGlibGVcIiwgXCIzaCAwOG1cIl0sXG4gICAgICBbXCJBdmFpbGFibGVcIiwgXCIyaCAwN21cIl0sXG4gICAgXTtcbiAgICBmb3IgKGNvbnN0IFtsYWJlbCwgdmFsdWVdIG9mIHZhbHVlcykge1xuICAgICAgY29uc3QgbWV0cmljID0gY3JlYXRlRWxlbWVudChcImRpdlwiLCBcInNkLW1ldHJpY1wiKTtcbiAgICAgIG1ldHJpYy5hcHBlbmQoY3JlYXRlRWxlbWVudChcInNwYW5cIiwgXCJzZC1tZXRyaWNfX2xhYmVsXCIsIGxhYmVsKSk7XG4gICAgICBtZXRyaWMuYXBwZW5kKGNyZWF0ZUVsZW1lbnQoXCJzdHJvbmdcIiwgXCJzZC1tZXRyaWNfX3ZhbHVlXCIsIHZhbHVlKSk7XG4gICAgICBtZXRyaWNzLmFwcGVuZChtZXRyaWMpO1xuICAgIH1cbiAgICBpZiAoaW5jbHVkZUxlZ2VuZCkgbWV0cmljcy5hcHBlbmQodGhpcy5yZW5kZXJMZWdlbmQoKSk7XG4gICAgcmV0dXJuIG1ldHJpY3M7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckxlZ2VuZCgpOiBIVE1MRWxlbWVudCB7XG4gICAgY29uc3QgbGVnZW5kID0gY3JlYXRlRWxlbWVudChcImRpdlwiLCBcInNkLWxlZ2VuZFwiKTtcbiAgICBsZWdlbmQuc2V0QXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiLCBcIlBsYW5uZXIgbGVnZW5kXCIpO1xuICAgIGZvciAoY29uc3QgW2tpbmQsIGxhYmVsXSBvZiBbXG4gICAgICBbXCJ1cmdlbnRcIiwgXCJVcmdlbnRcIl0sXG4gICAgICBbXCJldmVudFwiLCBcIkZpeGVkXCJdLFxuICAgICAgW1widGFza1wiLCBcIkZsZXhpYmxlXCJdLFxuICAgIF0pIHtcbiAgICAgIGNvbnN0IGVudHJ5ID0gY3JlYXRlRWxlbWVudChcInNwYW5cIiwgXCJzZC1sZWdlbmRfX2VudHJ5XCIpO1xuICAgICAgY29uc3QgZG90ID0gY3JlYXRlRWxlbWVudChcInNwYW5cIiwgYHNkLWRvdCBzZC1kb3QtLSR7a2luZH1gKTtcbiAgICAgIGVudHJ5LmFwcGVuZChkb3QsIGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKGxhYmVsKSk7XG4gICAgICBsZWdlbmQuYXBwZW5kKGVudHJ5KTtcbiAgICB9XG4gICAgcmV0dXJuIGxlZ2VuZDtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyU3BpcmFsKCk6IEhUTUxFbGVtZW50IHtcbiAgICBjb25zdCBmcmFtZSA9IGNyZWF0ZUVsZW1lbnQoXCJkaXZcIiwgXCJzZC1zcGlyYWwtZnJhbWVcIik7XG4gICAgY29uc3Qgc3ZnID0gY3JlYXRlU3ZnRWxlbWVudChcInN2Z1wiLCB7XG4gICAgICBjbGFzczogXCJzZC1zcGlyYWxcIixcbiAgICAgIHZpZXdCb3g6IHRoaXMubGF5b3V0ID09PSBcImNvbXBhY3RcIiA/IFwiMTA1IDIwIDM5MCAzOTBcIiA6IFwiMCAwIDYwMCA0MjBcIixcbiAgICAgIHJvbGU6IFwiaW1nXCIsXG4gICAgICBcImFyaWEtbGFiZWxcIjogXCJTcGlyYWwgc2NoZWR1bGUgZnJvbSAwOTowMCB0byAxODowMFwiLFxuICAgIH0pO1xuICAgIGNvbnN0IGdyaWQgPSBjcmVhdGVTdmdFbGVtZW50KFwiZ1wiLCB7IGNsYXNzOiBcInNkLXNwaXJhbF9fZ3JpZFwiLCBcImFyaWEtaGlkZGVuXCI6IFwidHJ1ZVwiIH0pO1xuICAgIGZvciAoY29uc3QgcmFkaXVzIG9mIFs1OCwgOTIsIDEyNiwgMTYwXSkge1xuICAgICAgZ3JpZC5hcHBlbmQoY3JlYXRlU3ZnRWxlbWVudChcImNpcmNsZVwiLCB7IGN4OiBcIjMwMFwiLCBjeTogXCIyMTBcIiwgcjogU3RyaW5nKHJhZGl1cykgfSkpO1xuICAgIH1cbiAgICBmb3IgKGxldCBob3VyID0gOTsgaG91ciA8PSAxODsgaG91ciArPSAxKSB7XG4gICAgICBjb25zdCBhbmdsZSA9ICgoaG91ciAtIDkpIC8gOSkgKiBNYXRoLlBJICogNi4yIC0gTWF0aC5QSSAvIDI7XG4gICAgICBjb25zdCByYWRpdXMgPSA1MiArICgoaG91ciAtIDkpIC8gOSkgKiAxMTY7XG4gICAgICBjb25zdCB4ID0gMzAwICsgTWF0aC5jb3MoYW5nbGUpICogcmFkaXVzO1xuICAgICAgY29uc3QgeSA9IDIxMCArIE1hdGguc2luKGFuZ2xlKSAqIHJhZGl1cztcbiAgICAgIGNvbnN0IGxhYmVsID0gY3JlYXRlU3ZnRWxlbWVudChcInRleHRcIiwgeyB4OiBTdHJpbmcoeCksIHk6IFN0cmluZyh5KSwgY2xhc3M6IFwic2Qtc3BpcmFsX19ob3VyXCIgfSk7XG4gICAgICBsYWJlbC50ZXh0Q29udGVudCA9IFN0cmluZyhob3VyKS5wYWRTdGFydCgyLCBcIjBcIik7XG4gICAgICBncmlkLmFwcGVuZChsYWJlbCk7XG4gICAgfVxuICAgIHN2Zy5hcHBlbmQoZ3JpZCk7XG5cbiAgICBjb25zdCBiYWNrZ3JvdW5kID0gY3JlYXRlU3ZnRWxlbWVudChcInBhdGhcIiwge1xuICAgICAgZDogdGhpcy5zcGlyYWxQYXRoKDkgKiA2MCwgMTggKiA2MCksXG4gICAgICBjbGFzczogXCJzZC1zcGlyYWxfX3RyYWNrXCIsXG4gICAgICBcImFyaWEtaGlkZGVuXCI6IFwidHJ1ZVwiLFxuICAgIH0pO1xuICAgIHN2Zy5hcHBlbmQoYmFja2dyb3VuZCk7XG5cbiAgICBjb25zdCB2aXNpYmxlID0gdGhpcy5maWx0ZXJlZEl0ZW1zKCkuZmlsdGVyKFxuICAgICAgKGl0ZW0pID0+IGl0ZW0ua2luZCAhPT0gXCJvdmVyZmxvd1wiICYmIGl0ZW0uc3RhcnRNaW51dGUgIT09IHVuZGVmaW5lZCAmJiBpdGVtLmVuZE1pbnV0ZSAhPT0gdW5kZWZpbmVkLFxuICAgICk7XG4gICAgdmlzaWJsZS5mb3JFYWNoKChpdGVtKSA9PiB7XG4gICAgICBjb25zdCBncm91cCA9IGNyZWF0ZVN2Z0VsZW1lbnQoXCJnXCIsIHtcbiAgICAgICAgY2xhc3M6IGBzZC1zcGlyYWwtaXRlbSBzZC1zcGlyYWwtaXRlbS0tJHtpdGVtLmtpbmR9YCxcbiAgICAgICAgcm9sZTogXCJpbWdcIixcbiAgICAgICAgdGFiaW5kZXg6IFwiMFwiLFxuICAgICAgICBcImFyaWEtbGFiZWxcIjogYCR7aXRlbS50aXRsZX0uICR7aXRlbS50aW1lfS4gJHtmb3JtYXRNaW51dGVzKGl0ZW0ubWludXRlcyl9LmAsXG4gICAgICB9KTtcbiAgICAgIGNvbnN0IHRpdGxlID0gY3JlYXRlU3ZnRWxlbWVudChcInRpdGxlXCIsIHt9KTtcbiAgICAgIHRpdGxlLnRleHRDb250ZW50ID0gYCR7aXRlbS50aXRsZX0gXHUwMEI3ICR7aXRlbS50aW1lfSBcdTAwQjcgJHtmb3JtYXRNaW51dGVzKGl0ZW0ubWludXRlcyl9YDtcbiAgICAgIGNvbnN0IGZvY3VzSGFsbyA9IGNyZWF0ZVN2Z0VsZW1lbnQoXCJwYXRoXCIsIHtcbiAgICAgICAgZDogdGhpcy5zcGlyYWxQYXRoKGl0ZW0uc3RhcnRNaW51dGUhLCBpdGVtLmVuZE1pbnV0ZSEpLFxuICAgICAgICBjbGFzczogXCJzZC1zcGlyYWwtaXRlbV9fZm9jdXMtaGFsb1wiLFxuICAgICAgICBcImFyaWEtaGlkZGVuXCI6IFwidHJ1ZVwiLFxuICAgICAgfSk7XG4gICAgICBjb25zdCBwYXRoID0gY3JlYXRlU3ZnRWxlbWVudChcInBhdGhcIiwge1xuICAgICAgICBkOiB0aGlzLnNwaXJhbFBhdGgoaXRlbS5zdGFydE1pbnV0ZSEsIGl0ZW0uZW5kTWludXRlISksXG4gICAgICAgIGNsYXNzOiBcInNkLXNwaXJhbC1pdGVtX19zZWdtZW50XCIsXG4gICAgICB9KTtcbiAgICAgIGdyb3VwLmFwcGVuZCh0aXRsZSwgZm9jdXNIYWxvLCBwYXRoKTtcbiAgICAgIGlmIChpdGVtLnByb2dyZXNzICYmIGl0ZW0ucHJvZ3Jlc3MgPCAxMDApIHtcbiAgICAgICAgZ3JvdXAuYXBwZW5kKFxuICAgICAgICAgIGNyZWF0ZVN2Z0VsZW1lbnQoXCJwYXRoXCIsIHtcbiAgICAgICAgICAgIGQ6IHRoaXMuc3BpcmFsUGF0aChpdGVtLnN0YXJ0TWludXRlISwgaXRlbS5zdGFydE1pbnV0ZSEgKyBpdGVtLm1pbnV0ZXMgKiAoaXRlbS5wcm9ncmVzcyAvIDEwMCkpLFxuICAgICAgICAgICAgY2xhc3M6IFwic2Qtc3BpcmFsLWl0ZW1fX3Byb2dyZXNzXCIsXG4gICAgICAgICAgfSksXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBzdmcuYXBwZW5kKGdyb3VwKTtcbiAgICB9KTtcblxuICAgIGlmICh0aGlzLmxheW91dCA9PT0gXCJ3aWRlXCIpIHRoaXMucmVuZGVyT3V0c2lkZUxhYmVscyhzdmcsIHZpc2libGUpO1xuXG4gICAgY29uc3QgY2VudGVyID0gY3JlYXRlU3ZnRWxlbWVudChcImdcIiwgeyBjbGFzczogXCJzZC1zcGlyYWxfX2NlbnRlclwiLCBcImFyaWEtaGlkZGVuXCI6IFwidHJ1ZVwiIH0pO1xuICAgIGNvbnN0IGNlbnRlckRhdGUgPSBjcmVhdGVTdmdFbGVtZW50KFwidGV4dFwiLCB7IHg6IFwiMzAwXCIsIHk6IFwiMjAzXCIgfSk7XG4gICAgY2VudGVyRGF0ZS50ZXh0Q29udGVudCA9IFwiQVVHIDI4XCI7XG4gICAgY29uc3QgY2VudGVyVGltZSA9IGNyZWF0ZVN2Z0VsZW1lbnQoXCJ0ZXh0XCIsIHsgeDogXCIzMDBcIiwgeTogXCIyMjVcIiwgY2xhc3M6IFwic2Qtc3BpcmFsX19ub3dcIiB9KTtcbiAgICBjZW50ZXJUaW1lLnRleHRDb250ZW50ID0gdGhpcy5wbGF5YmFja0xhYmVsKCk7XG4gICAgY2VudGVyLmFwcGVuZChjZW50ZXJEYXRlLCBjZW50ZXJUaW1lKTtcbiAgICBzdmcuYXBwZW5kKGNlbnRlcik7XG4gICAgZnJhbWUuYXBwZW5kKHN2Zyk7XG4gICAgcmV0dXJuIGZyYW1lO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJPdXRzaWRlTGFiZWxzKHN2ZzogU1ZHU1ZHRWxlbWVudCwgaXRlbXM6IFBsYW5JdGVtW10pOiB2b2lkIHtcbiAgICBjb25zdCBsZWZ0VHJhY2tzID0gWzkyLCAxNjgsIDI0NCwgMzIwXTtcbiAgICBjb25zdCByaWdodFRyYWNrcyA9IFsxMjAsIDIwNiwgMjkyXTtcbiAgICBsZXQgbGVmdEluZGV4ID0gMDtcbiAgICBsZXQgcmlnaHRJbmRleCA9IDA7XG5cbiAgICBpdGVtcy5mb3JFYWNoKChpdGVtLCBpbmRleCkgPT4ge1xuICAgICAgY29uc3QgaXNMZWZ0ID0gaW5kZXggJSAyID09PSAwO1xuICAgICAgY29uc3QgeSA9IGlzTGVmdCA/IGxlZnRUcmFja3NbbGVmdEluZGV4KytdIDogcmlnaHRUcmFja3NbcmlnaHRJbmRleCsrXTtcbiAgICAgIGNvbnN0IHggPSBpc0xlZnQgPyAxMTUgOiA0ODU7XG4gICAgICBjb25zdCBncm91cCA9IGNyZWF0ZVN2Z0VsZW1lbnQoXCJnXCIsIHtcbiAgICAgICAgY2xhc3M6IGBzZC1vdXRzaWRlLWxhYmVsIHNkLW91dHNpZGUtbGFiZWwtLSR7aXRlbS5raW5kfWAsXG4gICAgICAgIFwiYXJpYS1oaWRkZW5cIjogXCJ0cnVlXCIsXG4gICAgICB9KTtcbiAgICAgIGNvbnN0IGRvdCA9IGNyZWF0ZVN2Z0VsZW1lbnQoXCJjaXJjbGVcIiwge1xuICAgICAgICBjeDogU3RyaW5nKGlzTGVmdCA/IDEyNCA6IDQ3NiksXG4gICAgICAgIGN5OiBTdHJpbmcoeSAtIDMpLFxuICAgICAgICByOiBcIjMuNVwiLFxuICAgICAgICBjbGFzczogXCJzZC1vdXRzaWRlLWxhYmVsX19kb3RcIixcbiAgICAgIH0pO1xuICAgICAgY29uc3QgdGV4dCA9IGNyZWF0ZVN2Z0VsZW1lbnQoXCJ0ZXh0XCIsIHtcbiAgICAgICAgeDogU3RyaW5nKHgpLFxuICAgICAgICB5OiBTdHJpbmcoeSksXG4gICAgICAgIFwidGV4dC1hbmNob3JcIjogaXNMZWZ0ID8gXCJlbmRcIiA6IFwic3RhcnRcIixcbiAgICAgICAgY2xhc3M6IFwic2Qtb3V0c2lkZS1sYWJlbF9fdGl0bGVcIixcbiAgICAgIH0pO1xuICAgICAgdGV4dC50ZXh0Q29udGVudCA9IHNwaXJhbExhYmVsKGl0ZW0pO1xuICAgICAgY29uc3QgdGltZSA9IGNyZWF0ZVN2Z0VsZW1lbnQoXCJ0ZXh0XCIsIHtcbiAgICAgICAgeDogU3RyaW5nKHgpLFxuICAgICAgICB5OiBTdHJpbmcoeSArIDE1KSxcbiAgICAgICAgXCJ0ZXh0LWFuY2hvclwiOiBpc0xlZnQgPyBcImVuZFwiIDogXCJzdGFydFwiLFxuICAgICAgICBjbGFzczogXCJzZC1vdXRzaWRlLWxhYmVsX190aW1lXCIsXG4gICAgICB9KTtcbiAgICAgIHRpbWUudGV4dENvbnRlbnQgPSBpdGVtLnRpbWU7XG4gICAgICBncm91cC5hcHBlbmQoZG90LCB0ZXh0LCB0aW1lKTtcbiAgICAgIHN2Zy5hcHBlbmQoZ3JvdXApO1xuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBzcGlyYWxQb2ludChtaW51dGU6IG51bWJlcik6IHsgeDogbnVtYmVyOyB5OiBudW1iZXIgfSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IE1hdGgubWF4KDAsIE1hdGgubWluKDEsIChtaW51dGUgLSA5ICogNjApIC8gKDkgKiA2MCkpKTtcbiAgICBjb25zdCBhbmdsZSA9IG5vcm1hbGl6ZWQgKiBNYXRoLlBJICogNi4yIC0gTWF0aC5QSSAvIDI7XG4gICAgY29uc3QgcmFkaXVzID0gNTIgKyBub3JtYWxpemVkICogMTE2O1xuICAgIHJldHVybiB7IHg6IDMwMCArIE1hdGguY29zKGFuZ2xlKSAqIHJhZGl1cywgeTogMjEwICsgTWF0aC5zaW4oYW5nbGUpICogcmFkaXVzIH07XG4gIH1cblxuICBwcml2YXRlIHNwaXJhbFBhdGgoc3RhcnRNaW51dGU6IG51bWJlciwgZW5kTWludXRlOiBudW1iZXIpOiBzdHJpbmcge1xuICAgIGNvbnN0IHN0ZXBzID0gTWF0aC5tYXgoOCwgTWF0aC5jZWlsKChlbmRNaW51dGUgLSBzdGFydE1pbnV0ZSkgLyA0KSk7XG4gICAgY29uc3QgcG9pbnRzOiBzdHJpbmdbXSA9IFtdO1xuICAgIGZvciAobGV0IGluZGV4ID0gMDsgaW5kZXggPD0gc3RlcHM7IGluZGV4ICs9IDEpIHtcbiAgICAgIGNvbnN0IG1pbnV0ZSA9IHN0YXJ0TWludXRlICsgKChlbmRNaW51dGUgLSBzdGFydE1pbnV0ZSkgKiBpbmRleCkgLyBzdGVwcztcbiAgICAgIGNvbnN0IHBvaW50ID0gdGhpcy5zcGlyYWxQb2ludChtaW51dGUpO1xuICAgICAgcG9pbnRzLnB1c2goYCR7aW5kZXggPT09IDAgPyBcIk1cIiA6IFwiTFwifSR7cG9pbnQueC50b0ZpeGVkKDIpfSwke3BvaW50LnkudG9GaXhlZCgyKX1gKTtcbiAgICB9XG4gICAgcmV0dXJuIHBvaW50cy5qb2luKFwiIFwiKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyVmFyaWFudEIoKTogSFRNTEVsZW1lbnQge1xuICAgIGNvbnN0IHNlY3Rpb24gPSBjcmVhdGVFbGVtZW50KFwiZGl2XCIsIFwic2QtdmFyaWFudCBzZC12YXJpYW50LWJcIik7XG4gICAgc2VjdGlvbi5kYXRhc2V0LnZhcmlhbnQgPSBcIkJcIjtcbiAgICBjb25zdCBoZWFkaW5nID0gY3JlYXRlRWxlbWVudChcImRpdlwiLCBcInNkLXNlY3Rpb24taGVhZGluZ1wiKTtcbiAgICBoZWFkaW5nLmFwcGVuZChjcmVhdGVFbGVtZW50KFwiaDJcIiwgXCJzZC1zZWN0aW9uLXRpdGxlXCIsIFwiRGF5IHJhaWwgLyBcdTY1RjZcdTk1RjRcdThGNzRcIikpO1xuICAgIGhlYWRpbmcuYXBwZW5kKGNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIsIFwic2Qtc2VjdGlvbi1tZXRhXCIsIFwiMDk6MDBcdTIwMTMxODowMCBcdTAwQjcgNTMlIHBsYW5uZWRcIikpO1xuICAgIHNlY3Rpb24uYXBwZW5kKGhlYWRpbmcpO1xuXG4gICAgY29uc3QgcmFpbCA9IGNyZWF0ZUVsZW1lbnQoXCJkaXZcIiwgXCJzZC1kYXktcmFpbFwiKTtcbiAgICBjb25zdCB0aW1lZCA9IHRoaXMuZmlsdGVyZWRJdGVtcygpLmZpbHRlcigoaXRlbSkgPT4gaXRlbS5zdGFydE1pbnV0ZSAhPT0gdW5kZWZpbmVkKTtcbiAgICBmb3IgKGxldCBob3VyID0gOTsgaG91ciA8PSAxODsgaG91ciArPSAxKSB7XG4gICAgICBjb25zdCByb3cgPSBjcmVhdGVFbGVtZW50KFwiZGl2XCIsIFwic2QtZGF5LXJhaWxfX2hvdXJcIik7XG4gICAgICByb3cuYXBwZW5kKGNyZWF0ZUVsZW1lbnQoXCJ0aW1lXCIsIFwic2QtZGF5LXJhaWxfX3RpbWVcIiwgYCR7U3RyaW5nKGhvdXIpLnBhZFN0YXJ0KDIsIFwiMFwiKX06MDBgKSk7XG4gICAgICBjb25zdCBzbG90ID0gY3JlYXRlRWxlbWVudChcImRpdlwiLCBcInNkLWRheS1yYWlsX19zbG90XCIpO1xuICAgICAgY29uc3QgbWF0Y2hlcyA9IHRpbWVkLmZpbHRlcigoaXRlbSkgPT4gTWF0aC5mbG9vcihpdGVtLnN0YXJ0TWludXRlISAvIDYwKSA9PT0gaG91cik7XG4gICAgICBpZiAobWF0Y2hlcy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgc2xvdC5hcHBlbmQoY3JlYXRlRWxlbWVudChcInNwYW5cIiwgXCJzZC1kYXktcmFpbF9fYXZhaWxhYmxlXCIsIGhvdXIgPCAxNSA/IFwiQXZhaWxhYmxlIC8gXHU1M0VGXHU3NTI4XCIgOiBcIk9wZW4gY2FwYWNpdHlcIikpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZm9yIChjb25zdCBpdGVtIG9mIG1hdGNoZXMpIHNsb3QuYXBwZW5kKHRoaXMucmVuZGVyUmFpbEl0ZW0oaXRlbSkpO1xuICAgICAgfVxuICAgICAgcm93LmFwcGVuZChzbG90KTtcbiAgICAgIHJhaWwuYXBwZW5kKHJvdyk7XG4gICAgfVxuICAgIHNlY3Rpb24uYXBwZW5kKHJhaWwpO1xuICAgIHNlY3Rpb24uYXBwZW5kKHRoaXMucmVuZGVyT3ZlcmZsb3dEaXNjbG9zdXJlKCkpO1xuICAgIHJldHVybiBzZWN0aW9uO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJSYWlsSXRlbShpdGVtOiBQbGFuSXRlbSk6IEhUTUxFbGVtZW50IHtcbiAgICBjb25zdCByb3cgPSBjcmVhdGVFbGVtZW50KFwiZGl2XCIsIGBzZC1yYWlsLWl0ZW0gc2QtcmFpbC1pdGVtLS0ke2l0ZW0ua2luZH1gKTtcbiAgICByb3cudGFiSW5kZXggPSAwO1xuICAgIHJvdy5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIGAke2l0ZW0udGl0bGV9LiAke2l0ZW0udGltZX0uYCk7XG4gICAgcm93LmFwcGVuZChjcmVhdGVFbGVtZW50KFwic3BhblwiLCBcInNkLXJhaWwtaXRlbV9fYmFyXCIpKTtcbiAgICBjb25zdCBjb3B5ID0gY3JlYXRlRWxlbWVudChcImRpdlwiLCBcInNkLXJhaWwtaXRlbV9fY29weVwiKTtcbiAgICBjb3B5LmFwcGVuZChjcmVhdGVFbGVtZW50KFwic3Ryb25nXCIsIFwic2QtcmFpbC1pdGVtX190aXRsZVwiLCBpdGVtLnRpdGxlKSk7XG4gICAgY29weS5hcHBlbmQoY3JlYXRlRWxlbWVudChcInNwYW5cIiwgXCJzZC1yYWlsLWl0ZW1fX21ldGFcIiwgYCR7aXRlbS50aW1lfSBcdTAwQjcgJHtmb3JtYXRNaW51dGVzKGl0ZW0ubWludXRlcyl9YCkpO1xuICAgIHJvdy5hcHBlbmQoY29weSk7XG4gICAgaWYgKGl0ZW0ucHJvZ3Jlc3MgIT09IHVuZGVmaW5lZCkge1xuICAgICAgcm93LmFwcGVuZChjcmVhdGVFbGVtZW50KFwic3BhblwiLCBcInNkLXJhaWwtaXRlbV9fcHJvZ3Jlc3NcIiwgYCR7aXRlbS5wcm9ncmVzc30lYCkpO1xuICAgIH1cbiAgICByZXR1cm4gcm93O1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJWYXJpYW50QygpOiBIVE1MRWxlbWVudCB7XG4gICAgY29uc3Qgc2VjdGlvbiA9IGNyZWF0ZUVsZW1lbnQoXCJkaXZcIiwgXCJzZC12YXJpYW50IHNkLXZhcmlhbnQtY1wiKTtcbiAgICBzZWN0aW9uLmRhdGFzZXQudmFyaWFudCA9IFwiQ1wiO1xuICAgIGNvbnN0IGNhcGFjaXR5ID0gY3JlYXRlRWxlbWVudChcImRpdlwiLCBcInNkLWNhcGFjaXR5LWJhbmRcIik7XG4gICAgY2FwYWNpdHkuYXBwZW5kKGNyZWF0ZUVsZW1lbnQoXCJzdHJvbmdcIiwgXCJzZC1jYXBhY2l0eS1iYW5kX192YWx1ZVwiLCBcIjJoIDA3bVwiKSk7XG4gICAgY2FwYWNpdHkuYXBwZW5kKGNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIsIFwic2QtY2FwYWNpdHktYmFuZF9fbGFiZWxcIiwgXCJvcGVuIGNhcGFjaXR5IC8gXHU1MjY5XHU0RjU5XHU1QkI5XHU5MUNGXCIpKTtcbiAgICBjb25zdCBtZXRlciA9IGNyZWF0ZUVsZW1lbnQoXCJkaXZcIiwgXCJzZC1jYXBhY2l0eS1iYW5kX19tZXRlclwiKTtcbiAgICBtZXRlci5hcHBlbmQoY3JlYXRlRWxlbWVudChcInNwYW5cIiwgXCJzZC1jYXBhY2l0eS1iYW5kX19maXhlZFwiKSk7XG4gICAgbWV0ZXIuYXBwZW5kKGNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIsIFwic2QtY2FwYWNpdHktYmFuZF9fZmxleFwiKSk7XG4gICAgbWV0ZXIuYXBwZW5kKGNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIsIFwic2QtY2FwYWNpdHktYmFuZF9fb3BlblwiKSk7XG4gICAgY2FwYWNpdHkuYXBwZW5kKG1ldGVyKTtcbiAgICBzZWN0aW9uLmFwcGVuZChjYXBhY2l0eSk7XG5cbiAgICBjb25zdCBjb2x1bW5zID0gY3JlYXRlRWxlbWVudChcImRpdlwiLCBcInNkLW9wcy1jb2x1bW5zXCIpO1xuICAgIGNvbnN0IGdyb3VwczogQXJyYXk8eyB0aXRsZTogc3RyaW5nOyBpY29uOiBzdHJpbmc7IGl0ZW1zOiBQbGFuSXRlbVtdOyB0b25lOiBzdHJpbmcgfT4gPSBbXG4gICAgICB7XG4gICAgICAgIHRpdGxlOiBcIkZpeGVkIGV2ZW50cyAvIFx1NTZGQVx1NUI5QVx1NEU4Qlx1NEVGNlwiLFxuICAgICAgICBpY29uOiBcImNhbGVuZGFyLXJhbmdlXCIsXG4gICAgICAgIGl0ZW1zOiB0aGlzLmZpbHRlcmVkSXRlbXMoKS5maWx0ZXIoKGl0ZW0pID0+IGl0ZW0ua2luZCA9PT0gXCJldmVudFwiKSxcbiAgICAgICAgdG9uZTogXCJldmVudFwiLFxuICAgICAgfSxcbiAgICAgIHtcbiAgICAgICAgdGl0bGU6IFwiRmxleGlibGUgdGFza3MgLyBcdTVGMzlcdTYwMjdcdTRFRkJcdTUyQTFcIixcbiAgICAgICAgaWNvbjogXCJsaXN0LWNoZWNrc1wiLFxuICAgICAgICBpdGVtczogdGhpcy5maWx0ZXJlZEl0ZW1zKCkuZmlsdGVyKChpdGVtKSA9PiBbXCJ0YXNrXCIsIFwidXJnZW50XCIsIFwiZG9uZVwiXS5pbmNsdWRlcyhpdGVtLmtpbmQpKSxcbiAgICAgICAgdG9uZTogXCJ0YXNrXCIsXG4gICAgICB9LFxuICAgICAge1xuICAgICAgICB0aXRsZTogXCJPdmVyZmxvdyAvIFx1NkVBMlx1NTFGQVwiLFxuICAgICAgICBpY29uOiBcImFyY2hpdmUtcmVzdG9yZVwiLFxuICAgICAgICBpdGVtczogdGhpcy5maWx0ZXJlZEl0ZW1zKCkuZmlsdGVyKChpdGVtKSA9PiBpdGVtLmtpbmQgPT09IFwib3ZlcmZsb3dcIiksXG4gICAgICAgIHRvbmU6IFwib3ZlcmZsb3dcIixcbiAgICAgIH0sXG4gICAgXTtcbiAgICBmb3IgKGNvbnN0IGdyb3VwIG9mIGdyb3VwcykgY29sdW1ucy5hcHBlbmQodGhpcy5yZW5kZXJPcHNDb2x1bW4oZ3JvdXApKTtcbiAgICBzZWN0aW9uLmFwcGVuZChjb2x1bW5zKTtcbiAgICByZXR1cm4gc2VjdGlvbjtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyT3BzQ29sdW1uKGdyb3VwOiB7XG4gICAgdGl0bGU6IHN0cmluZztcbiAgICBpY29uOiBzdHJpbmc7XG4gICAgaXRlbXM6IFBsYW5JdGVtW107XG4gICAgdG9uZTogc3RyaW5nO1xuICB9KTogSFRNTEVsZW1lbnQge1xuICAgIGNvbnN0IGNvbHVtbiA9IGNyZWF0ZUVsZW1lbnQoXCJzZWN0aW9uXCIsIGBzZC1vcHMtY29sdW1uIHNkLW9wcy1jb2x1bW4tLSR7Z3JvdXAudG9uZX1gKTtcbiAgICBjb25zdCBoZWFkZXIgPSBjcmVhdGVFbGVtZW50KFwiaGVhZGVyXCIsIFwic2Qtb3BzLWNvbHVtbl9faGVhZGVyXCIpO1xuICAgIGNvbnN0IGljb24gPSBjcmVhdGVFbGVtZW50KFwic3BhblwiLCBcInNkLW9wcy1jb2x1bW5fX2ljb25cIik7XG4gICAgc2V0SWNvbihpY29uLCBncm91cC5pY29uKTtcbiAgICBoZWFkZXIuYXBwZW5kKGljb24sIGNyZWF0ZUVsZW1lbnQoXCJoMlwiLCBcInNkLW9wcy1jb2x1bW5fX3RpdGxlXCIsIGdyb3VwLnRpdGxlKSk7XG4gICAgaGVhZGVyLmFwcGVuZChjcmVhdGVFbGVtZW50KFwic3BhblwiLCBcInNkLW9wcy1jb2x1bW5fX2NvdW50XCIsIFN0cmluZyhncm91cC5pdGVtcy5sZW5ndGgpKSk7XG4gICAgY29sdW1uLmFwcGVuZChoZWFkZXIpO1xuICAgIGNvbnN0IGxpc3QgPSBjcmVhdGVFbGVtZW50KFwiZGl2XCIsIFwic2Qtb3BzLWxpc3RcIik7XG4gICAgZm9yIChjb25zdCBpdGVtIG9mIGdyb3VwLml0ZW1zKSB7XG4gICAgICBjb25zdCByb3cgPSBjcmVhdGVFbGVtZW50KFwiZGl2XCIsIGBzZC1vcHMtcm93IHNkLW9wcy1yb3ctLSR7aXRlbS5raW5kfWApO1xuICAgICAgcm93LnRhYkluZGV4ID0gMDtcbiAgICAgIHJvdy5hcHBlbmQoY3JlYXRlRWxlbWVudChcInN0cm9uZ1wiLCBcInNkLW9wcy1yb3dfX3RpdGxlXCIsIGl0ZW0udGl0bGUpKTtcbiAgICAgIHJvdy5hcHBlbmQoY3JlYXRlRWxlbWVudChcInNwYW5cIiwgXCJzZC1vcHMtcm93X19tZXRhXCIsIGAke2l0ZW0udGltZX0gXHUwMEI3ICR7Zm9ybWF0TWludXRlcyhpdGVtLm1pbnV0ZXMpfWApKTtcbiAgICAgIGxpc3QuYXBwZW5kKHJvdyk7XG4gICAgfVxuICAgIGNvbHVtbi5hcHBlbmQobGlzdCk7XG4gICAgcmV0dXJuIGNvbHVtbjtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyU2NoZWR1bGVMaXN0KGl0ZW1zOiBQbGFuSXRlbVtdKTogSFRNTEVsZW1lbnQge1xuICAgIGNvbnN0IGxpc3QgPSBjcmVhdGVFbGVtZW50KFwiZGl2XCIsIFwic2Qtc2NoZWR1bGUtbGlzdFwiKTtcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgaXRlbXMpIHtcbiAgICAgIGNvbnN0IHJvdyA9IGNyZWF0ZUVsZW1lbnQoXCJkaXZcIiwgYHNkLXNjaGVkdWxlLXJvdyBzZC1zY2hlZHVsZS1yb3ctLSR7aXRlbS5raW5kfWApO1xuICAgICAgcm93LmFwcGVuZChjcmVhdGVFbGVtZW50KFwic3BhblwiLCBgc2QtZG90IHNkLWRvdC0tJHtpdGVtLmtpbmR9YCkpO1xuICAgICAgcm93LmFwcGVuZChjcmVhdGVFbGVtZW50KFwidGltZVwiLCBcInNkLXNjaGVkdWxlLXJvd19fdGltZVwiLCBpdGVtLnRpbWUpKTtcbiAgICAgIHJvdy5hcHBlbmQoY3JlYXRlRWxlbWVudChcInNwYW5cIiwgXCJzZC1zY2hlZHVsZS1yb3dfX3RpdGxlXCIsIGl0ZW0udGl0bGUpKTtcbiAgICAgIGxpc3QuYXBwZW5kKHJvdyk7XG4gICAgfVxuICAgIHJldHVybiBsaXN0O1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJPdmVyZmxvd0Rpc2Nsb3N1cmUoKTogSFRNTEVsZW1lbnQge1xuICAgIGNvbnN0IG92ZXJmbG93SXRlbXMgPSB0aGlzLmZpbHRlcmVkSXRlbXMoKS5maWx0ZXIoKGl0ZW0pID0+IGl0ZW0ua2luZCA9PT0gXCJvdmVyZmxvd1wiKTtcbiAgICBjb25zdCBkZXRhaWxzID0gY3JlYXRlRWxlbWVudChcImRldGFpbHNcIiwgXCJzZC1kaXNjbG9zdXJlIHNkLW92ZXJmbG93XCIpO1xuICAgIGRldGFpbHMub3BlbiA9IHRoaXMub3ZlcmZsb3dPcGVuO1xuICAgIGRldGFpbHMuYWRkRXZlbnRMaXN0ZW5lcihcInRvZ2dsZVwiLCAoKSA9PiB7XG4gICAgICB0aGlzLm92ZXJmbG93T3BlbiA9IGRldGFpbHMub3BlbjtcbiAgICB9KTtcbiAgICBjb25zdCB0b3RhbCA9IG92ZXJmbG93SXRlbXMucmVkdWNlKChzdW0sIGl0ZW0pID0+IHN1bSArIGl0ZW0ubWludXRlcywgMCk7XG4gICAgZGV0YWlscy5hcHBlbmQoXG4gICAgICBjcmVhdGVFbGVtZW50KFxuICAgICAgICBcInN1bW1hcnlcIixcbiAgICAgICAgXCJzZC1kaXNjbG9zdXJlX19zdW1tYXJ5XCIsXG4gICAgICAgIGBVbnNjaGVkdWxlZCB0b2RheSAvIFx1NEVDQVx1NjVFNVx1NjcyQVx1NjM5MiBcdTAwQjcgJHtmb3JtYXRNaW51dGVzKHRvdGFsKX0gXHUwMEI3ICR7b3ZlcmZsb3dJdGVtcy5sZW5ndGh9YCxcbiAgICAgICksXG4gICAgKTtcbiAgICBkZXRhaWxzLmFwcGVuZCh0aGlzLnJlbmRlclNjaGVkdWxlTGlzdChvdmVyZmxvd0l0ZW1zKSk7XG4gICAgcmV0dXJuIGRldGFpbHM7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlcldyaXRlUHJvb2YoKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLnByb29mSG9zdCkgcmV0dXJuO1xuICAgIHRoaXMucHJvb2ZIb3N0LmVtcHR5KCk7XG4gICAgY29uc3QgaGVhZGVyID0gY3JlYXRlRWxlbWVudChcImRpdlwiLCBcInNkLXByb29mX19oZWFkZXJcIik7XG4gICAgY29uc3QgaGVhZGluZyA9IGNyZWF0ZUVsZW1lbnQoXCJkaXZcIiwgXCJzZC1wcm9vZl9faGVhZGluZ1wiKTtcbiAgICBoZWFkaW5nLmFwcGVuZChjcmVhdGVFbGVtZW50KFwiaDJcIiwgXCJzZC1zZWN0aW9uLXRpdGxlXCIsIFwiTWFya2Rvd24gd3JpdGUgcHJvb2ZcIikpO1xuICAgIGhlYWRpbmcuYXBwZW5kKGNyZWF0ZUVsZW1lbnQoXCJzcGFuXCIsIFwic2QtcHJvb2ZfX3BhdGhcIiwgU09VUkNFX1BBVEgpKTtcbiAgICBoZWFkZXIuYXBwZW5kKGhlYWRpbmcpO1xuICAgIGhlYWRlci5hcHBlbmQoXG4gICAgICBjcmVhdGVFbGVtZW50KFxuICAgICAgICBcInNwYW5cIixcbiAgICAgICAgYHNkLXByb29mX19zdGF0dXMgc2QtcHJvb2ZfX3N0YXR1cy0tJHt0aGlzLmRlbW9TdGFnZX1gLFxuICAgICAgICB0aGlzLmRlbW9TdGF0dXNMYWJlbCgpLFxuICAgICAgKSxcbiAgICApO1xuICAgIHRoaXMucHJvb2ZIb3N0LmFwcGVuZChoZWFkZXIpO1xuXG4gICAgY29uc3QgYWN0aW9ucyA9IGNyZWF0ZUVsZW1lbnQoXCJkaXZcIiwgXCJzZC1wcm9vZl9fYWN0aW9uc1wiKTtcbiAgICBjb25zdCBwcmV2aWV3ID0gaWNvbkJ1dHRvbihcInNjYW4tdGV4dFwiLCBcIlByZXZpZXcgZXhhY3Qgc291cmNlXCIsICgpID0+IHZvaWQgdGhpcy5ydW5BY3Rpb24oKCkgPT4gdGhpcy5wcmV2aWV3U291cmNlKGZhbHNlKSksIHtcbiAgICAgIHRleHQ6IFwiUHJldmlldyBzb3VyY2VcIixcbiAgICB9KTtcbiAgICBjb25zdCBpbmplY3QgPSBpY29uQnV0dG9uKFwiZmlsZS13YXJuaW5nXCIsIFwiSW5qZWN0IHdhdGNoZWQtbGluZSBjb25mbGljdFwiLCAoKSA9PiB2b2lkIHRoaXMucnVuQWN0aW9uKCgpID0+IHRoaXMuaW5qZWN0Q29uZmxpY3QoKSksIHtcbiAgICAgIHRleHQ6IFwiSW5qZWN0IGNvbmZsaWN0XCIsXG4gICAgfSk7XG4gICAgY29uc3Qgc3RhbGUgPSBpY29uQnV0dG9uKFwic2hpZWxkLXhcIiwgXCJBdHRlbXB0IHN0YWxlIHdyaXRlXCIsICgpID0+IHZvaWQgdGhpcy5ydW5BY3Rpb24oKCkgPT4gdGhpcy5hdHRlbXB0U3RhbGVXcml0ZSgpKSwge1xuICAgICAgdGV4dDogXCJBdHRlbXB0IHN0YWxlIHdyaXRlXCIsXG4gICAgfSk7XG4gICAgY29uc3QgcmVmcmVzaCA9IGljb25CdXR0b24oXCJyZWZyZXNoLWN3XCIsIFwiUmVmcmVzaCB3cml0ZSBpbnRlbnRcIiwgKCkgPT4gdm9pZCB0aGlzLnJ1bkFjdGlvbigoKSA9PiB0aGlzLnByZXZpZXdTb3VyY2UodHJ1ZSkpLCB7XG4gICAgICB0ZXh0OiBcIlJlZnJlc2ggaW50ZW50XCIsXG4gICAgfSk7XG4gICAgY29uc3QgYXBwbHkgPSBpY29uQnV0dG9uKFwidGltZXItcmVzZXRcIiwgXCJXcml0ZSBvbmUgY2Fub25pY2FsIENMT0NLXCIsICgpID0+IHZvaWQgdGhpcy5ydW5BY3Rpb24oKCkgPT4gdGhpcy5hcHBseUZyZXNoV3JpdGUoKSksIHtcbiAgICAgIHRleHQ6IFwiV3JpdGUgQ0xPQ0tcIixcbiAgICAgIGNsYXNzTmFtZTogXCJtb2QtY3RhXCIsXG4gICAgfSk7XG4gICAgY29uc3QgcmVyZWFkID0gaWNvbkJ1dHRvbihcInJvdGF0ZS1jY3dcIiwgXCJSZS1yZWFkIHJlY292ZXJ5IHN0YXRlIGZyb20gTWFya2Rvd25cIiwgKCkgPT4gdm9pZCB0aGlzLnJ1bkFjdGlvbigoKSA9PiB0aGlzLnJlY292ZXJGcm9tTWFya2Rvd24odHJ1ZSkpLCB7XG4gICAgICB0ZXh0OiBcIlJlLXJlYWQgTWFya2Rvd25cIixcbiAgICB9KTtcblxuICAgIHByZXZpZXcuZGlzYWJsZWQgPSB0aGlzLmJ1c3kgfHwgdGhpcy5kZW1vU3RhZ2UgPT09IFwiYXBwbGllZFwiIHx8IHRoaXMuZGVtb1N0YWdlID09PSBcInJlY292ZXJlZFwiO1xuICAgIGluamVjdC5kaXNhYmxlZCA9IHRoaXMuYnVzeSB8fCB0aGlzLmRlbW9TdGFnZSAhPT0gXCJwcmV2aWV3XCI7XG4gICAgc3RhbGUuZGlzYWJsZWQgPSB0aGlzLmJ1c3kgfHwgdGhpcy5kZW1vU3RhZ2UgIT09IFwiY29uZmxpY3QtaW5qZWN0ZWRcIjtcbiAgICByZWZyZXNoLmRpc2FibGVkID0gdGhpcy5idXN5IHx8IHRoaXMuZGVtb1N0YWdlICE9PSBcInJlamVjdGVkXCI7XG4gICAgYXBwbHkuZGlzYWJsZWQgPSB0aGlzLmJ1c3kgfHwgdGhpcy5kZW1vU3RhZ2UgIT09IFwiZnJlc2hcIjtcbiAgICByZXJlYWQuZGlzYWJsZWQgPSB0aGlzLmJ1c3k7XG4gICAgYWN0aW9ucy5hcHBlbmQocHJldmlldywgaW5qZWN0LCBzdGFsZSwgcmVmcmVzaCwgYXBwbHksIHJlcmVhZCk7XG4gICAgdGhpcy5wcm9vZkhvc3QuYXBwZW5kKGFjdGlvbnMpO1xuXG4gICAgaWYgKHRoaXMuZXhhY3RQcmV2aWV3KSB7XG4gICAgICBjb25zdCBzb3VyY2VEZXRhaWxzID0gY3JlYXRlRWxlbWVudChcImRldGFpbHNcIiwgXCJzZC1zb3VyY2UtcHJldmlld1wiKTtcbiAgICAgIHNvdXJjZURldGFpbHMub3BlbiA9IHRydWU7XG4gICAgICBzb3VyY2VEZXRhaWxzLmFwcGVuZChjcmVhdGVFbGVtZW50KFwic3VtbWFyeVwiLCBcInNkLXNvdXJjZS1wcmV2aWV3X19zdW1tYXJ5XCIsIFwiRXhhY3Qgc291cmNlIHByZXZpZXdcIikpO1xuICAgICAgc291cmNlRGV0YWlscy5hcHBlbmQoY3JlYXRlRWxlbWVudChcInByZVwiLCBcInNkLXNvdXJjZS1wcmV2aWV3X19jb2RlXCIsIHRoaXMuZXhhY3RQcmV2aWV3KSk7XG4gICAgICB0aGlzLnByb29mSG9zdC5hcHBlbmQoc291cmNlRGV0YWlscyk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMudHJhY2UubGVuZ3RoID4gMCkge1xuICAgICAgY29uc3QgdHJhY2UgPSBjcmVhdGVFbGVtZW50KFwib2xcIiwgXCJzZC1wcm9vZl9fdHJhY2VcIik7XG4gICAgICBmb3IgKGNvbnN0IGVudHJ5IG9mIHRoaXMudHJhY2UpIHRyYWNlLmFwcGVuZChjcmVhdGVFbGVtZW50KFwibGlcIiwgXCJzZC1wcm9vZl9fdHJhY2UtZW50cnlcIiwgZW50cnkpKTtcbiAgICAgIHRoaXMucHJvb2ZIb3N0LmFwcGVuZCh0cmFjZSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBkZW1vU3RhdHVzTGFiZWwoKTogc3RyaW5nIHtcbiAgICBjb25zdCBsYWJlbHM6IFJlY29yZDxEZW1vU3RhZ2UsIHN0cmluZz4gPSB7XG4gICAgICBpZGxlOiBcIklkbGUgXHUwMEI3IHNvdXJjZS1kZXJpdmVkXCIsXG4gICAgICBwcmV2aWV3OiBcIlByZXZpZXdlZCBcdTAwQjcgZXhwZWN0YXRpb24gY2FwdHVyZWRcIixcbiAgICAgIFwiY29uZmxpY3QtaW5qZWN0ZWRcIjogXCJDb25mbGljdCBpbmplY3RlZFwiLFxuICAgICAgcmVqZWN0ZWQ6IFwiUmVqZWN0ZWQgc2FmZWx5IFx1MDBCNyB6ZXJvIHBsdWdpbiBieXRlc1wiLFxuICAgICAgZnJlc2g6IFwiRnJlc2ggaW50ZW50IFx1MDBCNyByZWFkeVwiLFxuICAgICAgYXBwbGllZDogXCJBcHBsaWVkIFx1MDBCNyBjb25maXJtZWRcIixcbiAgICAgIHJlY292ZXJlZDogXCJSZWNvdmVyZWQgZnJvbSBNYXJrZG93blwiLFxuICAgICAgZXJyb3I6IFwiQmxvY2tlZCBcdTAwQjcgaW5zcGVjdCB0cmFjZVwiLFxuICAgIH07XG4gICAgcmV0dXJuIGxhYmVsc1t0aGlzLmRlbW9TdGFnZV07XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJ1bkFjdGlvbihhY3Rpb246ICgpID0+IFByb21pc2U8dm9pZD4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5idXN5KSByZXR1cm47XG4gICAgdGhpcy5idXN5ID0gdHJ1ZTtcbiAgICB0aGlzLnJlbmRlcldyaXRlUHJvb2YoKTtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgYWN0aW9uKCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcik7XG4gICAgICB0aGlzLmRlbW9TdGFnZSA9IFwiZXJyb3JcIjtcbiAgICAgIHRoaXMudHJhY2UucHVzaChgQmxvY2tlZDogJHttZXNzYWdlfWApO1xuICAgICAgbmV3IE5vdGljZShgU3BpcmFsIERheSBwcm90b3R5cGU6ICR7bWVzc2FnZX1gKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5idXN5ID0gZmFsc2U7XG4gICAgICB0aGlzLnJlbmRlcldyaXRlUHJvb2YoKTtcbiAgICAgIHRoaXMudXBkYXRlU3RhdGVPdXRwdXQoKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGdldFNvdXJjZUZpbGUoKTogVEZpbGUge1xuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoU09VUkNFX1BBVEgpO1xuICAgIGlmICghKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHRocm93IG5ldyBFcnJvcihgRGlzcG9zYWJsZSBmaXh0dXJlICR7U09VUkNFX1BBVEh9IHdhcyBub3QgZm91bmQuYCk7XG4gICAgcmV0dXJuIGZpbGU7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGFzc2VydFZhdWx0VW5pcXVlVGFyZ2V0SWQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgbGV0IG9jY3VycmVuY2VzID0gMDtcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgdGhpcy5hcHAudmF1bHQuZ2V0TWFya2Rvd25GaWxlcygpKSB7XG4gICAgICBjb25zdCBzb3VyY2UgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpO1xuICAgICAgb2NjdXJyZW5jZXMgKz0gc291cmNlLm1hdGNoKG5ldyBSZWdFeHAoYFxcXFxeJHtUQVJHRVRfSUR9KD89WyBcXFxcdF0qKD86XFxcXHI/XFxcXG58JCkpYCwgXCJnXCIpKT8ubGVuZ3RoID8/IDA7XG4gICAgfVxuICAgIGlmIChvY2N1cnJlbmNlcyAhPT0gMSkgdGhyb3cgbmV3IEVycm9yKGBQbGFuIEl0ZW0gSUQgXiR7VEFSR0VUX0lEfSBvY2N1cnMgJHtvY2N1cnJlbmNlc30gdGltZXMgaW4gdGhlIHZhdWx0LmApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBwcmV2aWV3U291cmNlKGlzUmVmcmVzaDogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmdldFNvdXJjZUZpbGUoKTtcbiAgICBjb25zdCBzb3VyY2UgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5yZWFkKGZpbGUpO1xuICAgIGNvbnN0IGFuYWx5c2lzID0gYW5hbHl6ZVNvdXJjZShzb3VyY2UpO1xuICAgIGF3YWl0IHRoaXMuYXNzZXJ0VmF1bHRVbmlxdWVUYXJnZXRJZCgpO1xuICAgIGlmIChhbmFseXNpcy5ydW5uaW5nQ2xvY2tMaW5lKSB0aHJvdyBuZXcgRXJyb3IoXCJUaGUgdGFyZ2V0IGFscmVhZHkgb3ducyBhIHJ1bm5pbmcgQ0xPQ0suXCIpO1xuICAgIGNvbnN0IGRpZ2VzdCA9IGF3YWl0IHNoYTI1Nihzb3VyY2UpO1xuICAgIHRoaXMuZXhwZWN0YXRpb24gPSB7IGRpZ2VzdCwgdGFyZ2V0TGluZTogYW5hbHlzaXMudGFyZ2V0TGluZSwgc291cmNlIH07XG4gICAgdGhpcy5leGFjdFByZXZpZXcgPSBzb3VyY2U7XG4gICAgdGhpcy5kZW1vU3RhZ2UgPSBpc1JlZnJlc2ggPyBcImZyZXNoXCIgOiBcInByZXZpZXdcIjtcbiAgICB0aGlzLnRyYWNlLnB1c2goXG4gICAgICBpc1JlZnJlc2hcbiAgICAgICAgPyBgRnJlc2ggaW50ZW50OiBTSEEtMjU2ICR7ZGlnZXN0LnNsaWNlKDAsIDEyKX1cdTIwMjYsIElEIHVuaXF1ZSwgb3BlbiBGbGV4aWJsZSBUYXNrIHJldmFsaWRhdGVkLmBcbiAgICAgICAgOiBgUHJldmlldzogZXhhY3QgJHtzb3VyY2UubGVuZ3RofSBieXRlcywgU0hBLTI1NiAke2RpZ2VzdC5zbGljZSgwLCAxMil9XHUyMDI2LCB0YXJnZXQgXiR7VEFSR0VUX0lEfS5gLFxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGluamVjdENvbmZsaWN0KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5leHBlY3RhdGlvbikgdGhyb3cgbmV3IEVycm9yKFwiUHJldmlldyB0aGUgc291cmNlIGJlZm9yZSBpbmplY3RpbmcgYSBjb25mbGljdC5cIik7XG4gICAgY29uc3QgZmlsZSA9IHRoaXMuZ2V0U291cmNlRmlsZSgpO1xuICAgIGxldCBpbmplY3RlZCA9IGZhbHNlO1xuICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LnByb2Nlc3MoZmlsZSwgKGN1cnJlbnQpID0+IHtcbiAgICAgIGNvbnN0IGFuYWx5c2lzID0gYW5hbHl6ZVNvdXJjZShjdXJyZW50KTtcbiAgICAgIGlmIChhbmFseXNpcy50YXJnZXRMaW5lICE9PSB0aGlzLmV4cGVjdGF0aW9uIS50YXJnZXRMaW5lKSByZXR1cm4gY3VycmVudDtcbiAgICAgIGNvbnN0IGNoYW5nZWRMaW5lID0gYW5hbHlzaXMudGFyZ2V0TGluZS5yZXBsYWNlKFxuICAgICAgICBgICNsYXVuY2ggXiR7VEFSR0VUX0lEfWAsXG4gICAgICAgIGAgI2xhdW5jaCBjb25mbGljdC1pbmplY3RlZCBeJHtUQVJHRVRfSUR9YCxcbiAgICAgICk7XG4gICAgICBpZiAoY2hhbmdlZExpbmUgPT09IGFuYWx5c2lzLnRhcmdldExpbmUpIHJldHVybiBjdXJyZW50O1xuICAgICAgY29uc3QgbmV4dExpbmVzID0gWy4uLmFuYWx5c2lzLmxpbmVzXTtcbiAgICAgIG5leHRMaW5lc1thbmFseXNpcy50YXJnZXRMaW5lSW5kZXhdID0gY2hhbmdlZExpbmU7XG4gICAgICBpbmplY3RlZCA9IHRydWU7XG4gICAgICByZXR1cm4gbmV4dExpbmVzLmpvaW4oYW5hbHlzaXMubGluZUVuZGluZyk7XG4gICAgfSk7XG4gICAgaWYgKCFpbmplY3RlZCkgdGhyb3cgbmV3IEVycm9yKFwiQ29uZmxpY3QgaW5qZWN0aW9uIGNvdWxkIG5vdCB0YXJnZXQgdGhlIHdhdGNoZWQgbGluZS5cIik7XG4gICAgdGhpcy5kZW1vU3RhZ2UgPSBcImNvbmZsaWN0LWluamVjdGVkXCI7XG4gICAgdGhpcy50cmFjZS5wdXNoKFwiQ29uZmxpY3QgZml4dHVyZTogY2hhbmdlZCBvbmx5IHVub3duZWQgd2F0Y2hlZCB0ZXh0IGJlZm9yZSB0aGUgdGVybWluYWwgSUQuXCIpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBhdHRlbXB0U3RhbGVXcml0ZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMuZXhwZWN0YXRpb24pIHRocm93IG5ldyBFcnJvcihcIk5vIHN0YWxlIGV4cGVjdGF0aW9uIGV4aXN0cy5cIik7XG4gICAgY29uc3QgZmlsZSA9IHRoaXMuZ2V0U291cmNlRmlsZSgpO1xuICAgIGNvbnN0IGJlZm9yZUF0dGVtcHQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5yZWFkKGZpbGUpO1xuICAgIGNvbnN0IGJlZm9yZURpZ2VzdCA9IGF3YWl0IHNoYTI1NihiZWZvcmVBdHRlbXB0KTtcbiAgICBsZXQgcmVqZWN0ZWRJbnNpZGVUcmFuc2Zvcm0gPSBmYWxzZTtcblxuICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LnByb2Nlc3MoZmlsZSwgKGN1cnJlbnQpID0+IHtcbiAgICAgIGNvbnN0IGFuYWx5c2lzID0gYW5hbHl6ZVNvdXJjZShjdXJyZW50KTtcbiAgICAgIGlmIChhbmFseXNpcy50YXJnZXRMaW5lICE9PSB0aGlzLmV4cGVjdGF0aW9uIS50YXJnZXRMaW5lKSB7XG4gICAgICAgIHJlamVjdGVkSW5zaWRlVHJhbnNmb3JtID0gdHJ1ZTtcbiAgICAgICAgcmV0dXJuIGN1cnJlbnQ7XG4gICAgICB9XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJUaGUgc3RhbGUgZml4dHVyZSB1bmV4cGVjdGVkbHkgbWF0Y2hlZCBpbnNpZGUgVmF1bHQucHJvY2VzcygpLlwiKTtcbiAgICB9KTtcblxuICAgIGNvbnN0IGFmdGVyQXR0ZW1wdCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG4gICAgY29uc3QgYWZ0ZXJEaWdlc3QgPSBhd2FpdCBzaGEyNTYoYWZ0ZXJBdHRlbXB0KTtcbiAgICBpZiAoIXJlamVjdGVkSW5zaWRlVHJhbnNmb3JtIHx8IGJlZm9yZUF0dGVtcHQgIT09IGFmdGVyQXR0ZW1wdCB8fCBiZWZvcmVEaWdlc3QgIT09IGFmdGVyRGlnZXN0KSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXCJTYWZlIHJlamVjdGlvbiBjb3VsZCBub3QgcHJvdmUgYnl0ZS1pZGVudGljYWwgYmVmb3JlIGFuZCBhZnRlciBzb3VyY2UuXCIpO1xuICAgIH1cbiAgICB0aGlzLmRlbW9TdGFnZSA9IFwicmVqZWN0ZWRcIjtcbiAgICB0aGlzLmV4YWN0UHJldmlldyA9IGFmdGVyQXR0ZW1wdDtcbiAgICB0aGlzLnRyYWNlLnB1c2goXG4gICAgICBgU2FmZSByZWplY3Rpb246IFZhdWx0LnByb2Nlc3MoKSByZXBhcnNlIHNhdyBjaGFuZ2VkIHdhdGNoZWQgYnl0ZXM7IFNIQS0yNTYgc3RheWVkICR7YWZ0ZXJEaWdlc3Quc2xpY2UoMCwgMTIpfVx1MjAyNjsgemVybyBwbHVnaW4td3JpdGUgYnl0ZXMuYCxcbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBhcHBseUZyZXNoV3JpdGUoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLmV4cGVjdGF0aW9uIHx8IHRoaXMuZGVtb1N0YWdlICE9PSBcImZyZXNoXCIpIHRocm93IG5ldyBFcnJvcihcIlJlZnJlc2ggdGhlIGludGVudCBiZWZvcmUgd3JpdGluZy5cIik7XG4gICAgY29uc3QgZmlsZSA9IHRoaXMuZ2V0U291cmNlRmlsZSgpO1xuICAgIGNvbnN0IHF1ZXVlSGVhZFNvdXJjZSA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG4gICAgY29uc3QgcXVldWVIZWFkRGlnZXN0ID0gYXdhaXQgc2hhMjU2KHF1ZXVlSGVhZFNvdXJjZSk7XG4gICAgaWYgKHF1ZXVlSGVhZERpZ2VzdCAhPT0gdGhpcy5leHBlY3RhdGlvbi5kaWdlc3QpIHRocm93IG5ldyBFcnJvcihcIlRoZSByZWZyZXNoZWQgc291cmNlIGNoYW5nZWQgYmVmb3JlIGNvbW1pdC5cIik7XG4gICAgYXdhaXQgdGhpcy5hc3NlcnRWYXVsdFVuaXF1ZVRhcmdldElkKCk7XG5cbiAgICBjb25zdCBjbG9ja0lkID0gYG5sLWNsb2NrLSR7Y3J5cHRvLnJhbmRvbVVVSUQoKX1gO1xuICAgIGNvbnN0IGNsb2NrTGluZSA9IGAgICAgLSBDTE9DSzogWyR7Zm9ybWF0Q2xvY2tUaW1lc3RhbXAobmV3IERhdGUoKSl9XSBeJHtjbG9ja0lkfWA7XG4gICAgbGV0IGFwcGxpZWQgPSBmYWxzZTtcbiAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5wcm9jZXNzKGZpbGUsIChjdXJyZW50KSA9PiB7XG4gICAgICBjb25zdCBhbmFseXNpcyA9IGFuYWx5emVTb3VyY2UoY3VycmVudCk7XG4gICAgICBpZiAoYW5hbHlzaXMudGFyZ2V0TGluZSAhPT0gdGhpcy5leHBlY3RhdGlvbiEudGFyZ2V0TGluZSB8fCBhbmFseXNpcy5ydW5uaW5nQ2xvY2tMaW5lKSByZXR1cm4gY3VycmVudDtcblxuICAgICAgY29uc3QgbmV4dExpbmVzID0gWy4uLmFuYWx5c2lzLmxpbmVzXTtcbiAgICAgIGNvbnN0IHRhcmdldEJvZHkgPSBuZXh0TGluZXMuc2xpY2UoYW5hbHlzaXMudGFyZ2V0TGluZUluZGV4ICsgMSwgYW5hbHlzaXMudGFyZ2V0Qm91bmRhcnlJbmRleCk7XG4gICAgICBjb25zdCBkcmF3ZXJPZmZzZXQgPSB0YXJnZXRCb2R5LmZpbmRJbmRleCgobGluZSkgPT4gL15cXHMrLSBMT0dCT09LOjokLy50ZXN0KGxpbmUpKTtcbiAgICAgIGlmIChkcmF3ZXJPZmZzZXQgPj0gMCkge1xuICAgICAgICBuZXh0TGluZXMuc3BsaWNlKGFuYWx5c2lzLnRhcmdldExpbmVJbmRleCArIDIgKyBkcmF3ZXJPZmZzZXQsIDAsIGNsb2NrTGluZSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBuZXh0TGluZXMuc3BsaWNlKGFuYWx5c2lzLnRhcmdldEJvdW5kYXJ5SW5kZXgsIDAsIFwiICAtIExPR0JPT0s6OlwiLCBjbG9ja0xpbmUpO1xuICAgICAgfVxuICAgICAgYXBwbGllZCA9IHRydWU7XG4gICAgICByZXR1cm4gbmV4dExpbmVzLmpvaW4oYW5hbHlzaXMubGluZUVuZGluZyk7XG4gICAgfSk7XG5cbiAgICBpZiAoIWFwcGxpZWQpIHRocm93IG5ldyBFcnJvcihcIlRoZSBhdG9taWMgdHJhbnNmb3JtIHJlamVjdGVkIHRoZSBmcmVzaCBpbnRlbnQuXCIpO1xuICAgIGNvbnN0IGNvbmZpcm1lZCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LnJlYWQoZmlsZSk7XG4gICAgY29uc3QgY29uZmlybWVkQW5hbHlzaXMgPSBhbmFseXplU291cmNlKGNvbmZpcm1lZCk7XG4gICAgaWYgKCFjb25maXJtZWRBbmFseXNpcy5ydW5uaW5nQ2xvY2tMaW5lPy5pbmNsdWRlcyhgXiR7Y2xvY2tJZH1gKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKFwiQXV0aG9yaXRhdGl2ZSByZWFkLWFmdGVyLXdyaXRlIGNvdWxkIG5vdCBjb25maXJtIHRoZSBDTE9DSy5cIik7XG4gICAgfVxuICAgIGNvbnN0IGNvbmZpcm1lZERpZ2VzdCA9IGF3YWl0IHNoYTI1Nihjb25maXJtZWQpO1xuICAgIHRoaXMuZGVtb1N0YWdlID0gXCJhcHBsaWVkXCI7XG4gICAgdGhpcy5leGFjdFByZXZpZXcgPSBjb25maXJtZWQ7XG4gICAgdGhpcy5yZWNvdmVyZWRDbG9jayA9IGNvbmZpcm1lZEFuYWx5c2lzLnJ1bm5pbmdDbG9ja0xpbmU7XG4gICAgdGhpcy50cmFjZS5wdXNoKFxuICAgICAgYEFwcGxpZWQ6IG9uZSBWYXVsdC5wcm9jZXNzKCkgdHJhbnNmb3JtIGluc2VydGVkIExPR0JPT0svQ0xPQ0s7IHJlYWQtYWZ0ZXItd3JpdGUgY29uZmlybWVkICR7Y2xvY2tJZH07IFNIQS0yNTYgJHtjb25maXJtZWREaWdlc3Quc2xpY2UoMCwgMTIpfVx1MjAyNi5gLFxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlY292ZXJGcm9tTWFya2Rvd24oYWRkVHJhY2U6IGJvb2xlYW4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBmaWxlID0gdGhpcy5nZXRTb3VyY2VGaWxlKCk7XG4gICAgY29uc3Qgc291cmNlID0gYXdhaXQgdGhpcy5hcHAudmF1bHQucmVhZChmaWxlKTtcbiAgICBjb25zdCBhbmFseXNpcyA9IGFuYWx5emVTb3VyY2Uoc291cmNlKTtcbiAgICB0aGlzLmV4YWN0UHJldmlldyA9IHRoaXMuZGVtb1N0YWdlID09PSBcImlkbGVcIiA/IFwiXCIgOiBzb3VyY2U7XG4gICAgdGhpcy5leHBlY3RhdGlvbiA9IG51bGw7XG4gICAgdGhpcy5yZWNvdmVyZWRDbG9jayA9IGFuYWx5c2lzLnJ1bm5pbmdDbG9ja0xpbmU7XG4gICAgdGhpcy5kZW1vU3RhZ2UgPSBhbmFseXNpcy5ydW5uaW5nQ2xvY2tMaW5lID8gXCJyZWNvdmVyZWRcIiA6IFwiaWRsZVwiO1xuICAgIGlmIChhZGRUcmFjZSB8fCBhbmFseXNpcy5ydW5uaW5nQ2xvY2tMaW5lKSB7XG4gICAgICB0aGlzLnRyYWNlLnB1c2goXG4gICAgICAgIGFuYWx5c2lzLnJ1bm5pbmdDbG9ja0xpbmVcbiAgICAgICAgICA/IGBSZWNvdmVyeTogYWN0aXZlIENMT0NLIGRlcml2ZWQgZnJvbSAke1NPVVJDRV9QQVRIfTsgbm8gaGlkZGVuIHJlY2VpcHQgb3Igc3RhcnR1cCB3cml0ZS5gXG4gICAgICAgICAgOiBgUmVjb3Zlcnk6IG5vIHJ1bm5pbmcgQ0xPQ0sgZm91bmQgaW4gJHtTT1VSQ0VfUEFUSH07IGRlcml2ZWQgSWRsZSB3aXRob3V0IGEgd3JpdGUuYCxcbiAgICAgICk7XG4gICAgfVxuICAgIHRoaXMucmVuZGVyV3JpdGVQcm9vZigpO1xuICAgIHRoaXMudXBkYXRlU3RhdGVPdXRwdXQoKTtcbiAgfVxuXG4gIHByaXZhdGUgdXBkYXRlU3RhdGVPdXRwdXQoKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLnN0YXRlT3V0cHV0KSByZXR1cm47XG4gICAgY29uc3QgY3VycmVudCA9IFZBUklBTlRTW3RoaXMudmFyaWFudEluZGV4XTtcbiAgICBjb25zdCBhY3RpdmUgPSBkb2N1bWVudC5hY3RpdmVFbGVtZW50O1xuICAgIGNvbnN0IGFjdGl2ZURlc2NyaXB0aW9uID0gYWN0aXZlIGluc3RhbmNlb2YgSFRNTEVsZW1lbnRcbiAgICAgID8gYWN0aXZlLmdldEF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIikgfHwgYWN0aXZlLmdldEF0dHJpYnV0ZShcInBsYWNlaG9sZGVyXCIpIHx8IGFjdGl2ZS50YWdOYW1lLnRvTG93ZXJDYXNlKClcbiAgICAgIDogXCJub25lXCI7XG4gICAgdGhpcy5zdGF0ZU91dHB1dC50ZXh0Q29udGVudCA9IEpTT04uc3RyaW5naWZ5KFxuICAgICAge1xuICAgICAgICB2YXJpYW50OiBgJHtjdXJyZW50LmtleX0gXHUwMEI3ICR7Y3VycmVudC5uYW1lfWAsXG4gICAgICAgIHZhcmlhbnRTdG9yYWdlOiBcIm1lbW9yeS1vbmx5XCIsXG4gICAgICAgIHRoZW1lOiBkb2N1bWVudC5ib2R5LmNsYXNzTGlzdC5jb250YWlucyhcInRoZW1lLWRhcmtcIikgPyBcImRhcmtcIiA6IFwibGlnaHRcIixcbiAgICAgICAgbWVhc3VyZWRMZWFmV2lkdGg6IHRoaXMubWVhc3VyZWRXaWR0aCxcbiAgICAgICAgYnJlYWtwb2ludDogXCJjb21wYWN0IDw9IDUyMHB4XCIsXG4gICAgICAgIGxheW91dDogdGhpcy5sYXlvdXQsXG4gICAgICAgIGZpbHRlcjogdGhpcy5maWx0ZXIsXG4gICAgICAgIGNvbGxhcHNlZDogdGhpcy5jb2xsYXBzZWQsXG4gICAgICAgIGNvbXBsZXRlZFZpc2libGU6IHRoaXMuc2hvd0NvbXBsZXRlZCxcbiAgICAgICAgcGxheWJhY2s6IHRoaXMucGxheWJhY2sgPyBgYWN0aXZlIFx1MDBCNyAke3RoaXMucGxheWJhY2tMYWJlbCgpfWAgOiBcImlkbGVcIixcbiAgICAgICAgb3ZlcnZpZXdPcGVuOiB0aGlzLm92ZXJ2aWV3T3BlbixcbiAgICAgICAgc2NoZWR1bGVPcGVuOiB0aGlzLnNjaGVkdWxlT3BlbixcbiAgICAgICAgb3ZlcmZsb3dPcGVuOiB0aGlzLm92ZXJmbG93T3BlbixcbiAgICAgICAgY2xvY2s6IFwiYWN0aXZlIFx1MDBCNyAwMDo0MjoxOFwiLFxuICAgICAgICBwb21vOiBcImN5Y2xlIDMgXHUwMEI3IDEyOjA3XCIsXG4gICAgICAgIG1hcmtkb3duU3RhZ2U6IHRoaXMuZGVtb1N0YWdlLFxuICAgICAgICByZWNvdmVyZWRDbG9jazogdGhpcy5yZWNvdmVyZWRDbG9jayxcbiAgICAgICAgZm9jdXNlZDogYWN0aXZlRGVzY3JpcHRpb24sXG4gICAgICAgIHJlZHVjZWRNb3Rpb246IHdpbmRvdy5tYXRjaE1lZGlhKFwiKHByZWZlcnMtcmVkdWNlZC1tb3Rpb246IHJlZHVjZSlcIikubWF0Y2hlcyxcbiAgICAgIH0sXG4gICAgICBudWxsLFxuICAgICAgMixcbiAgICApO1xuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIFNwaXJhbERheVBsYW5uZXJQcm90b3R5cGVQbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xuICBhc3luYyBvbmxvYWQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5yZWdpc3RlclZpZXcoVklFV19UWVBFLCAobGVhZikgPT4gbmV3IFBsYW5uZXJQcm90b3R5cGVWaWV3KGxlYWYpKTtcbiAgICB0aGlzLmFkZFJpYmJvbkljb24oXCJjYWxlbmRhci1jbG9ja1wiLCBcIk9wZW4gU3BpcmFsIERheSBwbGFubmVyIHByb3RvdHlwZVwiLCAoKSA9PiB7XG4gICAgICB2b2lkIHRoaXMuYWN0aXZhdGVWaWV3KCk7XG4gICAgfSk7XG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiBcIm9wZW4tcGxhbm5lclwiLFxuICAgICAgbmFtZTogXCJPcGVuIFNwaXJhbCBEYXkgcGxhbm5lciBwcm90b3R5cGVcIixcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB2b2lkIHRoaXMuYWN0aXZhdGVWaWV3KCksXG4gICAgfSk7XG4gIH1cblxuICBvbnVubG9hZCgpOiB2b2lkIHtcbiAgICB0aGlzLmFwcC53b3Jrc3BhY2UuZGV0YWNoTGVhdmVzT2ZUeXBlKFZJRVdfVFlQRSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGFjdGl2YXRlVmlldygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoVklFV19UWVBFKVswXTtcbiAgICBjb25zdCBsZWFmID0gZXhpc3RpbmcgPz8gYXdhaXQgdGhpcy5hcHAud29ya3NwYWNlLmVuc3VyZVNpZGVMZWFmKFZJRVdfVFlQRSwgXCJyaWdodFwiLCB7IGFjdGl2ZTogdHJ1ZSB9KTtcbiAgICBhd2FpdCB0aGlzLmFwcC53b3Jrc3BhY2UucmV2ZWFsTGVh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
