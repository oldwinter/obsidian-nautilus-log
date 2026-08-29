# DEV-007: Report native Vault and Editor failures

Status: proposed, pending parity and product/release approval
Class: HOST
Owner: ticket #22 planning record; implementation ticket #27
Proposed: 2026-08-29
Approved: pending
Requirements: `UP-ERR-06`, `UP-ERX-03`, `UP-ERX-04`

## Upstream observation

Roam Nautilus Log v1.0.2 reports graph-query, block-UID, create, update, delete,
drawer/CLOCK, ownership, completion, and confirmation failures through
operation-specific Roam error strings, command toasts, popover notices, and
logs. The frozen evidence is upstream
[`timing-roam.js`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L126-L460)
and [`timing-runtime.js`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L151-L449).

## Obsidian behavior

Roam graph-query, block-UID, create, update, and delete failures map to specific
Obsidian Vault, Editor transaction, source-identity, and authoritative-
confirmation failures. Localized Notice or panel output identifies the failed
operation; no mutation is reported successful without authoritative reread and
confirmation.

Native read/write copy distinguishes Vault read unavailable, unreadable
Markdown, Markdown insertion unavailable, Editor update unavailable, missing
authoritative deletion identity, and Markdown deletion unavailable. Native
confirmation copy separately distinguishes deletion, LOGBOOK creation, Clock
In, current CLOCK read, Clock Out, and task completion. Command paths use a
Notice; panel paths retain notice state after refresh and log the operation.

## Rationale and alternatives

This preserves operation-specific diagnostics, command/panel visibility,
LOGBOOK/CLOCK creation and closure, completion-confirmation semantics, and the
rule that no unauthorized write or false success is allowed. Users see errors
that name real Obsidian and Markdown operations. Retaining `Roam ...` copy,
collapsing every failure into a generic fallback, and inferring success from an
API return without reread were rejected.

## Acceptance

- `TC-UP-ERR-06-001..004`, `TC-UP-ERX-03-001..004`,
  `TC-UP-ERX-04-001..004`, `FX-15`, and `FX-16` cover every mapped read, write,
  identity, transaction, and postcondition failure with zero false success.
- Evidence runs in `ENV-PURE`, every `ENV-HOST-*` profile, and `ENV-A11Y` and
  remains bound to the exact release candidate SHA.

## Rollback and revisit

Rollback reverts host error mapping and localized copy while leaving the core
and write protocol unchanged; no data rollback is required. Revisit on material
public Obsidian Vault or Editor error-contract changes.

## Approvals

- Parity reviewer: pending explicit approval of this exact DEV record.
- Product/release owner: pending explicit approval of this exact DEV record.
