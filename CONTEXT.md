# Spiral Day Context

This glossary is the canonical language for the Obsidian parity port. It keeps
upstream scheduling and execution concepts distinct from Obsidian storage and UI
mechanisms.

User-facing documentation starts with the [user guide](docs/user-guide.md)
and the [Chinese user guide](docs/user-guide.zh.md).
Use the [Markdown grammar reference](docs/reference/markdown-grammar-v1.md) for
plan syntax, the [settings reference](docs/reference/settings.md) for defaults
and Daily Note paths, and the [troubleshooting guide](docs/troubleshooting.md)
for blocked or unavailable states. The files in `docs/decisions/` explain the
design constraints that maintainers must preserve.

Normative implementation precedence belongs to the
[canonical implementation dossier](docs/implementation-dossier.md). This file
defines terms and must be updated with the dossier when a contract changes.

## Planning

**Daily Note**:
The date-scoped Markdown note whose eligible items form one day's planning input.
_Avoid_: Daily Page, journal entry

**Plan Region**:
The explicitly bounded and versioned part of a Daily Note that supplies planning input.
_Avoid_: Plan section, task area

**Plan Item**:
An eligible direct item in the Primary Plan that the planner interprets as either a Fixed Event or Flexible Task.
_Avoid_: Block, record

**Primary Plan**:
The one Plan Region in a Daily Note that supplies the authoritative day plan.
_Avoid_: Main section, first task list

**Plan Item ID**:
The durable, vault-scoped identity of a Plan Item independent of its wording or location.
_Avoid_: UID, line key, task hash

**Grammar Version**:
The declared contract that determines how a Plan Region's source becomes Plan Items.
_Avoid_: Plugin version, schema version

**Fixed Event**:
A Plan Item with an explicit start time that reserves its position on the day timeline.
_Avoid_: Appointment block, pinned task

**Flexible Task**:
A Plan Item without a fixed start time that the Scheduler places into available time in source order.
_Avoid_: Floating event, backlog item

**Duration**:
The amount of timeline capacity required by a Plan Item, either written explicitly or supplied by the default-duration rule.
_Avoid_: Estimate, length

**Scheduler**:
The deterministic domain operation that combines Fixed Events, Flexible Tasks, day bounds, and the current-time boundary into a day plan.
_Avoid_: Calendar engine, optimizer

**Planned Slot**:
The Scheduler's placement of one Plan Item on the day timeline.
_Avoid_: Time block, allocation

**Overflow**:
A Flexible Task that remains visible because it cannot fit within the available day capacity.
_Avoid_: Hidden backlog, dropped task

## Execution

**Execution Layer**:
The optional Timing, Plan, Review, CLOCK, and POMO capabilities layered on top of the visual day plan.
_Avoid_: Productivity mode, tracking add-on

**Active Task**:
The single Plan Item currently associated with CLOCK timing.
_Avoid_: Selected task, current block

**ActiveTaskView**:
The dedicated singleton Obsidian `ItemView` that projects the Active Task and
reveals/focuses its one existing leaf when opened again. It owns no canonical
task state and is not the source Markdown leaf.
_Avoid_: Active Task panel, planner selection

**CLOCK**:
The task-bound timing interval that takes precedence over POMO and can be persisted in LOGBOOK-compatible Markdown.
_Avoid_: Stopwatch, timer

**POMO**:
The umbrella focus-cycle concept covering Task POMO and Standalone POMO. CLOCK
is authoritative whenever a valid running CLOCK exists.
_Avoid_: Stopwatch, generic timer

**Task POMO**:
A focus cycle bound to the Active Task. Its absolute start persists in plugin
data, it exists only while the Active Task remains valid, and it is suppressed
by the authoritative CLOCK presentation rather than becoming a second timer.
_Avoid_: Standalone timer, task duration

**Standalone POMO**:
An unbound focus cycle that starts only when there is no CLOCK, persists its
absolute start in plugin data, and clears before Clock In. If restore observes
both states, CLOCK wins and the standalone state is removed.
_Avoid_: Task POMO, CLOCK

**LOGBOOK**:
The Markdown property section used to persist compatible CLOCK timing history when that option is enabled.
_Avoid_: Activity database, audit log

## Acceptance

**Parity Requirement**:
A stable, never-reused statement of one observable baseline behavior or approved Obsidian adaptation that a release must satisfy.
_Avoid_: Feature checklist, test case

**Evidence Record**:
An immutable result that links one Release Candidate, environment, test, and set of Parity Requirements.
_Avoid_: Test output, screenshot folder

**Deviation**:
An explicitly approved Obsidian-native difference from the baseline, limited to host integration, accessibility, theme, or write safety without changing scheduling semantics or the core workflow.
_Avoid_: Bug waiver, omission

**Release Candidate**:
One exact Git commit and its deterministic package assets evaluated together by the release gates.
_Avoid_: Branch head, latest build
