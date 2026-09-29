# Spiral Day devin-factory

A small executable factory for this repository: it takes one bounded work item
at a time from `factory/backlog.json` through intake, implementation,
verification, and a reviewable delivery artifact. It reuses the repo's own
tooling (`npm run verify`, focused `tests/*/run.mjs` lanes, `node --test`
suites, release scripts) and introduces no competing control system.

GitHub issues remain the canonical product queue. `factory/backlog.json` holds
local factory-chore and evidence items only; it must not duplicate an open
issue or active PR. See `factory/backlog.schema.md` for the item contract.

## Layout

- `factory/backlog.json` — durable queue: items, acceptance criteria, ordered
  states, retry bookkeeping. Committed.
- `scripts/factory/run.mjs` — the factory entry point (Node stdlib only).
- `scripts/factory/checks/` — lane wrappers used by acceptance checks.
- `npm run audit:docs` — standalone doc-surface audit (command titles,
  settings labels, internal-code hygiene); same script FAC-105 delivered.
- `scripts/factory/audits/` — committed audit tools used by audit items.
- `tests/factory/` — the factory's own test lane (auto-discovered by
  `npm test` via `tests/**/*.test.mjs`).
- `.codex/runtime/devin-factory/` — volatile runtime evidence, gitignored:
  `session.json`, `progress.jsonl`, `status.md`, `items/<id>.jsonl`,
  `evidence/`, `deliveries/`.

## Run

```sh
node scripts/factory/run.mjs list           # queue overview
node scripts/factory/run.mjs next           # next ready item (full spec)
node scripts/factory/run.mjs show FAC-101   # one item's stored fields
node scripts/factory/run.mjs inspect FAC-101  # audit a delivery bundle (read-only)
node scripts/factory/run.mjs add --file item.json   # append a ready item
node scripts/factory/run.mjs claim FAC-101  # ready -> claimed (attempt +1)
# ... do the item's `implementation` work inside its module_boundary ...
node scripts/factory/run.mjs implemented FAC-101   # claimed -> implemented
node scripts/factory/run.mjs verify FAC-101        # run acceptance + verify
node scripts/factory/run.mjs deliver FAC-101       # verified -> delivered
```

`verify` exits nonzero and marks the item `failed` on the first failing
check; it never records success after a failure. Command checks run in
their own process group, so a `timeout_ms` deadline (or a runner signal)
SIGKILLs every descendant — backgrounded work cannot write after
cancellation. A successful `verify` stamps
the item with the HEAD, the acceptance-contract hash, and a worktree
fingerprint; `deliver` refuses when any of them drifted since verify
(`verification is stale`) — rerun `verify` to restamp. `deliver` writes
`.codex/runtime/devin-factory/deliveries/<id>/attempt-<n>/` with
`change.patch`, `bundle.json` (the captured diff file list), untracked-file
copies, `evidence.json`, and `summary.md` — the reviewable artifact.
`evidence.json` embeds the attempt's check results plus `item_log_sha256`
and `item_log_bytes`, so a reviewer can re-hash the per-item JSONL prefix
even after later events extend it. `deliver` on an already-delivered item
is an idempotent no-op that prints the existing bundle (and rebuilds
`evidence.json`/`summary.md` if a crash left them missing).

`add` validates the payload (schema, unique id, acceptance criteria) and
always appends at `ready` with a fresh attempt counter — later states are
reachable only through the pipeline commands. `--file -` reads the item JSON
from stdin.

Self-test without touching the repo:

```sh
node scripts/factory/run.mjs dry-run   # sandboxed full pipeline incl. failure+retry
node --test tests/factory/             # unit lane
npm run verify                         # repo gate; includes tests/factory/
```

## Inspect

```sh
node scripts/factory/run.mjs status    # counts + item table + recent JSONL events
cat .codex/runtime/devin-factory/progress.jsonl   # every transition/check, JSONL
cat .codex/runtime/devin-factory/items/FAC-101.jsonl  # per-item evidence
```

Each progress row carries timestamp, event, item, attempt, prior/next state,
check exit codes, kill signal, durations, output tails, and the current
git HEAD.

Mutating commands serialize on `.codex/runtime/devin-factory/run.lock/`
— a lock *directory* (`mkdir` is atomic) holding `owner.json` with the
owner pid. A second mutation fails with "factory already running".
There is no automatic reclaim: removing or renaming an existing lock
opens the slot to a third writer before any comparison can run, so a
dead pid, a missing/invalid `owner.json` (e.g. an owner that died
mid-creation), or a foreign lock entry all fail closed — confirm the
owner process is gone and remove the directory manually to recover.
`list`/`next`/`show`/`status`/`inspect` stay lock-free so you can
observe a long verify.

## Recover

- `verify` failure → fix the cause, then `claim <id> --retry` (bounded by
  `max_attempts`), `implemented`, `verify` again. Earlier attempts stay in the
  JSONL logs.
- Process died mid-`verify` → the item sits in `verifying`; rerun
  `verify <id>` to resume the same attempt.
- Process killed mid-command → `run.lock/` may be left behind; mutating
  commands fail closed ("stale or mid-initialization") until you confirm
  the owner pid is gone and remove the directory manually.
- Wrong claim → `release <id>` returns it to `ready`; `fail <id> --reason`
  records a terminal-for-this-attempt failure; `block`/`unblock` parks a
  `ready` item; `cancel <id> --reason` removes it from rotation.
- `record <id> --note "..."` appends free-form evidence (for example the
  commit SHA that checkpointed a delivery).

## Stop

The factory is not a daemon: each command is one short process. Nothing keeps
running between commands, so "stop" is simply not invoking the next command.
Ctrl-C during `verify` kills the running check's process group and leaves
the item in `verifying` (see Recover). No
command ever pushes, merges, deploys, or approves anything — those stay
manual gates.

## Environment knobs

- `FACTORY_ROOT` — repo root override (used by `dry-run` and tests).
- `FACTORY_ITEM_ID`, `FACTORY_EVIDENCE_DIR` — exported to check commands.
- `FACTORY_GIT_TIMEOUT_MS` — deadline for every `git` call the runner makes
  (default `60000`). A hung git fails the command and releases the lock
  instead of pinning the queue.
- `FACTORY_NODE24` — path to a Node 24.20.0 binary for pinned lanes
  (defaults to the mise install).
- `OBSIDIAN_EXECUTABLE` — host probe target (default `/Applications/Obsidian.app`).
- `PLAYWRIGHT_MODULE` — Playwright module dir for host probes.
