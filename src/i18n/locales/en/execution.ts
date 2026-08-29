import type { MessageFunction } from "../../types";

export type ExecutionCatalog = Readonly<{
  "surface.name": string;
  "surface.identity": string;
  "tab.timing": string;
  "tab.plan": string;
  "tab.review": string;
  "action.clockIn": string;
  "action.clockOut": string;
  "action.complete": string;
  "action.deleteClock": string;
  "action.openSource": string;
  "action.openActiveTask": string;
  "action.stopPomo": string;
  "action.startPomo": string;
  "action.retry": string;
  "action.showDetails": string;
  "action.hideDetails": string;
  "timing.idle": string;
  "timing.noActive": string;
  "timing.active": string;
  "timing.forgotten": string;
  "timing.pomo": string;
  "timing.recent": string;
  "timing.noRecent": string;
  "timing.deleteConfirm": string;
  "timing.pending": string;
  "plan.scheduled": string;
  "plan.unscheduled": string;
  "plan.noPrimary": string;
  "plan.noTasks": string;
  "plan.loading": string;
  "plan.unavailable": string;
  "plan.capacity": string;
  "plan.range": MessageFunction<{ start: string; end: string }>;
  "plan.unscheduledSummary": MessageFunction<{ count: number; duration: string }>;
  "plan.remaining": MessageFunction<{ remaining: string; planned: string }>;
  "review.pending": string;
  "review.empty": string;
  "active.title": string;
  "active.unavailable": string;
  "active.unavailableDetail": string;
  "active.elapsed": string;
  "active.keyboardHint": string;
  "status.ready": string;
  "status.working": string;
  "status.stale": string;
  "status.degraded": string;
  "settings.title": string;
  "settings.language": string;
  "settings.chartStart": string;
  "settings.chartEnd": string;
  "settings.componentPrefix": string;
  "settings.legendLength": string;
  "settings.defaultDuration": string;
  "settings.urgentTrigger": string;
  "settings.executionEnabled": string;
  "settings.executionEnabledDesc": string;
  "settings.keepTimingFirst": string;
  "settings.pomoThreshold": string;
  "settings.recentRetention": string;
  "settings.forgottenWarning": string;
  "settings.dailyNoteFolder": string;
  "settings.dailyNoteFormat": string;
  "notice.applied": string;
  "notice.alreadyApplied": string;
  "notice.failed": string;
  "notice.sourceUnavailable": string;
  "error.refresh": string;
  "error.unconfirmed": string;
  "error.executionInactive": string;
  "error.overlap": string;
  "error.taskOwner": string;
  "error.deleteTiming": string;
  "error.deleteRunning": string;
  "error.completeTask": string;
  "error.queryUnavailable": string;
  "error.unreadableGraph": string;
  "error.createUnavailable": string;
  "error.updateUnavailable": string;
  "error.deleteUid": string;
  "error.deleteUnavailable": string;
  "error.deleteUnconfirmed": string;
  "error.drawerUnconfirmed": string;
  "error.clockInUnconfirmed": string;
  "error.clockOutUnreadable": string;
  "error.clockOutUnconfirmed": string;
  "error.completeUnconfirmed": string;
  "error.focusTodo": string;
  "error.commandsUnavailable": string;
  "error.generic": string;
  "error.noPrimary": string;
  "error.navigationUnavailable": string;
  "error.noBlockId": string;
  "error.sidebarUnavailable": string;
  "error.sidebarOrder": string;
  "error.sidebarOpen": string;
  "error.sidebarAfterStart": string;
  "error.writerConflict": string;
}>;

export const enExecution: ExecutionCatalog = Object.freeze({
  "surface.name": "Execution",
  "surface.identity": "unresolve · Nautilus",
  "tab.timing": "Timing",
  "tab.plan": "Plan",
  "tab.review": "Review",
  "action.clockIn": "Clock in",
  "action.clockOut": "Clock out",
  "action.complete": "Complete",
  "action.deleteClock": "Delete current CLOCK",
  "action.openSource": "Open source",
  "action.openActiveTask": "Open active task",
  "action.stopPomo": "Stop POMO",
  "action.startPomo": "Start POMO",
  "action.retry": "Try again",
  "action.showDetails": "Show details",
  "action.hideDetails": "Hide details",
  "timing.idle": "Idle",
  "timing.noActive": "No task is being timed.",
  "timing.active": "Current task",
  "timing.forgotten": "This CLOCK may have been left running.",
  "timing.pomo": "POMO",
  "timing.recent": "Recent",
  "timing.noRecent": "No recently timed tasks.",
  "timing.deleteConfirm": "Activate again to delete this CLOCK.",
  "timing.pending": "Confirming change",
  "plan.scheduled": "Scheduled",
  "plan.unscheduled": "Unscheduled today",
  "plan.noPrimary": "No Primary Nautilus Log was found today.",
  "plan.noTasks": "No unfinished direct tasks are available.",
  "plan.loading": "Refreshing today's plan.",
  "plan.unavailable": "Today's plan is unavailable.",
  "plan.capacity": "Capacity",
  "plan.range": ({ start, end }) => `${start}–${end}`,
  "plan.unscheduledSummary": ({ count, duration }) => `${count} · ${duration}`,
  "plan.remaining": ({ remaining, planned }) => `${remaining} remaining · ${planned} planned`,
  "review.pending": "Review is being prepared.",
  "review.empty": "No Review tasks for today.",
  "active.title": "Active Task",
  "active.unavailable": "Active task unavailable",
  "active.unavailableDetail": "The current task could not be confirmed. Source navigation is disabled.",
  "active.elapsed": "Elapsed",
  "active.keyboardHint": "Press Enter to open the source task.",
  "status.ready": "Ready",
  "status.working": "Working",
  "status.stale": "Refreshing",
  "status.degraded": "Timing unavailable",
  "settings.title": "Spiral Day",
  "settings.language": "Language",
  "settings.chartStart": "Chart start",
  "settings.chartEnd": "Chart end",
  "settings.componentPrefix": "Component prefix",
  "settings.legendLength": "Legend maximum length",
  "settings.defaultDuration": "Default task duration",
  "settings.urgentTrigger": "Urgent trigger word",
  "settings.executionEnabled": "Execution Layer",
  "settings.executionEnabledDesc": "Enable CLOCK tracking, POMO, commands, and execution surfaces.",
  "settings.keepTimingFirst": "Keep Timing Line first in the right sidebar",
  "settings.pomoThreshold": "Pomodoro threshold",
  "settings.recentRetention": "Recent retention minutes",
  "settings.forgottenWarning": "Forgotten timer minutes",
  "settings.dailyNoteFolder": "Daily Note folder",
  "settings.dailyNoteFormat": "Daily Note date format",
  "notice.applied": "Change confirmed.",
  "notice.alreadyApplied": "Already up to date.",
  "notice.failed": "The change was not applied.",
  "notice.sourceUnavailable": "Source navigation is unavailable.",
  "error.refresh": "Timing data could not be refreshed.",
  "error.unconfirmed": "The graph change could not be confirmed.",
  "error.executionInactive": "Actual Time Tracking is no longer active.",
  "error.overlap": "Legacy overlapping CLOCK records could not be reconciled.",
  "error.taskOwner": "Only an unfinished TODO can own the Timing Line.",
  "error.deleteTiming": "Only the current Timing CLOCK can be deleted.",
  "error.deleteRunning": "Only the current running CLOCK can be deleted.",
  "error.completeTask": "Only unfinished TODO tasks can be completed.",
  "error.queryUnavailable": "Roam graph query is unavailable.",
  "error.unreadableGraph": "Roam returned an unreadable graph result.",
  "error.createUnavailable": "Roam block creation is unavailable.",
  "error.updateUnavailable": "Roam block update is unavailable.",
  "error.deleteUid": "A block UID is required for deletion.",
  "error.deleteUnavailable": "Roam block deletion is unavailable.",
  "error.deleteUnconfirmed": "Roam could not confirm the block deletion.",
  "error.drawerUnconfirmed": "LOGBOOK drawer creation could not be confirmed.",
  "error.clockInUnconfirmed": "Clock In could not be confirmed.",
  "error.clockOutUnreadable": "Clock Out could not read the current CLOCK block.",
  "error.clockOutUnconfirmed": "Clock Out could not be confirmed.",
  "error.completeUnconfirmed": "Task completion could not be confirmed.",
  "error.focusTodo": "Focus an unfinished TODO block before starting timing.",
  "error.commandsUnavailable": "Roam command-palette actions are unavailable.",
  "error.generic": "Nautilus Log could not complete that action.",
  "error.noPrimary": "No Primary Nautilus Log was found today.",
  "error.navigationUnavailable": "Roam main-window navigation is unavailable.",
  "error.noBlockId": "This task has no block UID.",
  "error.sidebarUnavailable": "Roam right-sidebar block windows are unavailable.",
  "error.sidebarOrder": "Roam could not move the Timing Line sidebar window to the top.",
  "error.sidebarOpen": "Could not open this task in the right sidebar.",
  "error.sidebarAfterStart": "The task started, but Roam could not show it at the top of the right sidebar.",
  "error.writerConflict": "Disable Roam Logbook before enabling Nautilus Log Actual Time Tracking. Only one extension may write CLOCK records.",
});
