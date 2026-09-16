import { PLAN_CLOSE_MARKER, PLAN_OPEN_MARKER_V1 } from "../../workspace/plan-region";
import { ENGLISH_SAMPLE_FLEXIBLE_TASK } from "../../workspace/insert-primary-plan";

export const PRIMARY_PLAN_MARKERS = `${PLAN_OPEN_MARKER_V1}\n${PLAN_CLOSE_MARKER}`;

export const SAMPLE_FLEXIBLE_TASK = ENGLISH_SAMPLE_FLEXIBLE_TASK;

export interface PlanMissingCopy {
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
      | "status.missingNextSurfaces",
  ): string;
}

export interface PlanMissingActions {
  readonly onInsertPrimaryPlan?: () => void | Promise<void>;
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

export function renderPlanMissingGuidance(
  parent: HTMLElement,
  messages: PlanMissingCopy,
  actions: PlanMissingActions = {},
): void {
  const intro = create(parent.ownerDocument, "p", "spiral-day-onboarding__intro");
  intro.textContent = messages.t("planner", "status.missingDetail");
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
  const markers = create(parent.ownerDocument, "pre", "spiral-day-onboarding__markers");
  const code = create(parent.ownerDocument, "code");
  code.textContent = PRIMARY_PLAN_MARKERS;
  markers.append(code);
  const actionsRow = create(parent.ownerDocument, "div", "spiral-day-onboarding__actions");
  const copy = create(parent.ownerDocument, "button", "spiral-day-onboarding__copy");
  copy.type = "button";
  copy.textContent = messages.t("planner", "status.missingCopyMarkers");
  copy.addEventListener("click", () => {
    const clipboard = parent.ownerDocument.defaultView?.navigator?.clipboard;
    if (!clipboard?.writeText) {
      selectMarkers(code);
      copy.textContent = messages.t("planner", "status.missingCopyFailed");
      return;
    }
    void clipboard.writeText(PRIMARY_PLAN_MARKERS).then(() => {
      copy.textContent = messages.t("planner", "status.missingCopied");
    }).catch(() => {
      selectMarkers(code);
      copy.textContent = messages.t("planner", "status.missingCopyFailed");
    });
  });
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
