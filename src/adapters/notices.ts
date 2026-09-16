import { Notice } from "obsidian";
import type { ExecutionCommandOutcome, ExecutionRuntimeCode } from "../runtime/execution/commands";
import type { ExecutionMessages } from "../ui/execution/shared-controls";

const CODE_TO_MESSAGE: Readonly<Partial<Record<
  ExecutionRuntimeCode,
  keyof import("../i18n/locales/en/execution").ExecutionCatalog
>>> = Object.freeze({
  "action-no-longer-applicable": "error.taskOwner",
  "ambiguous-local-time": "error.unconfirmed",
  "anonymous-source-changed": "error.unconfirmed",
  "clock-discontinuity": "error.refresh",
  "clock-has-attached-content": "error.unconfirmed",
  "clock-index-unavailable": "error.refresh",
  "clock-owner-invalid": "error.taskOwner",
  "execution-disabled": "error.executionInactive",
  "identity-collision": "error.unconfirmed",
  "intent-queue-over-limit": "error.refresh",
  "intent-mismatch": "error.generic",
  "logbook-ambiguous": "error.overlap",
  "multiple-running-clocks": "error.overlap",
  "nonexistent-local-time": "error.unconfirmed",
  "partial-switch": "error.unconfirmed",
  "plan-item-not-found": "error.taskOwner",
  "plugin-data-failed": "error.unconfirmed",
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

export function firstRunNoticeKey(
  executionEnabled: boolean,
): "notice.firstRun" | "notice.firstRunExecution" {
  return executionEnabled ? "notice.firstRunExecution" : "notice.firstRun";
}

export type NoticeLevel = "info" | "warning" | "danger";

export interface ExecutionNotice {
  readonly message: string;
  readonly level: NoticeLevel;
  readonly durationMs: number;
}

export function executionOutcomeNotice(
  outcome: ExecutionCommandOutcome,
  messages: ExecutionMessages,
): ExecutionNotice {
  if (outcome.outcome === "applied") {
    return Object.freeze({ message: messages.t("execution", "notice.applied"), level: "info", durationMs: 3_000 });
  }
  if (outcome.outcome === "already-applied") {
    return Object.freeze({ message: messages.t("execution", "notice.alreadyApplied"), level: "info", durationMs: 3_000 });
  }
  const key = outcome.code ? CODE_TO_MESSAGE[outcome.code] : undefined;
  return Object.freeze({
    message: messages.t("execution", key ?? "error.generic"),
    level: outcome.code === "write-outcome-uncertain" ? "danger" : "warning",
    durationMs: 5_000,
  });
}

export function showExecutionNotice(notice: ExecutionNotice): Notice {
  const instance = new Notice(notice.message, notice.durationMs);
  const element = instance.noticeEl;
  element.dataset.level = notice.level;
  element.classList.add("spiral-day-execution-notice");
  return instance;
}
