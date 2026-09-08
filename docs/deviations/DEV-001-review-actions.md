# DEV-001: Today-only Review task actions

Status: proposed. Owner: oldwinter. Proposed on 2026-09-08.
Class: HOST. Linked requirement: UP-EXE-08. The requirement's numerical and
five-state contract remains unchanged; release acceptance is pending this
proposal's approval and the affected evidence.

Upstream Review exposes title navigation and no timing/completion action
column. The frozen observation is in
[Execution research](../research/execution-layer.md#review-state-machine),
including its immutable upstream source references. In contrast,
[issue #29](https://github.com/oldwinter/obsidian-nautilus-log/issues/29)
explicitly asks for Clock In and Complete actions through the existing runtime.

The proposed Obsidian behavior keeps the existing summary and metrics and adds
conditional Clock In and Complete buttons below today's unfinished rows. It
uses the same serialized execution commands and source revalidation as Timing
and Plan. Past and future dates are read-only. Missing or colliding targets,
stale data, pending writes, degraded timing, and over-limit history disable
changes. Identified source navigation remains available on confirmed dates.

The alternative is to reproduce upstream's read-only Review and amend #29's
action requirement accordingly. An action column was rejected because it would
change the information hierarchy and consume narrow-panel width. The proposed
buttons remove the need to find the same task again in Plan while preserving
Review's states, ordering, comparison population, and Actual calculation.

Acceptance requires the Review browser suite, coordinator/source tests, actual
Obsidian Clock In/Complete byte diffs, live-minute transition, past/current/future
navigation, keyboard/focus, both locales/themes, zoom and screen-reader checks.
Changed goldens require review. Screenshots of this proposal must be labelled
adapted behavior. Browser evidence alone is not native or human acceptance.

Rollback removes the Review action controls while retaining read-only rows,
source navigation, date selection, and the existing Timing/Plan commands.
Revisit if action availability, command meaning, source safety, or narrow-panel
accessibility diverges from the reviewed behavior.

Parity approval: pending the required reviewer; automated design review is
supporting material only.

Product/release approval: pending an explicit decision on the concrete proposal.
No human approval, release sign-off, or approved machine-ledger entry is claimed.
On approval, link DEV-001 bidirectionally in the requirement and deviation
manifests, record actual reviewers and timestamps, and rerun candidate evidence.
