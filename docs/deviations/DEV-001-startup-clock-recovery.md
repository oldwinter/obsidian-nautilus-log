# DEV-001: Diagnose legacy CLOCK conflicts at startup

Status: proposed, pending parity and product/release approval
Class: SAFETY
Owner: ticket #26
Proposed: 2026-08-28
Approved: pending
Requirements: `UP-CLK-04`

## Upstream observation

Roam Nautilus Log v1.0.2 performs a complete LOGBOOK scan at startup, chooses
the newest valid open CLOCK as focused, closes older open CLOCKs at that start,
and closes open CLOCKs owned by DONE tasks. Invalid CLOCK strings are ignored.
The frozen evidence is the upstream
[`timing-runtime.js`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L77-L149)
implementation.

## Obsidian behavior

Spiral Day performs the same complete startup scan but treats Markdown as the
only authority. Exactly one valid running CLOCK with a uniquely resolved
eligible owner resumes. Zero valid running CLOCKs yields Idle. Multiple valid
running records, malformed potential-running records, DONE/ineligible/missing
owners, duplicate identities, and stale sessions publish stable read-only
recovery diagnostics. Startup never closes, deletes, normalizes, deduplicates,
or otherwise writes Markdown.

Timing Repair is the only recovery path for these states. It previews the exact
target and replacement, revalidates the current source, and writes only after a
fresh explicit user confirmation. Unrelated Markdown remains byte-identical.

## Rationale and alternatives

Automatic repair was rejected because startup has no fresh user intent and
cannot distinguish corrupted data from the only surviving record of work. A
persisted recovery journal was rejected as a second authority. Automatic retry,
compensating reopen, and lifecycle-triggered closure were rejected because each
can fabricate time or race an external Markdown edit. The accepted timing-write
safety decision already fixes this behavior; this record makes its relationship
to `UP-CLK-04` explicit rather than changing the decision.

## Acceptance

- Unit and vault tests cover zero, one, and multiple valid running CLOCKs;
  DONE, missing, ineligible, duplicate, malformed, and stale owners; and a full
  startup LOGBOOK scan.
- Lifecycle and integration tests prove zero startup writes and stable recovery
  codes across reload.
- Timing Repair tests prove preview, explicit confirmation, semantic CAS,
  byte-preserving unrelated content, and fail-closed conflict behavior.
- Evidence runs in the `UP-CLK-04` declared environments and remains bound to
  the exact release candidate SHA.

## Rollback and revisit

Rollback disables Execution or reverts the #26 runtime without replaying older
note bytes. Revisit only if a future public Obsidian API can provide atomic,
identity-stable recovery while preserving explicit user intent and the
Markdown-only authority model.

## Approvals

- Parity reviewer: pending explicit approval of this exact DEV record.
- Product/release owner: pending explicit approval of this exact DEV record.

Normative basis: [timing-write safety decision](https://github.com/oldwinter/obsidian-nautilus-log/blob/03e7a8d734a3eec99c8be5b8ce0edde65d9e9a54/docs/decisions/timing-write-safety-conflict-handling-and-recovery.md#reload-crash-and-retry-semantics)
and [approval ledger](https://github.com/oldwinter/obsidian-nautilus-log/blob/564dc5317612ceef47b0d9d22387868bae773c47/docs/parity/source-ledger.json).
