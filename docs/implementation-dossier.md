# Spiral Day implementation dossier

Version: `1.2.0`

Status: implementation-ready specification for
[Produce the implementation-ready parity dossier and execution sequence](https://github.com/oldwinter/obsidian-nautilus-log/issues/14),
2026-08-28.

Functional baseline: Roam Nautilus Log `v1.0.2` at
[`973a041aa2f59f3b05bf31db8187efbfea07017a`](https://github.com/404KSG/roam-nautilus-log/tree/973a041aa2f59f3b05bf31db8187efbfea07017a).
Later upstream `main` at `08892f948c63e4cacd3fc1cc100a600dd38c21f8`
is supplementary drift evidence only.

## Canonical use and precedence

This file is the single canonical dossier and implementation index. It does not
copy the detailed matrices into a second authority. It fixes how the linked
artifacts compose, records every approved resolution, and routes each contract
to one implementation owner.

When two sources appear to disagree, apply this order:

1. The fixed upstream baseline establishes observed Roam behavior.
2. Accepted decision records establish the Obsidian contract and resolve
   research questions. A research document's `unknown`, `unresolved`, or
   `downstream decision` wording remains historical evidence, not live fog.
3. The approved prototype establishes interaction feasibility only. Its source,
   architecture, fixtures, and package files are throwaway and are not an
   implementation foundation.
4. This dossier integrates the accepted records and assigns ownership. It may
   clarify routing but cannot silently change a decision or an upstream
   requirement.
5. A later implementation change to observable meaning requires a new decision,
   a new never-reused requirement ID, and an updated dossier version.

Normative words (`must`, `must not`, `required`) preserve the accepted records.
Research prose is descriptive unless this dossier or a decision adopts it.

## Evidence ledger

The six research artifacts were integrated in this exact order. `Source commit`
is the immutable branch head reviewed on its closed research ticket. Ordered
cherry-picks preserved each imported body at its integration point. The final
artifacts intentionally include the status, errata, resolution, and
decision-amendment overlays enumerated in the machine-readable
[source ledger](parity/source-ledger.json). That ledger binds every ticket,
source commit, ordered integration commit, final artifact blob, approving
substantive commit, overlay kind, and status pointer. The planning checker
verifies the original patch identities, final blobs, overlay declarations, and
approval ancestry from the audited Git object.

| Order | Closed source ticket | Source commit | Integrated artifact | Authority |
| ---: | --- | --- | --- | --- |
| 1 | [Research: inventory every v1.0.2 user-visible behavior](https://github.com/oldwinter/obsidian-nautilus-log/issues/2) | `254976ab0c92611e59b8c9bb88d946d7b155212b` | [Behavior inventory](research/behavior-inventory.md) | Frozen 114-row observable contract and `FX-01..16` corpus |
| 2 | [Research: specify the deterministic scheduler and parser semantics](https://github.com/oldwinter/obsidian-nautilus-log/issues/3) | `d0d1c100f863a3cea43c0a37407670aa1a3997a4` | [Scheduler semantics](research/scheduler-semantics.md) | Frozen parser, scheduling, capacity, day, and warning behavior |
| 3 | [Research: reverse-engineer the Execution Layer state machines](https://github.com/oldwinter/obsidian-nautilus-log/issues/4) | `a43ae669a40799468e6473c6e8f8baac36143b1f` | [Execution state machines](research/execution-layer.md) | Frozen Timing, Plan, Review, CLOCK, POMO, persistence, and lifecycle behavior |
| 4 | [Research: map every Roam contract to Obsidian capabilities](https://github.com/oldwinter/obsidian-nautilus-log/issues/6) | `d906db8ea949c36a9255116b5a535bc9d0afa211` | [Capability map](research/roam-obsidian-capability-map.md) | Public Obsidian API mappings and host gaps |
| 5 | [Research: inventory the visual and interaction parity contract](https://github.com/oldwinter/obsidian-nautilus-log/issues/5) | `bce308843b3579f1be0afc5a2367e6b00e6feb9a` | [Visual and interaction contract](research/visual-interaction.md) | Surface/state, token, interaction, keyboard, and visual fixtures |
| 6 | [Research: audit license, provenance, and the reusable-code boundary](https://github.com/oldwinter/obsidian-nautilus-log/issues/7) | `b2400709e7dea84a1080864a35974f6f2c23c582` | [License and provenance audit](research/license-provenance.md) | Reuse boundary, notices, asset exclusions, and release obligations |

Accepted decisions supersede the choice points in those frozen research records:

| Closed decision ticket | Exact decision commit | Durable record | Normative result |
| --- | --- | --- | --- |
| [Decide: Obsidian Markdown grammar and stable Plan Item identity](https://github.com/oldwinter/obsidian-nautilus-log/issues/8) | `343ae3f252b27f723a97eddaae8813f66a8c21fe` | [Grammar and identity](decisions/markdown-grammar-and-plan-item-identity.md) | Versioned Plan Region, direct list items, explicit identity materialization, no hidden database |
| [Decide: plugin architecture and state ownership boundaries](https://github.com/oldwinter/obsidian-nautilus-log/issues/9) | `7f3972c2f64bbcf4a6d31c00d262201836273dc2` | [Architecture and state](decisions/plugin-architecture-and-state-ownership.md) | Pure core, one Markdown seam, one vault runtime, thin host adapters |
| [Decide: timing-write safety, conflict handling, and recovery](https://github.com/oldwinter/obsidian-nautilus-log/issues/10) | `d09d766423326525be1c7e9e6a5d7dc3d8257426` | [Write protocol](decisions/timing-write-safety-conflict-handling-and-recovery.md) | FIFO intents, semantic CAS, close-before-open, no blind retry or automatic repair |
| [Decide: parity acceptance matrix and release gates](https://github.com/oldwinter/obsidian-nautilus-log/issues/11) | `278b3e68c0db50c65b33d572a1a14ec4d8d1e05b` | [Acceptance and release gates](decisions/parity-acceptance-matrix-and-release-gates.md) | Exact-SHA evidence, 114/114 public parity, G0-G9, controlled deviations |
| [Decide: desktop compatibility and performance envelope](https://github.com/oldwinter/obsidian-nautilus-log/issues/12) | `0feaf0ec8f7dc470e06e7bf5d55f0cbc8c8d906c` | [Compatibility and performance](decisions/desktop-compatibility-and-performance-envelope.md) | Desktop 1.7.7+, bounded inputs, numerical budgets, fail-closed degradation |
| [Decide: Community-compliant product naming and attribution](https://github.com/oldwinter/obsidian-nautilus-log/issues/15) | `8b7b10abd70a4796c78d518fa3d697e38560fcba` | [Naming and attribution](decisions/community-compliant-product-naming-and-attribution.md) | `Spiral Day` / `spiral-day`, unofficial lineage, immutable public ID |

The only adopted prototype result is the approved **A, Spiral first** interaction
direction and its feasibility proof:

- Exact throwaway commit:
  [`5a2db368df31f6ded948a983fbceae38c455b611`](https://github.com/oldwinter/obsidian-nautilus-log/commit/5a2db368df31f6ded948a983fbceae38c455b611).
- Committed evidence only at that exact tree:
  [Issue 13 evidence index](https://github.com/oldwinter/obsidian-nautilus-log/blob/5a2db368df31f6ded948a983fbceae38c455b611/prototype/evidence/issue-13/index.md).
- Public, non-draft evidence:
  [Issue 13 prototype evidence Release](https://github.com/oldwinter/obsidian-nautilus-log/releases/tag/issue-13-prototype-evidence),
  targeting that commit with five server-side SHA-256-identified assets.
- Approved conclusion: dockable `ItemView` -> variant A parity surface -> guarded
  `Vault.process()` round trip. The stale write changed zero plugin-owned bytes;
  the fresh write produced one LOGBOOK/CLOCK pair; reload recovered from Markdown.
- Excluded: every source, build file, package manifest, CSS file, fixture, and
  binary under the prototype commit. Production work must reimplement from this
  dossier and the accepted records.

## Versioned parity matrix

`UPSTREAM-MATRIX-v1` is the frozen 114-item matrix in
[Behavior inventory](research/behavior-inventory.md). Each row becomes
`UP-<row-id>` without changing the source ID. This is one versioned requirement
universe, not 114 copied summaries.

| Selector | Count | Contract family |
| --- | ---: | --- |
| `UP-INS-01..05`, `UP-SET-01..13` | 18 | Installation, lifecycle, settings |
| `UP-PAR-01..12` | 12 | Input, parsing, classification |
| `UP-SCH-01..07`, `UP-DAY-01..04`, `UP-HIS-01..05` | 16 | Scheduling, day relation, history |
| `UP-VIS-01..07`, `UP-CTL-01..05`, `UP-CMP-01..03` | 15 | Planner visuals, controls, responsive states |
| `UP-EXE-01..13`, `UP-CLK-01..10` | 23 | Execution views and CLOCK state |
| `UP-CMD-01..02`, `UP-PER-01..02` | 4 | Commands and persistence |
| `UP-ERR-01..09`, `UP-ERX-01..08` | 17 | Failures, warnings, exact error outcomes |
| `UP-DRF-01..09` | 9 | Contradictions and prohibited later-main drift |
| **Total** | **114** | Frozen public parity universe |

Implementation adds the 12 accepted cross-cutting IDs `OBS-TRACE-001`,
`OBS-HOST-001`, `OBS-VIS-001..002`, `OBS-A11Y-001`, `OBS-SAFE-001`,
`OBS-LIFE-001`, `OBS-I18N-001`, `OBS-LOCAL-001`, and `REL-001..003`.
The complete initial 126-row [requirement owner map](parity/requirement-owners.json)
and its [schema](parity/requirement-owners.schema.json) are normative now. Every
row has exactly one `owner_ticket` and one `owner_module`; optional
`evidence_contributors` never confer a second implementation owner. Ticket #22
owns this schema/map and the future `docs/parity/requirements.json`; ticket #17
is a bootstrap consumer only. The machine-readable
[ticket-boundary manifest](parity/ticket-boundaries.json) and its
[schema](parity/ticket-boundaries.schema.json) enumerate every ticket's
exclusive allowed module boundaries and complete primary requirement set.
The owner map, boundary manifest, and live ticket JSON sections must be exact
set-equal. `UP-HIS-01..05` belong to ticket #28: ticket #28 is their sole
primary owner, while ticket #19 contributes history primitives as evidence only.
The reviewed Planner seam amendment assigns `src/adapters/planner-view.ts`,
`src/ui/planner/view.ts`, and primary `UP-INS-03` ownership to ticket #24.
Ticket #23 retains the spiral geometry, state, responsive, diagnostic, and style
primitives and contributes their exact-SHA evidence to #24's production Planner
assembly; host registration and package/style-bundle assembly remain outside
this amendment and belong to the downstream host-assembly ticket.

The full implementation source of truth will be
`docs/parity/requirements.json`. Every row must retain its mapped primary owner
and have exactly one disposition (`exact`, `host-adapted`,
`approved-improvement`, or `not-applicable`), immutable source references,
fixtures, tests, environments, current-candidate evidence, and an approved
`DEV-NNN` when adapted or improved. IDs are never reused.

Public release requires all 114 upstream and all active Obsidian/release IDs.
Private packages may exclude declared families but cannot exclude safety,
lifecycle, local-only, deterministic candidate, or private-scope requirements.

## Semantic and data contract

### Grammar and identity

- A Daily Note contributes a plan only inside the first exact, complete
  `<!-- nautilus-log:plan/v1 -->` / `<!-- /nautilus-log:plan -->` pair.
  Unsupported, nested, duplicated-primary, or unclosed markers fail closed.
- Only direct unordered list items are Plan Item candidates. Nested, ordered,
  quoted, table, code, and foreign-checkbox rows remain ordinary Markdown.
- Plain rows remain visual items but have no execution action. `[ ]` enables
  actions only for Flexible Tasks; `[x]` and `[X]` are done.
- The first syntactic Time Range is authoritative even when invalid. A valid
  range wins Fixed Event classification. Then parse first Duration, first
  Progress, done-only completion anchor, and the non-owning urgent trigger.
- v1.0.2 overnight input remains truncated at local minute 1440. Progress uses
  the accepted shared rounding rule, half up, instead of preserving the
  upstream cross-surface floor/round defect.
- Links contribute visible labels but their destinations never contribute
  syntax. Embeds are never expanded. Tasks/Dataview-shaped text has no special
  meaning and must survive writes byte-for-byte.
- An anonymous Plan Item is read-only-plan-capable. Only an explicit action may
  materialize a terminal, vault-unique `^nl-<uuid>` block ID. A unique terminal
  ID is the only durable Plan Item identity. Duplicate IDs disable all
  identity-dependent writes until explicit repair.
- Source spans are half-open UTF-16 offsets into one exact source digest. They
  locate a snapshot and never become identity or write authority.
- Grammar changes require `/v2` or later plus explicit previewed migration.
  Unsupported versions remain ordinary Markdown and are never silently parsed
  with the newest grammar.

### Canonical state and storage

- Ordinary Markdown owns Plan Item text/status/tokens/IDs, LOGBOOK, CLOCK
  history, and the one running CLOCK. Markdown is the only task/timing database.
- Planned Slots, Overflow, capacity, Timing, Plan, Review, Actual, Recent, and
  Active Task are disposable projections.
- `data.json` owns only validated versioned settings and absolute task/standalone
  POMO starts. It contains no Plan Item map, CLOCK index, active task, source
  content, span, or projection.
- Daily Note resolution uses plugin-owned folder and Moment date-format settings,
  defaults to root `YYYY-MM-DD`, normalizes a single vault-relative path, and
  must round-trip without date collisions. It never reads private core-plugin
  settings or silently falls back.
- Canonical LOGBOOK is a direct nested list child. CLOCK is its direct child,
  carries offset-bearing millisecond timestamps and a terminal
  `^nl-clock-<uuid>` ID, and derives duration from endpoints. Legacy records are
  read conservatively; DST gaps/folds are never guessed.

## Architecture and ownership

Dependency direction is `surface adapters -> NautilusRuntime -> NautilusCore +
MarkdownWorkspace -> host ports`. There is no global event bus, hidden task
store, screen-owned domain logic, or per-view runtime.

| Module | Owns | Must not own |
| --- | --- | --- |
| `NautilusCore` | Pure token semantics, scheduling, capacity, Timing/Plan/Review projections, diagnostics, command decisions | Obsidian, DOM, I/O, clocks, persistence, localization, source relocation |
| `MarkdownWorkspace` | Daily Note resolution, region/list grammar, source spans, identity index, LOGBOOK/CLOCK placement, byte-preserving read/commit, host change normalization | UI, runtime queues, arbitrary text callbacks, cached-position write authority |
| `NautilusRuntime` | One vault-scoped lifecycle, settings/POMO saves, one mutation queue, refresh generations, snapshots, active-CLOCK projection, cancellation/reconciliation | Markdown syntax, concrete views, a durable projection or command journal |
| Surface adapters | `ItemView`, commands, ribbon/actions, editor menu, settings, notices, focus/scroll/transient presentation | Markdown reads/writes, core calls, active-task state, success inference |
| `ActiveTaskView` | One singleton `ItemView` leaf projecting current Active Task, read-only unavailable states, source navigation by authoritative block ID, keyboard/focus behavior, narrow-dock presentation | Canonical active state, Markdown writes, planner selection, stale source navigation |
| Planner surface assembly | Production Planner adapter and view wiring owned by #24, consuming #23's render primitives and exposing typed localized actions and approved state/style hooks | Host/package registration, Markdown reads/writes, duplicated geometry or scheduler semantics |
| i18n base/shared | Typed resolver, locale selection/fallback, and equal `shared` catalogs owned by #24 | Planner, Execution, or Review namespace content |
| i18n feature namespaces | Equal `planner` catalogs owned by #24, `execution` catalogs owned by #27, and `review` catalogs owned by #29 | Domain decisions, source text, edits to another ticket's namespace |

Production adapters use public Obsidian APIs only. `MemoryTextAdapter`, fake
clock, in-memory plugin data, and scripted runtime adapters must execute the same
contracts as production seams.

## State machines

The detailed transition tables remain canonical in
[Execution state machines](research/execution-layer.md),
[Architecture and state](decisions/plugin-architecture-and-state-ownership.md),
and [Write protocol](decisions/timing-write-safety-conflict-handling-and-recovery.md).
Every reachable state is assigned below so none is hidden in a UI ticket.

| Machine | Required states and transitions | Owner |
| --- | --- | --- |
| Scheduler | Normalize fixed intervals -> merge reservations -> advance one source-order cursor -> place each task atomically or Overflow -> never backfill after cursor reaches day end | `NautilusCore` |
| Plugin lifecycle | `unloaded -> starting -> ready/degraded -> stopping -> unloaded`; load validates data and builds bounded indexes; unload admits no new intent and writes no Markdown | `NautilusRuntime` |
| Projection refresh | `clean -> dirty/stale -> reading -> projecting -> confirmed` or `missing/over-limit/error`; newest generation alone may publish; stale views expose no write action | Runtime + workspace |
| Planner view | wide/compact at 521/520 px boundary; collapsed/expanded; completed shown/hidden; playback stopped/running/finished; Overview and Schedule disclosures preserve their accepted state | Planner adapter |
| Execution enablement | `disabled -> scanning -> ready-idle/ready-active` or `degraded`; Disable closes the sole CLOCK first, then clears POMO and saves disabled; unload is never Disable | Runtime |
| CLOCK/Timing | `idle`, `active`, `forgotten`, `working`, `reconciling`, `multiple/potential/invalid-owner degraded`; Clock In, switch, Clock Out, Complete, delete, reload, and repair follow one vault-wide invariant | Core + runtime + workspace |
| Task POMO | absent/running/over-threshold/suppressed; exists only with one valid Active Task and derives from absolute time; CLOCK wins on every ordering and reload | Runtime/plugin data |
| Standalone POMO | absent/running/over-threshold/suppressed; starts only with zero CLOCK, clears before Clock In, never auto-stops | Runtime/plugin data |
| Plan projection | no plan/empty/scheduled/unscheduled/focused/working/error; remains a read-only snapshot while Timing mutation is pending and updates only after confirmation | Core + execution adapter |
| Review row | exactly `not-started`, `live`, `paused`, `not-tracked`, or `compared`; only done tasks with positive closed same-day Actual compare; cross-midnight Actual clips by local calendar day | Core + Review adapter |
| Execution panel | closed/open; Timing/Plan/Review tab with correct roving focus and panel semantics; pending/notice/error/confirmation; Escape and close restore focus | Execution adapter |
| `ActiveTaskView` | `closed -> opening -> available` or `unavailable`; a repeated open reveals/focuses the one existing leaf; source refresh may move `available -> unavailable`; only a fresh authoritative block ID enables source navigation; unavailable is always read-only | Execution adapter over Runtime snapshot |
| Commit | `admitted -> queued -> fresh-read -> decided -> host-transform -> confirming -> applied/already-applied/rejected/conflict/failed-no-change/uncertain/partial-safe/invariant-broken`; uncertain never retries and blocks later writes until reread | Runtime + workspace |
| Time continuity | trusted -> `time-review-required` on >5 s wall/monotonic divergence, backwards time, or impossible elapsed -> explicit keep-measured/use-system/stop-at-trusted action -> trusted | Runtime + write protocol |
| History index | absent/building/current/dirty/over-limit/unavailable; yields at least every 50 ms, never blocks today's plan, never presents partial totals as complete | Workspace + runtime |

## Write protocol

Every write begins with one explicit pointer, keyboard, or command activation and
one fresh `intentId`. One vault FIFO serializes every leaf and surface.

1. At queue head, drain invalidations and reread authoritative Editor/Vault text,
   current settings, trusted time, and the complete bounded CLOCK safety index.
2. Reparse structural facts and ask `NautilusCore.decide` for a semantic
   Mutation Plan. Cached path/line/text/MetadataCache state is never authority.
3. Reparse and validate the Expectation inside one synchronous Editor
   transaction or one `Vault.process()` transform. Unique IDs may relocate only
   when all watched semantic and unowned bytes still match; anonymous targets
   never relocate.
4. Apply only the action allowlist and reject any diff to unowned bytes. Same-file
   multi-effect actions are one transform. Cross-file switch closes and confirms
   the old CLOCK before it opens the new one; failure may leave only safe Idle.
5. Authoritatively reread every touched/dirty source, rebuild relevant indexes,
   and publish success only after exact postconditions and the global invariant.

The action contract covers Initialize/Migrate Plan, assign/repair Plan Item or
CLOCK identity, advance/reopen progress, Clock In/current/switch/Out, Complete,
delete current CLOCK, Timing Repair, enable/disable Execution, settings, task
POMO, standalone POMO, and all three wall-clock recovery choices. There is no
Force, overwrite, fuzzy relocation, persisted command journal, automatic retry,
startup repair, timeout retry, or lifecycle-triggered Markdown write.

Conflict and no-write paths expose stable localized codes and only allow open,
refresh, or a narrowly previewed repair. Routine logs/notices include action,
code, safe identity/location, counts, and timings, never full note text.

## Compatibility and performance

- Desktop only: `manifest.json.minAppVersion` `1.7.7`, official installer
  Electron floor `32.2.5`, and `isDesktopOnly: true`. Test minimum plus current
  public Obsidian on official Windows, macOS, Linux x64, and Linux ARM64 lanes.
- Public Obsidian/browser APIs only: no Electron/Node import, private host DOM,
  undocumented global, network dependency, telemetry, or mobile load.
- Supported boundary: 20,000 Markdown files / 2 GiB, 3,650 Daily Notes,
  25,000 CLOCK records, 2 MiB active Daily Note, 1 MiB Plan Region,
  1,000 Plan Items, 16 KiB item span, depth 16, and four open ItemViews.
- Boundary p95: activation 75 ms; cold interactive view 1,000 ms; parse/project
  150 ms; pure schedule 50 ms; painted DOM 250 ms; incremental refresh 600 ms;
  confirmed write 750 ms; optional first history index 5,000 ms; visible tick
  CPU 8 ms; retained heap 64 MiB. Apply every hard cap and the 20% regression
  rule in the compatibility record.
- Active Editor uses 150 ms trailing debounce/500 ms max wait; vault/cache bursts
  use 250 ms trailing debounce. Explicit action, settings/date switch, and
  visibility restoration bypass debounce.
- Hidden views cancel rendering/playback/layout/ticks and become dirty. They must
  refresh before display or command. One global visible timing tick performs no
  vault I/O.
- Over-limit, stale, ambiguous, hard-cap, or invalid configuration states render
  no partial schedule and disable writes. Cross-note over-limit may disable only
  history while a bounded today's plan stays read-only/usable.

## Visual and interaction contract

The approved surface is a flat, dockable Spiral-first `ItemView`, not a board or
card dashboard. Preserve capacity/control/legend hierarchy, spiral time geometry,
fixed/flexible/urgent/current/completed/overflow meanings, and an unframed
Overflow area.

- Wide (`>520px`) retains outside labels and tooltips. Compact (`<=520px`)
  removes outside labels, starts Overview and Schedule folded, places metrics
  and legend in Overview, and supplies the textual Schedule equivalent.
- One container-width source controls the 519/520/521 branches. Required widths
  also include 320, 360, and a 300 px dock, with 80%, 100%, and 200% zoom.
- Tokenize semantic roles with Obsidian theme variables. Default light/dark is
  visual-release blocking; high-contrast and one heavily customized theme are
  functional gates. Do not reuse upstream CSS, screenshot, Blueprint icons, or
  font/assets. Use fixed-size Obsidian/Lucide icons and original screenshots.
- Preserve every planner control and Execution Timing/Plan/Review state, empty,
  pending, error, warning, confirmation, scroll, tooltip, temporal, and playback
  branch. Host chrome is checked by state/workflow, not Roam pixels.
- Plugin-owned golden crops use controlled fonts, DPR 1, fake clock, exact
  dimensions, and at most 0.2% pixels above per-channel delta 16. Missing state,
  overlap, clipping, or changed hierarchy fails regardless of numeric diff.

`ActiveTaskView` is the approved HOST replacement for Roam right-sidebar task
fronting. Opening it normally creates one dedicated leaf; every later open
reveals and focuses that same leaf, including after workspace restoration. Its
primary action opens the authoritative source Markdown and locates the current
terminal block ID. It never navigates by cached line/span alone. A missing or
stale ID, missing file, unreadable source, over-limit source, or unavailable
workspace API produces an explicit localized read-only unavailable state and
zero write. All actions and unavailable details are keyboard reachable. At a
narrow dock it retains status, elapsed timing, and source navigation while
folding secondary metadata; it never changes into planner state or a bare
Markdown leaf.

## Keyboard, accessibility, and localization

- Every pointer action has a keyboard equivalent. Icon buttons have stable
  dimensions, localized accessible names, and decorative glyphs hidden.
- Implement a complete dialog/tab pattern: deterministic initial focus, roving
  tab selection, associated tabpanels, containment where modal, Escape/outside
  close, and focus restoration. No keyboard trap or pointer-only progress action.
- Planner items expose meaningful state, urgency, current status, schedule, and
  tooltip detail without color alone. Focus adds a separate visible halo/ring and
  never replaces the semantic stroke.
- Status and write outcomes use named live/status semantics. Normal text meets
  4.5:1; large text and non-text state/control boundaries meet 3:1.
- Reduced motion removes nonessential duration and delay plugin-wide while
  retaining immediate state feedback.
- English `en` and Simplified Chinese `zh-CN` use exactly equal stable key sets.
  Core/workspace/runtime return codes and typed values, never UI prose. Locale
  changes rerender only. Missing Chinese keys fail tests; runtime English fallback
  is a defensive path, not releasable evidence.
- Both locales must expose identical actions and fit all canonical states at
  every required width and 100%/200% zoom on supported host profiles.

Catalogs are namespaced `shared`, `planner`, `execution`, and `review`. Ticket
#24 lands the typed resolver plus equal `shared`/`planner` catalogs and exports
the namespace registration contract. Tickets #27 and #29 depend on that API and
own only equal `execution` and `review` catalogs respectively. Integration
imports namespaces through the resolver; no ticket edits another namespace,
and #30 verifies union-key equality plus cross-locale action/state parity.

Ticket #24 also owns the production Planner adapter/view seam. Its acceptance
must prove that controls, disclosures, focus/playback behavior, typed locale
actions, and semantic style hooks are reachable through that production seam,
not only through a test harness. Rolling back #24 removes that assembly and its
controls/i18n/theme/a11y additions together while leaving #23's pure rendering
primitives available for tests. Host registration and final package stylesheet
bundling are qualified separately by the downstream host-assembly boundary.

## Privacy and offline contract

Spiral Day is local-only. It initiates zero network requests and emits zero
telemetry on load, planning, execution, settings, failures, package checks, or
unload. It has no account, cloud service, remote model, analytics identifier, or
background update channel. Acceptance instruments all `FX-01..16` paths.

Diagnostics are local, bounded, and content-minimizing. They may include counts,
durations, file path/line, action code, and safe ID suffix; they must not persist
full note text, a task index, source snapshots, or hidden execution history.
Derived caches are memory-only, bounded, disposable, and rebuildable from
Markdown. Release assets contain no private vault fixture or prototype `/tmp`
evidence.

## License, provenance, and attribution

- Product identity is **Spiral Day**, ID/folder **`spiral-day`**, described as an
  unofficial independently maintained Obsidian-native parity port. `Nautilus
  Log` names the upstream lineage, never this product.
- Port pure scheduling logic or selected tests only when it reduces risk and
  record the exact source/blob, modifications, license, target scope, and parity
  test in root `PROVENANCE.md`. Mechanically ported files carry a short source
  header. Behavioral reimplementations receive a ledger reference, not a false
  copied-code notice.
- Reimplement Roam/ClojureScript/Blueprint/UI/CSS/timing orchestration and host
  adapters. Exclude the upstream bundle, screenshot, lockfile, build graph,
  fonts, host assets, and prototype source/assets.
- Before copied or substantially ported code lands, create root `LICENSE`,
  `THIRD_PARTY_NOTICES.md`, and `PROVENANCE.md`. Preserve Matt Vogel's MIT notice
  for Nautilus-lineage code and Jiayuan Zhang's notice if timing code is ported.
- A release license scan and target lockfile/SBOM include only code actually
  distributed. Preserve applicable notices in a minifier-safe `main.js` banner
  because the Community installer downloads only manifest/main/optional styles.
- README and settings About credit `404KSG`, Tomas Baranek, `hopeserena`, Matt
  Vogel, and Jiayuan Zhang without implying affiliation. Public submission must
  recheck name availability and current fork/duplication/attribution policy.

## Explicit deviations and drift boundary

These are approved decision classes, not blanket waivers. Each implementation
instance still requires a linked, reviewed `DEV-NNN` record and passing evidence.

| Class | Approved difference | Preserved invariant | Rollback/revisit trigger |
| --- | --- | --- | --- |
| `HOST` | Roam scaffold/topbar/block menu become Obsidian planner/entry adapters; right-sidebar task fronting becomes the dedicated singleton `ActiveTaskView` with authoritative-block-ID source navigation and read-only unavailable fallback | Same availability, conditional action, state/timing visibility, keyboard reachability, one-step source access, and zero-write stale/missing behavior; repeated open never duplicates leaves | Public APIs cannot reveal/focus a singleton leaf or authoritative ID navigation cannot be preserved |
| `A11Y` | Correct tabs/dialog focus, focus rings, Enter/Space activation, urgency naming, live status, and complete reduced motion | Same action, semantic state, and information hierarchy | Accessibility regression or an upstream parity decision changes meaning |
| `THEME` | Obsidian variables, `.theme-dark`, Lucide icons, inherited fonts, contrast-corrected colors | Semantic hue roles, emphasis, hit areas, geometry, and non-color cues | Theme/API change collapses a required state |
| `SAFETY` | Explicit Plan Region/ID materialization, semantic CAS, conservative link handling, fail-closed conflicts, no automatic write/repair/retry | Scheduling semantics and explicit workflow remain; unowned Markdown is byte-preserved | New host atomicity/identity capability justifies a narrower approved protocol |
| `not-applicable` | Roam Depot installation conflict `UP-INS-01` | Obsidian install/package workflow is fully tested | Product again targets Roam distribution |

Approved semantic resolutions from the data-contract decision are not silently
filed as native deviations: standard Markdown checkbox mapping, no link/embed
dereference, no true overnight continuation, and shared progress rounding are
baseline-changing decisions with their own fixed decision evidence. No other
later-`main` behavior may enter. Parser/scheduler changes, missing features,
hidden errors, and core-workflow changes require a new Wayfinder decision.

## Risks and rollback boundaries

| Risk | Prevention/evidence | Rollback boundary |
| --- | --- | --- |
| Parser/scheduler drift | Frozen 114 IDs, negative `UP-DRF` tests, pure deterministic hashes | Revert the core task commit without touching Markdown adapters |
| Mis-targeted or partial write | Exact diff allowlists, dual adapters, failure injection, authoritative confirmation | Revert write protocol/runtime command commits; read-only planner remains usable |
| Duplicate CLOCK or identity | Complete bounded safety index, unique IDs, fail-closed repair | Disable Execution and revert execution commits; never rewrite user source automatically |
| External edits/races | Fresh queue-head and in-primitive parse, watched bytes, no retry | Return no-write/conflict; user source is the rollback authority |
| Performance/large vault | Fixed scale fixtures, budgets, last-input-wins, bounded caches | Disable cross-note history first; then disable interactive projection, never truncate |
| UI/theme/a11y regression | State assertions plus screenshots, contrast, keyboard/screen-reader scripts | Revert the owning surface commit independently of core/workspace |
| `ActiveTaskView` duplication or stale navigation | Singleton leaf assertions; fresh ID lookup; missing/stale/source-unavailable and narrow-dock QA | Revert #27 view/adapter files; execution runtime and source Markdown remain unchanged |
| License/name/policy failure | Provenance ledger, notices, bundle scan, current policy recheck | Remove/reimplement the affected ported unit or stop release; do not rename a published ID |
| Bad package/candidate mismatch | Reproducible build, asset allowlist/hash, exact remote SHA | Withdraw the candidate assets/tag; Markdown data requires no migration |

Every implementation ticket owns a narrow file/module set and must land as a
revertable commit. Schema/grammar/manifest changes require explicit forward and
backward migration notes. Rollback never means replaying old note bytes.

## Packaging and release gates

Ticket #22 first delivers every reusable release script, fixture, scanner,
schema, and template. After the last material change, ticket #30 pushes one
clean commit, runs G0-G6 against that remote SHA, records package identity, and
freezes it. Ticket #31 runs and signs G7-G9 against that identical SHA. It owns
no repository files and may not commit or modify any source, test, build,
package, or release-input file. A material source, test, fixture, requirement,
golden, dependency, build, package, release script, scanner, schema, or template
change invalidates the freeze and returns the candidate to #30 for G0-G6 before
#31 may restart.

| Gate | Blocking result |
| --- | --- |
| G0 candidate/baseline | Exact candidate and upstream SHA; complete 114 + active requirement map; scope and deviations frozen |
| G1 static/build | Compiler, type, lint, manifest, key equality, and clean deterministic build all pass without skips |
| G2 semantic | Parser, scheduler, day/history, Execution, CLOCK/POMO, contradiction, error, and negative-drift contracts pass |
| G3 data safety | Exact vault diffs, conflicts, malformed/failure/race/reload paths, serialization, and zero-byte no-write paths pass |
| G4 host | Minimum/current Obsidian, commands/views/settings/notices/navigation/lifecycle/local-only/performance pass |
| G5 interaction | Pointer, keyboard, focus, screen reader, reduced motion, English/Chinese, zoom, and errors pass |
| G6 visual | Geometry/state assertions, 519/520/521, themes, dense/edge fixtures, screenshot threshold, and human goldens pass |
| G7 package/policy | Two byte-identical builds, hashes, install/upgrade/uninstall, license/provenance, manifest, and policy pass |
| G8 private | Declared scope passes G0-G7; mandatory safety/lifecycle/local/package IDs pass; package says private preview |
| G9 public | Zero exclusions; 114/114 plus every active ID/environment; exact G7 package; five workflows; named final sign-off |

The package allowlist is `manifest.json`, `main.js`, and optional `styles.css`.
GitHub release assets additionally carry `LICENSE` and
`THIRD_PARTY_NOTICES.md`. The exact-package manual workflows cover install and
settings; planning/Overflow/progress; CLOCK switch/Complete/reload; standalone
POMO/warnings; and past/current/future Review across two local dates.

## Implementation task graph

The unique `implement-spec` entry is the GitHub root issue linked here after the
graph is published. Its native sub-issues and `blocked by` edges are canonical;
the table below is the dossier view and must match them. The
[machine-readable graph manifest](planning-github-graph.json) is the checker's
expected graph and is compared read-only with live GitHub metadata. Each live
task's parseable module and primary-ownership sections must exactly match the
[ticket-boundary manifest](parity/ticket-boundaries.json) and the 126-row owner
map; prose cannot claim primary ownership outside that set.

Implementation root issue:
[Implementation spec: ship Spiral Day v1.0.2 parity](https://github.com/oldwinter/obsidian-nautilus-log/issues/16).

| Phase | Task | Blocked by | Owning boundary |
| --- | --- | --- | --- |
| Foundation | [Foundation: bootstrap the Spiral Day plugin and provenance controls](https://github.com/oldwinter/obsidian-nautilus-log/issues/17) | None | Toolchain, manifest, license/notices/provenance baseline; requirement-schema consumer/bootstrap only |
| Scheduler | [Scheduler: implement Grammar v1 semantic parsing and core value types](https://github.com/oldwinter/obsidian-nautilus-log/issues/18) | [Foundation: bootstrap the Spiral Day plugin and provenance controls](https://github.com/oldwinter/obsidian-nautilus-log/issues/17) | `src/core/model`, parser, diagnostics |
| Scheduler | [Scheduler: implement deterministic scheduling, capacity, and day projections](https://github.com/oldwinter/obsidian-nautilus-log/issues/19) | [Scheduler: implement Grammar v1 semantic parsing and core value types](https://github.com/oldwinter/obsidian-nautilus-log/issues/18) | Pure scheduler/capacity/day plus history primitives contributed as evidence to #28; no `UP-HIS` primary ownership |
| Scheduler | [Scheduler: implement Markdown reads, Daily Note resolution, and identity indexing](https://github.com/oldwinter/obsidian-nautilus-log/issues/20) | [Scheduler: implement Grammar v1 semantic parsing and core value types](https://github.com/oldwinter/obsidian-nautilus-log/issues/18) | Workspace grammar/read/index/TextAccess |
| Scheduler | [Scheduler: build the vault runtime read and projection lifecycle](https://github.com/oldwinter/obsidian-nautilus-log/issues/21) | [Scheduler: implement deterministic scheduling, capacity, and day projections](https://github.com/oldwinter/obsidian-nautilus-log/issues/19); [Scheduler: implement Markdown reads, Daily Note resolution, and identity indexing](https://github.com/oldwinter/obsidian-nautilus-log/issues/20) | Runtime snapshots, cache, clock, plugin data, lifecycle |
| Cross-cutting | [Quality: build parity traceability and the exact-SHA evidence harness](https://github.com/oldwinter/obsidian-nautilus-log/issues/22) | [Foundation: bootstrap the Spiral Day plugin and provenance controls](https://github.com/oldwinter/obsidian-nautilus-log/issues/17) | Requirement map/schema/manifest plus all reusable release scripts, fixtures, scanners, schemas, templates, and evidence tooling |
| Planner UI | [Planner UI: build the dockable Spiral-first planner surface](https://github.com/oldwinter/obsidian-nautilus-log/issues/23) | [Scheduler: build the vault runtime read and projection lifecycle](https://github.com/oldwinter/obsidian-nautilus-log/issues/21) | Spiral geometry, responsive/state/diagnostic rendering primitives, and planner styles; evidence contributor to #24's production assembly |
| Planner UI | [Planner UI: complete controls, responsive themes, accessibility, and bilingual UI](https://github.com/oldwinter/obsidian-nautilus-log/issues/24) | [Planner UI: build the dockable Spiral-first planner surface](https://github.com/oldwinter/obsidian-nautilus-log/issues/23); [Quality: build parity traceability and the exact-SHA evidence harness](https://github.com/oldwinter/obsidian-nautilus-log/issues/22) | Production Planner adapter/view assembly and `UP-INS-03`; controls, i18n resolver/shared/planner namespaces, a11y/theme styles |
| Execution Layer | [Execution Layer: implement byte-preserving Markdown commits and write safety](https://github.com/oldwinter/obsidian-nautilus-log/issues/25) | [Scheduler: implement deterministic scheduling, capacity, and day projections](https://github.com/oldwinter/obsidian-nautilus-log/issues/19); [Scheduler: implement Markdown reads, Daily Note resolution, and identity indexing](https://github.com/oldwinter/obsidian-nautilus-log/issues/20); [Quality: build parity traceability and the exact-SHA evidence harness](https://github.com/oldwinter/obsidian-nautilus-log/issues/22) | Workspace commit/mutations/conflicts |
| Execution Layer | [Execution Layer: implement the serialized CLOCK and POMO runtime](https://github.com/oldwinter/obsidian-nautilus-log/issues/26) | [Scheduler: build the vault runtime read and projection lifecycle](https://github.com/oldwinter/obsidian-nautilus-log/issues/21); [Execution Layer: implement byte-preserving Markdown commits and write safety](https://github.com/oldwinter/obsidian-nautilus-log/issues/25) | Runtime commands, mutation queue, execution/recovery/POMO |
| Execution Layer | [Execution Layer: build entry points and the Timing and Plan surfaces](https://github.com/oldwinter/obsidian-nautilus-log/issues/27) | [Planner UI: complete controls, responsive themes, accessibility, and bilingual UI](https://github.com/oldwinter/obsidian-nautilus-log/issues/24); [Execution Layer: implement the serialized CLOCK and POMO runtime](https://github.com/oldwinter/obsidian-nautilus-log/issues/26) | Commands/settings/notices, execution namespace, execution panel/Timing/Plan, singleton `ActiveTaskView` and source navigation |
| Review | [Review: implement the bounded history index and Review projection](https://github.com/oldwinter/obsidian-nautilus-log/issues/28) | [Scheduler: implement deterministic scheduling, capacity, and day projections](https://github.com/oldwinter/obsidian-nautilus-log/issues/19); [Scheduler: implement Markdown reads, Daily Note resolution, and identity indexing](https://github.com/oldwinter/obsidian-nautilus-log/issues/20); [Execution Layer: implement the serialized CLOCK and POMO runtime](https://github.com/oldwinter/obsidian-nautilus-log/issues/26) | Sole primary owner of `UP-HIS-01..05`; history index and Review core projection |
| Review | [Review: build the Review surface and end-to-end Review evidence](https://github.com/oldwinter/obsidian-nautilus-log/issues/29) | [Execution Layer: build entry points and the Timing and Plan surfaces](https://github.com/oldwinter/obsidian-nautilus-log/issues/27); [Review: implement the bounded history index and Review projection](https://github.com/oldwinter/obsidian-nautilus-log/issues/28) | Review UI/styles, review locale namespace, and Review host QA |
| Hardening | [Hardening: qualify compatibility, performance, lifecycle, privacy, and full parity](https://github.com/oldwinter/obsidian-nautilus-log/issues/30) | [Planner UI: complete controls, responsive themes, accessibility, and bilingual UI](https://github.com/oldwinter/obsidian-nautilus-log/issues/24); [Execution Layer: implement the serialized CLOCK and POMO runtime](https://github.com/oldwinter/obsidian-nautilus-log/issues/26); [Review: build the Review surface and end-to-end Review evidence](https://github.com/oldwinter/obsidian-nautilus-log/issues/29); [Quality: build parity traceability and the exact-SHA evidence harness](https://github.com/oldwinter/obsidian-nautilus-log/issues/22) | Last bounded fixes, clean push, G0-G6 evidence, and exact-SHA candidate freeze |
| Release | [Release: produce the deterministic candidate and execute gates G0-G9](https://github.com/oldwinter/obsidian-nautilus-log/issues/31) | [Hardening: qualify compatibility, performance, lifecycle, privacy, and full parity](https://github.com/oldwinter/obsidian-nautilus-log/issues/30); [Quality: build parity traceability and the exact-SHA evidence harness](https://github.com/oldwinter/obsidian-nautilus-log/issues/22) | G7-G9 execution/sign-off on #30's exact SHA; owns no repository files and changes none |

No task may implement outside its owning boundary without first updating its
issue and native dependencies. Scheduler and workspace work can proceed in
parallel after Grammar; evidence tooling can proceed beside all domain work;
Review remains downstream of the Execution runtime, while package work remains
downstream of all required evidence.

## Residual-unknowns audit

| Research uncertainty or contradiction | Resolution | Foundational fog? |
| --- | --- | --- |
| Roam Depot PR `1428` vs `1430` | `UP-INS-01` is reviewed `not-applicable`; Obsidian package/install evidence replaces it | No |
| Roam command-palette failure presentation | Public Obsidian command registration gets typed Notice/status and host integration tests | No |
| Real keyboard/focus/screen-reader behavior | `OBS-A11Y-001`, approved A11Y deviations, prototype renderer proof, and mandatory manual/automated gates | No |
| Marker-free planner rows vs TODO-only execution | Preserve plain visual items; execution requires `[ ]` Flexible Task | No |
| Progress floor vs round disagreement | Accepted grammar chooses shared half-up rounding and requires direct assertions | No |
| Bare reference ownership and recursive resolution | Links/embeds never lend identity or source; local wrapper line alone may be a Plan Item | No |
| Prefix could render but break Primary Plan | Replaced by exact versioned marker pair independent of display/product name | No |
| `0m`, first-invalid range, overnight, cascading Overflow | Exact grammar/scheduler contract and fixtures retain each deterministic result | No |
| Roam setting persistence/sync unknown | Versioned local `data.json`, one save tail, Markdown authority, and local-only contract | No |
| Partial writes, external CLOCKs, malformed records, DST, time jumps, unload races | Complete write/recovery decision with safety index, explicit repair, calendar-day clipping, trusted clock, and no retry | No |
| Daily Note configuration and minimum host version | Plugin-owned resolver; desktop 1.7.7/Electron 32.2.5 floor | No |
| Unsupported topbar/sidebar APIs | Approved HOST adaptation to public entry points plus singleton `ActiveTaskView`; repeated open reveals one leaf, authoritative ID opens/locates source, and stale/missing/unavailable is read-only | No |
| Cross-note history scope and scale | Configured Daily Notes, bounded derived index, fail-closed incomplete totals | No |
| Product name, existing registry collision, attribution | Spiral Day/`spiral-day`, immutable-ID gate, unofficial credits/notices | No |
| Contributor notice completeness and Community duplicate/fork policy | Conservative credits/notices plus mandatory live policy/approval check before public submission | No implementation blocker; public release gate remains intentionally time-sensitive |
| Third-party themes and OS pointer chrome | Functional theme matrix and host-state evidence; not part of upstream pixel baseline | No |

Residual result: **zero foundational unknowns remain before implementation**.
Remaining uncertainty is candidate evidence or time-sensitive public release
qualification, both already owned by explicit tasks and G0-G9. It does not
require reopening behavior, data, architecture, safety, or product decisions.

## Done-when audit for the dossier ticket

- One canonical linked dossier/index: this file.
- All six research commits integrated in order and traceable: evidence ledger.
- All six accepted decisions current and precedence-resolved: decision ledger.
- 114-row versioned parity universe plus 12 Obsidian/release IDs, all with one
  primary owner: parity section, owner map/schema, and ticket-boundary
  manifest/schema; live ticket sections are exact-set audited.
- Semantics, data, architecture, state machines, writes, compatibility,
  performance, visual/interaction, keyboard/accessibility, bilingual UI,
  privacy/offline, license/attribution, risks/rollback, release gates,
  deviations, and residual audit: covered above.
- Prototype source excluded; exact commit, evidence index, Release, and approved
  conclusion cited only: evidence ledger.
- Implementable non-overlapping task graph with native relations: linked root
  issue and tickets, kept open for `implement-spec`.
- Parent Wayfinder map is not edited by this ticket; the resolution handoff
  supplies one-line gists for #2-#7 and #14 to the controller that owns #1.
