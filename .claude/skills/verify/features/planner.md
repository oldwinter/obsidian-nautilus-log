# Planner

The read-only day view: capacity, the 24-hour spiral schedule, overflow and
warnings for today's configured Daily Note.

## Sub-features

- Capacity row: Scheduled / Flexible / Available / Fixed time for today.
- Spiral schedule with hourly ticks, task arcs, and external labels for tasks
  that do not fit inside the ring.
- Completed-item visibility toggle.
- Collapse / expand the whole planner.
- Copy plan summary; play the day as a temporary playback, then return to the
  live schedule.
- Refresh after editing the Daily Note.
- Empty and diagnostic states: **No Primary Plan**, marker checklist, invalid
  marker pair, duplicated block ID.

## How to get to it (user POV)

Left ribbon → **Open Spiral Day** (shell icon). It always targets today's
configured Daily Note, so the note must exist and carry the Plan Region:

```markdown
<!-- nautilus-log:plan/v1 -->
- [ ] Write the release note 45m
<!-- /nautilus-log:plan -->
```

## Driving it with the host runner

```bash
.claude/skills/verify/scripts/host-lane.sh probe   # fast, read-only proof
.claude/skills/verify/scripts/host-lane.sh full    # adds the toggle buttons
```

The runner opens the view through the real ribbon/command path
(`openPlanner()` in `tests/host-matrix/run.mjs`), hovers the first external SVG
label and waits 900 ms for the host's delayed tooltip.

Assertions that prove this feature:

- `planner-svg-accessible-name` — the label exposes `Host fixture Alpha` to the
  accessibility tree (`img "<name>"`), not just visually.
- `planner-svg-real-hover` — the hovered element is
  `.spiral-day-planner__external-label`.
- `planner-svg-tooltip-delay-observed` — the host tooltip really waited
  (`elapsedMilliseconds >= 900`), so a screen change is observable.
- `planner-svg-hover-no-page-errors` — hovering raised no page errors.
- `planner-Collapse planner` → `planner-Expand planner` and
  `planner-Hide completed items` → `planner-Show completed items` (`full` lane
  only) — each button flips the paired control.
- `activation-preserves-all-markdown`, `planner-tooltip-preserves-all-markdown`
  — opening and inspecting the Planner writes nothing.
- Screenshots `planner.png`, `planner-svg-tooltip-hover.png`,
  `planner-after-tooltip.png` under `host-<lane>/evidence/`.

Playback, copy-summary, and the refresh button are not driven by the host
runner. Their proof today is the focused suite
`tests/ui/planner/run.mjs` (state, summary, geometry, responsive layout), which
`mise exec node@24.20.0 -- npm run verify` runs.

## Gotchas

- Planner is read-only by contract. If a drive leaves Markdown changed, that is
  a product bug, not a test to relax (`docs/AGENTS` rule: writes only after an
  explicit action).
- The view is a leaf of type `spiral-day-planner`; `app.workspace.detachLeavesOfType`
  is how the lifecycle scenario closes it, not a UI click.
- The empty-state text varies by state (no note / no markers / invalid markers /
  no list items). Drive the state you mean; `Insert into today's Daily Note`
  only appears once the note exists.
