# Troubleshooting

## The planner says “No supported Plan Region was found”

The Planner and Settings first-run checklist now show the exact next step,
including the two HTML markers. The plugin does not rewrite your note.

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

## Review shows a preparation notice

The Review tab is present as an integration placeholder while its coordinator
is being connected to the rendered surface. Use the Timing tab for current and
recent timing details. Planner and Plan actions remain available.

## A write says the source changed, is stale, or is unavailable

Spiral Day never applies a cached line number or title to a changed note. Save
the note, wait for the planner to refresh, and retry from the current row. Do
not duplicate a task line while retrying. If the problem persists, close and
reopen the planner view so it can rebuild its source snapshot.

## A task link cannot open the source

Task navigation requires a unique terminal block ID. If the ID was deleted,
changed, or copied to another item, repair the Markdown so the ID is present on
exactly one item, save, and refresh. An item without an ID can still be planned;
an explicit identity-requiring action may assign a generated `^nl-<uuid>` ID.

## A timer is marked forgotten or timing is unavailable

Forgotten is a warning state, not an automatic stop. Use **Clock out** from the
Timing panel or command palette when the task is finished. A `0` Forgotten timer
setting disables that warning.

If timing is unavailable, refresh the Timing panel. A degraded state means the
current CLOCK records could not be confirmed safely; do not edit those records
manually while a repair or confirmation is pending.

## The Daily Note cannot be resolved

Use a vault-relative folder and a format containing a year, month, and day
component. The default is `YYYY-MM-DD`. Avoid absolute paths, `..`,
backslashes, a trailing `.md`, adjacent variable-width tokens (`M`/`D`), and
unescaped alphabetic literals; wrap alphabetic literals in `[square brackets]`.

After correcting the setting, reopen the planner for the target date. If the
resolved Markdown path does not exist, create that Daily Note or change the
folder/format to match the note you use.

## The planner reports an over-limit state

The runtime protects responsiveness with limits on active note bytes, plan-region
bytes, plan-item bytes, item count, and list depth. Split a very large plan into
smaller notes or reduce deeply nested content, then refresh. The planner does
not write a partial projection when a limit is exceeded.
