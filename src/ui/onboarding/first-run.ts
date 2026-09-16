import { PLAN_CLOSE_MARKER, PLAN_OPEN_MARKER_V1 } from "../../workspace/plan-region";
import { primaryPlanSeed, sampleFlexibleTask } from "../../workspace/insert-primary-plan";

export const PRIMARY_PLAN_MARKERS = `${PLAN_OPEN_MARKER_V1}\n${PLAN_CLOSE_MARKER}`;

export interface PlanMissingCopy {
  readonly locale: string;
  t(
    namespace: "planner",
    key:
      | "status.missingDetail"
      | "status.missingStepNote"
      | "status.missingStepMarkers"
      | "status.missingStepItems"
      | "status.missingStepRefresh"
      | "status.missingCopyMarkers"
      | "status.missingCopied"
      | "status.missingCopyFailed"
      | "status.missingInsert"
      | "status.missingInserted"
      | "status.missingInsertFailed"
      | "status.missingAlreadyPresent"
      | "status.missingInsertBlocked"
      | "status.missingInvalidPath"
      | "status.missingNextSurfaces"
      | "status.emptyPlan"
      | "status.emptyCopySample"
      | "status.emptyCopied"
      | "status.emptyCopyFailed",
  ): string;
}

export interface PlanMissingActions {
  readonly onInsertPrimaryPlan?: () => void | Promise<void>;
  readonly intro?: string;
}

function create<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  name: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(name);
  if (className) node.className = className;
  return node;
}

function selectMarkers(code: HTMLElement): void {
  const document = code.ownerDocument;
  const selection = document.defaultView?.getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(code);
  selection.removeAllRanges();
  selection.addRange(range);
}

function bindCopyText(
  button: HTMLButtonElement,
  host: HTMLElement,
  text: string,
  select: HTMLElement,
  copied: string,
  failed: string,
): void {
  button.addEventListener("click", () => {
    const clipboard = host.ownerDocument.defaultView?.navigator?.clipboard;
    if (!clipboard?.writeText) {
      selectMarkers(select);
      button.textContent = failed;
      return;
    }
    void clipboard.writeText(text).then(() => {
      button.textContent = copied;
    }).catch(() => {
      selectMarkers(select);
      button.textContent = failed;
    });
  });
}

export function appendCopySampleAction(
  parent: HTMLElement,
  messages: PlanMissingCopy,
): void {
  const sample = sampleFlexibleTask(messages.locale);
  const markers = create(parent.ownerDocument, "pre", "spiral-day-onboarding__markers");
  const code = create(parent.ownerDocument, "code");
  code.textContent = sample;
  markers.append(code);
  const actionsRow = create(parent.ownerDocument, "div", "spiral-day-onboarding__actions");
  const copy = create(parent.ownerDocument, "button", "spiral-day-onboarding__copy");
  copy.type = "button";
  copy.textContent = messages.t("planner", "status.emptyCopySample");
  bindCopyText(
    copy,
    parent,
    sample,
    code,
    messages.t("planner", "status.emptyCopied"),
    messages.t("planner", "status.emptyCopyFailed"),
  );
  actionsRow.append(copy);
  parent.append(markers, actionsRow);
}

export function renderEmptyPlanGuidance(
  parent: HTMLElement,
  messages: PlanMissingCopy,
): void {
  const intro = create(parent.ownerDocument, "p", "spiral-day-onboarding__intro");
  intro.textContent = messages.t("planner", "status.emptyPlan");
  parent.append(intro);
  appendCopySampleAction(parent, messages);
}

export function renderPlanMissingGuidance(
  parent: HTMLElement,
  messages: PlanMissingCopy,
  actions: PlanMissingActions = {},
): void {
  const intro = create(parent.ownerDocument, "p", "spiral-day-onboarding__intro");
  intro.textContent = actions.intro ?? messages.t("planner", "status.missingDetail");
  const steps = create(parent.ownerDocument, "ol", "spiral-day-onboarding__steps");
  for (const key of [
    "status.missingStepNote",
    "status.missingStepMarkers",
    "status.missingStepItems",
    "status.missingStepRefresh",
  ] as const) {
    const item = create(parent.ownerDocument, "li");
    item.textContent = messages.t("planner", key);
    steps.append(item);
  }
  const seed = primaryPlanSeed(messages.locale);
  const markers = create(parent.ownerDocument, "pre", "spiral-day-onboarding__markers");
  const code = create(parent.ownerDocument, "code");
  code.textContent = seed;
  markers.append(code);
  const actionsRow = create(parent.ownerDocument, "div", "spiral-day-onboarding__actions");
  const copy = create(parent.ownerDocument, "button", "spiral-day-onboarding__copy");
  copy.type = "button";
  copy.textContent = messages.t("planner", "status.missingCopyMarkers");
  bindCopyText(
    copy,
    parent,
    seed,
    code,
    messages.t("planner", "status.missingCopied"),
    messages.t("planner", "status.missingCopyFailed"),
  );
  actionsRow.append(copy);
  if (actions.onInsertPrimaryPlan) {
    const insert = create(parent.ownerDocument, "button", "spiral-day-onboarding__insert");
    insert.type = "button";
    insert.textContent = messages.t("planner", "status.missingInsert");
    insert.addEventListener("click", () => {
      if (insert.disabled) return;
      insert.disabled = true;
      void Promise.resolve(actions.onInsertPrimaryPlan?.()).catch(() => undefined).finally(() => {
        insert.disabled = false;
      });
    });
    actionsRow.append(insert);
  }
  const next = create(parent.ownerDocument, "p", "spiral-day-onboarding__next");
  next.textContent = messages.t("planner", "status.missingNextSurfaces");
  parent.append(intro, steps, markers, actionsRow, next);
}
