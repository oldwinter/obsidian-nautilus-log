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
- `transitions`: action -> source states; a mirror of the runner's canonical
  rules that `loadBacklog` validates — entries that widen a gate or name an
  unknown action fail closed at load time. The runner is authoritative.
- `items`: array of work items.

## Item

`id`, `title`, `kind`, `priority`, `state`, `attempts`, `max_attempts`,
`module_boundary`, `implementation`, and `acceptance_criteria` are required;
the load-time validation in `run.mjs` enforces the types stated below and
rejects empty or wrong-typed values before any command runs.

- `id`: `FAC-NNN` (matches `^[A-Z]+-\d+$`, unique, never reused).
- `title`: one non-empty line.
- `kind`: non-empty free-form label; items so far use `code-change`,
  `verification`, `audit`, or `factory`.
- `priority`: integer; `next` picks lowest first.
- `state`: one of `states`.
- `attempts`, `max_attempts`: retry bookkeeping; a `failed` item may be
  re-claimed with `claim --retry` while `attempts < max_attempts`.
- `module_boundary`: globs bounding the item's allowed diff (`*` = one path
  segment, `**` = any depth, a trailing `/` = that directory prefix). Every
  entry must be a non-empty string. `implemented` fails when the working
  tree contains changes outside it.
  `factory/backlog.json` and `.codex/` are always exempt.
- `allow_empty_diff`: boolean; when true, `implemented` accepts a clean tree
  (verification/audit items that produce evidence only).
- `implementation`: non-empty string describing the expected work.
- `acceptance_criteria`: `[{ id, description, check }]`; every check must
  pass during `verify`. Check types:
  - `{ "type": "command", "command": "...", "timeout_ms"?: n }` runs via `sh -c`
    at the repo root with `FACTORY_ROOT`, `FACTORY_ITEM_ID`, and
    `FACTORY_EVIDENCE_DIR` in the environment. `command` must be non-empty;
    `timeout_ms` when present must be a positive integer (default 600000).
  - `{ "type": "file-exists", "path": "..." }`.
  - `{ "type": "json-field", "path": "...", "field": "a.b", "equals": "..." }`.
  `path` must resolve inside the worktree; `json-field` requires `field` and
  `equals` (the assertion compares `String(actual)` against it).
- `verify`: extra commands run only after all acceptance checks pass
  (heavier lanes; failures also mark the item failed).
- `notes`: provenance/limitation notes.

## Runner-maintained fields

A successful `verify` stamps the item; `deliver` refuses a stale stamp:

- `verified_head`: git HEAD at verify time; a HEAD move invalidates.
- `verified_contract`: sha256 of the acceptance criteria and `verify`
  commands; any contract edit invalidates.
- `verified_work`: sha256 of the non-exempt worktree the verifier read
  (tracked diff + untracked file bytes; without git, every non-exempt file
  under the root). Any source edit invalidates. `.codex/` and the backlog's
  own directory are exempt, so state and evidence bookkeeping never
  invalidates a stamp.

Any of the three rejecting means `deliver` exits nonzero with
`verification is stale`; the item stays `verified` and a rerun of `verify`
restamps cleanly.

## Evidence model

Volatile evidence never enters git: `.codex/runtime/devin-factory/` holds
`progress.jsonl`, `status.md`, `items/<id>.jsonl`, `evidence/`, and
`deliveries/<id>/attempt-<n>/` (change.patch, bundle.json, files/,
evidence.json, summary.md). `evidence.json.checks` embeds the attempt's
check outcomes and `item_log_sha256`/`item_log_bytes` bind the per-item
JSONL prefix. A delivery is reviewable on its own; commits on the factory
branch checkpoint `factory/backlog.json` state alongside the delivered diff.
