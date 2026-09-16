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
  "action.copyTaskLink": string;
  "action.openSource": string;
  "action.openActiveTask": string;
  "action.stopPomo": string;
  "action.startPomo": string;
  "action.retry": string;
  "action.showDetails": string;
  "action.hideDetails": string;
  "timing.idle": string;
  "timing.noActive": string;
  "timing.nextAction": string;
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
  "plan.noPrimaryDetail": string;
  "plan.noTasks": string;
  "plan.noUnscheduled": string;
  "plan.emptyReady": string;
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
  "settings.componentPrefixDesc": string;
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
  "settings.dailyNoteFolderDesc": string;
  "settings.dailyNoteFolderRejected": string;
  "settings.dailyNoteFormat": string;
  "settings.dailyNoteFormatDesc": string;
  "settings.dailyNoteFormatRejected": string;
  "settings.dailyNoteFormatHostIgnored": MessageFunction<{ format: string }>;
  "settings.onboardingTitle": string;
  "settings.onboardingDetail": string;
  "settings.onboardingExecution": string;
  "settings.onboardingExecutionOn": string;
  "notice.firstRun": string;
  "notice.firstRunExecution": string;
  "notice.applied": string;
  "notice.alreadyApplied": string;
  "notice.clockOutIdle": string;
  "notice.clockInFocused": string;
  "notice.refreshed": string;
  "notice.taskLinkCopied": string;
  "notice.failed": string;
  "notice.sourceUnavailable": string;
  "error.refresh": string;
  "error.copyTaskLink": string;
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
  "error.missingDailyNote": string;
  "error.navigationUnavailable": string;
  "error.noBlockId": string;
  "error.sidebarUnavailable": string;
  "error.sidebarOrder": string;
  "error.sidebarOpen": string;
  "error.sidebarAfterStart": string;
  "error.writerConflict": string;
  "command.focusCurrent": string;
  "command.clockOut": string;
  "command.locatePrimary": string;
  "menu.clockIn": string;
  "menu.clockOut": string;
}>;

export const enExecution: ExecutionCatalog = Object.freeze({
  "surface.name": "Execution",
  "surface.identity": "Spiral Day",
  "tab.timing": "Timing",
  "tab.plan": "Plan",
  "tab.review": "Review",
  "action.clockIn": "Clock in",
  "action.clockOut": "Clock out",
  "action.complete": "Complete",
  "action.deleteClock": "Delete current CLOCK",
  "action.copyTaskLink": "Copy task link",
  "action.openSource": "Open source",
  "action.openActiveTask": "Open active task",
  "action.stopPomo": "Stop POMO",
  "action.startPomo": "Start POMO",
  "action.retry": "Try again",
  "action.showDetails": "Show details",
  "action.hideDetails": "Hide details",
  "timing.idle": "Idle",
  "timing.noActive": "No task is being timed.",
  "timing.nextAction": "If there is no Primary Plan yet, use Insert into today's Daily Note on the Plan tab. If the list is empty or every task is done, use Copy sample task on the Plan tab. Otherwise clock in from the Plan tab on an open `- [ ]` flexible task, or right-click that task in the Daily Note. Standalone POMO can run when no CLOCK is active.",
  "timing.active": "Current task",
  "timing.forgotten": "This CLOCK may have been left running.",
  "timing.pomo": "POMO",
  "timing.recent": "Recent",
  "timing.noRecent": "No recently timed tasks.",
  "timing.deleteConfirm": "Activate again to delete this CLOCK.",
  "timing.pending": "Confirming change",
  "plan.scheduled": "Scheduled",
  "plan.unscheduled": "Unscheduled today",
  "plan.noPrimary": "No Primary Plan was found today.",
  "plan.noPrimaryDetail": "Use Insert into today's Daily Note, or add the Primary Plan markers to today's Daily Note and save. The next steps are listed below.",
  "plan.noTasks": "No unfinished direct tasks are available. Use Copy sample task and paste an open `- [ ]` flexible task between the markers, then save.",
  "plan.noUnscheduled": "Every open flexible task is already on the schedule.",
  "plan.emptyReady": "The Primary Plan has no list items yet. Use Copy sample task and paste a `- [ ]` task between the markers, then save.",
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
  "settings.componentPrefixDesc": "Stored compatibility value. It does not change Markdown grammar or Insert.",
  "settings.legendLength": "Legend maximum length",
  "settings.defaultDuration": "Default task duration",
  "settings.urgentTrigger": "Urgent trigger word",
  "settings.executionEnabled": "Execution Layer",
  "settings.executionEnabledDesc": "Enable CLOCK tracking, POMO, commands, and execution surfaces.",
  "settings.keepTimingFirst": "Keep Active Task first in the right sidebar",
  "settings.pomoThreshold": "Pomodoro threshold",
  "settings.recentRetention": "Recent retention minutes",
  "settings.forgottenWarning": "Forgotten timer minutes",
  "settings.dailyNoteFolder": "Daily Note folder",
  "settings.dailyNoteFolderDesc": "Vault-relative folder for today's Daily Note. Leave empty for the vault root. Must match the note Insert creates and Planner reads. Invalid folders are rejected and the field returns to the last accepted value.",
  "settings.dailyNoteFolderRejected": "That Daily Note folder is invalid. The last accepted folder was kept. Use a vault-relative folder, not .. or an absolute path.",
  "settings.dailyNoteFormat": "Daily Note date format",
  "settings.dailyNoteFormatDesc": "Date format for the Daily Note filename. Must include year, month, and day tokens. The plugin adds .md. Unsupported tokens such as dddd are rejected and the field returns to the last accepted format.",
  "settings.dailyNoteFormatRejected": "That Daily Note date format is invalid. The last accepted format was kept. Use year, month, and day tokens (YYYY, MM/M, DD/D). Weekday names such as dddd are not supported.",
  "settings.dailyNoteFormatHostIgnored": ({ format }) =>
    `Obsidian's Daily Notes format (${format}) was not copied because it uses unsupported tokens. Planner and Insert use the format below, not that host filename.`,
  "settings.onboardingTitle": "First-run checklist",
  "settings.onboardingDetail": "Planner reads only today's configured Daily Note and the nautilus-log:plan/v1 region. If you see No Primary Plan, click Insert into today's Daily Note. After a plan exists, this explanation stays and Insert hides.",
  "settings.onboardingExecution": "Enable Execution Layer below to open Timing, Plan, Review, command-palette actions, and the Active Task sidebar.",
  "settings.onboardingExecutionOn": "Execution Layer is on. Use the timer ribbon for Timing, Plan, and Review, and the right sidebar for the Active Task.",
  "notice.firstRun": "No Primary Plan yet. Use Insert into today's Daily Note in Planner or Settings, or paste the plan starter (markers plus a sample task).",
  "notice.firstRunExecution": "No Primary Plan yet. Use Insert into today's Daily Note in Planner, Settings, the Plan tab, or Review (today), or paste the plan starter (markers plus a sample task).",
  "notice.applied": "Change confirmed.",
  "notice.alreadyApplied": "Already up to date.",
  "notice.clockOutIdle": "No task is being timed. Clock In from the Plan tab.",
  "notice.clockInFocused": "This task is already being timed. Clock Out from the Plan tab when you stop.",
  "notice.refreshed": "Timing data refreshed.",
  "notice.taskLinkCopied": "Active task link copied.",
  "notice.failed": "The change was not applied.",
  "notice.sourceUnavailable": "Source navigation is unavailable.",
  "error.refresh": "Timing data could not be refreshed.",
  "error.copyTaskLink": "The active task link could not be copied.",
  "error.unconfirmed": "The graph change could not be confirmed.",
  "error.executionInactive": "Actual Time Tracking is no longer active.",
  "error.overlap": "Legacy overlapping CLOCK records could not be reconciled.",
  "error.taskOwner": "Only an open `- [ ]` flexible task can be clocked in. Use an eligible line, or Clock In from the Plan tab.",
  "error.deleteTiming": "Only the current Timing CLOCK can be deleted.",
  "error.deleteRunning": "Only the current running CLOCK can be deleted.",
  "error.completeTask": "Only an open `- [ ]` flexible task can be completed.",
  "error.queryUnavailable": "The workspace query is unavailable.",
  "error.unreadableGraph": "Obsidian returned an unreadable workspace result.",
  "error.createUnavailable": "Creating the Markdown block is unavailable.",
  "error.updateUnavailable": "Updating the Markdown block is unavailable.",
  "error.deleteUid": "A block UID is required for deletion.",
  "error.deleteUnavailable": "Deleting the Markdown block is unavailable.",
  "error.deleteUnconfirmed": "Obsidian could not confirm the block deletion.",
  "error.drawerUnconfirmed": "LOGBOOK drawer creation could not be confirmed.",
  "error.clockInUnconfirmed": "Clock In could not be confirmed.",
  "error.clockOutUnreadable": "Clock Out could not read the current CLOCK block.",
  "error.clockOutUnconfirmed": "Clock Out could not be confirmed.",
  "error.completeUnconfirmed": "Task completion could not be confirmed.",
  "error.focusTodo": "Open today's Daily Note and put the caret on an open `- [ ]` flexible task, or Clock In from the Plan tab.",
  "error.commandsUnavailable": "Obsidian command-palette actions are unavailable.",
  "error.generic": "Spiral Day could not complete that action.",
  "error.noPrimary": "No Primary Plan was found today. Use Insert into today's Daily Note, or check Daily Note folder and date format in Settings → Spiral Day.",
  "error.missingDailyNote": "Today's Daily Note does not exist yet. Use Insert into today's Daily Note in Planner, Settings, the Plan tab, or Review (today).",
  "error.navigationUnavailable": "Obsidian navigation is unavailable.",
  "error.noBlockId": "This task has no block ID yet. Clock In from the Plan tab to assign one, or use Locate Primary Plan to open today's Daily Note.",
  "error.sidebarUnavailable": "The Obsidian sidebar is unavailable.",
  "error.sidebarOrder": "Obsidian could not move the Active Task view to the top.",
  "error.sidebarOpen": "Could not open this task in the right sidebar.",
  "error.sidebarAfterStart": "The task started, but Obsidian could not show it at the top of the sidebar.",
  "error.writerConflict": "Disable another CLOCK writer before enabling Spiral Day Actual Time Tracking. Only one extension may write CLOCK records.",
  "command.focusCurrent": "Spiral Day: 1. Clock in current task",
  "command.clockOut": "Spiral Day: 2. Clock out current task",
  "command.locatePrimary": "Spiral Day: 3. Locate Primary Plan",
  "menu.clockIn": "Spiral Day: Clock in",
  "menu.clockOut": "Spiral Day: Clock out",
});
