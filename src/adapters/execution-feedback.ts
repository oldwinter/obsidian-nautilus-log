import type { ExecutionCatalog } from "../i18n/locales/en/execution";
import type { ExecutionRuntimeCode } from "../runtime/execution/commands";

export type ExecutionFeedbackKey = keyof ExecutionCatalog;

const CODE_TO_MESSAGE: Readonly<Partial<Record<
  ExecutionRuntimeCode | "focused-task-unavailable",
  ExecutionFeedbackKey
>>> = Object.freeze({
  "action-no-longer-applicable": "error.taskOwner",
  "ambiguous-local-time": "error.unconfirmed",
  "anonymous-source-changed": "error.unconfirmed",
  "clock-discontinuity": "error.refresh",
  "clock-has-attached-content": "error.unconfirmed",
  "clock-index-unavailable": "error.refresh",
  "clock-owner-invalid": "error.taskOwner",
  "execution-disabled": "error.executionInactive",
  "focused-task-unavailable": "notice.sourceUnavailable",
  "identity-collision": "error.unconfirmed",
  "intent-queue-over-limit": "error.refresh",
  "intent-mismatch": "error.generic",
  "logbook-ambiguous": "error.overlap",
  "multiple-running-clocks": "error.overlap",
  "nonexistent-local-time": "error.unconfirmed",
  "partial-switch": "error.unconfirmed",
  "plan-item-not-found": "error.taskOwner",
  "plugin-data-failed": "error.pluginData",
  "potential-running-clock": "error.overlap",
  "repair-confirmation-required": "error.unconfirmed",
  "runtime-not-started": "error.executionInactive",
  "runtime-stopping": "error.executionInactive",
  "source-conflict": "error.unconfirmed",
  "source-over-limit": "error.refresh",
  "stale-clock-session": "error.refresh",
  "time-review-required": "error.refresh",
  "write-failed-no-change": "error.unconfirmed",
  "write-invariant-broken": "error.unconfirmed",
  "write-outcome-uncertain": "error.unconfirmed",
});

export function executionFeedbackKey(code: string | undefined): ExecutionFeedbackKey | undefined {
  if (!code) return undefined;
  return CODE_TO_MESSAGE[code as ExecutionRuntimeCode | "focused-task-unavailable"];
}
