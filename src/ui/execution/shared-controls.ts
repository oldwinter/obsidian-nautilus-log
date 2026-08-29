import type { CoreMessageNamespaces, Messages } from "../../i18n/types";
import type { ExecutionCatalog } from "../../i18n/locales/en/execution";

export type ExecutionMessages = Messages<CoreMessageNamespaces & { readonly execution: ExecutionCatalog }>;
export type ExecutionIconName =
  | "check"
  | "chevron-down"
  | "chevron-right"
  | "clock"
  | "external-link"
  | "focus"
  | "refresh"
  | "square"
  | "timer"
  | "trash"
  | "x";

export type ExecutionIconRenderer = (element: HTMLElement, icon: ExecutionIconName) => void;

export function executionElement<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  name: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const created = document.createElement(name);
  if (className) created.className = className;
  return created;
}

export function formatExecutionDuration(milliseconds: number): string {
  const bounded = Math.max(0, Number.isFinite(milliseconds) ? milliseconds : 0);
  const totalSeconds = Math.floor(bounded / 1_000);
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatExecutionMinutes(minutes: number): string {
  const bounded = Math.max(0, Math.round(Number.isFinite(minutes) ? minutes : 0));
  const hours = Math.floor(bounded / 60);
  const remainder = bounded % 60;
  if (hours === 0) return `${remainder}m`;
  if (remainder === 0) return `${hours}h`;
  return `${hours}h ${remainder}m`;
}

export function executionIconButton(input: {
  readonly document: Document;
  readonly label: string;
  readonly icon: ExecutionIconName;
  readonly renderIcon: ExecutionIconRenderer;
  readonly className?: string;
  readonly onActivate: () => void;
}): HTMLButtonElement {
  const button = executionElement(input.document, "button", input.className);
  button.type = "button";
  button.setAttribute("aria-label", input.label);
  button.title = input.label;
  input.renderIcon(button, input.icon);
  button.addEventListener("click", input.onActivate);
  return button;
}

export function executionLiveRegion(document: Document): HTMLElement {
  const region = executionElement(document, "div", "spiral-day-execution__live-region");
  region.setAttribute("role", "status");
  region.setAttribute("aria-live", "polite");
  region.setAttribute("aria-atomic", "true");
  return region;
}

export interface ExecutionTabDefinition<TName extends string> {
  readonly name: TName;
  readonly label: string;
  readonly panel: HTMLElement;
}

export class ExecutionRovingTabs<TName extends string> {
  readonly #tabs: readonly ExecutionTabDefinition<TName>[];
  readonly #buttons: readonly HTMLButtonElement[];
  readonly #onChange: (name: TName) => void;
  #active: TName;

  constructor(input: {
    readonly root: HTMLElement;
    readonly tabs: readonly ExecutionTabDefinition<TName>[];
    readonly active: TName;
    readonly onChange: (name: TName) => void;
  }) {
    if (input.tabs.length === 0) throw new Error("Execution tabs require at least one tab");
    this.#tabs = Object.freeze([...input.tabs]);
    this.#active = input.active;
    this.#onChange = input.onChange;
    input.root.setAttribute("role", "tablist");
    input.root.setAttribute("aria-orientation", "horizontal");
    this.#buttons = Object.freeze(this.#tabs.map((tab, index) => {
      const button = executionElement(input.root.ownerDocument, "button", "spiral-day-execution__tab");
      button.type = "button";
      button.id = `spiral-day-execution-tab-${tab.name}`;
      button.setAttribute("role", "tab");
      button.setAttribute("aria-controls", `spiral-day-execution-panel-${tab.name}`);
      button.textContent = tab.label;
      button.addEventListener("click", () => this.select(tab.name));
      button.addEventListener("keydown", (event) => this.#onKeyDown(event, index));
      tab.panel.id = `spiral-day-execution-panel-${tab.name}`;
      tab.panel.setAttribute("role", "tabpanel");
      tab.panel.setAttribute("aria-labelledby", button.id);
      input.root.append(button);
      return button;
    }));
    this.select(input.active, false);
  }

  get active(): TName {
    return this.#active;
  }

  select(name: TName, announce = true): void {
    const index = this.#tabs.findIndex((tab) => tab.name === name);
    if (index < 0) return;
    this.#active = name;
    this.#tabs.forEach((tab, tabIndex) => {
      const selected = tabIndex === index;
      const button = this.#buttons[tabIndex]!;
      button.tabIndex = selected ? 0 : -1;
      button.setAttribute("aria-selected", String(selected));
      tab.panel.hidden = !selected;
    });
    if (announce) this.#onChange(name);
  }

  focusActive(): void {
    this.#buttons[this.#tabs.findIndex((tab) => tab.name === this.#active)]?.focus();
  }

  setLabel(name: TName, label: string): void {
    const index = this.#tabs.findIndex((tab) => tab.name === name);
    if (index >= 0) this.#buttons[index]!.textContent = label;
  }

  #onKeyDown(event: KeyboardEvent, index: number): void {
    let next = index;
    if (event.key === "ArrowRight") next = (index + 1) % this.#tabs.length;
    else if (event.key === "ArrowLeft") next = (index - 1 + this.#tabs.length) % this.#tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = this.#tabs.length - 1;
    else return;
    event.preventDefault();
    const tab = this.#tabs[next]!;
    this.select(tab.name);
    this.#buttons[next]!.focus();
  }
}
