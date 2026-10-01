# DEV-004: Review clear-search control

Status: proposed. Owner: oldwinter. Proposed on 2026-10-02.
Class: HOST. Linked requirement: UP-EXE-08.

The upstream Review title-navigation workflow is recorded in
`docs/research/execution-layer.md`, under Review state machine.
The Obsidian adapter already offers local title search and a Clear filters
control. This proposal adds Clear search beside the title search field so
pointer users can clear only that query without losing the overrun filter.
The button appears for nonempty input, including whitespace, and returns
focus to the search field. It does not change date selection, row ordering,
whole-day totals, timing state, persistence, or Markdown-write behavior.

Acceptance evidence covers pointer and keyboard activation, focus recovery,
combined filtering, whitespace, both locales, and narrow layout. Browser
adapter evidence is not native Obsidian or screen-reader acceptance. This
proposal is not human parity approval or release sign-off and does not alter
the canonical five-state or numerical Review contract.

Rollback removes the button, its scoped styles and localized strings. Existing
Esc-to-clear and Clear filters remain available.
