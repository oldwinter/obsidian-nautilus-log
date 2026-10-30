# DEV-003: Localized Review weekday

Status: proposed. Owner: oldwinter. Proposed on 2026-09-30.
Class: HOST. Linked requirement: UP-EXE-08. Release acceptance is pending this
proposal's approval and the affected evidence.

The frozen v1.0.2 Review observation describes the summary, task rows, states,
metrics, and source navigation. It does not show a weekday beside the selected
date. The immutable source references are in
`docs/research/visual-interaction.md`
and `docs/research/execution-layer.md`.

The proposed Obsidian behavior adds one localized weekday below the Review date
toolbar. The native date input remains the date control. One nonfocusable
`<time>` element uses the same selected `LogicalDate` for its `dateTime` value and
visible weekday. UTC calendar construction prevents east or west time zones
from shifting the weekday. The line remains visible during loading and
unavailable states. It clears and hides while the native date input is blank or
contains an uncommitted date edit.

The alternative is to leave the native date input as the only calendar cue.
That input uses host and operating-system presentation, and it does not expose
the weekday consistently in the compact Review panel. An inline weekday inside
the toolbar was rejected because five controls already compete for width. A
separate muted line preserves the date input and button widths at 320 CSS px.

Acceptance requires the focused Review browser suite for English and Simplified
Chinese, pointer and keyboard date changes, Today, blank or uncommitted native editing, leap
day, supported year boundaries, stale and confirming snapshots, building and
unavailable states, east and west time zones, focus, and 320 CSS px geometry.
Native Obsidian review must confirm both themes, zoom, screen-reader output, and
the real date control. Browser evidence alone is not native or human acceptance.

Rollback removes the `<time>` element and its styles without changing date
selection, Review loading, history reads, task actions, or Markdown writes.
Revisit if Obsidian supplies a stable localized weekday in the native date
control or if the extra line harms narrow-panel access.

Parity approval: pending the required reviewer. Automated design review is
supporting material only.

Product/release approval: pending an explicit decision on this proposal. No
human approval, release sign-off, or approved machine-ledger entry is claimed.
