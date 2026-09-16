import { Notice } from "obsidian";
import type { ExecutionCommandOutcome } from "../runtime/execution/commands";
import type { ExecutionMessages } from "../ui/execution/shared-controls";
import { executionFeedbackKey } from "./execution-feedback";

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
    if (outcome.code === "already-idle") {
      return Object.freeze({
        message: messages.t("execution", "notice.clockOutIdle"),
        level: "warning",
        durationMs: 5_000,
      });
    }
    if (outcome.code === "already-focused") {
      return Object.freeze({
        message: messages.t("execution", "notice.clockInFocused"),
        level: "info",
        durationMs: 5_000,
      });
    }
    return Object.freeze({ message: messages.t("execution", "notice.alreadyApplied"), level: "info", durationMs: 3_000 });
  }
  const key = executionFeedbackKey(outcome.code);
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
