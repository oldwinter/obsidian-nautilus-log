# DEV-002: Use native host registration and settings

Status: proposed, pending parity and product/release approval
Class: HOST
Owner: ticket #22 planning record; implementation ticket #27
Proposed: 2026-08-29
Approved: pending
Requirements: `UP-INS-02`, `UP-SET-03`, `UP-SET-13`

## Upstream observation

Roam Nautilus Log v1.0.2 creates and repairs a `roam/render` setup page,
template block, code block, and compiled ClojureScript child. Chart Start and
End use closed choice lists, update the generated renderer template, and take
effect from current extension settings even when serialized renderer arguments
are stale. The frozen evidence is the upstream
[`entry-helpers.js`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/entry-helpers.js#L112-L186),
[`index.js`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L397-L407),
and [`log-core.js`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L145-L179).

## Obsidian behavior

On first Obsidian load, Spiral Day idempotently registers native views,
commands, settings, and lifecycle disposers and performs zero vault writes. It
creates no `roam/render` page, template block, code block, or ClojureScript
child. Chart Start and End retain the exact closed choice lists and update
persisted plugin settings plus every mounted projection immediately. Current
validated runtime settings are authoritative; no serialized renderer arguments
or template rewrites exist.

## Rationale and alternatives

This preserves the exact start/end choices, current-settings precedence,
immediate mounted-view updates, idempotent lifecycle, and the rule that legacy
or unowned notes are not mutated. Users receive native Obsidian setup without
generated Roam scaffold clutter. Recreating an inert Roam scaffold, emulating
serialized renderer arguments solely for parity, and graph-wide template
rewrites were rejected because none has an Obsidian runtime purpose.

## Acceptance

- `TC-UP-INS-02-001..005`, `TC-UP-SET-03-001..005`, and
  `TC-UP-SET-13-001..005` cover idempotent registration, exact choices,
  persistence, immediate projection refresh, lifecycle disposal, and zero note
  writes through `FX-01` and `FX-02`.
- Evidence runs in `ENV-PURE`, `ENV-HOST-PRIVATE`, `ENV-HOST-MIN`,
  `ENV-HOST-MAC`, `ENV-HOST-WIN`, and `ENV-HOST-LINUX` and remains bound to the
  exact release candidate SHA.

## Rollback and revisit

Rollback reverts only ticket #27 host/settings composition; Markdown needs no
rollback. Revisit if Obsidian adds a public first-class serialized note renderer
or template lifecycle, or migration compatibility requires importing such
artifacts.

## Approvals

- Parity reviewer: pending explicit approval of this exact DEV record.
- Product/release owner: pending explicit approval of this exact DEV record.
