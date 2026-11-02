import type { ReviewRow } from "../../core/review";
import type { CoreMessageNamespaces, Messages } from "../../i18n/types";
import type { ReviewCatalog } from "../../i18n/locales/en/review";
import type { RuntimeReviewTask } from "../../runtime/review/coordinator";

export type ReviewMessages = Messages<CoreMessageNamespaces & { readonly review: ReviewCatalog }>;
export type ReviewRowAction = "clock-in" | "complete" | "open-source";

export function reviewDuration(messages: ReviewMessages, minutes: number | null): string {
  return minutes === null ? "—" : messages.t("shared", "unit.duration", { minutes });
}

export function reviewVariance(messages: ReviewMessages, minutes: number | undefined): string {
  if (minutes === undefined) return "—";
  return `${minutes > 0 ? "+" : minutes < 0 ? "−" : ""}${reviewDuration(messages, Math.abs(minutes))}`;
}

export interface ReviewTitlePart {
  readonly text: string;
  readonly match: boolean;
}

// Splits a row title into plain and matched runs for one case-insensitive
// search query. Matching is presentation-only; filtering happens upstream.
export function splitReviewTitleHighlight(label: string, query: string): readonly ReviewTitlePart[] {
  const needle = query.trim().toLowerCase();
  if (needle === "") return Object.freeze([{ text: label, match: false }]);
  const haystack = label.toLowerCase();
  const parts: ReviewTitlePart[] = [];
  let rest = 0;
  for (;;) {
    const at = haystack.indexOf(needle, rest);
    if (at < 0) break;
    if (at > rest) parts.push({ text: label.slice(rest, at), match: false });
    parts.push({ text: label.slice(at, at + needle.length), match: true });
    rest = at + needle.length;
  }
  if (rest < label.length) parts.push({ text: label.slice(rest), match: false });
  if (parts.length === 0) parts.push({ text: label, match: false });
  return Object.freeze(parts);
}

export class ReviewRowView {
  readonly element: HTMLLIElement;
  readonly #title: HTMLButtonElement;
  #titleKey: string | null = null;
  readonly #state: HTMLSpanElement;
  readonly #metrics: readonly { label: HTMLElement; value: HTMLElement }[];
  readonly #actions: HTMLDivElement;
  readonly #clockIn: HTMLButtonElement;
  readonly #complete: HTMLButtonElement;
  readonly #warning: HTMLElement;

  constructor(document: Document, activate: (action: ReviewRowAction) => void) {
    this.element = document.createElement("li");
    this.element.className = "spiral-day-review__row";
    this.#title = document.createElement("button");
    this.#title.type = "button";
    this.#title.className = "spiral-day-review__title";
    this.#title.addEventListener("click", () => activate("open-source"));
    this.#state = document.createElement("span");
    this.#state.className = "spiral-day-review__state";
    const metrics = document.createElement("dl");
    metrics.className = "spiral-day-review__metrics";
    this.#metrics = ["planned", "actual", "variance"].map((name) => {
      const group = document.createElement("div");
      const label = document.createElement("dt");
      const value = document.createElement("dd");
      value.dataset.metric = name;
      group.append(label, value);
      metrics.append(group);
      return { label, value };
    });
    this.#actions = document.createElement("div");
    this.#actions.className = "spiral-day-review__actions";
    this.#clockIn = document.createElement("button");
    this.#clockIn.type = "button";
    this.#clockIn.addEventListener("click", () => activate("clock-in"));
    this.#complete = document.createElement("button");
    this.#complete.type = "button";
    this.#complete.addEventListener("click", () => activate("complete"));
    this.#actions.append(this.#clockIn, this.#complete);
    this.#warning = document.createElement("p");
    this.#warning.className = "spiral-day-review__warning";
    this.element.append(this.#title, this.#state, metrics, this.#actions, this.#warning);
  }

  disable(): void {
    this.#title.disabled = true;
    this.#clockIn.disabled = true;
    this.#complete.disabled = true;
  }

  contains(element: Element | null): boolean {
    return element !== null && this.element.contains(element);
  }

  focusSource(): boolean {
    if (!this.element.isConnected || this.#title.disabled) return false;
    this.#title.focus({ preventScroll: true });
    return this.element.ownerDocument.activeElement === this.#title;
  }

  #renderTitle(label: string, searchQuery: string): void {
    // Skip DOM churn (and keep title focus) while neither label nor query changed.
    const key = `${searchQuery.trim().toLowerCase()}\n${label}`;
    if (this.#titleKey === key) return;
    this.#titleKey = key;
    const document = this.element.ownerDocument;
    this.#title.replaceChildren(
      ...splitReviewTitleHighlight(label, searchQuery).map((part) => {
        if (!part.match) return document.createTextNode(part.text);
        const mark = document.createElement("mark");
        mark.textContent = part.text;
        return mark;
      }),
    );
  }

  update(row: ReviewRow<RuntimeReviewTask>, messages: ReviewMessages, enabled: boolean, writableDate: boolean, focusedOwner: string | undefined, searchQuery: string): boolean {
    const { task } = row;
    const active = this.element.ownerDocument.activeElement;
    const mutationFocused = active === this.#clockIn || active === this.#complete;
    const titleFocused = active === this.#title;
    this.element.dataset.state = row.state;
    this.#renderTitle(task.label, searchQuery);
    this.#title.setAttribute("aria-label", messages.t("review", "action.openSource", { title: task.label }));
    this.#title.disabled = !enabled || !task.target?.ownerId;
    this.#state.textContent = messages.t("review", `state.${row.state}`);
    const values = [
      reviewDuration(messages, row.plannedMinutes),
      reviewDuration(messages, row.actualMinutes),
      reviewVariance(messages, row.varianceMinutes),
    ];
    const labels = ["metric.planned", "metric.actual", "metric.variance"] as const;
    this.#metrics.forEach((metric, index) => {
      metric.label.textContent = messages.t("review", labels[index]!);
      metric.value.textContent = values[index]!;
      metric.value.classList.toggle("spiral-day-review__overrun", index === 2 && (row.varianceMinutes ?? 0) > 0);
    });
    this.#clockIn.textContent = messages.t("review", "action.clockIn");
    this.#complete.textContent = messages.t("review", "action.complete");
    const done = task.status === "done";
    const hideMutations = done || !writableDate || !task.target;
    const mutationUnavailable = hideMutations || !enabled;
    if (mutationFocused && mutationUnavailable && !this.#title.disabled) this.#title.focus({ preventScroll: true });
    this.#actions.hidden = hideMutations;
    this.#clockIn.hidden = hideMutations;
    this.#complete.hidden = hideMutations;
    this.#clockIn.disabled = !enabled || !writableDate || !task.target || (task.ownerId !== undefined && task.ownerId === focusedOwner);
    this.#complete.disabled = !enabled || !writableDate || !task.target;
    this.#warning.textContent = !task.target
      ? messages.t("review", "state.noTarget")
      : row.malformedClockCount > 0 || row.potentialRunning
        ? messages.t("review", "state.malformed")
        : "";
    this.#warning.hidden = this.#warning.textContent === "";
    const focusedControlBecameUnavailable = (mutationFocused && mutationUnavailable)
      || (titleFocused && this.#title.disabled);
    return focusedControlBecameUnavailable && this.element.ownerDocument.activeElement !== this.#title;
  }
}
