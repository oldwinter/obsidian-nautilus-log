# Timing write safety, conflict handling, and recovery

Status: Accepted on 2026-08-28

Decision ticket: [Decide: timing-write safety, conflict handling, and recovery](https://github.com/oldwinter/obsidian-nautilus-log/issues/10)

Functional baseline: upstream Nautilus Log `v1.0.2` at
[`973a041aa2f59f3b05bf31db8187efbfea07017a`](https://github.com/404KSG/roam-nautilus-log/tree/973a041aa2f59f3b05bf31db8187efbfea07017a).

## Decision

Spiral Day accepts one explicit write intent at a time through the vault-scoped
runtime. Each intent is decided from a fresh, coherent read and committed with a
semantic compare-and-swap inside one Editor transaction or one
`Vault.process()` transform per file. A unique Plan Item ID and CLOCK ID permit
structural relocation; a cached path, line, range, label, or equal text never
does. Unowned Markdown is byte-preserved.

All same-file effects of one action are atomic. A cross-file task switch closes
the old CLOCK before opening the new one. That ordering can leave the vault
safely idle after a failure or crash; the runtime's own effects cannot leave its
old and new CLOCKs open together. A concurrent external writer can still violate
the invariant and is caught by the post-commit scan. No cross-file operation is
described as atomic, no compensating write reopens elapsed time, and no failed
or uncertain write is blindly retried.

Every commit is followed by authoritative source confirmation and a vault-wide
running-CLOCK check before success is published. A changed but still uniquely
identified target may proceed only when the action's semantic preconditions and
watched bytes still match. Otherwise the action makes no write and requires a
fresh user intent. An uncertain or partial outcome enters reconciliation and
blocks later writes until every touched file and the running-CLOCK set have been
reread.

Reload and crash recovery derive state from Markdown rather than a hidden
journal. Startup never repairs, closes, deletes, normalizes, or deduplicates
Markdown. One valid running CLOCK with a uniquely resolved eligible owner
resumes; zero yields Idle. Multiple records, a malformed potential-running
record, an ineligible/missing owner, duplicate identities, or an ambiguous
legacy local time produces a read-only recovery state. Repair is a separate,
previewed, explicit action.

New CLOCK records carry an absolute, offset-bearing timestamp and a unique
terminal block ID. Day clipping uses consecutive local calendar midnights, not
`midnight + 24h`. A monotonic clock detects wall-clock discontinuities while the
process is alive. A discontinuity pauses timing writes and asks the user to keep
measured elapsed time, accept system time, or stop at the last trusted instant;
it never silently changes recorded duration.

## Scope and authority

This record fixes:

- the LOGBOOK/CLOCK Markdown written by the port;
- the common read-decide-commit-confirm protocol;
- optimistic relocation, conflict, idempotency, and serialization rules;
- every Markdown and plugin-data write action already required by the accepted
  grammar and v1.0.2 behavior;
- same-file atomicity and cross-file partial outcomes;
- crash, reload, stale-session, malformed-data, DST, time-zone, and wall-clock
  recovery;
- user-visible outcomes, undo/history expectations, adversarial fixtures, and
  testable invariants.

It does not implement the plugin, add a hidden task database, choose new UI
placement, add a general-purpose Undo feature, or authorize automatic planning
writes. Navigation, tab changes, plan projection, Review calculation, playback,
disclosure, and timing display ticks remain read-only.

The controller explicitly delegated the choices and pre-authorized the
strongest supported recommendations. The grilling branches are therefore
settled here instead of being returned as questions.

## Accepted inputs

This decision consumes the integrated records in this branch:

- [Markdown grammar and stable Plan Item identity](markdown-grammar-and-plan-item-identity.md),
  which makes source spans snapshot-local, gives durable authority only to a
  vault-unique terminal block ID, and permits identity creation only inside an
  explicit identity-requiring action.
- [Plugin architecture and state ownership](plugin-architecture-and-state-ownership.md),
  which assigns every Markdown commit to one `NautilusRuntime` through one
  `MarkdownWorkspace` and keeps Markdown authoritative.
- [Parity acceptance matrix and release gates](parity-acceptance-matrix-and-release-gates.md),
  especially `OBS-SAFE-001`, the G3 mutation gate, and exact before/after vault
  evidence.
- [Desktop compatibility and performance envelope](desktop-compatibility-and-performance-envelope.md),
  which requires active-Editor and background-file parity, stale-control
  disabling, no automatic retries, and bounded vault-wide CLOCK indexing.
- [Community-compliant product naming and attribution](community-compliant-product-naming-and-attribution.md),
  which names the product Spiral Day while leaving the persisted
  `nautilus-log` grammar namespace unchanged.

The source research was read at its published commits rather than branch tips:

- [Execution Layer state machines at `a43ae669a40799468e6473c6e8f8baac36143b1f`](https://github.com/oldwinter/obsidian-nautilus-log/blob/a43ae669a40799468e6473c6e8f8baac36143b1f/docs/research/execution-layer.md):
  serialized mutations, CLOCK-over-POMO precedence, all v1.0.2 write actions,
  read-after-write confirmation, partial failures, reload behavior, malformed
  records, and missing DST/clock-jump coverage.
- [Roam-to-Obsidian capability map at `d906db8ea949c36a9255116b5a535bc9d0afa211`](https://github.com/oldwinter/obsidian-nautilus-log/blob/d906db8ea949c36a9255116b5a535bc9d0afa211/docs/research/roam-obsidian-capability-map.md):
  active `Editor` writes, atomic background `Vault.process()` transforms,
  mutable Markdown locations, block IDs, host lifecycle, and write-safety gaps.

The safety changes are approved Obsidian-native improvements: they preserve
scheduling semantics and the core workflow while refusing upstream's automatic
overlap repair, unconfirmed partial success, and 24-hour DST assumption.

## Normative protocol terms

These terms are local to this decision and are not new domain glossary entries:

- **Write Intent**: one direct user gesture or command, carrying a fresh opaque
  `intentId`, action kind, originating snapshot revision, and target reference.
- **Expectation**: the minimal source versions, identities, structural facts,
  watched spans, settings version, time anchor, and running-CLOCK facts that
  must still hold for that intent.
- **Mutation Plan**: a pure, action-specific set of permitted semantic changes
  plus its preconditions and postconditions. It is not arbitrary replacement
  text.
- **Commit Receipt**: the workspace's structured result containing intent ID,
  touched paths, before/after digests, applied semantic changes, resulting
  identities, and confirmation status. It never contains full note contents in
  notices or routine logs.
- **Potential-running record**: CLOCK-looking source under a recognized LOGBOOK
  that lacks a closed delimiter but cannot be parsed unambiguously. It may be
  open, so it blocks a new CLOCK.
- **Trusted time anchor**: a paired wall-clock and monotonic reading used to
  detect a discontinuity while the current process is alive.

## Canonical LOGBOOK and CLOCK source

### Structure

A LOGBOOK is a direct nested list child of a Plan Item. Each CLOCK is a direct
list child of that LOGBOOK. Newly created source uses the file's existing line
ending and this visible shape:

```markdown
- [ ] Draft the release 45m ^nl-9f4de6a0-4d94-4b44-a7c4-c41127068e83
  - LOGBOOK::
    - CLOCK: [2026-08-28 Fri 09:15:42.137 +08:00] ^nl-clock-4d80fd42-ecbd-402f-af68-973fda5cce14
    - CLOCK: [2026-08-28 Fri 08:10:03.006 +08:00]--[2026-08-28 Fri 08:45:12.991 +08:00] => 0:35 ^nl-clock-197f13ab-63a2-49af-9229-a23ad6603b88
```

When a drawer is needed, the writer appends it after the Plan Item's existing
continuation and nested content, before the next sibling. It does not reorder
user children. A new CLOCK is inserted immediately after the drawer line, so
records are newest first. Existing drawer/CLOCK order is otherwise preserved.

The reader accepts one case-insensitive, checkbox-free direct child whose
trimmed semantic text is `LOGBOOK:` or `LOGBOOK::`. The writer emits exactly
`LOGBOOK::`. It never normalizes an accepted existing drawer. Two or more
accepted drawers under one owner are ambiguous and block mutations for that
owner.

Indentation is derived from the parsed parent/child structure, not guessed from
a cached number of spaces. Newly inserted bullets use `-`; existing bullet
markers, indentation, continuation text, hard-break spaces, nested children,
and suffixes are not rewritten.

### CLOCK grammar v1

Canonical writer output is ASCII and has these semantic forms:

```ebnf
RUNNING = "CLOCK: [", STAMP, "] ", CLOCK_ID;
CLOSED  = "CLOCK: [", STAMP, "]--[", STAMP, "] => ", DURATION,
          " ", CLOCK_ID;
STAMP    = DATE, " ", WEEKDAY, " ", TIME, " ", OFFSET;
DATE     = YYYY, "-", MM, "-", DD;
WEEKDAY  = "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat" | "Sun";
TIME     = HH, ":", mm, ":", ss, ".", SSS;
OFFSET   = ("+" | "-"), HH, ":", mm;
DURATION = DIGITS, ":", MM;
CLOCK_ID = "^nl-clock-", UUID_V4;
```

`STAMP` identifies one absolute millisecond instant. Its numeric offset and
English weekday must agree with the date/time fields. `DURATION` is the
nonnegative whole-minute floor of `end - start`, formatted with unbounded hours
and exactly two minute digits. Readers derive Actual from the endpoints; the
displayed duration is confirmation text. A mismatched duration yields a
diagnostic but never overrides the endpoints.

The end must be greater than or equal to the start. A backwards end is a time
conflict; the writer does not silently clamp it. A task switch uses one absolute
transition instant for both the old end and new start. Milliseconds and the
unique ID prevent two rapid sessions at the same displayed minute from aliasing.

A CLOCK ID is a terminal Obsidian block ID, unique across every block ID in the
vault. Generated IDs use `nl-clock-` plus a lowercase RFC 4122 UUID v4 from a
cryptographically secure source. A collision retries generation. A duplicate
CLOCK ID makes every occurrence non-writable until explicit identity repair.

Future syntax with different timestamp meaning must use a distinct record tag
such as `CLOCK/v2:` and retain the v1 reader. A package update must not assign a
new meaning to an existing v1 line.

### Legacy records

The reader also accepts the frozen v1.0.2 visible forms, including optional
weekday text, minute-resolution local timestamps, tolerant `CLOCK:`/`CLOCK::`,
and an optional displayed duration. It does not rewrite them merely because
they were read.

An offset-free legacy timestamp is interpreted only when that local date/time
maps to exactly one instant in the active IANA time zone. A spring-forward gap
is `nonexistent-local-time`; a fall-back fold with two possible instants is
`ambiguous-local-time`. Neither is guessed. Closed unambiguous legacy records
remain readable history. A legacy running record without a CLOCK ID may be
closed, deleted, or normalized only by an explicit action against an unchanged
exact locator; the same transaction adds an ID if the record remains.

Malformed closed-looking records are preserved and excluded from Actual with a
line diagnostic. A malformed potential-running record blocks all Clock In and
switch actions because the single-CLOCK precondition cannot be proved. Manual
editing or explicit Timing Repair resolves it; startup does not.

### Vault-wide CLOCK safety index

The one-running-CLOCK invariant covers the vault, not only today's Daily Note
or open planner leaves. The disposable safety index classifies:

- every canonical `^nl-clock-<uuid>` record in every Markdown file, even when
  its owner was moved outside a Plan Region or its file was renamed;
- every CLOCK-looking direct child of a LOGBOOK under a uniquely identified
  Plan Item in a valid Plan Region; and
- every previously adopted legacy CLOCK locator that remains in the loaded
  runtime's source scope.

Other `CLOCK:` text is ordinary Markdown and is not silently adopted merely
because another tool uses the same word. An explicit Clock In, legacy
normalization, or Timing Repair adopts the selected record under this contract.
Once a canonical CLOCK ID exists, moving its source cannot make it invisible to
the safety index.

The index is memory-only and reconstructible. Enable/reload builds it through a
bounded scan; vault create, modify, delete, and rename events mark affected files
dirty. Before a timing write, the runtime drains those invalidations and requires
a complete index generation. A new or changed canonical/potential-running
record invalidates interactive timing controls immediately. The post-commit
scan rereads every touched file and any file dirtied during the operation.

No public host API can lock out an arbitrary concurrent external writer between
the last scan and the commit. Spiral Day therefore guarantees serialization of
its own intents and detection rather than impossible cross-plugin exclusion. If
an external record appears in that window, success is withheld and the runtime
enters the multiple-running recovery state without deleting either record.

## Common write protocol

### Intent admission

A surface may dispatch a Write Intent only from a direct pointer, keyboard, or
command action. The runtime rejects admission when it is starting, stale,
reconciling, degraded, stopping, over a configured source/index limit, or
waiting for time review. Opening or refreshing a view, a timer tick, source or
metadata events, startup, unload, and Review calculation never create a
Markdown intent.

Each physical activation creates one `intentId`. All adapters handling that
activation reuse it. The runtime keeps a bounded in-memory set of queued and
settled IDs. Re-delivery of the same ID returns the existing promise or receipt;
it never queues a second mutation. A later deliberate activation has a new ID.

### Fresh decision read

When an intent reaches the head of the queue, the runtime ignores its cached
source spans and:

1. drains or invalidates dirty source/index work;
2. resolves the current target from its unique ID, or from the exact anonymous
   snapshot locator where the action is allowed to materialize identity;
3. reads the authoritative active Editor buffer or current background file;
4. reparses the Plan Region, owner, LOGBOOK, CLOCKs, and all action-relevant
   owned and unowned spans;
5. obtains a coherent vault-wide running-CLOCK set, failing closed if the index
   is dirty, over limit, ambiguous, or contains a potential-running record;
6. validates plugin-data/settings version and the trusted time anchor; and
7. asks the pure core for a Mutation Plan or typed rejection.

The mutation timestamp is captured only after these preconditions pass. It is
not the click time or the time an intent waited in the queue.

### Expectation and relocation

An Expectation never means only `path + line`. It contains:

- the originating and fresh file digests;
- the unique Plan Item ID and, where relevant, CLOCK ID;
- current file/path and parsed parent relationship;
- required Grammar Version, item type, checkbox state, drawer count, CLOCK
  state, and running-CLOCK set;
- the exact bytes of every owned span to be changed;
- an action-specific fingerprint of watched unowned bytes; and
- settings version plus time-zone/time-anchor facts that affect the mutation.

Inside the host mutation primitive, the workspace reparses the current text.
If the whole-file digest changed, it may relocate only by one vault-unique ID.
It may proceed through an unrelated edit, rename, reorder, or move when all
action-specific facts and watched bytes still match. It must conflict when the
target is absent, duplicated, outside a valid Plan Region, changed from Flexible
Task to Fixed Event, has an unexpected status, changed watched text, gained an
ambiguous drawer, or depends on a changed running-CLOCK set.

An Anonymous Plan Item or ID-less legacy CLOCK never relocates. Its exact file,
digest, structural span, and watched bytes must all match. Equal text, nearest
text, fuzzy text, source order, modification time, or a surviving line number
is never fallback authority.

Watched bytes are action-specific:

- Clock In, Complete, progress, and identity actions watch the target first
  line's unowned bytes, status, type, ID, and relevant owned tokens.
- Clock Out and delete watch the CLOCK line, its ID/locator, running state, and
  owner relationship; an unrelated title edit may proceed.
- Migrate Plan watches the complete old Plan Region because its preview covers
  the complete transformation.
- A LOGBOOK insertion watches the complete owner item boundary and existing
  direct children so it cannot capture or split newly added content.

### Host mutation primitives

For an active source, the supplied Editor is authoritative. The workspace opens
one synchronous Editor transaction, rereads its complete value, validates the
Expectation, and applies all same-file replacements in descending offset order.
The transaction is one native undo step and preserves selection/cursor mapping
where the public Editor API permits.

For a background source, the workspace uses one `Vault.process()` call. The
synchronous transform reparses the callback's current text, returns it unchanged
on conflict, or returns the complete transformed text. `Vault.modify()`, cached
MetadataCache positions, and an inactive Editor are not write paths.

A same-file task switch, Clock In plus identity/drawer/CLOCK insertion, Complete
plus CLOCK close/status/progress removal, progress completion, plan migration,
or identity repair is one transform. A source event raised by the transform
marks the context dirty but cannot start a competing refresh.

### Allowed diff and postconditions

Every Mutation Plan contains an exact semantic change allowlist. The workspace
constructs a full before/after diff and rejects an implementation result that
changes any byte outside the listed owned spans and explicit insertions. In
particular, it preserves BOM, LF/CRLF, bullets, indentation, hard-break spaces,
links, tags, aliases, Tasks/Dataview text, unknown suffixes, comments,
continuations, and nested children.

After the host primitive returns, the runtime authoritatively rereads every
touched source, rebuilds the relevant ID/CLOCK facts, and projects through the
core. Success requires all of the plan's postconditions and the global
running-CLOCK invariant. A host promise resolving is not confirmation.

Commit outcomes are:

| Outcome | Meaning | Runtime behavior |
| --- | --- | --- |
| `applied` | Exact postcondition is confirmed. | Publish the confirmed projection and action receipt. |
| `already-applied` | No bytes changed because the intended end state already existed for the same stable identity. | Publish the fresh projection; never duplicate the effect. |
| `rejected` | Fresh semantic preconditions did not hold before mutation. | No write; publish fresh facts and an actionable message. |
| `conflict` | The source changed inside the optimistic window or relocation was unsafe. | No write; require a fresh action. No automatic retry or overwrite. |
| `failed-no-change` | The host rejected before a change and unchanged digests are confirmed. | Keep the last confirmed snapshot stale until reread, then report failure. |
| `uncertain` | The host may have changed source, or confirmation could not classify the result. | Enter reconciliation, block writes, and reread; never retry the transform. |
| `partial-safe` | A confirmed earlier cross-file stage applied and a later stage did not. | Publish the observed safe state and the exact incomplete effect; require a new intent. |
| `invariant-broken` | Confirmed source cannot satisfy a declared postcondition or global invariant. | Disable writes for the scope and require reload or explicit repair. |

An uncertain reread is classified only from source: if all postconditions hold,
it becomes `applied`; if all before-state predicates hold and digests confirm no
change, it becomes `failed-no-change`; otherwise it remains a visible partial or
conflict state. The command function itself is never rerun.

## Serialization and idempotency

There is one FIFO Markdown intent queue per loaded vault, shared by every leaf,
tab, command, menu, settings surface, and locale. Queue order is dispatch order.
A task switch is one intent even when it has two physical file stages. Reads may
overlap outside the queue, but starting an intent invalidates older publication,
and no read result can overwrite its confirmed receipt.

Plugin-data saves use one serialized tail owned by the same runtime. A command
that needs both stores declares their order below; the tails do not silently
interleave. No Markdown action is retried automatically for timeout, conflict,
write rejection, source event, reload, or uncertain outcome. A timeout changes
visible status to pending; it does not start another call.

Idempotency follows stable end state, not a persisted request ledger:

- Clock In on the one already-running target is `already-applied` and creates no
  drawer, CLOCK, ID, or new task POMO.
- Clock Out against the same now-closed CLOCK is `already-applied`; global Clock
  Out with no active CLOCK is a no-op.
- Complete on the same already-done Plan Item is `already-applied` only when no
  owned running CLOCK remains. It does not add a second completion effect.
- Delete is `already-applied` only when the confirmed target CLOCK ID is absent;
  it never deletes a nearby line.
- Initialize, Assign Identity, and Repair Identity return the existing valid
  end state instead of inserting duplicate markers or IDs.
- Progress advancement is idempotent only for the same `intentId`. Two distinct
  activations intentionally advance twice, in FIFO order, each from a fresh
  reread.
- Cross-file switch retry is safe: if the old CLOCK closed and the new one did
  not open, a new Clock In opens the target from Idle; if the target did open,
  same-target Clock In is already applied.

The in-memory `intentId` set is discarded on reload. The plugin persists no
command journal, retry counter, source patch, active-task mirror, or idempotency
key. Markdown end state is sufficient because every cross-file order fails to a
safe state and no command is resumed automatically.

## Write-action contracts

### Common surface rule

An action has one semantic contract regardless of whether it originates in the
spiral, Timing, Plan, Review, command palette, or editor menu. Plan and Review
rows dispatch Clock In or Complete; they do not own separate writers. Opening
Plan/Review, changing tabs, expanding rows, viewing summaries, and navigating to
a task make no source or plugin-data write.

### Action matrix

| Action | Additional preconditions | Permitted mutation | Required postconditions |
| --- | --- | --- | --- |
| Initialize Plan | Resolved target Daily Note; no plan-marker candidate; previewed insertion point still exact | Insert one v1 marker pair in one file | Exactly one valid Primary Plan v1; all prior bytes preserved |
| Migrate Plan | Supported old version; complete preview accepted; old region digest exact | One whole-region transform including opening version marker | Target grammar parses; previewed classifications/IDs match; old grammar is no longer active |
| Assign Plan Item Identity | Anonymous eligible item at exact locator; generated ID vault-unique | Insert one terminal `^nl-<uuid>` | Exactly one eligible item has the new ID |
| Repair Plan Item/CLOCK Identity | User selected one revalidated colliding occurrence | Replace only that terminal ID with a new unique ID | Selected occurrence is unique; every other occurrence is byte-identical |
| Advance/Reopen Progress | Today's eligible Flexible Task; supported checkbox/progress state; no time conflict | Insert/replace/remove progress, or atomically complete/reopen as below | One expected status/progress/anchor state; no duplicate token |
| Clock In from Idle | Execution enabled; target is open Flexible Task; coherent zero-running set | Materialize target ID if needed; ensure one drawer; insert one running CLOCK; clear standalone POMO as ordered below | Exactly one running CLOCK owned by target; confirmed active projection |
| Clock In current task | Exactly one running CLOCK already belongs to target | No Markdown mutation | Same CLOCK ID remains sole active record |
| Switch task | Exactly one running old CLOCK; new target open/eligible; trusted time | Close old and open new at one instant, atomically if same file or close-then-open if different files | Exactly one running CLOCK owned by new target, or confirmed safe Idle partial outcome |
| Clock Out | Zero or one coherent running CLOCK; trusted time | Close the exact running CLOCK | No running CLOCK; closed endpoints/duration/ID parse exactly |
| Complete | Target open Flexible Task; target identity unique; zero or one owned running CLOCK | If owned CLOCK runs, close it; set `[x]`; remove owned Progress; do not add a completion anchor | Target done; no owned running CLOCK; other task's CLOCK unchanged |
| Delete current CLOCK | Exact current running CLOCK with no continuation/nested content; second confirmation for same ID within 2.5 seconds | Delete only that CLOCK physical line; keep drawer and task | Target CLOCK ID absent; no running CLOCK owned by task |
| Timing Repair | Coherent preview and explicit confirmation; every selected source revalidated | Only previewed ID replacement, timestamp normalization, or older-overlap closure | Reparse matches preview; unresolved ambiguity remains visibly blocked |
| Enable Execution | Settings valid; bounded authoritative global scan coherent | Save enabled setting only | Enabled/ready with zero or one valid running CLOCK; no Markdown change |
| Disable Execution | Enabled; coherent running set; trusted time if one runs | Close sole CLOCK first; then one plugin-data save clears both POMOs and disables | No running CLOCK and persisted disabled state, or visible partial-safe enabled/Idle result |
| Start/Stop standalone POMO | Coherent zero-running set for start | One plugin-data transition using absolute epoch milliseconds | Persisted state rereads exactly; no Markdown change |
| Persist settings | Valid new document and unchanged settings version | One complete `data.json` save | Reread/validated requested settings before publication |
| Startup stale-POMO cleanup | Markdown proves persisted POMO impossible | Delete only impossible POMO field in one serialized plugin-data save | Effective and persisted state agree; failure remains suppressed and diagnostic |

### Initialize, migrate, and identity

Initialize and Migrate always show the exact affected file and preview before
confirmation. Initialize never guesses from a heading. Migrate follows the
seven-step grammar migration contract and never combines with a timing action.
Both are one-file transactions and one active-Editor undo step when applicable.

Assign Identity may combine with the explicit action that first needs identity;
it is not a preparatory commit. If the requested action rejects, no generated ID
is left behind. Repair Identity is separate because choosing which duplicate
occurrence retains an existing ID changes identity meaning; the selected
occurrence receives a fresh ID, while the others remain untouched.

### Advance and reopen progress

The spiral's task activation remains an explicit write rather than a generic
row click. It is available only on today's Flexible Tasks and has a keyboard
equivalent. Fixed Events and plain/foreign-checkbox items remain read-only.

For an open task, absent Progress becomes `d10%`. A present raw `dNNN%` value is
increased by 10 without first applying the projection clamp. A result below 100
replaces the token; exactly 100 atomically changes `[ ]` to `[x]`, removes the
owned Progress token, and adds one `dH:MM` completion anchor using the current
logical-day local time; above 100 removes the Progress token and leaves the task
open. This preserves the frozen writer's odd over-100 branch while making its
write safe. If the task owns the running CLOCK when it reaches exactly 100, the
same file transaction closes it first at the same instant. Completing another
task leaves the active task unchanged.

A done Flexible Task with no Progress may be explicitly reopened: `[x]` or
`[X]` becomes `[ ]`, the owned completion anchor is removed, and `d10%` is
inserted at that owned-token position or before the terminal Plan Item ID. A
done item that contains a manually retained Progress token conflicts instead of
guessing which state the user intended.

All insertions preserve surrounding whitespace and unowned suffixes. A progress
action materializes Plan Item identity inside the same transaction if needed.

### Clock In and task switch

Clock In requires an open Flexible Task and a coherent vault-wide running set.
The writer materializes the Plan Item ID, appends a canonical drawer only when
none exists, and inserts a canonical running CLOCK with its own ID in one
same-file transaction.

If a sole current CLOCK already belongs to the target, Clock In is a read-only
idempotent result. It still suppresses stale standalone POMO state, because a
CLOCK is authoritative.

For a switch, one transition instant is captured after both owners and the
global set validate:

1. If both task records are in one file, one transform closes the old CLOCK and
   opens the new CLOCK. Either the entire new source parses and commits or no
   bytes change.
2. If the tasks are in different files, stage A closes and confirms the old
   CLOCK. Only then may stage B reread the new owner, drain the safety index
   again, prove the running set is still empty, and create the new CLOCK.
3. If stage B rejects, fails, or is uncertain, the runtime does not reopen A.
   The confirmed outcome is Idle or reconciliation, with `partial-safe` copy
   naming both files.
4. The final global scan must contain exactly the new CLOCK. A competing
   external open produces an invariant conflict, never an automatic deletion.

Close-before-open is the safety choice: losing continuity is visible and
recoverable; overlapping two files would corrupt the single-CLOCK meaning.

After a confirmed first CLOCK, one plugin-data save clears standalone POMO and
stores the task-POMO start captured for that cycle. A seamless task switch
preserves the existing task-POMO start. If the save fails, it does not roll back
the canonical CLOCK: CLOCK suppresses standalone POMO, the runtime derives a
missing task-POMO start from the CLOCK, reports an applied-with-warning outcome,
and reconciles on the next explicit transition or reload. This order preserves
the standalone POMO when Clock In fails before creating a CLOCK. Same-target
Clock In performs no Markdown write but still clears a stale standalone POMO in
plugin data; a save failure leaves CLOCK authoritative and visible.

If a cross-file switch closes the old CLOCK but does not open the new one, task
POMO is suppressed immediately and cleared through the plugin-data save tail.
Failure to clear it is a plugin-data warning on the already confirmed
`partial-safe` Idle state; it never reopens the old CLOCK.

### Clock Out, Complete, and delete

Clock Out closes the exact running record at a trusted instant and retains its
terminal CLOCK ID. If wall time is earlier than the start or the trusted anchor
is broken, the action enters time review rather than clamping. Global Clock Out
with no active record is a no-op. A stale row action may be already applied only
when its same CLOCK ID is confirmed closed.

Complete is one atomic same-file mutation when the target owns a running CLOCK:
close that CLOCK, set the canonical checkbox to `[x]`, and remove the owned
Progress token. It deliberately does not add the spiral completion anchor; its
closed Actual supplies history, matching v1.0.2 Execution behavior. Completing
a different task changes only that task and leaves the current CLOCK open.

Delete requires two activations naming the same current CLOCK ID within 2.5
seconds. Any rerender, target/status change, view close, timeout, or different ID
cancels confirmation. The transaction removes exactly the CLOCK physical line
and its line ending, never the drawer, owner, sibling sessions, or a closed
record. A CLOCK with continuation text or nested children fails closed with
`clock-has-attached-content` so user-authored content is not deleted or orphaned.
If a legacy running line has no ID, confirmation binds to its exact digest/span
and expires on any source change.

After Clock Out, Complete, or delete, task POMO is cleared in the serialized
plugin-data document. If that save fails after confirmed Markdown, the active
CLOCK projection still wins: stale POMO is suppressed, the source action is
reported applied with a plugin-data warning, and no Markdown rollback occurs.

### Timing Repair

Startup and normal refresh are diagnostic only. Timing Repair is the sole
plugin action that may deliberately alter inconsistent timing source. It always
shows a complete before/after preview grouped by file and requires confirmation
after an authoritative reread.

Supported repairs are narrow:

- assign a fresh ID to one selected duplicate Plan Item or CLOCK occurrence;
- convert one unambiguous offset-free legacy CLOCK to canonical v1 without
  changing its chosen instants;
- resolve a DST fold only after the user selects the earlier or later displayed
  offset;
- close older valid overlapping running CLOCKs at the newest start, preserving
  the newest as active; or
- close a running CLOCK owned by a done task at a user-selected trusted instant.

Newest-valid-wins is preselected for overlaps. Exact start-time ties have no
preselection because source order is not timing authority. A malformed record
whose intended timestamp or open/closed state cannot be proved is not repaired
by inference; Timing Repair opens the source and explains the required manual
correction.

Same-file repairs are atomic. Multi-file overlap repair applies older closes in
deterministic `(start, path, offset)` order, confirming each. A failure stops the
sequence, reports every applied file, and leaves remaining ambiguity blocked.
The repair is safely repeatable from a new preview; no rollback fabricates
running time.

### Enable, disable, settings, and POMO

Enable first performs a bounded read-only global scan. It saves
`executionEnabled: true` only after the scan is coherent, then publishes ready.
A crash after the save is safe because reload repeats the scan. Enable never
repairs Markdown.

Disable closes the sole running CLOCK first, confirms the global set is empty,
then saves one plugin-data document with Execution disabled and both POMO fields
cleared. Multiple/ambiguous records block disable and leave it enabled. If the
Markdown close succeeds but the plugin-data save fails, the result is visibly
enabled but Idle; retrying Disable is idempotent. Unload is not Disable and
performs no write.

A standalone POMO start is admitted only with zero coherent running CLOCKs. Its
absolute epoch start is persisted before publication. Stop persists `null`.
Same-ID duplicate gestures share one save. If save outcome is uncertain, the
runtime reloads and validates plugin data, blocks later session transitions
until classified, and never changes Markdown.

Settings are versioned as one validated document and saved whole through one
tail, so two controls cannot overwrite each other's accepted value. A setting
does not publish until the saved document rereads successfully. Locale changes
rerender only. Daily Note resolver, grammar, workday, execution, or time-zone
changes invalidate projections and controls before they can accept an action.

On startup, an impossible task POMO with no active CLOCK and a standalone POMO
that coexists with a valid CLOCK are suppressed immediately. The runtime may
delete only those impossible plugin-data fields in one serialized cleanup save;
it never touches Markdown. Cleanup failure retains a diagnostic and suppressed
effective state. It cannot overwrite a later explicit POMO transition because
the same save tail and settings version guard serialize both.

## Conflict handling and user-visible outcomes

There is no Force, Overwrite, Apply anyway, or automatic retry choice. A
conflict surface offers only actions that cannot reuse stale intent: open the
exact source, refresh, or enter a narrowly defined repair flow. Refreshing does
not resubmit the command; the user must activate it again.

Stable result codes, localized in English and Simplified Chinese, have this
minimum user meaning:

| Code | User-visible meaning | Available next action |
| --- | --- | --- |
| `action-no-longer-applicable` | The item is no longer in the state required by the action; nothing changed. | Open item; Refresh |
| `anonymous-source-changed` | This item moved or changed before it had durable identity; Spiral Day will not guess its new location. | Open source; Refresh and act again |
| `plan-item-not-found` | The identified item is no longer in an eligible Plan Region. | Open last known file; Refresh |
| `identity-collision` | The same block ID occurs in multiple locations, so none can be written safely. | Review locations; Repair identity |
| `source-conflict` | Watched source changed before commit; no bytes were written. | Open changed note; Refresh |
| `logbook-ambiguous` | The target has multiple or structurally invalid LOGBOOK drawers. | Open source; Timing Repair where supported |
| `clock-has-attached-content` | The running CLOCK has user content attached, so deleting its line could lose or orphan that content. | Open exact line; move the content, then act again |
| `multiple-running-clocks` | More than one valid running CLOCK exists; timing writes are paused. | Review all locations; Timing Repair |
| `potential-running-clock` | A malformed CLOCK may be running, so starting another could duplicate time. | Open exact line; repair manually |
| `clock-owner-invalid` | A running CLOCK's owner is missing, done, fixed, outside a valid Plan Region, or ambiguously identified. | Open owner/CLOCK; Clock Out exact record; Timing Repair |
| `ambiguous-local-time` | A legacy time occurs twice at the DST fold and cannot be inferred. | Choose earlier/later in Timing Repair |
| `nonexistent-local-time` | A legacy time falls in a DST gap. | Open exact line; correct manually |
| `clock-discontinuity` | System time changed while timing; writes are paused to avoid changing elapsed time silently. | Keep measured elapsed; Use system time; Stop at trusted time |
| `write-failed-no-change` | The host rejected the write and the note is confirmed unchanged. | Retry with a new action; Open note |
| `write-outcome-uncertain` | Spiral Day cannot yet prove whether the note changed; later writes are paused during reconciliation. | Open touched files; Reload after reconciliation failure |
| `partial-switch` | The prior task was safely stopped, but the new task did not start. | Open both notes; Clock In again |
| `plugin-data-failed` | The Markdown action may be complete, but its setting/POMO state could not be saved. | View observed state; Retry the setting/session action |
| `write-invariant-broken` | Confirmed source violates a safety postcondition; writes are disabled. | Open evidence; Reload; Timing Repair if available |
| `source-over-limit` | The actual source/index size exceeds the supported limit, so writes are disabled without truncation. | Show actual and limit; narrow scope |

Notices and status regions include action name, stable code, file name/path,
line when current, and safe identity suffix. They do not include complete note
text. Direct command failures receive a Notice and the same persistent in-view
status. Status changes are announced accessibly. A pending write after 1,000 ms
stays disabled and visibly pending; timeout alone is never called failure.

## Undo and history visibility

- One active-Editor file transform is one native undo step. Same-file switch and
  completion remain one step because all effects share the transaction.
- `Vault.process()` background writes do not promise an active editor undo
  entry. The success receipt identifies every file and line/block link changed
  so the user can inspect it and use Obsidian File Recovery, Sync history, or
  version control where available.
- Cross-file switch or repair reports each file separately and never implies one
  atomic Undo.
- Delete confirmation names the CLOCK start/elapsed and file before deletion.
- The last action receipt may remain in memory for the loaded runtime, but it is
  not a canonical audit log and is not persisted as a hidden database.
- The v1.0.2 baseline has no Tidy/Undo control. Spiral Day does not invent a
  compensating Markdown Undo command, because replaying old bytes after external
  edits would create a second conflict protocol.

## Crash, reload, and lifecycle recovery

### Crash points

| Crash or unload point | Durable possibilities | Reload behavior |
| --- | --- | --- |
| Intent queued or still reading | No write | Intent is forgotten; source is reread |
| Before an Editor/`Vault.process` transform returns | Complete before or after file, never a planned partial same-file patch | Parse the actual source; do not replay |
| After same-file source commit but before receipt/publication | Complete post-state may exist | Confirm from Markdown and project it; no duplicate action |
| Between cross-file switch close and open | Old closed; new absent | Restore Idle and show no fabricated continuation |
| After new CLOCK commit but before task-POMO save | New CLOCK active; task POMO may be stale/missing | Restore active from CLOCK; derive task-POMO start from CLOCK |
| After CLOCK close but before POMO clear | No active CLOCK; stale task POMO may persist | Suppress and clean plugin data; do not reopen CLOCK |
| After disable CLOCK close but before disabled save | Enabled setting may remain true; no running CLOCK | Load enabled/Idle and allow idempotent Disable retry |
| During multi-file Timing Repair | A confirmed prefix of older CLOCKs may be closed | Scan all files, expose remaining ambiguity, require a new preview |
| Plugin unload before host mutation starts | No write | Normal read-only startup |
| Plugin unload after host mutation starts | Host primitive may settle; no destroyed UI publication or follow-up save | Next load classifies source; no automatic continuation |

An active Editor buffer can be confirmed in the running application before the
host flushes it to disk; no plugin can promise survival from a process or OS
crash in that interval without bypassing the required Editor path. Reload uses
what the host actually persisted and never replays the in-memory receipt.

### Startup/reload state table

| Observed durable state | Recovery state |
| --- | --- |
| Exactly one canonical or unambiguous legacy running CLOCK with a unique, open Flexible Task owner | Restore Active Task; retain source unchanged |
| No running CLOCK | Idle; suppress stale task POMO |
| Standalone POMO and no CLOCK | Resume from persisted absolute start after time validation |
| Standalone POMO plus one CLOCK | CLOCK wins; suppress and clear standalone POMO only |
| Multiple valid running CLOCKs | Degraded read-only state; no newest-wins write until explicit Timing Repair |
| Running CLOCK under missing, done, fixed, plain, out-of-region, or ambiguously identified owner | Degraded owner state; exact Clock Out/delete or manual/Timing Repair is available, but Clock In/switch is blocked |
| Potential-running malformed record | Block Clock In/switch globally; other unambiguous read-only projections remain |
| Malformed closed record | Exclude it from Actual, retain line diagnostic, and allow unrelated actions |
| Duplicate Plan Item or CLOCK ID | Disable identity-dependent action for every occurrence; render current spans read-only |
| Missing/moved Daily Note or Plan Region | Missing-source state; no creation or relocation without an explicit command |
| Over-limit global CLOCK index | Today's read-only plan may remain; all timing writes and complete global totals are unavailable |

No stale session is auto-stopped. A CLOCK that survives hours, sleep, midnight,
or reload remains active and receives the configured forgotten warning. The
user chooses Clock Out, delete, or Timing Repair. Unload, view close, Daily Note
change, and midnight never write Markdown.

## DST, time-zone, and wall-clock-change rules

### Absolute instants and local days

Canonical CLOCK endpoints are absolute instants because their numeric offsets
are source data. Elapsed duration is `endEpochMs - startEpochMs`. Running elapsed
is derived from a trusted effective now, never from counted one-second ticks.

Timing, Review, and history share one local-day function. For logical date `D`
and IANA zone `Z`, the interval is:

```text
[localMidnight(D, Z), localMidnight(D + 1 calendar day, Z))
```

It may be 23, 24, or 25 hours. Cross-midnight CLOCK Actual is intersected with
that half-open interval. No code uses `dayStart + 86_400_000` for a calendar
boundary. A DST transition does not itself pause a CLOCK or create a write.

A system time-zone change invalidates every date relation and projection. The
same absolute CLOCKs are re-rendered under the new zone only after an
authoritative refresh. It never rewrites stored endpoints. A normal offset
change predicted by the active zone's DST rules is not a wall-clock conflict.

### Detecting discontinuity

While loaded, `SystemClock` samples `{wallEpochMs, monotonicMs, zoneId,
offsetMinutes}` at trusted anchors. On each visible tick, wake/visibility event,
and before every timing write it compares wall delta with monotonic delta. A
difference greater than five seconds, a backwards wall value, or an impossible
running elapsed enters `time-review-required`. Tests inject both clocks; product
logic never reads them directly.

If no CLOCK or POMO is active, the runtime reanchors after an authoritative
refresh and writes nothing. With an active timer, it freezes mutation controls
and continues to show the last trusted elapsed as provisional, not authoritative.

The explicit recovery choices are:

1. **Keep measured elapsed and continue** (recommended when the monotonic sample
   is trustworthy): rebase the running CLOCK start to `observed wall now -
   trusted elapsed`, retaining its ID, then reanchor. A standalone POMO rebases
   its plugin-data start similarly.
2. **Use system time**: retain the stored source start and accept the observed
   wall clock as authoritative, after showing the resulting elapsed. This is a
   no-Markdown confirmation unless POMO data changes.
3. **Stop at last trusted time**: close the CLOCK at the last trusted effective
   instant, or clear the POMO, then reanchor. It is rejected if that end would be
   before the stored start.

Each Markdown-changing choice is one explicit, revalidated action. After a full
process restart there is no monotonic continuity. A future-dated or otherwise
impossible restored start therefore cannot offer measured elapsed; the user may
accept system time, restart from zero, or correct/delete the source. The plugin
does not invent elapsed time.

## Adversarial fixture contract

These fixtures extend the accepted `FX-07`, `FX-11`, `FX-13`, `FX-14`, and
`FX-16` corpus. Every Markdown fixture asserts complete before/after bytes
through both `MemoryTextAdapter` and the disposable-vault Obsidian adapter where
the path applies.

### Targeting and preservation

- `OFX-SAFE-001`: anonymous item edited, moved, duplicated, or deleted between
  click and commit; zero changed bytes and no equal-text fallback.
- `OFX-SAFE-002`: unique ID item renamed, reordered, and moved to another valid
  region before commit; relocation succeeds only when watched action facts hold.
- `OFX-SAFE-003`: duplicate Plan Item/CLOCK IDs across same and different files;
  every occurrence is read-only until selected repair.
- `OFX-SAFE-004`: unrelated frontmatter/prose edit changes whole-file digest;
  semantic revalidation permits the target-only write.
- `OFX-SAFE-005`: title, checkbox, token, suffix, drawer, or parent relationship
  changes inside the watched set; conflict and zero changed bytes.
- `OFX-SAFE-006`: LF/CRLF, BOM, tabs, all bullet styles, hard breaks, Unicode,
  links, tags, aliases, embeds, comments, Tasks/Dataview fields, continuation
  lines, and nested children survive every action byte-for-byte.
- `OFX-SAFE-007`: active Editor unsaved text is newer than Vault/MetadataCache;
  Editor wins and the stale cache cannot overwrite its receipt.

### Ordering, duplicate delivery, and partial outcomes

- `OFX-SAFE-008`: same `intentId` delivered by pointer and keyboard handlers;
  one commit and one receipt.
- `OFX-SAFE-009`: two distinct rapid progress intents; FIFO fresh rereads
  produce exactly two ten-point transitions without lost update.
- `OFX-SAFE-010`: Clock In A/reselect A, A-to-B, A-to-B-to-C, Clock Out, Complete,
  and delete permutations across multiple leaves; one runtime order and at most
  one running CLOCK after each settled intent.
- `OFX-SAFE-011`: same-file switch injected failure before/inside/after host
  transform; only complete before or after source is observable.
- `OFX-SAFE-012`: cross-file switch fails after old close and before/after new
  create; safe Idle or confirmed B, never two plugin-created opens.
- `OFX-SAFE-013`: host throws after possibly applying each action; reconciliation
  classifies applied/no-change/partial without invoking the mutation again.
- `OFX-SAFE-014`: external writer opens a CLOCK before decision, between
  pre-scan/commit, and after commit/before post-scan; writes reject or enter
  invariant recovery rather than deleting external source.
- `OFX-SAFE-015`: unload at every queue and commit phase; no new admission,
  destroyed UI publication, automatic close, or post-stop follow-up write.

### Action and source-shape coverage

- `OFX-SAFE-016`: missing, canonical, tolerant legacy, duplicate, and malformed
  LOGBOOK; insertion point and diagnostics exact.
- `OFX-SAFE-017`: canonical running/closed CLOCK round trip with seconds,
  milliseconds, offset, weekday, duration, unique ID, and newest-first order.
- `OFX-SAFE-018`: offset-free unambiguous legacy record can be read and
  explicitly normalized; read alone changes nothing.
- `OFX-SAFE-019`: malformed closed versus potential-running record; only the
  latter blocks unrelated Clock In.
- `OFX-SAFE-020`: progress absent/0/25/85/90/95/100/above-100, exact-100
  completion, over-100 removal, reopen, active-target close, other-target
  completion, and manually inconsistent DONE progress.
- `OFX-SAFE-021`: delete confirmation expiry, rerender, changed ID, external
  close, and sibling history; only the exact current line can disappear.
- `OFX-SAFE-022`: enable/disable with zero/one/multiple clocks and plugin-data
  failure at each ordered stage.
- `OFX-SAFE-023`: standalone/task POMO same-tick orders and save failures;
  CLOCK always wins without duplicate Markdown.
- `OFX-SAFE-024`: over-limit note, region, item, CLOCK index, or dirty index;
  zero writes and actual-versus-limit feedback.

### Recovery and civil time

- `OFX-SAFE-025`: crash/reload at every tabled stage; Markdown alone produces
  deterministic Active, Idle, partial-safe, or degraded state.
- `OFX-SAFE-026`: stale multi-day open CLOCK, open CLOCK owned by done task,
  stale task POMO, and CLOCK plus standalone POMO; no startup Markdown write.
- `OFX-SAFE-027`: America/New_York spring gap, fall fold (both offsets), 23/25
  hour Review days, cross-midnight intervals, and Shanghai/UTC controls.
- `OFX-SAFE-028`: manual forward/backward wall-clock jump, ordinary DST offset
  change, time-zone change, sleep/wake, and future restored start using fake wall
  and monotonic clocks.
- `OFX-SAFE-029`: newest-overlap repair in one/multiple files, equal-start tie,
  failure after every stage, and safe repeat from a new preview.
- `OFX-SAFE-030`: Editor undo groups one same-file action; background/cross-file
  receipts name every changed source without claiming atomic Undo.

Failure injection covers read rejection, before-write rejection, write-then-
throw, confirmation read failure, plugin-data save/load failure, source event
bursts, MetadataCache lag, cancellation, and adapter teardown. Tests assert
observable receipts and bytes, never private queue implementation.

## Rejected options

### Whole-file last-write-wins or Force overwrite

Replacing the file produced by the original click can erase unrelated edits and
act on a repurposed item. There is no safe Force path. Semantic revalidation is
strict where meaning matters and tolerant only of proved unrelated changes.

### Whole-file digest equality as the only optimistic check

This is safe but rejects harmless prose, frontmatter, rename, and reorder edits.
Unique identity plus action-specific watched bytes permits useful relocation
without weakening the mutation target.

### Path, line, nearest text, or content-hash relocation

Positions move and equal text is common. None is identity. Anonymous targets
remain snapshot-local; durable actions materialize source-carried identity.

### Automatic retry after conflict, timeout, or uncertain failure

A retry is a new write against changed facts and can duplicate a host operation
that actually succeeded. Reconciliation observes; only a new user intent writes.

### Persisted command/recovery journal

A journal containing target IDs, patches, or active transition state can diverge
from copied, restored, or externally edited Markdown and become a hidden second
authority. Safe operation ordering plus source-derived reload makes it
unnecessary.

### Multi-file atomicity by promise queue or compensating reopen

A JavaScript queue does not make two files transactional. Reopening an old CLOCK
after a failed switch fabricates time and can race an external edit. The selected
close-before-open partial state is honest and safe.

### Automatic startup overlap, DONE-owner, malformed, or stale-session repair

Those are Markdown writes without a fresh user decision and can destroy the only
evidence of what happened. Startup diagnoses; Timing Repair previews and asks.

### Close CLOCK on view close, unload, midnight, sleep, or forgotten threshold

Those lifecycle events are not evidence that work stopped. The source remains
open for reload, with a warning for stale duration.

### Offset-free canonical timestamps and fixed 24-hour days

They cannot distinguish the fall DST fold and produce inconsistent 23/25-hour
Review totals. New records use absolute offset-bearing instants and consecutive
calendar midnights.

### Wall time alone or monotonic time alone

Wall time survives reload but can jump; monotonic time detects jumps but does
not survive process restart. Pairing them exposes discontinuity and leaves the
irreducible restart choice visible.

### Background `Vault.modify()` or direct active-file Vault writes

They bypass the required atomic background transform or active Editor undo and
cursor semantics. The two approved paths share one workspace contract suite.

### Custom persisted Undo log

Reapplying old bytes after later user edits needs another merge engine and
creates hidden history. Native Editor undo and source/file history remain the
truth; receipts provide visibility without pretending to reverse cross-file
effects atomically.

## Testable invariants

An implementation is conformant only if automated fixtures prove all of these:

1. No Markdown write occurs without one admitted explicit Write Intent.
2. Startup, refresh, projection, tick, navigation, view close, unload, midnight,
   and forgotten warnings perform zero Markdown writes.
3. Exactly one runtime admits Markdown intents per loaded vault, in FIFO order.
4. One physical activation and `intentId` produces at most one commit attempt;
   two distinct progress activations remain two ordered intents.
5. Every intent rereads and reparses at queue head and again inside its host
   mutation primitive.
6. No cached path, line, range, title, equal text, hash, or MetadataCache record
   is sufficient write authority.
7. A unique ID may relocate only when all action-specific semantic facts and
   watched bytes remain true.
8. Anonymous and ID-less legacy locators require exact file digest/span/bytes and
   never relocate heuristically.
9. Duplicate Plan Item or CLOCK IDs make every occurrence non-writable; repair
   changes only the selected terminal ID.
10. Every same-file action is one complete Editor transaction or one
    `Vault.process()` transform and exposes no intermediate source.
11. Active Editor and background adapter fixtures produce byte-equivalent source
    and semantic receipts.
12. A complete before/after diff contains only the Mutation Plan allowlist; all
    unowned bytes and line endings are preserved exactly.
13. Host completion is never published as success until source postconditions
    and the global running-CLOCK check confirm.
14. Conflict and rejected outcomes change zero bytes and never resubmit
    themselves.
15. An uncertain outcome blocks later writes and is classified only by
    authoritative reread, never by rerunning the command.
16. Canonical LOGBOOK/CLOCK writer output round-trips to the same absolute
    instants, IDs, owner, running state, and whole-minute display duration.
17. New CLOCK and Plan Item IDs are cryptographically generated and unique
    across the vault before commit.
18. A same-target Clock In creates no duplicate drawer, CLOCK, ID, or task POMO.
19. Same-file switch is atomic; cross-file switch confirms old close before new
    open and can fail only to safe Idle, confirmed target Active, or blocked
    reconciliation.
20. A task switch uses one absolute transition instant for old end and new start.
21. Clock Out changes only the exact running CLOCK and never clamps a backwards
    end silently.
22. Complete closes only the target-owned CLOCK, sets `[x]`, removes owned
    Progress, adds no Execution completion anchor, and leaves another task's
    CLOCK unchanged.
23. Progress below/exactly/above 100 and reopen produce exactly the specified
    checkbox, Progress, anchor, ID, and optional CLOCK state in one transaction.
24. Delete requires the same current CLOCK confirmation within 2.5 seconds and
    removes no drawer, sibling, closed record, or unrelated continuation.
25. Enable performs no Markdown write; Disable persists off only after a sole
    CLOCK is confirmed closed and the global set is empty.
26. CLOCK-over-POMO holds for both same-tick queue orders, every save-failure
    point, and reload.
27. Plugin-data failure never rolls back confirmed Markdown or publishes an
    unconfirmed setting/session state.
28. Reload writes no Markdown and deterministically derives Active, Idle,
    partial-safe, or degraded state from actual source.
29. Multiple valid running or potential-running malformed records block new
    timing writes until explicit repair.
30. Closed malformed history is preserved, diagnosed, excluded from Actual, and
    does not block unrelated safe actions.
31. Timing Repair never infers an exact-start tie, nonexistent local time, or
    malformed record meaning; every applied byte was in the confirmed preview.
32. Stale sessions survive reload/midnight/unload until an explicit action; a
    warning never stops or deletes time.
33. Day clipping uses consecutive local calendar midnights and passes 23-, 24-,
    and 25-hour day fixtures in every projection.
34. Canonical offset-bearing endpoints retain their absolute meaning across DST
    and time-zone changes; legacy folds/gaps are never guessed.
35. A detected wall-clock discontinuity disables timing writes until one
    explicit recovery choice is confirmed.
36. No source write is issued by a one-second tick, hidden view, refresh retry,
    cache rebuild, or metadata reconciliation.
37. Over-limit and dirty-index states disable actions without sampling,
    truncation, partial totals, or hidden writes.
38. One active-Editor same-file action is one native undo step; no background or
    cross-file result claims atomic Undo.
39. Notices/logs exclude full note contents while identifying action, stable
    code, and safe source location.
40. After unload begins, no new intent is admitted, no destroyed surface is
    updated, and an entered host mutation is only observed on the next load.

## Domain-language effect

`CONTEXT.md` is intentionally unchanged. Plan Item, Plan Item ID, Execution
Layer, Active Task, CLOCK, POMO, and LOGBOOK already name the domain. Write
Intent, Expectation, Commit Receipt, source conflict, and time anchor are
implementation protocol terms, not enduring product-domain concepts.

## One-line map gist

Serialize one explicit intent at a time, atomically revalidate each file, close
before a cross-file open, never blind-retry or auto-repair, and recover from
offset-aware Markdown rather than hidden state.
