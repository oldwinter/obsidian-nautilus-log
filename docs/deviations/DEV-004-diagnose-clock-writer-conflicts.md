# DEV-004: Gate Execution on attestation and safe CLOCK data

Status: proposed, pending parity and product/release approval
Class: SAFETY
Owner: ticket #22 planning record; implementation ticket #27
Proposed: 2026-08-29
Approved: pending
Requirements: `UP-ERR-03`, `UP-ERX-08`

## Upstream observation

Roam Nautilus Log v1.0.2 probes host extension state when Execution is enabled.
If it detects the legacy Roam Logbook writer, it resets the master switch and
shows a five-second danger toast naming that extension and the one-writer rule.
The frozen evidence is upstream
[`timing-roam.js`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L567-L617)
and [`timing-runtime.js`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L437-L447).

## Obsidian behavior

During an explicit Enable Execution attempt, Spiral Day requires the user to
attest that no other CLOCK writer is enabled and requires the bounded
authoritative CLOCK index to prove a safe CLOCK data state. If the attestation
is absent or the data check fails, Spiral Day performs zero Markdown writes,
leaves Execution disabled, shows a localized five-second danger Notice, and
exposes the read-only diagnosis and Timing Repair entry. It inspects neither
Roam globals or DOM nor private Obsidian plugin registries and never claims that
it detected or identified another writer.

## Rationale and alternatives

The bounded CLOCK index can detect unsafe data but cannot prove that another
plugin will not write later. The explicit attestation covers that unobservable
part without overstating host knowledge. This preserves the single-writer goal,
five-second danger feedback, disabled state, zero-write handling, and an
actionable recovery path. Private `app.plugins` probing, Roam DOM/global probes,
marking the guard not applicable, and guessing another plugin identity were
rejected.

## Acceptance

- `TC-UP-ERR-03-001..004`, `TC-UP-ERX-08-001..004`, and `FX-16` cover missing
  attestation, accepted attestation, safe and conflicting CLOCK data, disabled
  rollback, exact duration/meaning, localized Notice and panel output, zero
  writes, and Timing Repair availability.
- Tests prove that the UI and logs make no claim that an external writer was
  detected and that a data-safe index alone never substitutes for attestation.
- Evidence runs in `ENV-PURE`, every `ENV-HOST-*` profile, and `ENV-A11Y` and
  remains bound to the exact release candidate SHA.

## Rollback and revisit

Rollback reverts the activation guard and copy and leaves Execution disabled;
it never rewrites old note bytes. Revisit only if a public trusted inter-plugin
writer capability or protocol can prove exclusivity without private host state.

## Approvals

- Parity reviewer: pending explicit approval of this exact DEV record.
- Product/release owner: pending explicit approval of this exact DEV record.
