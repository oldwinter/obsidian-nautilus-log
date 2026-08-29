# DEV-003: Remove the obsolete component prefix control

Status: proposed, pending parity and product/release approval
Class: HOST
Owner: ticket #22 planning record; implementation ticket #27
Proposed: 2026-08-29
Approved: pending
Requirements: `UP-SET-04`

## Upstream observation

Roam Nautilus Log v1.0.2 inserts a configurable Component Prefix before newly
generated component render text. Execution Primary detection nevertheless
requires the literal `[[Nautilus Log]]`, so a custom or empty prefix can render
the chart while making Execution report that no Primary Plan exists. The frozen
evidence is upstream
[`index.js`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L287-L312)
and [`timing-core.js`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-core.js#L183-L224).

## Obsidian behavior

Component Prefix is not exposed in the Obsidian settings UI because native
ItemViews do not generate component render text. A migrated stored prefix is
retained but ignored. Primary Plan discovery uses the canonical Plan Region and
authoritative identity, so custom or empty legacy prefix data cannot hide an
otherwise valid Primary Plan. No Markdown is rewritten.

## Rationale and alternatives

This preserves migrated data, deterministic Primary identity, and zero
setting-triggered note rewrites while removing a known failure mode. Users no
longer see an obsolete no-op control, and legacy prefix data cannot break
Primary discovery. Deliberately preserving the matcher defect, inventing a
Markdown meaning for `#schedule`, and exposing a silent no-op control were
rejected.

## Acceptance

- `TC-UP-SET-04-001..005` and `FX-02` cover hidden UI, retained migrated data,
  prefix-independent Primary resolution, invalid data, reload, and zero note
  writes.
- Evidence runs in `ENV-PURE`, `ENV-HOST-PRIVATE`, `ENV-HOST-MIN`,
  `ENV-HOST-MAC`, `ENV-HOST-WIN`, and `ENV-HOST-LINUX` and remains bound to the
  exact release candidate SHA.

## Rollback and revisit

Rollback reverts only prefix migration/hiding and Primary decoupling; no note
migration is required. Revisit if a future canonical Plan Region explicitly
defines a configurable prefix or upstream fixes and standardizes component
identity.

## Approvals

- Parity reviewer: pending explicit approval of this exact DEV record.
- Product/release owner: pending explicit approval of this exact DEV record.
