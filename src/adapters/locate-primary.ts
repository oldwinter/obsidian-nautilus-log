export function locatePrimaryPath(
  confirmedSourcePath: string | undefined,
  resolvedTodayPath: string | null,
): string | null {
  return confirmedSourcePath ?? resolvedTodayPath;
}

export function primaryNavigationMessageKey(
  code: string,
): "error.noPrimary" | "error.missingDailyNote" | "error.noBlockId" | "notice.sourceUnavailable" {
  if (code === "primary-plan-missing") return "error.noPrimary";
  if (code === "primary-source-missing") return "error.missingDailyNote";
  if (code === "no-block-id") return "error.noBlockId";
  return "notice.sourceUnavailable";
}
