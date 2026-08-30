import type { PlannerSummaryCopyOutcome } from "../ui/planner/summary";

export interface PlannerSummaryClipboard {
  writeText(value: string): Promise<void>;
}

export async function copyPlannerSummary(input: {
  readonly summary: string;
  readonly clipboard?: PlannerSummaryClipboard;
}): Promise<PlannerSummaryCopyOutcome> {
  const clipboard = input.clipboard ?? globalThis.navigator?.clipboard;
  if (!clipboard) return "failed";
  try {
    await clipboard.writeText(input.summary);
    return "copied";
  } catch {
    return "failed";
  }
}
