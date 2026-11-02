# DEV-002: Copy the Review summary

Status: proposed. Proposed on 2026-09-30. Class: HOST.
Related requirement: UP-EXE-08. The frozen Review comparison contract remains
unchanged. This document does not claim parity approval or release sign-off.

The Review workflow in `docs/research/execution-layer.md` provides date-scoped
counts and comparison totals. This Obsidian adaptation adds
**Copy review summary** beside those totals so users can paste a daily recap
into a note or another application.

The copied text contains the displayed ISO date, completed and compared counts,
and the same comparable-only Planned, Actual, and Variance totals as Review.
Search and overrun filters do not change the exported whole-day summary. English
and Simplified Chinese use the current plugin language. No comparable tasks
produce missing-value marks rather than zero totals.

Only an explicit activation writes to the clipboard. It never writes Markdown
or plugin data. Past and future dates remain eligible because copying is
read-only. Unavailable or stale data, pending mutations, and write-blocked
execution disable the action. One copy can remain in flight per view. Date,
language, source, visibility, or lifecycle changes suppress obsolete feedback.
An already-started browser clipboard operation cannot be cancelled.

Verification covers exact bilingual text, filters, missing comparisons,
clipboard rejection, duplicate clicks, delayed date selection, disposal,
keyboard focus, and narrow layout. Native Obsidian acceptance checks the real
clipboard and unchanged Markdown hashes in a disposable vault. Browser evidence
alone does not establish native-host or screen-reader acceptance.

Rollback removes the copy control, its injected clipboard callback, localized
strings, and associated tests. Existing Review metrics, task actions, and date
navigation remain available. Human parity and product approval remain part of
PR and release review; no approved machine-ledger entry is added here.
