# Spiral Day user guide

Spiral Day is an Obsidian desktop plugin for planning a day from Markdown and,
when enabled, tracking actual time against open flexible tasks. It reads the
Daily Note configured in the plugin settings. Planning is read-only; execution
actions write only after the current source has been re-read and confirmed.

## Requirements and installation

- Obsidian desktop 1.7.7 or later.
- A vault with Markdown Daily Notes.
- A local build containing `manifest.json`, `main.js`, and `styles.css`, copied to
  `<vault>/.obsidian/plugins/spiral-day/`.

Copy all three build artifacts into the plugin folder, then enable
**Spiral Day** in **Settings → Community plugins**. Mobile is not
supported. The plugin ID and folder are `spiral-day`.

## Create a plan

1. Open today's configured Daily Note.
2. Add the exact opening and closing markers on their own lines:

   ```markdown
   <!-- nautilus-log:plan/v1 -->
   <!-- /nautilus-log:plan -->
   ```

3. Put direct unordered list items between the markers. Use `-`, `+`, or `*`.
   The first physical line of each item is its planning input.

Example:

```markdown
<!-- nautilus-log:plan/v1 -->
- [ ] 09:00-09:30 Stand-up ^stand-up
- [ ] Write the release note 45m
- Lunch 12:00-13:00
- [x] Send the previous report 30m
<!-- /nautilus-log:plan -->
```

An item without a checkbox is still visible in the planner, but it cannot be
clocked in or completed. Only an open (`[ ]`) flexible task has execution
actions. A completed item uses `[x]` or `[X]`.

Open the planner with the **Open Spiral Day** ribbon icon. It opens today's
configured Daily Note. The planner shows
fixed events, scheduled flexible tasks, unscheduled open tasks, capacity, and
warnings. Use **Hide completed items**, **Copy plan summary**, or **Play day**
from the planner controls. Playback is a temporary view; it restores the live
schedule when it finishes.

## Use the Execution Layer

Open **Settings → Spiral Day** and enable **Execution Layer**. This adds the
Timing, Plan, and Review surfaces and registers these command-palette commands:

- `Nautilus Log: 1. Focus current block`
- `Nautilus Log: 2. Clock out Timing Line`
- `Nautilus Log: 3. Locate Primary Plan`

When the caret is inside an eligible open flexible task, the editor context menu
also offers **Nautilus Log: Clock in**. When the caret is inside the currently
timed task, it offers **Clock out**. The Timing panel can start or stop a
standalone POMO when no task is running.

In the Plan tab, an open flexible task can be clocked in or advanced through
progress. The task title opens its source; Shift-click opens it in the right
sidebar. **Complete** advances progress by 10 percentage points and completes
the task at 100%. Reopen a completed task from its Planner progress control.
The Plan tab does not reopen completed tasks. Every write is guarded by the
source snapshot; if the note changed, refresh and repeat the action.

The Timing panel shows the current task, elapsed time, recent tasks, and a
forgotten-timer warning when configured. A POMO threshold changes warning
styling; it does not stop the timer. Clock records are written to Markdown
LOGBOOK content owned by the plugin's execution writer. The Review tab is
currently a preparation notice. Use Timing for current and recent timing
details until the Review surface is connected to its coordinator.

## Stable task links and edits

An item may carry a terminal block ID, for example `^stand-up`. Existing
vault-unique IDs are retained. If an explicit action needs an anonymous item's
durable identity, Spiral Day inserts a generated `^nl-<uuid>` ID in the same
atomic edit as that action. Opening or refreshing the planner never inserts an
ID.

Keep the terminal ID when renaming, reordering, or moving an item. Do not copy
the same ID to two items: duplicate IDs disable identity-dependent actions until
the collision is repaired. The parser preserves links, tags, Dataview fields,
nested children, and other unowned Markdown text.

## Change language and Daily Note location

The settings tab supports English (`en`) and Simplified Chinese (`zh`). Changes
apply to mounted surfaces immediately.

Set **Daily Note folder** to a vault-relative folder (leave it empty for the
vault root). Set **Daily Note date format** so it contains `YYYY`, `MM` or `M`,
and `DD` or `D`; literals may be wrapped in square brackets. The default is
`YYYY-MM-DD`, which resolves today's note to `YYYY-MM-DD.md`.

See [Settings reference](reference/settings.md) for every field and accepted
value.

## Safe editing rules

- Keep both plan markers at column zero and outside code fences.
- Keep a plan item on its first line when adding scheduling tokens.
- Use inline code to display token-like text without scheduling it, for example
  `` `30m` ``.
- Keep a unique terminal block ID if the item must remain addressable after
  edits.
- If the planner reports a stale, conflict, or unavailable state, stop editing
  through the action, update the source note, and refresh before retrying.
