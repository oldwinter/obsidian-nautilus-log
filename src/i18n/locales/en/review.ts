import type { MessageFunction } from "../../types";

export type ReviewCatalog = Readonly<{
  "date.label": string;
  "date.previous": string;
  "date.next": string;
  "date.today": string;
  "filter.overruns": string;
  "sort.label": string;
  "sort.source": string;
  "sort.actual": string;
  "sort.variance": string;
  "filter.result": MessageFunction<{ count: number }>;
  "summary.counts": MessageFunction<{ completed: number; total: number; compared: number }>;
  "metric.planned": string;
  "metric.actual": string;
  "metric.variance": string;
  "metric.noComparison": string;
  "state.not-started": string;
  "state.live": string;
  "state.paused": string;
  "state.not-tracked": string;
  "state.compared": string;
  "state.empty": string;
  "state.emptyPlan": string;
  "state.loading": string;
  "state.missingNote": string;
  "state.missingPlan": string;
  "state.invalidPlan": string;
  "state.readOnlyDate": string;
  "state.unavailable": string;
  "state.overLimit": string;
  "state.stale": string;
  "state.working": string;
  "state.malformed": string;
  "state.noTarget": string;
  "action.clockIn": string;
  "action.complete": string;
  "action.openSource": MessageFunction<{ title: string }>;
  "action.refresh": string;
  "action.failed": string;
  "list.label": string;
}>;

export const enReview: ReviewCatalog = Object.freeze({
  "date.label": "Review date",
  "date.previous": "Previous day",
  "date.next": "Next day",
  "date.today": "Today",
  "filter.overruns": "Only completed overruns",
  "sort.label": "Task order",
  "sort.source": "Note order",
  "sort.actual": "Most recorded time first",
  "sort.variance": "Largest variance first",
  "filter.result": ({ count }) => count === 0
    ? "No completed tasks exceeded their plan. The summary covers the whole day."
    : `Showing ${count} completed ${count === 1 ? "overrun" : "overruns"}. The summary covers the whole day.`,
  "summary.counts": ({ completed, total, compared }) => `${completed}/${total} completed · ${compared} compared`,
  "metric.planned": "Planned",
  "metric.actual": "Actual",
  "metric.variance": "Variance",
  "metric.noComparison": "No completed tasks with recorded time to compare.",
  "state.not-started": "Not started",
  "state.live": "Live",
  "state.paused": "Paused",
  "state.not-tracked": "Not tracked",
  "state.compared": "Compared",
  "state.empty": "No tasks to review on this date.",
  "state.emptyPlan": "No reviewable `- [ ]` or `- [x]` tasks today. Use Copy sample task and paste an open `- [ ]` flexible task between the markers, then save and refresh.",
  "state.loading": "Loading review…",
  "state.missingNote": "No Daily Note exists for this date. If this is today, use Insert into today's Daily Note. Or create the note that matches Settings → Daily Note folder and date format.",
  "state.missingPlan": "This Daily Note has no Primary Plan. If this is today, use Insert into today's Daily Note. Or add `<!-- nautilus-log:plan/v1 -->` and `<!-- /nautilus-log:plan -->` at column zero, then save.",
  "state.invalidPlan": "The Primary Plan markers are invalid. If this is today, use Locate Primary Plan to open the note. Repair the existing markers instead of inserting another pair.",
  "state.readOnlyDate": "Past and future dates are read-only. Choose Today to change tasks.",
  "state.unavailable": "Review history is unavailable. Refresh to try again.",
  "state.overLimit": "History exceeds the supported limit. No partial totals are shown.",
  "state.stale": "Waiting for confirmed timing data. Task actions are unavailable.",
  "state.working": "Saving changes…",
  "state.malformed": "Some timing records could not be read. Their time is excluded.",
  "state.noTarget": "This task cannot be identified safely. If this is today, use Locate Primary Plan to open the note. If the block ID is duplicated, keep it on exactly one item, then save and refresh.",
  "action.clockIn": "Clock in",
  "action.complete": "Complete",
  "action.openSource": ({ title }) => `Open source for ${title}`,
  "action.refresh": "Refresh review",
  "action.failed": "The action could not be confirmed. Refresh and try again.",
  "list.label": "Review tasks",
});
