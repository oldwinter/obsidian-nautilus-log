# Plugin architecture and state ownership

Status: accepted for [Decide: plugin architecture and state ownership boundaries](https://github.com/oldwinter/obsidian-nautilus-log/issues/9), 2026-08-28.

## Decision

Build the plugin around three deep modules and thin Obsidian adapters:

1. `NautilusCore` is the pure domain module. It owns semantic token parsing,
   scheduling, capacity, Timing/Plan/Review projections, and pure command
   decisions.
2. `MarkdownWorkspace` is the only module that understands Markdown structure,
   source spans, Plan Item identity, LOGBOOK/CLOCK structural placement, or
   Obsidian text mutation. Markdown remains authoritative.
3. `NautilusRuntime` is one vault-scoped coordinator. It owns plugin-local
   settings/session state, refresh and mutation ordering, derived snapshots,
   lifecycle, and subscriptions. It is the only caller allowed to commit a
   Markdown mutation.

ItemViews, commands, ribbon controls, the settings tab, and notices are adapters
at the runtime seam. They render immutable snapshots and dispatch commands; they
do not parse notes, schedule work, keep an active-task store, or write files.
Localization resolves stable message keys only at these adapters. No projection,
task identity map, active-task record, or CLOCK index is persisted outside
ordinary Markdown.

The logical execution invariant is vault-wide: at most one valid Nautilus-owned
running CLOCK may exist across the configured Markdown scope, regardless of how
many planner leaves or dates are open. The active task is always derived from
that CLOCK, never persisted separately.

## Evidence and constraints

This decision uses the four ticket inputs at their exact published commits:

- [Scheduler and parser semantics](https://github.com/oldwinter/obsidian-nautilus-log/blob/d0d1c100f863a3cea43c0a37407670aa1a3997a4/docs/research/scheduler-semantics.md)
  at `d0d1c100f863a3cea43c0a37407670aa1a3997a4` proves that the parser,
  scheduler, and capacity calculations are dependency-free, deterministic, and
  shared by visual and execution projections.
- [Execution Layer state machines](https://github.com/oldwinter/obsidian-nautilus-log/blob/a43ae669a40799468e6473c6e8f8baac36143b1f/docs/research/execution-layer.md)
  at `a43ae669a40799468e6473c6e8f8baac36143b1f` proves the need for one
  mutation queue, CLOCK-over-POMO precedence, reload reconstruction, explicit
  teardown, and read-after-write reconciliation.
- [Roam to Obsidian capability map](https://github.com/oldwinter/obsidian-nautilus-log/blob/d906db8ea949c36a9255116b5a535bc9d0afa211/docs/research/roam-obsidian-capability-map.md)
  at `d906db8ea949c36a9255116b5a535bc9d0afa211` establishes the supported
  ItemView, Vault, MetadataCache, Editor, workspace, command, settings, and
  lifecycle seams, plus the absence of stable list-item identity or a public
  Daily Notes configuration interface.
- [License and provenance boundary](https://github.com/oldwinter/obsidian-nautilus-log/blob/b2400709e7dea84a1080864a35974f6f2c23c582/docs/research/license-provenance.md)
  at `b2400709e7dea84a1080864a35974f6f2c23c582` supports an attributed port
  of the scheduler while requiring host, UI, CSS, and timing orchestration to be
  reimplemented.

Standing map constraints also apply: desktop first, no network or telemetry,
no mandatory community-plugin dependency, Daily Notes and ordinary Markdown as
canonical data, a dockable ItemView, read-only planning, and Markdown writes
only after an explicit user action.

## Authorized assumptions

The controller delegated all choices and pre-authorized the strongest supported
recommendation. The decision therefore proceeds with these assumptions:

- One loaded plugin instance corresponds to one Obsidian vault.
- More than one ItemView may exist after workspace restoration or user action;
  correctness cannot depend on retaining a particular view instance.
- An Obsidian metadata cache is a rebuildable parsing aid, not mutation
  authority.
- `data.json` is appropriate for validated plugin configuration and POMO start
  timestamps, but not for Plan Items, CLOCK history, active-task identity, or a
  durable vault index.
- The exact eligible Markdown grammar and `PlanItemRef` representation are
  supplied by [Decide: Obsidian Markdown grammar and stable Plan Item identity](https://github.com/oldwinter/obsidian-nautilus-log/issues/8).
- The exact optimistic checks, partial-write recovery, and user conflict flow
  are supplied by [Decide: timing-write safety, conflict handling, and recovery](https://github.com/oldwinter/obsidian-nautilus-log/issues/10).
  The architecture below fixes their ownership and required outcomes; the
  [canonical dossier](../implementation-dossier.md) composes the resolved wire
  contracts.

## Module map

```text
Obsidian host
  |
  +-- NautilusPlugin composition root
        |
        +-- surface adapters -----> Messages
        |       |
        |       v
        +---- NautilusRuntime
                    |
                    +---- NautilusCore
                    |
                    +---- MarkdownWorkspace ---- TextAccess port
                    |
                    +---- PluginData port
                    |
                    +---- SystemClock port
```

Dependency arrows point inward toward behavior. `NautilusCore` imports nothing
from Obsidian, the DOM, persistence, clocks, timers, or localization.
`MarkdownWorkspace` may import core value types but never runtime or UI types.
`NautilusRuntime` depends on the core and the workspace interfaces. Surface
adapters depend only on the runtime interface, presentation types, and
`Messages`.

There is no global event bus or `window` bridge. The composition root creates
adapters and modules, registers them with Obsidian, and then contains no mutable
business state of its own.

## Module responsibilities and interfaces

### 1. `NautilusCore`

`NautilusCore` is an in-process module with a small, synchronous interface:

```ts
interface NautilusCore {
  project(input: ProjectionInput): DomainProjection;
  decide(input: CommandFacts): MutationPlan | CommandRejection;
}
```

`project` hides:

- duration, time-range, progress, completion, and CLOCK token semantics;
- day-window normalization and one shared local-day calculation;
- fixed-interval normalization and union;
- source-order, atomic greedy task placement;
- capacity, Overflow, Timing, Plan, Review, recent-work, and historical
  calculations; and
- deterministic diagnostic codes for malformed or contradictory source.

`decide` is pure. Given a command plus freshly read facts, it returns either a
semantic `MutationPlan` or a typed rejection. It does not choose an Editor,
calculate a source span, retry a conflict, show a Notice, localize text, or
perform I/O.

`ProjectionInput` contains logical day context, source-ordered structural Plan
Item/CLOCK records with raw semantic text, validated settings, and an explicit
`now`. The core parses that text and never reads the system clock.
`DomainProjection` is immutable and contains all
planner and execution projections required by every surface so the ItemView and
Review cannot develop separate scheduler semantics.

The public interface does not expose internal parser, scheduler, capacity, or
review helpers. Those are internal seams used only where focused tests add
diagnostic value. The interface itself is the durable contract test surface.

### 2. `MarkdownWorkspace`

`MarkdownWorkspace` is the deep storage module:

```ts
interface MarkdownWorkspace {
  read(request: WorkspaceReadRequest, signal: AbortSignal): Promise<WorkspaceRead>;
  commit(plan: MutationPlan, expected: MutationExpectation): Promise<CommitReceipt>;
  onChange(listener: (change: SourceChange) => void): Unsubscribe;
}
```

It owns:

- Daily Note resolution and logical-date association;
- the eligible-region and list-hierarchy grammar;
- extraction of raw semantic text for `NautilusCore`;
- standard checkboxes and any approved fail-open recognition of third-party-like
  syntax;
- `PlanItemRef`, CLOCK identity, source versions, spans, fingerprints, and
  relocation rules;
- structural location and byte-preserving embedding/removal of LOGBOOK/CLOCK
  records, while CLOCK line semantics and canonical line content remain owned by
  `NautilusCore`;
- preservation of indentation and all text the plugin does not own;
- selection of an active `Editor` transaction versus background
  `Vault.process()`;
- validation inside the chosen mutation primitive and structural confirmation
  of the resulting text in a `CommitReceipt`; and
- normalization of Vault, MetadataCache, Editor, rename, create, delete, and
  modify events into `SourceChange` hints.

`WorkspaceRead` returns facts plus a `SourceVersion` and diagnostics. A cached
line number or MetadataCache entry is never sufficient mutation authority.
`commit` accepts a semantic plan, not an arbitrary text callback, and it may be
called only by `NautilusRuntime`. The exact expectation and conflict variants
are filled by the write-safety decision, but they must be strong enough to make
a stale or ambiguous target a no-write result.

The module may keep a memory-only parsed-file cache keyed by path and source
version. It must be disposable, bounded, invalidated by source events, and fully
rebuildable from Markdown. It is never serialized and never answers a write
precondition without revalidation.

The Obsidian host is a true external dependency, so an internal `TextAccess`
port is justified. The production `ObsidianTextAdapter` uses Vault, Editor,
MetadataCache, and workspace events; `MemoryTextAdapter` runs the same workspace
contract suite against fixtures. These are two real adapters at one seam, not a
port for every host method.

### 3. `NautilusRuntime`

Exactly one `NautilusRuntime` exists per loaded vault:

```ts
interface NautilusRuntime {
  start(): Promise<void>;
  connect(context: ViewContext, listener: SnapshotListener): RuntimeConnection;
  dispatch(command: RuntimeCommand): Promise<CommandOutcome>;
  stop(): void;
}
```

It owns:

- validated plugin settings and POMO session data;
- a single serialized plugin-data save tail;
- one vault-wide Markdown mutation queue;
- refresh coalescing, dirty flags, generations, and stale-result suppression;
- immutable confirmed snapshots keyed by logical view context;
- the global active-CLOCK projection and CLOCK-over-POMO precedence;
- one-second display ticks, minute/day invalidation, and time-zone/wall-clock
  change detection;
- execution-enabled, starting, ready, working, reconciling, degraded, and
  stopping lifecycle state;
- structured error publication and recovery coordination; and
- subscribers, never concrete ItemView references.

`connect` returns the last confirmed snapshot immediately when available,
requests a refresh, and returns a disposable connection. A connection owns only
its context and callback. Closing one view cannot tear down the vault runtime or
cancel another view's mutation.

`dispatch` is the sole write-capable application entry point. Commands carry an
opaque `PlanItemRef`, originating context, and explicit user-intent marker.
Settings changes and POMO transitions also go through this entry point so
plugin-local saves cannot overwrite each other.

The runtime depends on three internal ports with production and deterministic
test adapters:

- `PluginData`: Obsidian `loadData`/`saveData` and an in-memory adapter;
- `SystemClock`: wall time, scheduled ticks, and a fake clock; and
- `MarkdownWorkspace`: the production workspace module and a scripted in-memory
  adapter for coordinator tests.

The runtime does not expose its queues, caches, or mutable state. Callers see
only snapshots and command outcomes.

### 4. Surface adapters

Surface adapters are the ItemView, command/ribbon registrations, editor menu,
settings tab, and Notice presenter. They may:

- translate a click, command, or setting edit into one runtime command;
- keep local presentation state such as selected tab, expanded Overflow,
  pending delete confirmation, focus, scroll, and measured geometry;
- render the latest immutable snapshot; and
- navigate through public Workspace/Editor operations after the runtime has
  resolved a safe target.

They may not read Markdown directly, call the core, mutate plugin data, create a
second active-task store, or infer success before `CommandOutcome` confirms it.
Obsidian workspace state may restore a leaf's logical date and selected tab; it
is a presentation hint and can be discarded without data loss.

### 5. `Messages`

`Messages` resolves stable keys and typed interpolation values for English and
Simplified Chinese:

```ts
interface Messages {
  text(locale: Locale, key: MessageKey, values?: MessageValues): string;
}
```

Core, workspace, and runtime results carry codes and safe structured values,
never user-facing English. Missing Simplified Chinese entries fail the locale
contract tests; runtime fallback is English. Locale changes rerender surfaces
but do not reparse Markdown or regenerate a domain projection.

## State ownership

| State | Owner and authority | Persistence and recovery |
| --- | --- | --- |
| Plan Item text, status, duration/progress/time tokens, stable written identity, LOGBOOK, closed CLOCK history, running CLOCK | Ordinary Markdown through `MarkdownWorkspace` | Canonical. Re-read after reload, external edits, conflict, and uncertain write outcome. |
| Active Task | `NautilusCore` projection of the one valid running CLOCK | Derived only. Never saved in `data.json` or view state. |
| Planned Slots, Overflow, capacity, Timing, Plan, Review, Actual, Recent | `NautilusCore` projection held by `NautilusRuntime` | Derived and replaceable. Never written to Markdown or plugin data. |
| Settings and schema version | `NautilusRuntime` through one `PluginData` save queue | Persisted in `data.json`; validate and migrate before publication. |
| Task POMO absolute start and standalone POMO absolute start | `NautilusRuntime` through `PluginData` | Persist only on transitions. Honor task POMO only when Markdown yields one valid active CLOCK; otherwise clear the stale plugin-local value. |
| Execution status, errors, source generations, mutation/read queues, dirty flags, parsed-file cache | Owning runtime/workspace module | Memory only; rebuild or discard on reload. |
| Open leaves and restored view context | Obsidian workspace plus each ItemView adapter | Presentation only. Invalid restoration falls back to today without changing Markdown. |
| Selected tab, disclosure, delete-confirmation window, focus, hover, geometry | One ItemView adapter | Transient; losing it is harmless. |
| Localized strings | `Messages` at render time | Source catalogs only; no duplicated localized text in domain state. |
| MetadataCache data | Obsidian, consumed as a hint by `MarkdownWorkspace` | Never authority for a write and never copied into durable plugin storage. |

`data.json` has one versioned document and one writer. Its minimum durable shape
is settings plus the two POMO timestamps. It contains no cached `DomainProjection`,
file contents, source spans, Plan Item map, active task, or CLOCK index.

## Event and command flow

### Read and projection flow

1. An ItemView connects with a logical date/path context.
2. The runtime coalesces the request with any in-flight read for that context.
3. `MarkdownWorkspace.read` resolves current source and returns facts,
   diagnostics, and `SourceVersion`.
4. The runtime invokes `NautilusCore.project` with an explicit clock value and
   validated settings.
5. The runtime publishes one immutable `RuntimeSnapshot` to every subscriber of
   that context and to execution surfaces that consume the global active state.

If a newer generation starts before step 4 completes, the older result may warm
an internal cache but cannot be published. A non-abortable Obsidian read is
discarded on completion rather than treated as cancelled I/O.

### Explicit Markdown mutation flow

1. A surface dispatches a command caused by a direct user action.
2. The vault-wide queue assigns a command sequence, invalidates publication of
   older reads, and prevents another Markdown command from interleaving.
3. The runtime requests fresh structural source, projects it through
   `NautilusCore`, and obtains the vault-wide valid running-CLOCK facts before
   calling `NautilusCore.decide`.
4. A rejection ends without a write. A `MutationPlan` proceeds to
   `MarkdownWorkspace.commit` with the freshly read expectation.
5. The workspace relocates and revalidates inside the Editor transaction or
   `Vault.process` transform, applies one semantic mutation, and confirms the
   resulting structural record and source version.
6. The runtime performs an authoritative read, reparses it through the core,
   derives a confirmed projection, and only then reports success and publishes
   it.
7. Source events raised by the mutation set a dirty flag. They are folded into
   the post-commit read instead of starting a competing refresh.

Task switch may require multiple semantic changes, but remains one queued
command. The write-safety decision must state whether its physical Markdown
changes can be one atomic transform or require a recoverable partial outcome.
This architecture never labels a multi-file operation atomic merely because it
was serialized.

### Host event flow

- `workspace.editor-change` invalidates unsaved active-editor source promptly.
- Vault create/modify/delete/rename and MetadataCache change/resolved events are
  normalized by `MarkdownWorkspace`; bursts coalesce by affected context.
- A one-second clock tick updates elapsed presentation only. It does not read or
  write Markdown.
- The next minute boundary recomputes cursor-dependent scheduling. A local date,
  time-zone, or backwards/large wall-clock change forces an authoritative read
  and projection before another execution command is accepted.
- A Daily Note resolver, grammar, workday, or execution setting change
  invalidates affected projections after its plugin-data save succeeds. A locale
  change only rerenders.
- Workspace layout/active-leaf changes affect adapters and view context, not
  canonical state.

## Concurrency, cancellation, and serialization

- There is one Markdown write queue per vault, not one per view, file, tab, or
  feature.
- Reads are deduplicated per logical context. At most one follow-up read is
  queued through a dirty flag; event bursts do not create an unbounded tail.
- Every read and command carries a monotonically increasing runtime generation.
  Only the newest applicable generation may publish.
- Starting a command invalidates pre-command read results. A read may overlap
  host I/O, but it cannot overwrite the command's post-confirmation snapshot.
- A command may be cancelled while queued or before host mutation begins. Once
  an Editor transaction or `Vault.process` has begun, it is not cancelled;
  cancellation at that point could make commit outcome unknowable.
- View closure cancels that view's pending connection work only. Plugin unload
  rejects new commands, aborts/discards cancellable reads, and detaches
  subscribers. An already entered commit is allowed to settle, but its result is
  reconciled only on the next load and is never published into destroyed UI.
- No lifecycle hook automatically closes a CLOCK or repairs Markdown. Reload
  reconstructs execution from Markdown. Disable is an explicit command and any
  associated close belongs to the write-safety protocol.
- A mutation command that observes multiple or ambiguous running CLOCKs fails
  closed. Automatic repair is forbidden because source repair is a Markdown
  write without a separately confirmed user action.

## Lifecycle invariants

### Load

1. The composition root loads and validates plugin data.
2. It constructs host adapters, `MarkdownWorkspace`, `NautilusCore`, and the one
   `NautilusRuntime`.
3. It registers the view, settings tab, commands, ribbon, and events through
   Obsidian lifecycle helpers.
4. The runtime starts read-only observation and reconstructs active execution
   state from Markdown plus validated POMO timestamps.
5. No view opens automatically and no Markdown is created, repaired, or closed.

Initialization failure tears down everything already registered and publishes
no partially ready runtime. Corrupt plugin data falls back field-by-field to
validated defaults while retaining a diagnostic; corrupt Markdown never causes
a settings reset.

### View open and close

An ItemView creates local presentation state, connects, and renders loading,
ready, stale, or error snapshots. On close it disposes the connection, timers,
observers, and DOM it owns. It does not stop the runtime or alter a CLOCK. Open,
close, and reopen must not duplicate host listeners or command registrations.

### Execution enable and disable

Enable persists the setting through the runtime, performs a read-only global
execution scan, and enters ready only when the scan is coherent. Existing
ambiguous running CLOCKs produce a blocked/degraded snapshot, not automatic
repair. Disable is dispatched as an explicit user command; its Markdown and
POMO effects must finish before the persisted enabled flag changes. Failure
leaves the last confirmed setting and source state visible.

### Unload

Unload transitions the runtime to stopping, rejects new work, unregisters host
resources, clears ticks/debounces, aborts or suppresses reads, and disconnects
views. It does not write Markdown or close the running CLOCK. Transition-persisted
POMO data already exists; unload does not invent a final save race.

## Error and recovery taxonomy

Every non-success result has a stable code, structured safe context, retry class,
and optional cause for logs. User-facing text is resolved later by `Messages`.

| Class | Examples | Required behavior |
| --- | --- | --- |
| `source-diagnostic` | malformed duration, range, checkbox, LOGBOOK, or CLOCK; unsupported optional syntax | Preserve source and project every unambiguous item. Never repair automatically. Attach line-safe diagnostics; block only a command that depends on ambiguous source. |
| `source-not-found` | unresolved Daily Note, removed file, missing eligible region | Publish an empty/missing-source state, not an exception. Offer navigation/settings actions through the surface. |
| `read-failed` | Vault/Editor/MetadataCache read error | Retain the last confirmed snapshot with `stale: true`; never reinterpret failure as an empty note. Retry on the next event or explicit refresh. |
| `command-rejected` | execution disabled, item no longer eligible, no active CLOCK, unsupported transition | No write. Publish the fresh facts and a localized actionable outcome. |
| `source-conflict` | expected version changed, identity relocated ambiguously, duplicate match, competing running CLOCK | No write and no blind retry. Authoritative re-read, then require a new user action or the conflict flow chosen by the write-safety ticket. |
| `write-failed` | host rejected a confirmed no-change mutation | Keep the prior confirmed snapshot marked stale, re-read, and report failure. Do not claim rollback that did not occur. |
| `write-uncertain` | host failed after a possible change or a multi-step command partially completed | Enter `reconciling`, block later writes, re-read every touched source, and expose the observed result. Recovery policy is specified by the write-safety ticket. |
| `plugin-data-failed` | settings/POMO save failed | Do not publish the requested setting/session transition as durable. Retain or restore the last confirmed plugin-data snapshot and report it. |
| `lifecycle-cancelled` | superseded read, closed view, stopping plugin | Silent unless it interrupted a direct command before mutation; never rendered as source corruption. |
| `invariant-broken` | impossible projection, duplicate runtime owner, post-commit parse mismatch | Disable write commands, retain evidence, and require reload/recovery. Do not continue optimistically. |

Error objects must not include full note contents in notices or routine logs.
File path, line, stable diagnostic code, and redacted token context are sufficient.

## Test strategy and fixture ownership

Tests cross the same interfaces as callers. They do not reach through a module
to assert private helper state.

### Core contract

- Structured fixtures, not Markdown, cover token semantics, scheduling,
  capacity, Timing, Review, date/DST inputs, and command decisions.
- The v1.0.2 scheduler examples and selected upstream tests are preserved as a
  pinned `upstream-v1.0.2` fixture set with expected outputs and evidence links.
- Property tests cover interval union, source-order stability, no task split,
  nonnegative capacity, deterministic output, and projection purity.

`NautilusCore` owns these fixtures. A UI or workspace test may consume a core
fixture but may not redefine its expected scheduling result.

### Markdown workspace contract

- Markdown fixture pairs own eligible-region, hierarchy, identity, rename/move,
  duplicate-text, links/embeds, optional syntax, LOGBOOK/CLOCK, unknown-suffix,
  newline, indentation, and malformed-input cases.
- The same read/commit contract suite runs through `MemoryTextAdapter` and the
  disposable-vault Obsidian adapter harness.
- Mutation assertions compare complete before/after bytes and prove that no
  unowned text changed.
- Active Editor and background `Vault.process` paths receive equivalent
  identity/conflict fixtures.

`MarkdownWorkspace` is the sole owner of raw Markdown fixtures. Core tests never
parse a note, and UI tests never make byte-level write assertions.

### Runtime contract

- A scripted workspace adapter, in-memory plugin data, and fake clock drive
  command-order permutations, CLOCK/POMO precedence in both same-tick orders,
  rapid task switches, event bursts, stale reads, partial outcomes, date and
  wall-clock changes, enable/disable, and unload during each command phase.
- Assertions observe snapshots, command outcomes, and committed plans through
  the runtime interface, not queue internals.
- Lifecycle tests prove one listener/timer/command set after
  load-unload-reload and no publication after stop.

### Surface, localization, and integration contracts

- Surface tests use a fake runtime and assert commands, rendered snapshot
  states, focus, keyboard semantics, responsive structure, and no direct Vault
  access.
- Every message key must exist in English and Simplified Chinese; interpolation
  values and fallback behavior are contract-tested.
- Architecture tests forbid `obsidian`, DOM, persistence, timer, and localization
  imports from the core; forbid surface imports of workspace implementations;
  and verify that only runtime code calls `MarkdownWorkspace.commit`.
- Real Obsidian desktop QA, screenshots, accessibility, and package gates belong
  to the prototype and parity-acceptance tickets, not to core unit tests.

Each fixture manifest records the owning module, baseline requirement/evidence,
source commit when applicable, and whether it is copied, ported, or independently
authored. A fixture changes only when its owning contract changes.

## Provenance decisions

Use a hybrid reuse boundary:

1. Mechanically port the dependency-free scheduler/parser/capacity portions of
   upstream `src/log-core.js` only where doing so lowers semantic parity risk.
   Port selected `test/log-core.test.js` cases with it. Record exact source path,
   fixed SHA `973a041aa2f59f3b05bf31db8187efbfea07017a`, source blob, target
   symbol, modifications, notice, and covering test in `PROVENANCE.md`.
2. Clean-room reimplement CLOCK parsing/writing, Timing/Review projections,
   runtime state machines, and orchestration from the accepted research contract
   and behavioral examples. Do not translate `timing-core.js`,
   `timing-runtime.js`, `timing-roam.js`, or Roam Logbook source line by line.
   Ledger rows identify behavioral references rather than claiming copied code.
3. Reimplement all Roam adapters, ClojureScript/Reagent UI, Blueprint icons,
   host DOM orchestration, CSS, and documentation with public Obsidian interfaces,
   Lucide icons, scoped CSS variables, and newly authored copy.
4. Exclude the upstream `extension.js`, overview screenshot, lockfile, build
   graph, host assets/fonts, and generated artifacts. Create new Obsidian visual
   evidence.
5. Preserve the upstream MIT notice for any ported scheduler source/tests and
   retain complete project credits. Because timing implementation is clean-room,
   Jiayuan Zhang's Roam Logbook notice is not represented as a copied-code
   license; Roam Logbook remains credited as behavioral/provenance context. If
   implementation later copies or ports timing source, that is an architecture
   exception requiring a ledger update and the full additional MIT notice.
6. Create `PROVENANCE.md` and the required license/notice structure before the
   first ported production file lands. Release automation must reconcile the
   ledger, target lockfile/SBOM, minifier-preserved notices, and release bundle.

## Rejected options

### Screen-owned domain logic

Giving Planner, Timing, and Review separate parsers, schedulers, or Vault reads
would recreate the observed upstream cross-surface disagreements and make each
screen a source of truth. It fails locality and is rejected.

### One plugin monolith

A single class containing host reads, parsing, scheduling, UI, timers, settings,
and writes would have a large interface with little leverage for tests. Deleting
it would smear every concern across callers rather than reveal three coherent
responsibilities. It is rejected in favor of the core, workspace, and runtime
seams.

### A module per helper or host method

Ports for parsing, scheduling, Vault, MetadataCache, Editor, every timer, or
every command would expose implementation structure without adding adapters or
leverage. Pure helpers remain private to the core/workspace. Host access is
grouped behind the smallest real production/test seams.

### Persisted projection or identity database

Redux persistence, IndexedDB, SQLite, a sidecar JSON item map, or a serialized
planner snapshot would create a second task database and conflict with ordinary
Markdown. A memory-only rebuildable cache is sufficient and is rejected as
authority.

### One runtime per ItemView

Per-view runtimes would permit concurrent CLOCK writers, duplicate timers and
listeners, inconsistent active tasks, and competing plugin-data saves. Views
share one vault runtime and keep presentation state only.

### Automatic Markdown repair

Startup overlap repair, malformed LOGBOOK cleanup, progress cleanup, or unload
CLOCK closure without a fresh explicit action would violate the standing
read-only planning rule. Diagnostics and blocked commands replace automatic
repair.

### Port everything or rewrite everything

Porting Roam/ClojureScript/DOM/CSS layers would preserve the wrong host seams and
expand provenance obligations. Rewriting the already pure, heavily tested
scheduler would add semantic risk without architectural benefit. The hybrid
boundary is narrower and auditable.

## Consequences and implementation decomposition

The implementation sequence is now structurally fixed:

1. Establish core value types, the two-entry-point core interface, pinned
   scheduler contract fixtures, and provenance ledger.
2. Implement the Markdown workspace interface after the grammar/identity ticket,
   first against memory fixtures and then the Obsidian text adapter.
3. Implement the vault runtime, plugin-data schema, fake clock, refresh pipeline,
   and read-only projections.
4. Add ItemView and other surface adapters plus localization without direct
   storage access.
5. Add write-capable runtime commands only after the write-safety ticket fixes
   mutation expectations and recovery.
6. Validate adapter behavior and real desktop lifecycle in the throwaway
   prototype; production implementation does not inherit prototype code.

The architecture does not need to be reopened when the remaining tickets choose
specific Markdown syntax, identity encoding, conflict copy, minimum version, or
performance budgets, provided they preserve these invariants: Markdown is
canonical, one runtime serializes writes, the core is pure, source is
revalidated at commit, projections are derived, and UI adapters do not cross the
workspace seam.

`CONTEXT.md` is intentionally unchanged. This decision introduces implementation
terms (`module`, `interface`, `seam`, `adapter`, runtime, source version), not new
Nautilus domain language. `README.md` is also unchanged because the ticket does
not alter the product boundary or usage contract.
