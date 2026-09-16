# Spiral Day user guide

Spiral Day is an Obsidian desktop plugin for planning one day from Markdown
and, when you enable Execution Layer, tracking actual time against open
flexible tasks. It is bilingual (English and Simplified Chinese).

Planning is read-only. Timing writes happen only after an explicit action such
as Clock In, Clock Out, progress, or Complete. The plugin never rewrites a
Daily Note just because you opened Planner.

**中文手册：** [使用手册](user-guide.zh.md)

## What you need

- Obsidian desktop 1.7.7 or later. Mobile loading is disabled.
- A vault where you keep Daily Notes as Markdown files.
- A local plugin folder at `<vault>/.obsidian/plugins/spiral-day/` containing
  `manifest.json`, `main.js`, and `styles.css`.

The plugin ID is permanently `spiral-day`. It does not read or overwrite an
older `nautilus-log` folder.

## Install

1. Run `npm ci && npm run build` in a clean checkout, or install a published
   build that already contains the three package files.
2. Create `<vault>/.obsidian/plugins/spiral-day/`.
3. Copy `manifest.json`, `main.js`, and `styles.css` into that folder.
4. In Obsidian, turn off **Restricted mode** if it is on, then enable
   **Spiral Day** under **Settings → Community plugins**.

![Enable Spiral Day in Community plugins](user-guide/images/01-enable-plugin.png)

After enablement you should see a shell icon in the left ribbon named
**Open Spiral Day**. That is the Planner. Timing, Plan, Review, and
command-palette actions are **not** registered yet.

## First use: why the plugin looks empty

The first-run path is easy to miss:

1. Execution Layer is **off** by default, so there is no Timing / Plan /
   Review panel and no `Spiral Day:` commands.
2. Planner only reads today's configured Daily Note.
3. Ordinary checkboxes anywhere else in the vault are ignored.
4. The Daily Note must contain this Plan Region at column zero, with at least
   one direct list item:

```markdown
<!-- nautilus-log:plan/v1 -->
- [ ] Write the release note 45m
<!-- /nautilus-log:plan -->
```

If those markers are missing, Planner shows **No Primary Plan** plus the next
steps, and the ribbon click also shows a short notice. That notice names
Planner and Settings. After Execution Layer is on, it also names the Plan tab
and Review (today). Opening Planner does not insert the markers. Click
**Insert into today's Daily Note** in Planner or Settings — or on Review
(today) after Execution is on — when you want the plugin to create today's
note and write the markers plus a sample task.

![Settings first-run checklist](user-guide/images/02-settings-first-run.png)

### First-run checklist

The Settings card keeps an explanation after a plan exists. It is not a live
**No Primary Plan** diagnosis, and Insert hides once the plan is confirmed.

1. Open **Settings → Spiral Day**. On first enable, Language and Daily Note
   folder/format are copied from Obsidian when present. **Insert into today's
   Daily Note** or any Settings change saves that snapshot; later host
   changes do not overwrite it. Otherwise leave defaults, or set them so they
   resolve the note you already use.
2. Click **Insert into today's Daily Note**. It creates today's note if needed
   (default `YYYY-MM-DD.md` at the vault root) and writes the markers plus a
   sample task. Or create the note yourself and paste the plan starter
   (markers plus a sample task).
3. Click the **Open Spiral Day** ribbon icon.
4. Enable **Execution Layer** when you want CLOCK, POMO, Timing, Plan,
   Review, Active Task, and commands.

![Open Planner from the ribbon](user-guide/images/03-open-planner-ribbon.png)

## Create today's plan

Open today's Daily Note and add a Primary Plan:

```markdown
<!-- nautilus-log:plan/v1 -->
- [ ] 09:00-09:30 Stand-up ^stand-up
- [ ] Write the release note 45m
- Lunch 12:00-13:00
- [x] Send the previous report 30m
<!-- /nautilus-log:plan -->
```

![Daily Note with Primary Plan markers](user-guide/images/04-daily-note-markers.png)

Rules that matter on day one:

- Both markers sit at column zero, outside code fences.
- Only **direct** unordered items (`-`, `+`, or `*`) become Plan Items.
- Nested lists, ordered lists, and tasks outside the markers are ignored.
- `[ ]` is an open task. `[x]` / `[X]` is completed. No checkbox means the
  item is visible but cannot be clocked in.
- A time range such as `09:00-09:30` makes a **Fixed Event**.
- A duration such as `45m` (or the default duration in settings) makes a
  **Flexible Task** that the scheduler places into free time.
- Tokens are read only from the first physical line of each item.

If the markers are missing, Planner shows the plan starter, **Copy plan
starter**, **Insert into today's Daily Note**, and where to open Timing / Plan
/ Review after you enable Execution. If the markers are there but the list is
empty, it shows **Copy sample task** instead of Insert.

![Planner empty-state guidance](user-guide/images/05-planner-empty-guidance.png)

Save the note. If Planner is already open, use **Refresh plan**.

## Daily loop

A typical day:

1. Write the Primary Plan in today's Daily Note.
2. Open **Planner** from the shell ribbon and check capacity, fixed events,
   scheduled tasks, and overflow.
3. Enable **Execution Layer** once. Open the timer ribbon to reach
   **Timing**, **Plan**, and **Review**.
4. Clock in an open `- [ ]` flexible task from the Plan tab, the editor
   context menu, or `Spiral Day: 1. Clock in current task`.
5. Work. Clock out when you stop. Advance progress or Complete from Plan or
   Planner.
6. Use **Review** to compare planned and recorded time. Filter **Only
   completed overruns** when you only want finished tasks that ran long.

![Planner with a scheduled day](user-guide/images/06-planner-scheduled-day.png)

## Surfaces

### Settings

**Settings → Spiral Day** is bilingual (`English` / `简体中文`). The first-run
explanation stays at the top. It is instructional, not a live Planner diagnosis.
After a Primary Plan exists, Settings keeps the explanation but hides
**Insert into today's Daily Note**. An empty ready plan offers **Copy sample
task** instead. After Execution Layer is on, the card says it is on and
points to the timer ribbon instead of asking you to enable it.

Important fields for getting started:

| Setting | Default | Why it matters |
| --- | --- | --- |
| Language | Copied from Obsidian on first enable (`en` / `zh`) | Relabels Planner, Execution, commands, editor menu, and the Planner ribbon immediately. Insert or a Settings change saves it; a later Settings choice wins. |
| Daily Note folder | Copied from core Daily Notes on first enable, otherwise empty (vault root) | Must match the folder Insert creates and Planner reads. Insert or a Settings change locks it so later core-plugin edits do not move it. Invalid folders snap back to the last accepted value. |
| Daily Note date format | Copied from core Daily Notes on first enable, otherwise `YYYY-MM-DD` | Must contain year, month, and day tokens (`YYYY`, `MM`/`M`, `DD`/`D`). Insert or a Settings change locks it. Tokens such as `dddd` are rejected and the field returns to the last accepted format. If Obsidian Daily Notes already uses those tokens, Settings says the host format was not copied. |
| Default task duration | 15 minutes | Used when a flexible task has no `30m` / `2h` token. |
| Execution Layer | off | Turns on Timing, Plan, Review, commands, and Active Task. |

See [Settings reference](reference/settings.md) for every accepted value.

![Enable Execution Layer](user-guide/images/07-enable-execution.png)

### Planner

Open it from the shell ribbon **Open Spiral Day**. It always targets today's
configured Daily Note.

You can:

- Read capacity (fixed, flexible, scheduled, available).
- See the spiral schedule, overflow, and warnings.
- Hide or show completed items.
- Copy a plan summary.
- Play the day as a temporary playback, then return to the live schedule.
- Refresh after you edit the Daily Note.
- Advance or reopen progress on a row when Execution Layer is on.

Planner never inserts block IDs. An explicit identity-requiring action may
add a generated `^nl-<uuid>` ID in the same write as that action.

### Timing

Enable Execution Layer, then click the timer ribbon. The panel opens on
**Timing**.

![Timing idle guidance](user-guide/images/08-timing-idle.png)

- Idle: no CLOCK. The empty state says to use **Insert into today's Daily
  Note** on the Plan tab if there is no Primary Plan yet, or **Copy sample
  task** on the Plan tab if the list is empty or every task is done, then
  Clock In from Plan or the editor. You can start a standalone POMO.
- Active: shows the current task, elapsed time, Clock Out, and optional
  forgotten-timer warning.
- Recent: closed CLOCKs kept for the configured retention window.

A POMO threshold only changes warning styling. It does not stop the timer.
Forgotten is a warning, not an automatic Clock Out.

### Plan

The Plan tab lists scheduled and unscheduled open tasks from today's Primary
Plan.

![Plan tab with open tasks](user-guide/images/09-plan-tab.png)

- Click a title to open the source line. Shift-click opens it in the right
  sidebar. A freshly inserted sample has no block ID yet; Clock In assigns
  one, or use **Locate Primary Plan** to open today's Daily Note.
- **Clock in** starts the only Active Task.
- **Complete** advances progress by 10 percentage points and completes the
  task at 100%.
- Scheduled rows with partial progress also show remaining vs planned
  duration.
- Reopen a completed task from Planner, not from this tab.

If the tab says **No Primary Plan was found today**, use **Insert into today's
Daily Note** or the same marker checklist. An empty **Unscheduled today**
list means every open flexible task is already on the schedule, not that
there are no unfinished tasks. If scheduled is empty because every item is
done or not clockable, it offers **Copy sample task** so you can add another
open `- [ ]` line.

### Review

Review compares planned and recorded time for a chosen date.

![Review surface](user-guide/images/10-review-tab.png)

- **Today** is writable. Past and future dates are read-only.
- **Only completed overruns** hides everything except completed tasks whose
  recorded time exceeded the plan. The day summary still covers the whole
  day.
- Missing Daily Note and missing Primary Plan states now say how to create
  the note and add the markers. When the selected date is today,
  **Insert into today's Daily Note** writes the markers for you. If the
  markers are already there but the list is empty, it offers **Copy sample
  task**.

### Active Task

This singleton view lives in the right sidebar. It follows the current CLOCK,
opens the source line, copies an Obsidian block link, and offers Clock Out.

If **Keep Timing Line first in the right sidebar** is on, a successful Clock
In opens this view.

![Active Task empty state](user-guide/images/11-active-task.png)

### Commands and editor menu

These exist only while Execution Layer is enabled:

- `Spiral Day: 1. Clock in current task` — Clock In the unfinished task under
  the caret. If no Markdown note is focused, or the caret is not on an open
  `- [ ]` flexible task, the notice points to today's Daily Note or **Clock
  In** on the Plan tab. If that task is already being timed, the notice says
  so and points to **Clock Out** on the Plan tab.
- `Spiral Day: 2. Clock out current task` — if nothing is being timed, the
  notice says so and points to **Clock In** on the Plan tab.
- `Spiral Day: 3. Locate Primary Plan` — opens today's Daily Note even when
  the Primary Plan is missing. If the note does not exist, a notice points to
  **Insert into today's Daily Note** in Planner, Settings, the Plan tab, or
  Review (today).

Right-click an eligible open flexible task for **Spiral Day: Clock in**.
Right-click the timed task for **Clock out**.

## Daily loop at a glance

![Daily loop across Planner and Execution](user-guide/images/12-daily-loop.png)

## Grammar you will use every day

Full syntax: [Markdown grammar v1](reference/markdown-grammar-v1.md).

| You write | Planner reads |
| --- | --- |
| `<!-- nautilus-log:plan/v1 -->` … `<!-- /nautilus-log:plan -->` | The only Primary Plan |
| `- [ ] Write docs 45m` | Open flexible task, 45 minutes |
| `- [ ] 14:00-15:00 Review` | Fixed event |
| `- Lunch 12:00-13:00` | Visible fixed event, no Clock In |
| `- [x] Done item 30m` | Completed; Planner may offer Reopen |
| `` `- [ ] example 30m` `` | Display only; not scheduled |
| `^stand-up` at the end of the line | Durable Plan Item ID |

Keep a unique terminal ID if you rename or move a task. Duplicate IDs disable
identity-dependent actions until you repair them.

## Safe editing

- Do not put markers inside a code fence or indent them.
- Do not duplicate the same `^id` on two items.
- If a write says the source changed, save, refresh, and retry. Do not
  duplicate the line while retrying.
- Only one CLOCK writer may be enabled. Disable another CLOCK extension
  before turning on Execution Layer.
- Spiral Day writes CLOCK / LOGBOOK records in Markdown. Settings and POMO
  start times stay in plugin data.

## Troubleshooting

Start with the in-plugin empty states, then see
[troubleshooting](troubleshooting.md).

| Symptom | Fix |
| --- | --- |
| Planner says No Primary Plan | Click **Insert into today's Daily Note**, or paste the plan starter at column zero, save, refresh. |
| Planner or Review looks empty after paste | The note has markers but no list items. Use **Copy sample task**, paste that line between the markers, save, refresh. |
| Ribbon is the only new control | Expected until Execution Layer is on. |
| A row has no Clock In | It must be a direct open `- [ ]` flexible task, not a fixed event or nested item. |
| Commands are missing | Enable Execution Layer. Search the palette for `Spiral Day:`. |
| Daily Note cannot be resolved | Folder must be vault-relative; format must include `YYYY` plus month and day tokens. Settings rejects `dddd` and snaps back to the last accepted value. |
| Insert says a file is blocking a folder | A note occupies a parent segment of today's path. Rename or move that file, then retry Insert. |
| Review is empty | There is no reviewable task on that date, the note / plan is missing, or the plan has markers but no list items. |
| Write is stale or unavailable | Save the note, refresh, retry from the current row. |

## Related documents

- [Settings reference](reference/settings.md)
- [Markdown grammar v1](reference/markdown-grammar-v1.md)
- [Troubleshooting](troubleshooting.md)
- [Context glossary](../CONTEXT.md)
