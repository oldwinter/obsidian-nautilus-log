# DEV-005: Fail Execution activation atomically

Status: proposed, pending parity and product/release approval
Class: HOST
Owner: ticket #22 planning record; implementation ticket #27
Proposed: 2026-08-29
Approved: pending
Requirements: `UP-ERR-08`, `UP-ERX-05`

## Upstream observation

Roam Nautilus Log v1.0.2 throws `Roam command-palette actions are unavailable.`
when its palette API is missing and resets Execution off. Its tests do not
establish whether the host presents that setting-handler error beyond console
or host UI. The frozen evidence is upstream
[`timing-commands.js`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-commands.js#L21-L50)
and [`index.js`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L170-L233).

## Obsidian behavior

If any required public Obsidian command registration fails during Execution
activation, Spiral Day disposes every partial command, menu, and UI registration,
tears down the poller and runtime, persists Execution disabled, performs zero
Markdown writes, logs the host cause, and shows a localized five-second Notice:
`Nautilus Log commands are unavailable. Execution remains disabled.` The
unrelated action messages remain `Focus an unfinished TODO block before starting
timing.` and fallback `Nautilus Log could not complete that action.`

## Rationale and alternatives

This preserves atomic activation, no lasting partial command surface, reset-off
behavior, zero Markdown writes, and the existing focus/non-TODO messages in
`UP-ERX-05`. Users get a deterministic visible failure. Testing for a missing
Roam palette API, console-only failure, leaving partial commands registered, and
reporting success despite failure were rejected.

## Acceptance

- `TC-UP-ERR-08-001..004`, `TC-UP-ERX-05-001..004`, and `FX-16` cover failure at
  each registration boundary, complete disposal, disabled persistence, exact
  Notice meaning/duration, stable other messages, and zero Markdown writes.
- Evidence runs in `ENV-PURE`, every `ENV-HOST-*` profile, and `ENV-A11Y` and
  remains bound to the exact release candidate SHA.

## Rollback and revisit

Rollback reverts the registration guard and copy while leaving Execution
disabled on incompatibility. Revisit when the minimum-supported Obsidian command
registration contract changes or provides atomic registration.

## Approvals

- Parity reviewer: pending explicit approval of this exact DEV record.
- Product/release owner: pending explicit approval of this exact DEV record.
