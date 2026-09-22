import type { LogicalDate } from "../../core/day";
import type { ReviewCoordinatorSnapshot } from "../../runtime/review/coordinator";
import type { ExecutionApplicationSnapshot } from "../../runtime/execution/application";
import { appendCopySampleAction } from "../onboarding/first-run";
import { ReviewRowView, reviewDuration, reviewVariance, type ReviewMessages, type ReviewRowAction } from "./review-row";

export type ReviewSortOrder = "source" | "actual" | "variance";

export interface ReviewViewActions {
  readonly today: () => LogicalDate;
  readonly selectDate: (date: LogicalDate | null) => void;
  readonly refresh: () => void;
  readonly setOnlyOverruns: (value: boolean) => void;
  readonly setSortOrder: (value: ReviewSortOrder) => void;
  readonly activate: (key: string, action: ReviewRowAction) => void;
  readonly insertPrimaryPlan?: () => void | Promise<void>;
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
  readonly #onlyOverruns: HTMLInputElement;
  readonly #filterLabel: HTMLElement;
  readonly #sort: HTMLSelectElement;
  readonly #sortLabel: HTMLElement;
  readonly #sortOptions: readonly { readonly value: ReviewSortOrder; readonly element: HTMLOptionElement }[];
  readonly #filterStatus: HTMLElement;
  readonly #status: HTMLElement;
  readonly #guidance: HTMLElement;
  #guidanceKey = "";
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
    const filter = document.createElement("label");
    filter.className = "spiral-day-review__filter";
    this.#onlyOverruns = document.createElement("input");
    this.#onlyOverruns.type = "checkbox";
    this.#onlyOverruns.addEventListener("change", () => actions.setOnlyOverruns(this.#onlyOverruns.checked));
    this.#filterLabel = document.createElement("span");
    filter.append(this.#onlyOverruns, this.#filterLabel);
    const sort = document.createElement("label");
    sort.className = "spiral-day-review__sort";
    this.#sortLabel = document.createElement("span");
    this.#sort = document.createElement("select");
    this.#sortOptions = (["source", "actual", "variance"] as const).map((value) => {
      const element = document.createElement("option");
      element.value = value;
      this.#sort.append(element);
      return { value, element };
    });
    this.#sort.addEventListener("change", () => {
      const value = this.#sort.value;
      if (value === "source" || value === "actual" || value === "variance") actions.setSortOrder(value);
    });
    sort.append(this.#sortLabel, this.#sort);
    this.#filterStatus = document.createElement("p");
    this.#filterStatus.className = "spiral-day-review__filter-status";
    this.#filterStatus.setAttribute("role", "status");
    this.#filterStatus.setAttribute("aria-live", "polite");
    this.#filterStatus.hidden = true;
    this.#status = document.createElement("p");
    this.#status.className = "spiral-day-review__status";
    this.#status.setAttribute("role", "status");
    this.#status.setAttribute("aria-live", "polite");
    this.#guidance = document.createElement("div");
    this.#guidance.className = "spiral-day-review__guidance";
    this.#guidance.hidden = true;
    this.#summary = document.createElement("div");
    this.#summary.className = "spiral-day-review__summary";
    this.#counts = document.createElement("p");
    this.#totals = document.createElement("p");
    this.#summary.append(this.#counts, this.#totals);
    this.#list = document.createElement("ul");
    this.#list.className = "spiral-day-review__list";
    root.classList.add("spiral-day-review");
    root.replaceChildren(toolbar, filter, sort, this.#status, this.#guidance, this.#summary, this.#filterStatus, this.#list);
  }

  render(input: {
    readonly review: ReviewCoordinatorSnapshot;
    readonly execution: ExecutionApplicationSnapshot;
    readonly messages: ReviewMessages;
    readonly pending: boolean;
    readonly error: boolean;
    readonly onlyOverruns: boolean;
    readonly sortOrder: ReviewSortOrder;
  }): void {
    const { review, execution, messages, pending } = input;
    this.#previous.textContent = "‹";
    this.#previous.setAttribute("aria-label", messages.t("review", "date.previous"));
    this.#next.textContent = "›";
    this.#next.setAttribute("aria-label", messages.t("review", "date.next"));
    this.#date.setAttribute("aria-label", messages.t("review", "date.label"));
    this.#today.textContent = messages.t("review", "date.today");
    this.#refresh.textContent = messages.t("review", "action.refresh");
    this.#filterLabel.textContent = messages.t("review", "filter.overruns");
    this.#onlyOverruns.checked = input.onlyOverruns;
    this.#sortLabel.textContent = messages.t("review", "sort.label");
    for (const option of this.#sortOptions) {
      const label = messages.t("review", `sort.${option.value}`);
      if (option.element.textContent !== label) option.element.textContent = label;
    }
    if (this.#sort.value !== input.sortOrder) this.#sort.value = input.sortOrder;
    this.#list.setAttribute("aria-label", messages.t("review", "list.label"));
    const reviewReady = review.state === "ready";
    const ready = reviewReady && (execution.status === "ready" || execution.status === "working");
    const hasRows = reviewReady && review.availability === "ready" && review.projection.rows.length > 0;
    const displayRows = ready && hasRows;
    const sortFocused = this.#root.ownerDocument.activeElement === this.#sort;
    this.#sort.disabled = !displayRows;
    this.#filterStatus.hidden = !displayRows || !input.onlyOverruns;
    this.#root.setAttribute("aria-busy", String(pending || review.state === "building"));
    this.#refresh.disabled = pending || review.state === "building";
    if (!displayRows && sortFocused) this.#focusToolbar();
    if (!displayRows && this.#list.contains(this.#root.ownerDocument.activeElement)) this.#focusToolbar();
    this.#summary.hidden = !displayRows;
    this.#list.hidden = !displayRows;
    if (!ready) {
      for (const row of this.#rows.values()) row.disable();
      this.#status.textContent = messages.t("review", review.state === "unavailable"
        ? review.reason === "history-over-limit" ? "state.overLimit" : "state.unavailable"
        : review.state === "ready" ? "state.stale" : "state.loading");
      this.#status.hidden = false;
      this.#setInsertGuidance(false, false, "", messages, pending);
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
      : review.availability === "invalid-plan" ? "state.invalidPlan"
      : writableDate ? "state.emptyPlan" : "state.empty";
    this.#status.textContent = input.error ? messages.t("review", "action.failed")
      : pending || execution.status === "working" ? messages.t("review", "state.working")
      : !enabled ? messages.t("review", "state.stale")
      : !hasRows ? messages.t("review", emptyMessage)
      : !writableDate ? messages.t("review", "state.readOnlyDate") : "";
    this.#status.hidden = this.#status.textContent === "";
    const showInsert = Boolean(this.#actions.insertPrimaryPlan)
      && writableDate
      && !hasRows
      && !input.error
      && (review.availability === "missing-plan" || review.availability === "missing-note");
    const showCopySample = writableDate
      && !hasRows
      && !input.error
      && review.availability === "ready";
    this.#setInsertGuidance(
      showInsert,
      showCopySample,
      `${review.availability}:${messages.locale}:${showInsert ? "insert" : showCopySample ? "sample" : ""}`,
      messages,
      pending,
    );
    const projectedRows = hasRows ? review.projection.rows.filter((row) => !input.onlyOverruns
      || (row.state === "compared" && (row.varianceMinutes ?? 0) > 0)) : [];
    if (input.sortOrder !== "source") {
      const metric = input.sortOrder === "actual" ? "actualMinutes" : "varianceMinutes";
      projectedRows.sort((left, right) => {
        const a = left[metric];
        const b = right[metric];
        if (a == null) return b == null ? 0 : 1;
        if (b == null) return -1;
        return b - a;
      });
    }
    const filterStatus = messages.t("review", "filter.result", { count: projectedRows.length });
    if (this.#filterStatus.textContent !== filterStatus) this.#filterStatus.textContent = filterStatus;
    this.#list.hidden = !displayRows || projectedRows.length === 0;
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
    const active = this.#root.ownerDocument.activeElement;
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
    else if (fallbackIndex === undefined && active instanceof HTMLElement && this.#list.contains(active)
      && this.#root.ownerDocument.activeElement !== active) active.focus({ preventScroll: true });
  }

  #setInsertGuidance(
    insertVisible: boolean,
    copySampleVisible: boolean,
    key: string,
    messages: ReviewMessages,
    pending: boolean,
  ): void {
    const visible = insertVisible || copySampleVisible;
    const guidanceKey = visible ? key : "";
    if (this.#guidanceKey !== guidanceKey) {
      this.#guidanceKey = guidanceKey;
      this.#guidance.replaceChildren();
      if (insertVisible) {
        const insert = this.#root.ownerDocument.createElement("button");
        insert.type = "button";
        insert.className = "spiral-day-review__insert-plan";
        insert.textContent = messages.t("planner", "status.missingInsert");
        insert.addEventListener("click", () => {
          if (insert.disabled) return;
          void this.#actions.insertPrimaryPlan?.();
        });
        this.#guidance.append(insert);
      } else if (copySampleVisible) {
        appendCopySampleAction(this.#guidance, messages);
      }
    }
    this.#guidance.hidden = !visible;
    const insert = this.#guidance.querySelector(".spiral-day-review__insert-plan");
    if (insert instanceof HTMLButtonElement) insert.disabled = pending;
  }

  #focusRow(rows: readonly ReviewRowView[], preferredIndex: number): boolean {
    for (let offset = 0; offset < rows.length; offset += 1) {
      if (rows[preferredIndex + offset]?.focusSource()) return true;
      if (offset > 0 && rows[preferredIndex - offset]?.focusSource()) return true;
    }
    return false;
  }

  #focusToolbar(): void {
    const fallback = this.#onlyOverruns.checked ? this.#onlyOverruns
      : this.#refresh.disabled ? this.#date : this.#refresh;
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
