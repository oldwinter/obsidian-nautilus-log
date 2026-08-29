# DEV-006: Map Execution workflows to native Obsidian surfaces

Status: proposed, pending parity and product/release approval
Class: HOST
Owner: ticket #22 planning record; implementation ticket #27
Proposed: 2026-08-29
Approved: pending
Requirements: `UP-SET-08`, `UP-SET-10`, `UP-EXE-03`, `UP-EXE-04`, `UP-EXE-05`, `UP-EXE-12`, `UP-CLK-10`, `UP-CMD-02`, `UP-ERR-05`, `UP-ERR-07`, `UP-ERX-06`, `UP-ERX-07`, `UP-DRF-07`

## Upstream observation

Roam Nautilus Log v1.0.2 exposes Execution through a topbar trigger, anchored
popover, block menu, main-window navigation, and right-sidebar block windows.
These surfaces carry idle, active, POMO, forgotten, Timing, Plan, Review,
navigation, modifier, warning, and task-fronting behavior. The frozen evidence
is upstream
[`timing-topbar.js`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L72-L144)
and [`timing-roam.js`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L387-L565).

## Obsidian behavior

Roam topbar, anchored popover, block menu, main-window navigation, and
right-sidebar windows map to a plugin-owned Obsidian Execution entry, accessible
Timing/Plan/Review panel, conditional editor menu, authoritative source
navigation, and one singleton `ActiveTaskView`. Availability, state and timing
information, modifier distinction, one-step source access, warning meaning,
focus restoration, and zero-write unavailable behavior remain equivalent;
repeated open never duplicates leaves.

The native mapping preserves each linked observable contract separately:

- Execution remains default-off; enabling registers the entry, poller, exactly
  three palette commands, conditional editor commands, and dependent settings;
  failed activation resets off.
- Keep Active Task first is Boolean and default-on. Clock In or switch promptly
  reveals one singleton `ActiveTaskView`; fronting failure warns but never rolls
  back a successful CLOCK mutation.
- The entry preserves idle, elapsed/thread-count, standalone POMO stop,
  threshold, and forgotten-warning states. Its panel preserves outside/Escape
  close, focus return, Nautilus identity, and Timing/Plan/Review tabs.
- Identity activation locates the Primary Plan in the main editor and flashes it
  for about 1.2 seconds with no Shift alternate. Task-title activation locates
  source in the main editor while Shift reveals `ActiveTaskView`.
- The editor context menu exposes Clock In only for an unfinished TODO and Clock
  Out only for the focused task, and removes both on teardown.
- Missing Primary, unavailable source, unavailable `ActiveTaskView`, and failed
  fronting retain operation-specific panel/Notice feedback and zero-write or
  mutation-preserving behavior as applicable.

## Rationale and alternatives

This preserves conditional actions, idle/active/POMO/forgotten state visibility,
Timing/Plan/Review hierarchy, Shift navigation distinction, one-step source
access, optional-navigation failure semantics, keyboard/focus behavior,
singleton fronting, and stale/missing-source zero-write behavior. Users receive
native Obsidian workflows. Imitating Roam chrome through private DOM, duplicate
leaves, a bare Markdown leaf, collapsing modifier paths, and making navigation
transaction authority were rejected.

## Acceptance

- The declared tests for `UP-SET-08`, `UP-SET-10`, `UP-EXE-03`, `UP-EXE-04`,
  `UP-EXE-05`, `UP-EXE-12`, and `UP-CLK-10` run all five accepted evidence
  modalities; `TC-UP-CMD-02-001..003`, the four accepted tests for each linked
  error/copy row, and `TC-UP-DRF-07-001` close the remaining workflows.
- `FX-02`, `FX-13`, `FX-14`, `FX-15`, and `FX-16` cover ordinary, compact,
  navigation, command, unavailable, and failure states in `ENV-PURE`, `ENV-VIS`,
  every `ENV-HOST-*` profile, and `ENV-A11Y` as declared by each requirement.
- `TC-UP-ERX-07-001..004` freeze the four native branch strings exactly:
  `Obsidian workspace leaves are unavailable.`,
  `Obsidian could not move the Active Task view to the front.`,
  `Could not open this task in Active Task.`, and fallback
  `The task started, but Obsidian could not show it in Active Task.`
- Evidence remains bound to the exact release candidate SHA.

## Rollback and revisit

Rollback reverts ticket #27 composition-root registrations, Execution adapters,
UI, styles, source navigation, and `ActiveTaskView` as one boundary; the runtime
remains unreachable/testable and Markdown stays unchanged. Revisit if public
APIs cannot reveal and focus one singleton leaf or authoritative-ID navigation
cannot be preserved.

## Approvals

- Parity reviewer: pending explicit approval of this exact DEV record.
- Product/release owner: pending explicit approval of this exact DEV record.
