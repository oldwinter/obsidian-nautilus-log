# Troubleshooting

## The planner says “No Primary Plan”

The Planner and Plan tab show the next step, including the two HTML markers.
The Settings first-run explanation is instructional and stays visible after a
plan exists, but Insert hides once today's Primary Plan is confirmed. Opening
a surface does not rewrite your note.
**Locate Primary Plan** opens today's configured Daily Note even when the
region is missing; if that file does not exist, the notice points to Insert
on Planner, Settings, the Plan tab, or Review (today).
**Insert into today's Daily Note** writes only after you click it. It creates
today's configured Daily Note when needed and refuses to insert when a valid or
malformed Plan Region is already present. If the region is already there and
the list looks empty, the notice points to **Copy sample task**. A failed
Insert shows that Copy-the-starter notice once. If locking first-run settings
fails before the write, Insert still continues and shows only the Insert
result. It does not add a **Spiral Day could not complete that action** toast.

Check the Daily Note path first:

1. In **Settings → Spiral Day**, verify **Daily Note folder** and
   **Daily Note date format** resolve the note you opened.
2. Confirm the opening marker is exactly
   `<!-- nautilus-log:plan/v1 -->` and the closing marker is exactly
   `<!-- /nautilus-log:plan -->`.
3. Put both markers at column zero, outside fenced code, with the opening marker
   before the closing marker.
4. Refresh the view after saving the note.

An unsupported version, missing close, nested marker, or malformed region is
intentionally ignored. Ordinary tasks elsewhere in the note do not become plan
items.

## A row is visible but has no Clock in or Complete action

Only a direct, open flexible task is execution-eligible. Add `[ ]` immediately
after the bullet and remove any nested-list indentation. Fixed Events with a
time range, plain items without a checkbox, completed `[x]`/`[X]` items, and
foreign checkboxes are read-only projections.

If the item has a duplicate block ID, identity-dependent actions are disabled.
Give one occurrence a distinct terminal ID, save, and refresh.

## The item title or duration looks wrong

Scheduling tokens are read only from the first physical line. Check that the
time range or duration is not inside inline code, a link destination, an image,
an embed, or a nested child. The first syntactic time range wins even when it is
invalid. Use `` `30m` `` when text should be displayed without being parsed.

If no duration token is present, check **Default task duration**. A duration on
a Fixed Event is parsed for display but the explicit time range controls its
reservation.

## The planner shows a warning or a fallback label

Open the planner's warning/details area. Common causes are:

- **Invalid time range**: correct the first range on the item's first line.
- **Same time**: start and end are equal, so the event has zero length.
- **Overnight truncated**: the end is earlier than the start and is displayed
  through 24:00.
- **Empty plan item**: add visible text after owned tokens are removed.
- **Another Plan Region appears after the primary region**: only the first valid
  region is used by grammar v1; move or remove the duplicate if it was meant to
  be active.
- **Unsupported version**: v1 cannot parse that region. Do not silently rewrite
  an old marker; migrate the source explicitly when a parser for the target
  grammar is available.

## The Execution Layer is missing

Enable **Execution Layer** in the settings tab. If activation fails, the plugin
rolls the setting back off and leaves execution surfaces disabled. Check the
notice, correct the reported source or timing problem, then enable it again.
A rejected enable shows that one notice. It does not add a second generic
toast.
Clicking a Planner task to advance progress while Execution is off names
**Execution Layer** and Settings. It does not say Actual Time Tracking.

The timer ribbon opens on **Timing**. If there is no Primary Plan yet, that
idle state points to **Insert into today's Daily Note** on the Plan tab. If
the list is empty or every task is done, it points to **Copy sample task** on
the Plan tab instead of only Clock In. An empty **Unscheduled today** list on
the Plan tab means every open flexible task is already on the schedule, not
that there are no unfinished tasks. If scheduled is empty because remaining
items are done or not clockable, use **Copy sample task** and paste another
open `- [ ]` line.

`Spiral Day: 1. Clock in current task` needs today's Daily Note focused and the
caret on an open `- [ ]` flexible task. Otherwise the notice points to that
line or **Clock In** on the Plan tab. It does not use Roam TODO wording. If
that task is already being timed, the notice says so and points to **Clock
Out** on the Plan tab. It does not say Already up to date.
`Spiral Day: 2. Clock out current task` with no running CLOCK says nothing is
being timed and points to **Clock In** on the Plan tab. It does not say
Already up to date.

## Review is empty or missing a Daily Note

Review is a live surface. Enable **Execution Layer**, open the timer ribbon, and
choose **Review**. It compares planned and recorded time for a chosen date.

1. If the date has no Daily Note, create the note that matches **Settings →
   Daily Note folder** and date format, or use **Insert into today's Daily
   Note** when the date is today.
2. If the note has no Primary Plan, use **Insert into today's Daily Note** when
   the selected date is today, or paste the plan starter (markers plus a
   sample task), then refresh Review. If the note already has markers but no
   reviewable `- [ ]` or `- [x]` task — including a day of only fixed events —
   use **Copy sample task**. The notice does not say the plan has no list items.
3. **Only completed overruns** hides other rows. The day summary still covers
   the whole day.

## A write says the source changed, is stale, or is unavailable

Spiral Day never applies a cached line number or title to a changed note. Save
the note, wait for the planner to refresh, and retry from the current row. Do
not duplicate a task line while retrying. If the problem persists, close and
reopen the planner view so it can rebuild its source snapshot.

## A task link cannot open the source

Task navigation requires a unique terminal block ID. If the ID was deleted,
changed, or copied to another item, repair the Markdown so the ID is present on
exactly one item, save, and refresh. An item without an ID can still be planned;
**Clock In** from the Plan tab assigns a generated `^nl-<uuid>` ID, or use
**Locate Primary Plan** to open today's Daily Note. A failed title click now
names **Locate Primary Plan** and repairing a missing or duplicated block ID.
It does not say only that source navigation is unavailable, and it does not
say block UID. A failed **Copy task link** names Locate Primary and copying
the wikilink from the task line, or **Clock In** from the Plan tab when the
block ID is missing.

## A timer is marked forgotten or timing is unavailable

Forgotten is a warning state, not an automatic stop. Use **Clock out** from the
Timing panel or command palette when the task is finished. A `0` Forgotten timer
setting disables that warning.

If timing is unavailable, refresh the Timing panel. The notice and the
degraded empty state now name **Try again** on the Timing tab after you save
the note. The Active Task unavailable state names that same Timing retry,
and **Locate Primary Plan** if today's Daily Note or the running CLOCK needs
a repair. It does not say only that source navigation is disabled. A degraded state means the
current CLOCK records could not be confirmed safely; do not edit those records
manually while a repair or confirmation is pending. A failed Clock In, Clock
Out, or Complete notice now says the **note** change could not be confirmed
and points to save and refresh. It does not say graph. If the notice says
CLOCK records are overlapping or ambiguous, use **Locate Primary Plan**, then
**Clock Out** or repair the open CLOCK lines so only one is running. It does
not say legacy.

## The Daily Note cannot be resolved

Use a vault-relative folder and a format containing a year, month, and day
component. The default is `YYYY-MM-DD`. Avoid absolute paths, `..`,
backslashes, a trailing `.md`, adjacent variable-width tokens (`M`/`D`), and
unescaped alphabetic literals; wrap alphabetic literals in `[square brackets]`.
Obsidian weekday tokens such as `dddd` are not supported.

If Settings rejects a folder or format, the field snaps back to the last
accepted value and a notice explains why. The plugin does not silently keep
showing a discarded `YYYY-MM-DD dddd` while Planner reads `YYYY-MM-DD`.

If core Daily Notes already uses weekday tokens, first enable does not copy
that format. Settings shows the ignored host string so Insert is not mistaken
for writing the Obsidian Daily Notes filename.

After correcting the setting, reopen the planner for the target date. If the
resolved Markdown path does not exist, create that Daily Note or change the
folder/format to match the note you use.

If Insert says a file is blocking a folder, a note already occupies a parent
segment of the resolved path (for example `Journal.md` when the format needs
`Journal/2026-09-16.md`). Rename or move that file, then try Insert again. The
folder and format settings can still be valid.

## The planner reports an over-limit state

The runtime protects responsiveness with limits on active note bytes, plan-region
bytes, plan-item bytes, item count, and list depth. Split a very large plan into
smaller notes or reduce deeply nested content, then refresh. The planner does
not write a partial projection when a limit is exceeded.
