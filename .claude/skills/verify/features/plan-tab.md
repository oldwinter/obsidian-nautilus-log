# Execution — Plan tab

The list view of today's open work: scheduled rows first, then **Unscheduled
today**, with the actions that start and advance a task.

## Sub-features

- Scheduled and unscheduled open tasks from today's Primary Plan.
- Click a title → open the source line; Shift-click → open it in the right
  sidebar. A missing or duplicated block ID produces a notice that names
  **Locate Primary Plan**.
- **Clock in** starts the single Active Task (assigns a block ID when the line
  has none).
- **Complete** advances progress by 10 points and completes the task at 100%.
- **Insert into today's Daily Note** / **Copy sample task** empty states.
- Partial-progress rows show remaining vs planned duration.

## How to get to it (user POV)

Ribbon **Execution** → tab **Plan** (or ArrowRight from Timing). Requires
Execution Layer on in Settings.

## Driving it with the host runner

```bash
.claude/skills/verify/scripts/host-lane.sh full
```

After the keyboard-tab assertion, the runner looks for the task button named
`Host fixture Alpha`, expands the real **Unscheduled today** disclosure when the
row is folded away, clicks the title, and waits for the active file to become
the fixture's today note.

Assertions that prove this feature:

- `execution-keyboard-plan-tab` — the tab is reachable by keyboard and reports
  `aria-selected="true"`.
- `execution-source-navigation` — clicking the task title activates
  `fixture.today.path` (`app.workspace.getActiveFile()?.path`).
- `clock-in-one-open-record` / `clock-out-closes-same-record` — Clock In from
  this surface opens exactly one CLOCK record and Clock Out closes the same one.
- `clock-preserves-outside-region` — the write stays inside the Plan Region and
  keeps the rest of the note byte-identical.
- `read-only-navigation-preserves-all-markdown` — navigating to the source line
  writes nothing.

**Complete**, Shift-click-to-sidebar, and the "Copy sample task" state are not
driven by the host runner today. Their proof is
`tests/ui/execution/plan-view.test.ts` and
`tests/ui/execution/insert-primary-plan.test.ts` via `npm run test`.

## Gotchas

- A freshly inserted sample task has no block ID; Clock In assigns one. Do not
  treat the missing ID as a failure in the middle of a drive.
- An empty **Unscheduled today** means every open flexible task is already
  scheduled — not that the day has no work.
- The row title is the accessible button name (the `Host fixture *` names come
  from the runner's fixture), so locate by name, not by index.
