# Nautilus Log Context

This glossary is the canonical language for the Obsidian parity port. It keeps
upstream scheduling and execution concepts distinct from Obsidian storage and UI
mechanisms.

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

**CLOCK**:
The task-bound timing interval that takes precedence over POMO and can be persisted in LOGBOOK-compatible Markdown.
_Avoid_: Stopwatch, timer

**POMO**:
A standalone focus interval that is not bound to a Plan Item and yields to an active CLOCK.
_Avoid_: Pomodoro task, focus block

**LOGBOOK**:
The Markdown property section used to persist compatible CLOCK timing history when that option is enabled.
_Avoid_: Activity database, audit log
