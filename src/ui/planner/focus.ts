export const PLANNER_FOCUS_KEY_ATTRIBUTE = "data-planner-focus-key";

export function isPlannerActivationKey(key: string): boolean {
  return key === "Enter" || key === " " || key === "Spacebar";
}

export function nextRovingIndex(
  current: number,
  key: string,
  count: number,
): number {
  if (!Number.isInteger(count) || count <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowRight" || key === "ArrowDown") return (current + 1 + count) % count;
  if (key === "ArrowLeft" || key === "ArrowUp") return (current - 1 + count) % count;
  return current;
}

export interface PlannerFocusManager {
  capture(): string | undefined;
  restore(key?: string, fallbackKey?: string): boolean;
}

export function createPlannerFocusManager(root: HTMLElement): PlannerFocusManager {
  let pending: string | undefined;
  return Object.freeze({
    capture() {
      const active = root.ownerDocument.activeElement;
      if (!active || !root.contains(active)) {
        pending = undefined;
        return undefined;
      }
      pending = active.getAttribute(PLANNER_FOCUS_KEY_ATTRIBUTE) ?? undefined;
      return pending;
    },
    restore(key = pending, fallbackKey?: string) {
      const find = (candidate: string | undefined): HTMLElement | SVGElement | null => {
        if (!candidate) return null;
        const escaped = typeof CSS !== "undefined" && typeof CSS.escape === "function"
          ? CSS.escape(candidate)
          : candidate.replaceAll('"', '\\"');
        return [...root.querySelectorAll<HTMLElement | SVGElement>(
          `[${PLANNER_FOCUS_KEY_ATTRIBUTE}="${escaped}"]`,
        )].find((element) => element.getClientRects().length > 0
          && element.getAttribute("aria-hidden") !== "true"
          && !element.closest("[hidden]")) ?? null;
      };
      const target = find(key) ?? find(fallbackKey);
      target?.focus({ preventScroll: true });
      const restored = target !== null && root.ownerDocument.activeElement === target;
      if (restored) pending = undefined;
      return restored;
    },
  });
}

export interface PlannerLiveAnnouncer {
  announce(message: string, priority?: "assertive" | "polite"): void;
  destroy(): void;
}

function liveRegion(document: Document, priority: "assertive" | "polite"): HTMLDivElement {
  const region = document.createElement("div");
  region.className = "spiral-day-planner__live-region";
  region.dataset.priority = priority;
  region.setAttribute("role", priority === "assertive" ? "alert" : "status");
  region.setAttribute("aria-atomic", "true");
  region.setAttribute("aria-live", priority);
  return region;
}

export function createPlannerLiveAnnouncer(root: HTMLElement): PlannerLiveAnnouncer {
  const polite = liveRegion(root.ownerDocument, "polite");
  const assertive = liveRegion(root.ownerDocument, "assertive");
  root.append(polite, assertive);
  let destroyed = false;
  return Object.freeze({
    announce(message: string, priority: "assertive" | "polite" = "polite") {
      if (destroyed || message.trim() === "") return;
      const region = priority === "assertive" ? assertive : polite;
      region.textContent = "";
      queueMicrotask(() => {
        if (!destroyed) region.textContent = message;
      });
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      polite.remove();
      assertive.remove();
    },
  });
}

export function bindKeyboardActivation(
  element: HTMLElement | SVGElement,
  activate: () => void,
): () => void {
  const nativeButton = element.tagName.toLowerCase() === "button";
  if (!nativeButton) {
    element.setAttribute("role", "button");
    element.setAttribute("tabindex", "0");
  }
  const keydown = (event: Event): void => {
    const keyboardEvent = event as KeyboardEvent;
    if (nativeButton || !isPlannerActivationKey(keyboardEvent.key) || keyboardEvent.repeat) return;
    keyboardEvent.preventDefault();
    activate();
  };
  const click = (): void => activate();
  element.addEventListener("keydown", keydown);
  element.addEventListener("click", click);
  return () => {
    element.removeEventListener("keydown", keydown);
    element.removeEventListener("click", click);
  };
}

export function bindEscapeFocusRestoration(
  container: HTMLElement,
  invoker: HTMLElement,
  close: () => void,
): () => void {
  const keydown = (event: KeyboardEvent): void => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    close();
    queueMicrotask(() => invoker.focus({ preventScroll: true }));
  };
  container.addEventListener("keydown", keydown);
  return () => container.removeEventListener("keydown", keydown);
}

export function bindPlannerTooltip(
  target: HTMLElement | SVGElement,
  tooltip: HTMLElement,
  text: string,
): () => void {
  if (!tooltip.id) throw new RangeError("Planner tooltip requires a stable ID");
  target.setAttribute("aria-describedby", tooltip.id);
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  const view = target.ownerDocument.defaultView;
  let viewportListenersBound = false;
  const position = (): void => {
    if (tooltip.hidden || !view) return;
    const targetBox = target.getBoundingClientRect();
    const tooltipBox = tooltip.getBoundingClientRect();
    const margin = 8;
    const preferredX = targetBox.left + targetBox.width / 2 - tooltipBox.width / 2;
    const x = Math.max(margin, Math.min(view.innerWidth - tooltipBox.width - margin, preferredX));
    const above = targetBox.top - tooltipBox.height - margin;
    const y = above >= margin ? above : Math.min(
      view.innerHeight - tooltipBox.height - margin,
      targetBox.bottom + margin,
    );
    const positionScale = tooltip.offsetWidth > 0
      ? tooltipBox.width / tooltip.offsetWidth
      : 1;
    const safePositionScale = Number.isFinite(positionScale) && positionScale > 0
      ? positionScale
      : 1;
    tooltip.dataset.side = above >= margin ? "top" : "bottom";
    tooltip.style.left = `${Math.round(x / safePositionScale)}px`;
    tooltip.style.top = `${Math.round(Math.max(margin, y) / safePositionScale)}px`;
  };
  const unbindViewport = (): void => {
    if (!view || !viewportListenersBound) return;
    viewportListenersBound = false;
    view.removeEventListener("resize", position);
    view.removeEventListener("scroll", position, true);
  };
  const bindViewport = (): void => {
    if (!view || viewportListenersBound) return;
    viewportListenersBound = true;
    view.addEventListener("resize", position);
    view.addEventListener("scroll", position, true);
  };
  const show = (): void => {
    tooltip.textContent = text;
    tooltip.hidden = false;
    position();
    bindViewport();
  };
  const hide = (): void => {
    tooltip.hidden = true;
    unbindViewport();
  };
  const keydown = (event: Event): void => {
    if ((event as KeyboardEvent).key === "Escape") hide();
  };
  target.addEventListener("mouseenter", show);
  target.addEventListener("mouseleave", hide);
  target.addEventListener("focus", show);
  target.addEventListener("blur", hide);
  target.addEventListener("keydown", keydown);
  return () => {
    hide();
    target.removeEventListener("mouseenter", show);
    target.removeEventListener("mouseleave", hide);
    target.removeEventListener("focus", show);
    target.removeEventListener("blur", hide);
    target.removeEventListener("keydown", keydown);
    target.removeAttribute("aria-describedby");
  };
}

export interface RovingTabEntry {
  readonly panel: HTMLElement;
  readonly tab: HTMLElement;
}

export interface RovingTabsController {
  readonly selectedIndex: number;
  select(index: number, focus?: boolean): boolean;
  destroy(): void;
}

let rovingTabSequence = 0;

export function bindRovingTabs(
  entries: readonly RovingTabEntry[],
  initialIndex = 0,
): RovingTabsController {
  if (entries.length === 0) throw new RangeError("Roving tabs require at least one tab");
  let selectedIndex = Number.isInteger(initialIndex)
    ? Math.max(0, Math.min(entries.length - 1, initialIndex))
    : 0;
  rovingTabSequence += 1;
  const groupId = rovingTabSequence;
  const cleanups: Array<() => void> = [];
  const commonParent = entries[0]?.tab.parentElement;
  if (commonParent && entries.every((entry) => entry.tab.parentElement === commonParent)) {
    commonParent.setAttribute("role", "tablist");
  }
  const render = (focus: boolean): void => {
    entries.forEach((entry, index) => {
      const selected = index === selectedIndex;
      if (!entry.tab.id) entry.tab.id = `spiral-day-tab-${groupId}-${index}`;
      if (!entry.panel.id) entry.panel.id = `spiral-day-tabpanel-${groupId}-${index}`;
      entry.tab.setAttribute("role", "tab");
      entry.tab.setAttribute("aria-controls", entry.panel.id);
      entry.tab.setAttribute("aria-selected", String(selected));
      entry.tab.tabIndex = selected ? 0 : -1;
      entry.panel.setAttribute("role", "tabpanel");
      entry.panel.setAttribute("aria-labelledby", entry.tab.id);
      entry.panel.hidden = !selected;
      if (selected && focus) entry.tab.focus({ preventScroll: true });
    });
  };
  const select = (index: number, focus = false): boolean => {
    if (!Number.isInteger(index) || index < 0 || index >= entries.length) return false;
    const changed = index !== selectedIndex;
    selectedIndex = index;
    render(focus);
    return changed;
  };
  entries.forEach((entry, index) => {
    const click = (): void => { select(index); };
    const keydown = (event: KeyboardEvent): void => {
      const navigationKeys = ["ArrowDown", "ArrowLeft", "ArrowRight", "ArrowUp", "End", "Home"];
      if (!navigationKeys.includes(event.key)) return;
      event.preventDefault();
      const next = nextRovingIndex(selectedIndex, event.key, entries.length);
      select(next, true);
    };
    entry.tab.addEventListener("click", click);
    entry.tab.addEventListener("keydown", keydown);
    cleanups.push(() => {
      entry.tab.removeEventListener("click", click);
      entry.tab.removeEventListener("keydown", keydown);
    });
  });
  render(false);
  return Object.freeze({
    get selectedIndex() {
      return selectedIndex;
    },
    select,
    destroy() {
      for (const cleanup of cleanups) cleanup();
    },
  });
}
