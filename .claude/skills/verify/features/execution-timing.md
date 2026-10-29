# Execution — Timing tab

The side panel that turns the plan into recorded time. Timing is the default
tab and holds the CLOCK.

## Sub-features

- Idle state: **No task is being timed.** plus the next step (Insert markers,
  Copy sample task, or Clock In from Plan / editor).
- Active state: current task, elapsed time, Clock Out, optional forgotten-timer
  warning (a POMO threshold changes styling only, never stops the timer).
- Recent: CLOCKs closed inside the retention window, each reopenable.
- Standalone POMO when nothing is planned.
- Unavailable state: save the note, then **Try again**.
- Panel lifecycle: open from the ribbon, close with `Escape`, keep focus
  predictable, survive disable/enable.

## How to get to it (user POV)

Settings → Spiral Day → enable **Execution Layer**, then left ribbon →
**Execution**. The panel opens on **Timing**; **Plan** and **Review** are the
other tabs. When Execution Layer is off, neither the ribbon button nor the `Spiral Day:`
commands exist.

## Driving it with the host runner

```bash
.claude/skills/verify/scripts/host-lane.sh full
```

`openExecution()` clicks `.spiral-day-execution-trigger`; the runner then
screenshots `execution-timing.png` and drives the keyboard tabs.

Assertions that prove this feature:

- `lifecycle-<n>-loaded` / `lifecycle-<n>-unloaded` (n = 1..10) — after enable,
  exactly one `.spiral-day-execution-trigger`, one `.spiral-day-execution`
  panel, one planner leaf, and 3 commands registered; after disable, all of
  them are zero and no DOM is left behind.
- `execution-keyboard-plan-tab` — ArrowRight on the focused Timing tab selects
  **Plan** (`aria-selected="true"`).
- `execution-escape-restores-trigger` — `Escape` returns focus to the ribbon
  trigger. **Currently failing on Obsidian 1.14.5** (panel stays open, see
  `failure.png`); reported as a product finding, keep the assertion.
- `clock-in-one-open-record`, `clock-out-closes-same-record`,
  `clock-writes-only-today`, `clock-preserves-all-other-note-bytes`,
  `clock-preserves-outside-region`, `active-clock-reload-restores-task`,
  `active-clock-reload-preserves-source` — one CLOCK record is opened, closed,
  survives a reload, and never touches another note or the text outside the
  Plan Region.
- `lifecycle-preserves-all-markdown`,
  `read-only-navigation-preserves-all-markdown` — open/close and navigation
  write nothing.

The POMO warning, the Recent list, and the "Try again" recovery state are not
driven by the host runner. Their proof today is
`tests/ui/execution/timing.test.ts` and `tests/ui/execution/application.test.ts`
via `npm run test`.

## Gotchas

- Timing writes happen only after an explicit action. A drive that clocks in
  must clock out (or the reload scenario owns the record), otherwise the
  fixture vault keeps an open CLOCK.
- The runner starts its own vault with `data.json` that already enables
  Execution in English; a run with `--review` relies on the plugin's own
  Settings dropdown for language changes.
- `Escape` with focus on the ribbon trigger does not close the panel on
  Obsidian 1.14.5, which is why the `full` lane stops at
  `execution-escape-restores-trigger`. Run `probe` for a green read-only proof
  of the rest of the plugin until that finding is resolved.
