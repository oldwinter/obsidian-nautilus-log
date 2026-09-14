import { PLAN_CLOSE_MARKER, PLAN_OPEN_MARKER_V1 } from "../../workspace/plan-region";

export const PRIMARY_PLAN_MARKERS = `${PLAN_OPEN_MARKER_V1}\n${PLAN_CLOSE_MARKER}`;

export const SAMPLE_FLEXIBLE_TASK = "- [ ] Write the release note 45m";

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
      | "status.missingNextSurfaces",
  ): string;
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

export function renderPlanMissingGuidance(parent: HTMLElement, messages: PlanMissingCopy): void {
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
  const copy = create(parent.ownerDocument, "button", "spiral-day-onboarding__copy");
  copy.type = "button";
  copy.textContent = messages.t("planner", "status.missingCopyMarkers");
  copy.addEventListener("click", () => {
    const clipboard = parent.ownerDocument.defaultView?.navigator?.clipboard;
    if (!clipboard?.writeText) return;
    void clipboard.writeText(PRIMARY_PLAN_MARKERS).then(() => {
      copy.textContent = messages.t("planner", "status.missingCopied");
    }).catch(() => undefined);
  });
  const next = create(parent.ownerDocument, "p", "spiral-day-onboarding__next");
  next.textContent = messages.t("planner", "status.missingNextSurfaces");
  parent.append(intro, steps, markers, copy, next);
}
