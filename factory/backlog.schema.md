# factory/backlog.json schema (schema_version 1)

One JSON document; the local durable queue for bounded factory work items.
GitHub issues remain the canonical product queue — this queue covers
factory-chore and evidence items that do not duplicate an open issue or PR.

## Top level

- `schema_version`: `1`.
- `queue`, `note`: human context.
- `states`: the ordered factory states. Order is normative for the forward
  path `ready -> claimed -> implemented -> verifying -> verified -> delivered`;
  `failed`, `blocked`, `cancelled` are non-forward states.
- `transitions`: action -> source states; advisory mirror of the rules
  enforced by `scripts/factory/run.mjs` (the runner is authoritative).
- `items`: array of work items.

## Item

- `id`: `FAC-NNN` (matches `^[A-Z]+-\d+$`, unique, never reused).
- `title`: one line.
- `kind`: `code-change`, `verification`, `audit`, or `docs`.
- `priority`: integer; `next` picks lowest first.
- `state`: one of `states`.
- `attempts`, `max_attempts`: retry bookkeeping; a `failed` item may be
  re-claimed with `claim --retry` while `attempts < max_attempts`.
- `module_boundary`: glob prefixes that bound the item's allowed diff
  (`*` = one path segment, `**` = any depth). `implemented` fails when the
  working tree contains changes outside it. `factory/backlog.json` and
  `.codex/` are always exempt.
- `allow_empty_diff`: when true, `implemented` accepts a clean tree
  (verification/audit items that produce evidence only).
- `implementation`: what the operator/agent is expected to do.
- `acceptance_criteria`: `[{ id, description, check }]`; every check must
  pass during `verify`. Check types:
  - `{ "type": "command", "command": "...", "timeout_ms"?: n }` runs via `sh -c`
    at the repo root with `FACTORY_ROOT`, `FACTORY_ITEM_ID`, and
    `FACTORY_EVIDENCE_DIR` in the environment.
  - `{ "type": "file-exists", "path": "..." }`.
  - `{ "type": "json-field", "path": "...", "field": "a.b", "equals": "..." }`.
- `verify`: extra commands run only after all acceptance checks pass
  (heavier lanes; failures also mark the item failed).
- `notes`: provenance/limitation notes.

## Evidence model

Volatile evidence never enters git: `.codex/runtime/devin-factory/` holds
`progress.jsonl`, `status.md`, `items/<id>.jsonl`, `evidence/`, and
`deliveries/<id>/attempt-<n>/` (change.patch, files/, evidence.json,
summary.md). A delivery is reviewable on its own; commits on the factory
branch checkpoint `factory/backlog.json` state alongside the delivered diff.
