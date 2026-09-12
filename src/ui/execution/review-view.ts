import type { LogicalDate } from "../../core/day";
import type { ReviewCoordinatorSnapshot } from "../../runtime/review/coordinator";
import type { ExecutionApplicationSnapshot } from "../../runtime/execution/application";
import { ReviewRowView, reviewDuration, reviewVariance, type ReviewMessages, type ReviewRowAction } from "./review-row";

export interface ReviewViewActions {
  readonly today: () => LogicalDate;
  readonly selectDate: (date: LogicalDate | null) => void;
  readonly refresh: () => void;
  readonly activate: (key: string, action: ReviewRowAction) => void;
}

function dateValue(date: LogicalDate): string {
  return `${String(date.year).padStart(4, "0")}-${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}`;
}

export class ReviewView {
  readonly #root: HTMLElement;
  readonly #date: HTMLInputElement;
  readonly #previous: HTMLButtonElement;
  readonly #next: HTMLButtonElement;
  readonly #today: HTMLButtonElement;
  readonly #refresh: HTMLButtonElement;
  readonly #status: HTMLElement;
  readonly #summary: HTMLElement;
  readonly #counts: HTMLElement;
  readonly #totals: HTMLElement;
  readonly #list: HTMLUListElement;
  readonly #rows = new Map<string, ReviewRowView>();
  readonly #actions: ReviewViewActions;
  #selectedDate: LogicalDate;

  constructor(root: HTMLElement, actions: ReviewViewActions) {
    this.#root = root;
    this.#actions = actions;
    this.#selectedDate = actions.today();
    const document = root.ownerDocument;
    const toolbar = document.createElement("div");
    toolbar.className = "spiral-day-review__toolbar";
    const button = (activate: () => void): HTMLButtonElement => {
      const element = document.createElement("button");
      element.type = "button";
      element.addEventListener("click", activate);
      return element;
    };
    this.#previous = button(() => this.#moveDate(-1));
    this.#next = button(() => this.#moveDate(1));
    this.#today = button(() => this.#selectDate(null));
    this.#refresh = button(actions.refresh);
    this.#date = document.createElement("input");
    this.#date.type = "date";
    this.#date.value = dateValue(this.#selectedDate);
    this.#date.addEventListener("change", () => {
      const value = this.#date.valueAsDate;
      if (!value || !Number.isFinite(value.getTime())) return;
      this.#selectDate({ year: value.getUTCFullYear(), month: value.getUTCMonth() + 1, day: value.getUTCDate() });
    });
    toolbar.append(this.#previous, this.#date, this.#next, this.#today, this.#refresh);
    this.#status = document.createElement("p");
    this.#status.className = "spiral-day-review__status";
    this.#status.setAttribute("role", "status");
    this.#status.setAttribute("aria-live", "polite");
    this.#summary = document.createElement("div");
    this.#summary.className = "spiral-day-review__summary";
    this.#counts = document.createElement("p");
    this.#totals = document.createElement("p");
    this.#summary.append(this.#counts, this.#totals);
    this.#list = document.createElement("ul");
    this.#list.className = "spiral-day-review__list";
    root.classList.add("spiral-day-review");
    root.replaceChildren(toolbar, this.#status, this.#summary, this.#list);
  }

  render(input: {
    readonly review: ReviewCoordinatorSnapshot;
    readonly execution: ExecutionApplicationSnapshot;
    readonly messages: ReviewMessages;
    readonly pending: boolean;
    readonly error: boolean;
  }): void {
    const { review, execution, messages, pending } = input;
    this.#previous.textContent = "‹";
    this.#previous.setAttribute("aria-label", messages.t("review", "date.previous"));
    this.#next.textContent = "›";
    this.#next.setAttribute("aria-label", messages.t("review", "date.next"));
    this.#date.setAttribute("aria-label", messages.t("review", "date.label"));
    this.#today.textContent = messages.t("review", "date.today");
    this.#refresh.textContent = messages.t("review", "action.refresh");
    this.#list.setAttribute("aria-label", messages.t("review", "list.label"));
    const reviewReady = review.state === "ready";
    const ready = reviewReady && (execution.status === "ready" || execution.status === "working");
    const hasRows = reviewReady && review.availability === "ready" && review.projection.rows.length > 0;
    const displayRows = ready && hasRows;
    this.#root.setAttribute("aria-busy", String(pending || review.state === "building"));
    this.#refresh.disabled = pending || review.state === "building";
    if (!displayRows && this.#list.contains(this.#root.ownerDocument.activeElement)) this.#focusToolbar();
    this.#summary.hidden = !displayRows;
    this.#list.hidden = !displayRows;
    if (!ready) {
      for (const row of this.#rows.values()) row.disable();
      this.#status.textContent = messages.t("review", review.state === "unavailable"
        ? review.reason === "history-over-limit" ? "state.overLimit" : "state.unavailable"
        : review.state === "ready" ? "state.stale" : "state.loading");
      this.#status.hidden = false;
      return;
    }
    this.#selectedDate = review.displayedDate;
    if (this.#date.value !== dateValue(review.displayedDate)) this.#date.value = dateValue(review.displayedDate);
    const enabled = !pending && execution.status === "ready" && !execution.writeBlocked;
    const summary = review.projection.summary;
    this.#counts.textContent = messages.t("review", "summary.counts", summary);
    const comparable = summary.compared > 0;
    this.#totals.textContent = `${messages.t("review", "metric.planned")} ${reviewDuration(messages, comparable ? summary.plannedMinutes : null)} · ${messages.t("review", "metric.actual")} ${reviewDuration(messages, comparable ? summary.actualMinutes : null)} · ${messages.t("review", "metric.variance")} ${reviewVariance(messages, comparable ? summary.varianceMinutes : undefined)}`;
    this.#totals.title = comparable ? "" : messages.t("review", "metric.noComparison");
    this.#totals.classList.toggle("spiral-day-review__overrun", summary.compared > 0 && summary.varianceMinutes > 0);
    const writableDate = dateValue(review.displayedDate) === dateValue(this.#actions.today());
    const emptyMessage = review.availability === "missing-note" ? "state.missingNote"
      : review.availability === "missing-plan" ? "state.missingPlan"
      : review.availability === "invalid-plan" ? "state.invalidPlan" : "state.empty";
    this.#status.textContent = input.error ? messages.t("review", "action.failed")
      : pending || execution.status === "working" ? messages.t("review", "state.working")
      : !enabled ? messages.t("review", "state.stale")
      : !hasRows ? messages.t("review", emptyMessage)
      : !writableDate ? messages.t("review", "state.readOnlyDate") : "";
    this.#status.hidden = this.#status.textContent === "";
    const projectedRows = hasRows ? review.projection.rows : [];
    const retained = new Set(projectedRows.map((row) => row.task.key));
    let fallbackIndex: number | undefined;
    for (const [key, row] of this.#rows) {
      if (retained.has(key)) continue;
      if (row.contains(this.#root.ownerDocument.activeElement)) {
        fallbackIndex = Array.from(this.#list.children).indexOf(row.element);
      }
      row.element.remove();
      this.#rows.delete(key);
    }
    const orderedRows: ReviewRowView[] = [];
    projectedRows.forEach((row, index) => {
      let view = this.#rows.get(row.task.key);
      if (!view) {
        view = new ReviewRowView(this.#root.ownerDocument, (action) => this.#actions.activate(row.task.key, action));
        this.#rows.set(row.task.key, view);
      }
      if (view.update(row, messages, enabled, writableDate, execution.focused?.ownerId)) fallbackIndex ??= index;
      const current = this.#list.children[index];
      if (current !== view.element) this.#list.insertBefore(view.element, current ?? null);
      orderedRows.push(view);
    });
    if (fallbackIndex !== undefined && !this.#focusRow(orderedRows, fallbackIndex)) this.#focusToolbar();
  }

  #focusRow(rows: readonly ReviewRowView[], preferredIndex: number): boolean {
    for (let offset = 0; offset < rows.length; offset += 1) {
      if (rows[preferredIndex + offset]?.focusSource()) return true;
      if (offset > 0 && rows[preferredIndex - offset]?.focusSource()) return true;
    }
    return false;
  }

  #focusToolbar(): void {
    const fallback = this.#refresh.disabled ? this.#date : this.#refresh;
    fallback.focus({ preventScroll: true });
  }

  #selectDate(date: LogicalDate | null): void {
    this.#selectedDate = date ?? this.#actions.today();
    this.#date.value = dateValue(this.#selectedDate);
    this.#actions.selectDate(date);
  }

  #moveDate(offset: number): void {
    const shifted = new Date(0);
    shifted.setUTCFullYear(this.#selectedDate.year, this.#selectedDate.month - 1, this.#selectedDate.day + offset);
    this.#selectDate({ year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1, day: shifted.getUTCDate() });
  }

  destroy(): void {
    this.#rows.clear();
    this.#root.replaceChildren();
    this.#root.classList.remove("spiral-day-review");
  }
}
