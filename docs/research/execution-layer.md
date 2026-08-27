# Nautilus Log v1.0.2 Execution Layer state machines

> Status: frozen upstream evidence. The [canonical implementation dossier](../implementation-dossier.md)
> records the accepted safety, persistence, recovery, and host adaptations.

## Research contract

- **Functional baseline:** upstream tag `v1.0.2`, commit
  `973a041aa2f59f3b05bf31db8187efbfea07017a`.
- **Supplementary drift snapshot:** upstream `main`, commit
  `08892f948c63e4cacd3fc1cc100a600dd38c21f8`. Nothing from that commit is
  included in the v1.0.2 contract unless explicitly labelled as drift.
- **Evidence:** upstream source, tests, user guide, changelog, and first-party
  design records at immutable commit URLs. Design records are treated as intent;
  executable source and tests win when they disagree.
- **Labels:** **Fact** means directly observed in the baseline. **Inference** is
  a consequence of the observed control flow that is not asserted by a test.
  **Unknown** means the baseline does not specify or enforce the behavior.

## Executive model

The optional Execution Layer is a single in-memory runtime with four kinds of
state:

1. a current-day Primary Plan projection;
2. parsed `LOGBOOK::` / `CLOCK:` entries and derived Timing/Review projections;
3. one task-bound Pomodoro cycle plus one mutually exclusive standalone POMO;
4. ephemeral UI state for the topbar, popover tabs, delete confirmation, and
   right-sidebar coordination.

The Roam graph is authoritative for tasks and CLOCK sessions. Roam extension
settings persist feature configuration and the two Pomodoro absolute start
times. Timing, Plan, and Review are projections, not separate databases.
[runtime snapshot][runtime-snapshot] [graph adapter][roam-queries]

The strongest implementation invariant is: **within one initialized runtime,
explicit mutations are serialized, every known parseable running CLOCK is
closed before a new one is created, and startup reduces known legacy overlaps
to the newest entry**. This is narrower than an absolute whole-graph invariant:
malformed records and unrelated CLOCKs created externally after startup can be
outside routine scoped reads. See [Limits of the invariant](#limits-of-the-invariant).

## Canonical runtime snapshot

| Field | Reachable values | Persistence | Meaning |
| --- | --- | --- | --- |
| `revision` | integer starting at 0 | memory only | Increments on every refresh and on entry to `working`; it is the structural UI invalidation token. |
| `status` | `loading`, `ready`, `working`, `error` | memory only | `loading` is the constructor state; `working` guards queued mutations; successful refresh publishes `ready`; failed refresh preserves previous data and publishes `error`. |
| `notice` | empty or error text | memory only | A failed mutation/refresh produces a visible popover notice. |
| `planSnapshot` | `null` or Primary Plan data plus execution capacity | memory only | Current day's page, first matching Nautilus component, direct tasks, review tasks, fixed events, and scheduler projection. |
| `entries` | parsed CLOCK entry array | memory only, rebuilt from graph | Valid entries known to the runtime, newest start first. |
| `activeWork` | focused entry, distinct recent entries, combined items/count | derived | Timing view model. |
| `dailyReview` | summary plus task rows | derived | Review view model. |
| `pomodoro` | `null` or `{startedAt: epochMs}` | `actual-time-pomodoro-state` | Task-bound continuous focus cycle. |
| `standalonePomodoro` | `null` or `{startedAt: epochMs}` | `standalone-pomodoro-state` | Standalone POMO, only projected when no CLOCK is focused. |
| `now` | `Date` | memory only | Updated every second; graph refresh is normally every 15 seconds. |

Source: [runtime constructor and refresh][runtime-snapshot], [structure key][core-structure].

## Execution Layer lifecycle

| From | Event and guard | Writes | To / visible result | Recovery and failure behavior |
| --- | --- | --- | --- | --- |
| Disabled | Extension loads with `actual-time-tracking !== true` | Default settings may be initialized | Disabled | No execution runtime, topbar, timer poller, commands, or CLOCK mutation handler is mounted. Historical chart rendering may still read existing CLOCK history. [index startup][index-lifecycle] [guide opt-in][guide-execution] |
| Disabled | User enables master switch | Setting `actual-time-tracking=true` first | Starting | Runtime performs a whole-graph CLOCK read, overlap reconciliation, DONE-clock reconciliation, initial refresh, timer setup, then mounts topbar and commands. [index enable][index-enable] [runtime initialize][runtime-initialize] |
| Starting | Legacy Roam Logbook DOM/global is detected | Toast only, then master setting rolled back to `false` | Disabled | Initialization throws before mounting. This check occurs only at initialization. [legacy guard][roam-legacy] [index rollback][index-enable] |
| Starting | Any runtime/topbar/command initialization error | Created controllers are destroyed; master setting rolled back to `false` | Disabled | Error is logged; no partial controller remains through the normal startup path. [index lifecycle][index-lifecycle] |
| Enabled | User disables master switch | Close known running CLOCKs; clear both Pomodoro setting keys; then `actual-time-tracking=false` | Disabled | If close/confirmation fails, the setting is restored to `true` and the execution surface remains enabled. [runtime disable][runtime-disable] [index disable rollback][index-enable] |
| Enabled | Extension unload | No graph rewrite; runtime/topbar/commands destroyed | Unmounted, graph CLOCK may remain running | Deliberately does not close an active CLOCK. A later load restores it from the graph. [index unload][index-unload] |
| Enabled | Refresh succeeds | No graph write | `ready` | Publishes a new revision and projections. [runtime refresh][runtime-refresh] |
| Enabled | Refresh fails | No graph write | `error` | Preserves the previous snapshot fields, changes status/notice/now, and publishes them. It never interprets read failure as an empty graph. [runtime refresh][runtime-refresh] |
| Enabled | Explicit action enters mutation queue | Depends on action | `working` then `ready`/`error` | Row action buttons are disabled while `working`, but cached rows are not rebuilt; errors cause an authoritative refresh and notice. [mutation queue][runtime-queue] [popover fast path][topbar-render] |

### Disabled subsettings

| Setting | Default | Disabled behavior |
| --- | --- | --- |
| `actual-time-tracking` | `false` | Hides all dependent execution settings and mounts no execution surface/writer. |
| `timing-line-sidebar` | `true` | When `false`, Clock In does not warm, open, add, expand, or reorder right-sidebar windows; CLOCK behavior is unchanged. |
| `pomodoro-minutes` | `45` | Select values are 15, 20, 25, 30, 45, 50, 60, 90. There is no supported disabled value. |
| `recent-retention-minutes` | `45` | `0` removes all Recent rows. |
| `forgotten-timer-minutes` | `120` | `0` disables the warning; it never stops or deletes a CLOCK. |

Source: [execution defaults][index-settings], [settings panel][index-panel],
[core numeric guards][core-active],
[guide settings][guide-settings].

## CLOCK and Timing state machine

### CLOCK record states

| State | Serialized graph form | Parser result | Projection behavior |
| --- | --- | --- | --- |
| No drawer | no matching task child | none | First Clock In creates `LOGBOOK::` at child order 0. |
| Drawer, no CLOCK | matching `LOGBOOK` label, no valid child | none | Clock In creates a CLOCK child at order 0. |
| Running | `CLOCK: [YYYY-MM-DD Ddd HH:MM]` | `{start, end:null, running:true, minutes:null}` | Eligible to become Focused; newest valid running entry wins. |
| Closed | `CLOCK: [start]--[end] => H:MM` | `{start,end,running:false,minutes:computed}` | Contributes to Actual and may appear as Recent. The parser recomputes minutes from timestamps and does not trust the displayed `=> H:MM`. |
| Malformed | invalid label, timestamp, reverse interval, or syntax | `null` | Silently filtered from entry reads; it is not repaired or counted. |

The parser accepts case-insensitive `CLOCK:`/`CLOCK::` with an optional leading
colon, accepts an optional weekday-like token, and accepts closed records without
the displayed duration. Timestamps are local-time `Date` values. The writer
always emits the canonical single-colon form and clamps a backwards end to the
start. [CLOCK parser/writer][core-clock] [entry normalization][roam-entries]

### User and system transitions

| From | Event and guard | Ordered effects | To | Failure behavior |
| --- | --- | --- | --- | --- |
| Idle | Clock In on a block whose current graph string is TODO | Optional sidebar intent starts first; ensure drawer; create and confirm running CLOCK; start task Pomodoro; refresh cached plan/entries | Focused | Non-TODO throws. Sidebar navigation may already be visible because it is deliberately independent/reversible. [start task][runtime-start] |
| Standalone POMO | Clock In valid TODO | Clear/persist standalone POMO `null` before any same-task early return; then normal Clock In | Focused | CLOCK is authoritative; stale standalone state cannot survive. [start task][runtime-start] |
| Focused task A | Clock In task A again | Clear stale standalone POMO if present; no graph mutation; cached refresh | Focused task A | No duplicate CLOCK is created. [start task][runtime-start] [runtime test][test-runtime-switch] |
| Focused task A | Clock In valid task B | Capture one `instant`; close and confirm every known running entry at that instant; create and confirm B CLOCK at the same instant; preserve the existing task Pomodoro `startedAt` | Focused task B; A may be Recent | If closing succeeds and creation fails, A stays closed and no success is claimed. There is no rollback/reopen. [start task][runtime-start] [runtime test][test-runtime-switch] |
| Focused | Clock Out | Re-read each known running CLOCK UID; if still open, update and confirm close; clear task Pomodoro; cached refresh; schedule idle authoritative refresh | Recent-only or Idle | If the current block became malformed/unreadable, action errors and refreshes. If already externally closed, it is accepted without another write. [stop task][runtime-stop] [close CLOCK][roam-close] |
| Idle | Global Clock Out | Clear stale task Pomodoro; no graph mutation; cached refresh plus idle authoritative refresh | Idle | Idempotent. [stop task][runtime-stop] |
| Focused task A | Complete A | At one instant close A's known running entries; replace TODO marker with canonical DONE and confirm; clear task Pomodoro; full refresh | A becomes DONE/Compared or Not tracked; no Focused | If close succeeds but completion fails, the task remains TODO and its CLOCK remains closed. No rollback. [finish task][runtime-finish] [complete task][roam-complete] |
| Focused task A | Complete another TODO B | No CLOCK close; replace B marker and confirm; refresh | A stays Focused; B becomes DONE | Completion is allowed only for a current graph string with TODO status. [finish task][runtime-finish] [complete task][roam-complete] |
| Focused task A | First trash click | No persistence | Delete-confirming for 2.5 seconds | Button becomes a destructive confirmation affordance. [delete UI][topbar-row] |
| Delete-confirming | Second click on same current CLOCK UID before timeout | Delete and confirm only that CLOCK block; clear task Pomodoro; refresh | Task remains TODO, no Focused | A changed/missing focus rejects the delete. The `LOGBOOK::` drawer is not removed. [delete runtime][runtime-delete] [delete graph][roam-delete] |
| Any | External task status becomes DONE and a 15-second refresh sees a running entry | Queue close for all running DONE entries at detection-time `now`; clear Pomodoro only if no focus remains | DONE entry closed | This is polling, not an immediate graph watcher in v1.0.2. [timer reconciliation][runtime-initialize] |
| Multiple valid running entries | Initialization | Sort newest start first; update every older CLOCK end to the newest start; locally verify exactly one remains running | Newest is Focused | Writes are sequential. A rejected write aborts startup; already-applied closes are not rolled back. [overlap recovery][runtime-reconcile] |
| Running DONE entries | Initialization | Close all known running entries at current `now`; clear task Pomodoro if none remains focused | No running DONE | Close uses direct read-after-write confirmation. [DONE recovery][runtime-reconcile] |
| Focused/Recent | Recent window expires or setting becomes 0 | No graph write | Row leaves Recent | Recent is one newest closed entry per distinct non-DONE task; the boundary is strict (`age < window`). [active work][core-active] |
| Focused | Forgotten threshold reached | No write and no stop | Still Focused, warning only | Trigger/row turns amber, shows warning icon and `Check CLOCK`; threshold 0 disables. [forgotten rule][core-active] [trigger feedback][topbar-trigger] |

### Timing projection

- Focused is the valid running entry with the latest start time. Entries whose
  task status is DONE are excluded before focus/recent derivation.
- Recent contains at most one latest closed entry per task, excludes the focused
  task and DONE tasks, and is sorted by latest end descending.
- The topbar active label shows the current CLOCK's elapsed time, the combined
  Focused+Recent Thread count, Pomodoro-threshold color, and forgotten warning.
- Timing rows show current elapsed plus Actual/Planned metadata; Recent rows show
  minutes left in the retention window. Titles open the task in the main window,
  or in the right sidebar with Shift+click.

Source: [active work rules][core-active], [Timing rows][topbar-row],
[trigger states][topbar-trigger].

## Proof of single-CLOCK and CLOCK-over-POMO precedence

### Single-CLOCK proof inside the runtime's known valid set

1. `mutationQueue` serializes all Clock In, Clock Out, Complete, Delete, POMO,
   and Disable operations; later actions begin after earlier actions settle.
   [queue][runtime-queue]
2. Clock In captures one timestamp, calls `closeEntriesAt(before, instant)`, and
   awaits every close before `createRunningClock(taskUid, instant, ...)`.
   [switch ordering][runtime-start]
3. Re-selecting the focused task returns before creation, so it cannot duplicate
   the current CLOCK. [same-task guard][runtime-start]
4. Startup performs a whole-graph read and reduces valid overlapping open
   records to the newest entry before publishing the initial snapshot.
   [startup recovery][runtime-initialize]
5. Both CLOCK creation and normal CLOCK close perform direct read-after-write
   confirmation on the affected UID. [create/close confirmation][roam-clock-write]

The runtime test proves close-before-switch, one remaining running record,
same-task idempotence, close-before-complete, and delete-current behavior.
[switch test][test-runtime-switch]

### CLOCK-over-POMO proof

There are two Pomodoro concepts:

| Concept | State key | Starts | Switch behavior | Stops | Graph effect |
| --- | --- | --- | --- | --- | --- |
| Task Pomodoro cycle | `actual-time-pomodoro-state` | First task CLOCK; if absent on reload, derives from focused CLOCK start | Preserves original `startedAt` across seamless task switches | Confirmed Clock Out, completing/deleting owned CLOCK, disabling, or recovery with no focus | None; only colors active elapsed after threshold |
| Standalone POMO | `standalone-pomodoro-state` | Header stopwatch only when no Focused CLOCK and no current standalone POMO | Repeated start preserves absolute `startedAt`; task switch is not applicable | Header close, Clock In, disabling | None; no graph read/write and no Review/spiral effect |

Source: [Pomodoro pure rules][core-pomodoro], [runtime restore][runtime-pomodoro],
[runtime POMO actions][runtime-standalone], [POMO test][test-runtime-pomo].

Both actions use the same mutation queue:

- If standalone POMO is dequeued first, it persists, then the queued Clock In
  clears it before creating the CLOCK.
- If Clock In is dequeued first, its confirmed entry is in the snapshot when
  standalone start runs; standalone start returns without changing state.
- A refresh projects standalone POMO only when there is no focused CLOCK and
  schedules awaited cleanup of stale persisted standalone state. A clear-in-flight
  promise prevents that cleanup from overwriting a later user start.

Therefore CLOCK wins either queue order. The first order and reload cleanup are
directly tested; the reverse-order result is an **Inference** from the serialized
queue plus the in-queue focus guard. [standalone guard][runtime-standalone]
[POMO tests][test-runtime-pomo]

Threshold crossing never stops task work or standalone POMO. Negative elapsed
values are clamped to zero by formatting/standalone calculations, but the system
uses wall-clock time rather than a monotonic clock. [CLOCK duration rules][core-elapsed]
[live elapsed rules][core-live-elapsed]

## Plan state and transitions

Plan is a deterministic projection of the current day's Primary Plan, not a
persisted mode.

| State | Guard | Visible content | Transition |
| --- | --- | --- | --- |
| Missing Primary Plan | Today's page tree has no matching component | `No Nautilus Log was found...`; no task sections | Appears on next refresh when a matching component exists. |
| Empty | Primary Plan exists but has no eligible unfinished direct-child tasks | `The Primary Plan has no unfinished direct-child tasks.` | Changes after graph refresh. |
| Scheduled | Scheduler places eligible task in a fitting gap | `Scheduled today`, projected start-end, Remaining/Planned metadata, section count and total | Recomputed from current time, fixed events, order, progress, and settings on refresh. |
| Unscheduled collapsed | Scheduler returns overflow tasks; local disclosure is closed | `Unscheduled today` header, count, duration | Click expands without graph access. |
| Unscheduled expanded | Same data, disclosure open | Overflow task rows | Click folds; closing popover resets disclosure to folded. |

Eligibility at v1.0.2 is an unfinished TODO direct child of the first matching
Nautilus component. Fixed events, DONE blocks, nested tasks, and plain blocks
are excluded. Direct block-reference strings are resolved for projection while
retaining the wrapper UID. Roam order is preserved. [plan projection][core-plan]
[Primary Plan read][roam-plan]

The execution capacity strip is shared across all three tabs. It always shows
Available plus exactly one of Remaining, Overload, or No fitting slot. Plan uses
the same scheduler core as the spiral, and progress is applied exactly once.
[execution projection][runtime-projection] [progress test][test-runtime-progress]

### Important v1.0.2 Plan/action mismatch

**Fact:** a direct child containing only `((sourceUid))` can be resolved into a
visible TODO Plan row, but Clock In and Complete subsequently re-read the wrapper
block string and require a TODO marker on that wrapper. A bare reference therefore
fails those actions in v1.0.2 even though it appears in Plan. This was changed on
post-tag `main`; it must not be silently treated as v1.0.2 behavior.
[reference projection][roam-plan] [Clock In guard][runtime-start]
[Complete guard][roam-complete] [main drift][main-changelog]

## Review state machine

Review includes every direct-child flexible TODO or DONE task in Roam order,
excluding fixed events and nested tasks. It joins that projection with the same
CLOCK snapshot already read by the runtime; selecting the Review tab issues no
new graph query. [review projection][core-plan] [review design][design-review]

| Row state | Exact guard | Actual shown | Variance | Reachable next states |
| --- | --- | --- | --- | --- |
| `not-started` | TODO and same-day Actual is 0 | `Actual -` | none | `live` after Clock In; `not-tracked` if completed without closed Actual |
| `live` | TODO, same-day Actual > 0, and at least one task entry is running | Running+closed same-day Actual through `now` | none | `paused` after Clock Out; `compared` after plugin Complete closes the CLOCK then marks DONE |
| `paused` | TODO, same-day Actual > 0, no running entry | Closed same-day Actual | none | `live` after Clock In; `compared` after Complete |
| `not-tracked` | DONE and positive closed same-day Actual is absent | `Actual -` | none | `compared` only if valid closed history later appears |
| `compared` | DONE and closed same-day Actual > 0 | Closed same-day Actual | `Actual - Planned` | `not-tracked` if valid history is removed; otherwise stable |

For DONE rows, open entries are excluded from the comparison. For TODO rows,
running time is included through `now`. The summary population is only
`compared` rows: Completed is DONE/all rows, Compared is compared count, Planned
and Actual are sums over compared rows, and Variance is Actual minus Planned.
The implementation floors once after summing milliseconds per task.
[Review classifier][core-review] [Review tests][test-core-review]

Actual is clipped to the local displayed/current day. In the Execution Layer,
the end boundary is `dayStart + 24h`; this is a DST limitation described below.
[Actual calculation][core-review]

The Review UI shows a two-line summary, state badge, Planned, Actual, and variance
only for comparable tasks. Positive variance receives muted warning emphasis;
live Actual text alone is updated on one-second ticks. Task title navigation uses
the same main-window/Shift+sidebar behavior as Timing and Plan.
[Review UI][topbar-review] [review CSS][css-review]

## Completed history and spiral synchronization

The spiral consumes the same parsed entry shape through a read-only bridge:

- while the execution runtime exists, the renderer reuses its entry snapshot;
- while tracking is disabled, it performs a task-scoped graph read and caches it
  for 15 seconds;
- read failure falls back to the previous cache or an empty list, so the chart
  falls back to Planned rather than failing.

Source: [renderer clock bridge][index-clock-bridge], [component bridge][component-clock-bridge].

For each DONE flexible task, only valid closed intervals overlapping the displayed
Daily Note date are summed. Multiple sessions remain separate in LOGBOOK but are
rendered as one contiguous historical slice. The slice uses Actual if positive,
otherwise Planned/default; it ends at explicit `dHH:MM` when present, otherwise
at the latest valid CLOCK end. Actual is not capped at Planned. No end anchor
means no fabricated historical slice. Open/malformed/out-of-day entries contribute
nothing. [history aggregation][log-history] [history tests][test-log-history]

This slice is a duration summary, not a claim of continuous work. Unfinished
tasks continue to schedule from Planned/remaining estimates; elapsed Actual does
not replace future demand. [history design][design-history]

## LOGBOOK graph contract and mutation inventory

### Accepted and emitted formats

| Object | Reader accepts | Writer emits |
| --- | --- | --- |
| Drawer | Case-insensitive `LOGBOOK`, optional leading colon, one/two trailing colons, limited enumerated leading/trailing padding (`''`, one space, two spaces, tab) | `LOGBOOK::` |
| Running CLOCK | Case-insensitive optional-leading-colon `CLOCK:`/`CLOCK::`, one valid bracketed local timestamp | `CLOCK: [YYYY-MM-DD Ddd HH:MM]` |
| Closed CLOCK | Valid start/end, end >= start; optional `=> H:MM` suffix | `CLOCK: [start]--[end] => H:MM` |
| TODO/DONE | `{{[[TODO]]}}`, `{{TODO}}`, `{{[[DONE]]}}`, or `{{DONE}}` for status parsing | Complete replaces the first TODO form with canonical `{{[[DONE]]}}` |

Source: [format grammar][core-clock], [drawer grammar/query][roam-drawers],
[completion writer][roam-complete].

### Graph reads

| Read | Frequency / scope | Purpose |
| --- | --- | --- |
| Today's full Daily Note block tree | Startup/refresh; normally every 15 seconds and on full action refresh | Select first Primary Plan in tree order, resolve direct references, project tasks/review/fixed events. |
| All LOGBOOK entries | Initialization only | Compatibility reconciliation and initial whole-graph overlap detection. |
| Entries for relevant task UIDs | Routine refresh | Review tasks plus task UIDs already running/recent in the prior snapshot. |
| One task block string | Clock In/Complete validation | Require current TODO status immediately before mutation. |
| One CLOCK block string | Clock Out | Revalidate exact known UID before update and again after update. |
| Task children | Drawer ensure | Reuse a matching drawer or confirm newly created drawer. |
| Right-sidebar windows | Warmup and each sidebar intent where host API permits | Dedupe/reorder only the selected block window. |

Source: [queries and reads][roam-queries], [refresh scoping][runtime-refresh],
[write helpers][roam-clock-write].

### Graph writes

| Trigger | Mutation | Read-after-write confirmation | Rollback |
| --- | --- | --- | --- |
| First Clock In for task | Create `LOGBOOK::` child at order 0 | Re-read children and match created UID/label | None; a create that succeeds but cannot be confirmed may leave a drawer. |
| Every new session | Create running CLOCK child at drawer order 0 | Pull exact UID and parse as running | None; an unconfirmed create may leave a block. |
| Clock Out/switch/disable/DONE reconciliation | Update exact CLOCK UID to closed canonical line | Pull exact UID and require parsed closed state | None. |
| Startup overlap reconciliation | Update each older open CLOCK end to newest start | **No graph re-read**; only local projected array is checked | None; partial closure is possible if a later write rejects. |
| Delete current CLOCK | Delete exact open CLOCK UID | Read exact UID and require absence | None; drawer remains. |
| Complete task | Update task string TODO -> DONE | Re-read task and require DONE status | None; a prior CLOCK close remains closed if completion fails. |

Source: [graph mutation helpers][roam-clock-write], [overlap recovery][runtime-reconcile],
[task completion][roam-complete].

## Settings and browser persistence inventory

The Execution Layer directly uses `extensionAPI.settings`; it does not directly
use `localStorage`, `sessionStorage`, or IndexedDB. The spiral's independent
per-render collapsed flag uses localStorage key
`nautilus-log:collapsed:v1:<blockUid>`, but that is not Timing/Plan/Review/POMO
state. [settings calls][runtime-pomodoro] [chart collapse storage][component-collapse]

| Key | Shape/default | Reads | Writes / recovery |
| --- | --- | --- | --- |
| `actual-time-tracking` | boolean, `false` | Startup and panel shape | Set true before enable; rolled back false on start failure. On disable, set false only after CLOCK close; restored true on failure. |
| `timing-line-sidebar` | boolean, `true` | Clock In and startup warmup | User setting only; disabling does not close an already open sidebar window. |
| `pomodoro-minutes` | number, `45` | Topbar threshold for task cycle and standalone POMO | User select only. |
| `recent-retention-minutes` | nonnegative integer, `45` | Every refresh | Numeric input; blank ignored, invalid becomes 45, negative clamps to 0. |
| `forgotten-timer-minutes` | nonnegative integer, `120` | Topbar/row tick | Numeric input; blank ignored, invalid becomes 120, negative clamps to 0. |
| `actual-time-pomodoro-state` | `null` or `{startedAt: epochMs}` | Every refresh/restore | First Clock In persists start; switches preserve it; stop/complete/delete/disable/no-focus recovery persist `null`. |
| `standalone-pomodoro-state` | `null` or `{startedAt: epochMs}` | Every refresh/restore | Standalone start persists; stop/Clock In/disable/focused recovery persist `null`. |
| `todo-duration` | number, `15` | Plan/review projection and row metadata | General plugin setting. |
| `workday-start`, `workday-end` | hours, `5`, `21` | Plan scheduler projection | General plugin settings. |
| `language` | `en` or `zh` | All execution copy | General plugin setting; settings event forces rerender. |

Source: [defaults][index-settings], [panel writes][index-panel],
[runtime setting state][runtime-pomodoro].

**Unknown:** the upstream source delegates these values to Roam's extension
settings API and does not specify whether their physical storage is graph-local,
account-local, or device-local. An Obsidian port must make that scope explicit.

## Right-sidebar projection state machine

Right-sidebar behavior is navigation feedback, not timing authority. It starts
before graph validation so the selected task can paint in the original click
stack. CLOCK success is still determined only by graph confirmation.
[sidebar intent][runtime-start] [sidebar implementation][roam-sidebar]

| State/condition | Transition | Result / guard |
| --- | --- | --- |
| Sidebar setting off | Clock In | No sidebar call; mutation starts immediately. |
| Startup, setting on | Deferred read-only `getWindows` warmup | Cache known block UIDs; does not open sidebar. A revision guard discards a slow stale warmup. |
| Target known in 45-minute memory cache | New intent | Preview `setWindowOrder(order:0)` and expand immediately if APIs exist; queued authoritative read still verifies. |
| Target exists in authoritative windows | Intent is still latest | Deduplicate; move to order 0 if possible; expand; preserve all unrelated windows. |
| Target absent | Intent is still latest | Open sidebar asynchronously and issue `addWindow` at order 0 without waiting for open animation. |
| First add fails while opening | Intent is still latest | Await open; re-read; if partially added, reorder/expand it; otherwise retry add. This avoids a duplicate. |
| Older rapid intent | A later intent increments global sequence | Older operation returns `skipped: superseded` before mutation where guards are reached. |
| Window-list read unavailable/malformed | Cache has recent target | Best-effort reorder/expand from cache; otherwise add. |
| Cannot move existing nonzero-order window because `setWindowOrder` absent | Existing target | Return visible failure; do not duplicate it. |
| Any terminal adapter error | Catch | Return structured failure; runtime shows a toast but timing mutation remains independent. |

Per-sidebar operations are serialized through a WeakMap promise queue. Known
windows and cache revisions are memory-only WeakMaps; target hints expire after
45 minutes. [sidebar queues/cache][roam-sidebar-cache] [sidebar fallback][roam-sidebar]

Task title clicks use main-window navigation by default and the same sidebar
fronting routine on Shift+click. Locate Primary Plan opens the plan in the main
window, scrolls it to center after 80 ms, highlights it for 1.2 seconds, and
closes the popover. [navigation helpers][roam-navigation] [topbar navigation][topbar-render]

## Popover and visible UI states

| Surface state | Visible feedback | Persistence |
| --- | --- | --- |
| Idle trigger | Blueprint `unresolve` icon | none |
| CLOCK trigger | elapsed, separator, and `N Thread(s)`; elapsed red after Pomodoro threshold | derived each second |
| Forgotten CLOCK | Amber trigger/row, warning icon, `Check CLOCK` | derived each second; no write |
| Standalone POMO | elapsed, separator, and `POMO` plus separate close control; overdue text red | absolute start in settings |
| Popover closed/open | Trigger `aria-expanded`; dialog is positioned 260-420 px wide | open state memory only |
| Tab | `Timing`, `Plan`, `Review`; default `Timing` | `view` survives popover close within the controller lifetime, but not reload |
| Working | Existing rows remain; action buttons disabled, quiet cursor | snapshot only |
| Error/notice | Amber status strip above capacity/list | snapshot until next refresh/action |
| Delete confirmation | Trash button red/confirming for 2.5 seconds | timer only; cleared on close/rerender/destroy |
| Unscheduled disclosure | Folded by default; local toggle | resets folded when popover closes |

Opening paints the last confirmed cached snapshot synchronously, then requests a
deduplicated graph refresh after a browser paint. A stable structural key excludes
`now`, so one-second ticks update only trigger/live text rather than rebuilding
Timing/Plan/Review lists. Tab changes never read the graph. [popover lifecycle][topbar-popover]
[structure key test][test-core-structure]

The topbar controller watches for Roam topbar replacement and remounts itself.
Destroy removes document/window listeners, MutationObservers, deferred refreshes,
delete timers, subscription, and DOM. Commands have an initialization guard and
remove palette/context-menu entries on destroy. [topbar teardown][topbar-teardown]
[command lifecycle][commands]

## Reload, date change, recovery, and cross-surface synchronization

| Event | Timing runtime | Spiral/chart | Persistence outcome |
| --- | --- | --- | --- |
| Reload with valid open CLOCK | Whole-graph startup read restores newest Focused entry; task Pomodoro restores saved start or derives from CLOCK start | Existing LOGBOOK remains authoritative | Running CLOCK is not rewritten unless overlap/DONE recovery is needed. |
| Reload with standalone POMO and no CLOCK | Restores exact epoch `startedAt` and continues count-up | No effect | No graph query/write caused by POMO itself. |
| Reload with both standalone POMO and active CLOCK | Projects CLOCK; persisted standalone POMO is asynchronously cleared | CLOCK-derived Actual only | CLOCK wins. |
| Reload with task Pomodoro but no Focused CLOCK | Initial refresh projects no task Pomodoro; initialization awaits setting clear | No effect | Stale task cycle becomes `null`. |
| Legacy overlapping valid CLOCKs | Keep newest start; close older entries at newest start | Later reads see closed history | Partial writes are not rolled back. |
| External edit to current CLOCK | Next direct action re-reads exact UID; routine refresh sees relevant task within about 15 seconds | Disabled renderer cache may retain old snapshot for up to 15 seconds | Malformed edit may make record disappear from projections. |
| Midnight/date change while enabled | A 15-second refresh calls `readPrimaryPlan(now)` and switches Primary Plan to the new Daily Note; prior focused/recent UIDs are carried into the relevant read set | Each mounted chart recomputes today/historical relation every minute | Running cross-midnight CLOCK contributes only overlap to each day's Actual. |
| Language/settings change | Settings event rerenders trigger/popover; relevant numeric changes may request refresh | Mounted charts reset renderer settings | CLOCK graph data unchanged. |
| Disable | Close all known entries and clear both Pomodoros before teardown | Existing closed history remains | Master switch false only after success. |
| Unload | Destroy without graph close | Chart scaffolding is not deleted or rewritten | Active CLOCK intentionally survives for reload restoration. |

Source: [runtime initialization/timer][runtime-initialize], [runtime refresh scope][runtime-refresh],
[renderer date loop][component-main], [unload contract][index-unload].

## Concurrency, race, teardown, and clock-drift protections

| Protection | Evidence | Guarantee | Limit |
| --- | --- | --- | --- |
| Mutation queue | Promise tail catches failures and continues | Explicit mutations cannot interleave | A mutation already executing is not cancelled by `destroy()`. |
| Deferred Clock In with sidebar | One browser task delay after sidebar intent | Gives native sidebar a paint/click-stack path before graph work | UI may show a task even if CLOCK validation later fails. |
| Explicit action beats idle refresh | Enqueue cancels scheduled idle refresh | Clock Out does not race a queued background graph scan | An already-running synchronous refresh cannot be cancelled. |
| Refresh dedupe | One `refreshPromise` and handle | Multiple requests share one read | Notice from later callers is not merged while one is pending. |
| Direct UID confirmation | Create/close/delete/complete helpers | Changed object is re-read before success | Startup overlap reconciliation is the exception. |
| Standalone stale-clear promise | Start awaits cleanup in flight | Old focused cleanup cannot overwrite a later start | Settings write failure is only logged for background cleanup. |
| Sidebar intent sequence | Global increasing intent | New rapid task switch supersedes older sidebar action | CLOCK mutation queue has its own ordering; sidebar and CLOCK UI can temporarily differ. |
| Sidebar operation queue/cache revision | WeakMap queue plus warmup revision | Dedupe and stale-read defense | Cache is only a hint and expires after 45 minutes. |
| One-second structural key | Revision/view-based key | No list rebuild for elapsed tick | Live Review only updates focused task Actual text. |
| Listener cleanup | Runtime/topbar/command destroy paths | Normal lifecycle removes intervals, observers, settings/document listeners, subscriptions, and commands | Direct repeated `runtime.initialize()`/`topbar.initialize()` is not guarded; module-level `startTiming` normally prevents it. |
| Backwards end clamp | CLOCK formatter uses `max(start,end)`; elapsed uses `max(0,...)` | No negative serialized duration/elapsed label | Forward/backward wall-clock changes still distort duration; no monotonic clock is used. |

Sources: [runtime queue/refresh][runtime-queue], [runtime destroy][runtime-disable],
[sidebar source][roam-sidebar], [topbar teardown][topbar-teardown],
[CLOCK duration core][core-elapsed], [live elapsed core][core-live-elapsed],
[performance design][design-performance].

## Limits of the invariant and unresolved failure cases

These are baseline facts or conservative inferences that an Obsidian parity
specification must decide explicitly.

1. **External unrelated CLOCK after startup (Fact).** Routine refresh reads only
   current Review task UIDs plus task UIDs already present as running/recent in
   the prior snapshot. A valid open CLOCK created externally under an unrelated
   task after initialization can remain unseen while Nautilus creates another.
   The whole-graph single-CLOCK claim is therefore not continuously enforced.
   [refresh UID scope][runtime-refresh]
2. **Malformed CLOCK/drawer (Fact).** Invalid CLOCK strings are filtered; drawer
   query inputs enumerate only four padding forms. Such records are not repaired,
   closed, counted, or warned about. [drawer query][roam-drawers]
3. **Partial mutation without rollback (Fact).** Switch can close old work before
   new creation fails; Complete can close time before DONE update fails; startup
   overlap repair can partially close records. UI avoids false success but graph
   changes are not transactional. [mutation ordering][runtime-start]
4. **Overlap repair confirmation gap (Fact).** Normal close confirms the changed
   UID; overlap reconciliation updates blocks and validates only its local array.
   A host that resolves an ignored write could leave multiple graph records open.
   [overlap source][runtime-reconcile]
5. **In-flight unload (Inference).** `destroy()` cancels pending deferred starts
   and scheduled refreshes, but not an operation already past its destroyed guard.
   `onunload` does not await `stopTiming`. An already-executing mutation may finish
   after UI teardown. [queue/destroy][runtime-queue] [unload][index-unload]
6. **Second writer detection is startup-only (Fact).** The legacy Roam Logbook
   check is not repeated during the 15-second refresh. It also detects named
   legacy globals/DOM, not an arbitrary external CLOCK writer. [legacy guard][roam-legacy]
7. **DST day length mismatch (Inference).** `actualMinutesToday` uses local
   midnight plus exactly 24 hours, while the renderer bridge constructs the next
   local calendar midnight. On a DST transition, Review/Timing and historical
   spiral clipping can disagree. [Review day bound][core-review]
   [renderer day bound][index-clock-bridge]
8. **Wall-clock changes (Fact/Inference).** Negative elapsed/end is clamped, but
   elapsed, thresholds, and durations use `Date.now()`/local `Date`. Manual clock
   or timezone changes can jump timers and serialized durations. No drift
   reconciliation or monotonic elapsed source exists. [elapsed][core-elapsed]
9. **Bare references and custom prefix (Fact).** Bare references can project but
   fail action validation; Primary Plan matching requires literal
   `[[Nautilus Log]]` even though the prefix is configurable. Both were addressed
   after v1.0.2 and are baseline compatibility decisions, not unknown desired
   behavior. [component matcher][core-plan] [main drift][main-changelog]
10. **Settings storage scope (Unknown).** Roam owns `extensionAPI.settings`
    persistence; the upstream does not document migration, corruption handling,
    sync scope, or atomicity for the Pomodoro objects.
11. **Missing runtime failure tests (Fact).** Baseline tests cover normal switching,
    cached Clock Out, POMO precedence/restoration, sidebar fallback, projection,
    and teardown contracts, but do not execute injected graph-write rejection,
    partial overlap failure, DST, wall-clock jump, or unload-during-mutation cases.
    [runtime tests][test-runtime-all]
12. **Historical/secondary chart entry gap while enabled (Fact).** The renderer
    bridge returns the current runtime entry array whenever the Execution Layer
    exists, before considering the requesting chart's task UIDs. That runtime
    array is scoped to the current Primary Plan and prior active work. A historical
    Daily Note or a secondary plan can therefore miss its own CLOCK Actual while
    tracking is enabled; when tracking is disabled, the bridge instead performs
    the requested task-scoped read. [renderer entry selection][index-clock-bridge]

## Post-v1.0.2 `main` drift (supplementary only)

At supplementary commit `08892f9`, `main` has 1,515 added and 126 removed lines
across execution source/tests/docs compared with the tag. Its Unreleased notes
describe behavior that is **not** in this baseline, including:

- bare/recursive reference daily-instance ownership and status-owner completion;
- direct flexible blocks without TODO markers;
- Primary Plan recognition by stable renderer instead of configurable display
  prefix;
- graph-native plan watchers and immediate cross-surface refresh;
- global/overnight chart windows and a Tidy action.

Source: [supplementary main changelog][main-changelog]. These changes explain
several v1.0.2 gaps but must be separate product decisions for a strict parity
port.

## Obsidian parity obligations derived from the baseline

These are **Inferences**, not implementation prescriptions:

1. Keep one authoritative mutation coordinator for task timing, and test both
   orders of CLOCK/POMO same-tick actions.
2. Define stable task identity before porting LOGBOOK semantics; a Markdown line
   can move or be edited while a Roam UID is stable.
3. Preserve explicit partial-failure semantics or improve them deliberately and
   document the divergence; do not claim atomic switching without a transaction
   or recovery journal.
4. Make date-zone/DST rules explicit and share one day-boundary function across
   Timing, Review, and history rendering.
5. Decide whether "single CLOCK" is vault-global, note-global, or planner-local,
   then continuously observe the chosen scope rather than relying only on startup.
6. Keep standalone POMO outside Markdown task history unless intentionally
   changing Review semantics.
7. Treat sidebar/tab navigation as reversible feedback separate from write
   confirmation, but surface mutation failures visibly rather than console-only.

## Immutable source index

[runtime-snapshot]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L79-L212
[runtime-projection]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L26-L55
[runtime-refresh]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L152-L253
[runtime-queue]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L255-L302
[runtime-reconcile]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L304-L342
[runtime-start]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L344-L383
[runtime-stop]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L385-L402
[runtime-finish]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L404-L412
[runtime-delete]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L414-L422
[runtime-standalone]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L424-L440
[runtime-initialize]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L442-L480
[runtime-disable]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L482-L530
[runtime-pomodoro]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L22-L150
[core-clock]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-core.js#L11-L137
[core-plan]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-core.js#L197-L276
[core-active]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-core.js#L279-L324
[core-review]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-core.js#L326-L394
[core-pomodoro]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-core.js#L418-L454
[core-elapsed]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-core.js#L107-L121
[core-live-elapsed]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-core.js#L418-L454
[core-structure]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-core.js#L456-L491
[roam-drawers]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L3-L55
[roam-queries]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L19-L55
[roam-plan]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L185-L225
[roam-entries]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L227-L255
[roam-clock-write]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L283-L375
[roam-close]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L354-L370
[roam-delete]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L312-L318
[roam-complete]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L378-L387
[roam-navigation]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L389-L408
[roam-sidebar-cache]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L61-L136
[roam-sidebar]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L410-L601
[roam-legacy]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L603-L605
[topbar-row]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L106-L199
[topbar-review]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L268-L375
[topbar-render]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L377-L518
[topbar-popover]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L384-L572
[topbar-trigger]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L574-L645
[topbar-teardown]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L647-L742
[commands]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-commands.js#L12-L87
[index-clock-bridge]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L43-L94
[index-lifecycle]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L170-L210
[index-enable]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L212-L234
[index-settings]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L26-L41
[index-panel]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L307-L450
[index-unload]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L454-L509
[component-clock-bridge]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L308-L316
[component-collapse]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1357-L1374
[component-main]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1686-L1822
[log-history]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L641-L719
[css-review]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L1085-L1196
[guide-execution]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/docs/guide.md#L70-L110
[guide-settings]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/docs/guide.md#L112-L134
[design-review]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/docs/plans/2026-08-22-daily-review-design.md#L3-L60
[design-history]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/docs/plans/2026-08-22-completed-clock-duration-design.md#L3-L51
[design-performance]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/docs/plans/2026-08-22-execution-surface-performance.md#L3-L26
[test-runtime-progress]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/test/timing-runtime.test.js#L98-L194
[test-runtime-switch]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/test/timing-runtime.test.js#L196-L365
[test-runtime-pomo]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/test/timing-runtime.test.js#L442-L553
[test-runtime-all]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/test/timing-runtime.test.js
[test-core-review]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/test/timing-core.test.js#L89-L148
[test-core-structure]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/test/timing-core.test.js#L215-L296
[test-log-history]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/test/log-core.test.js#L507-L609
[main-changelog]: https://github.com/404KSG/roam-nautilus-log/blob/08892f948c63e4cacd3fc1cc100a600dd38c21f8/CHANGELOG.md#L1-L80
