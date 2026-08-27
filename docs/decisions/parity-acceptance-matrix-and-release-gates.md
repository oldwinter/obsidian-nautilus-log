# Parity acceptance matrix and release gates

Status: Accepted

Decision ticket: [Decide: parity acceptance matrix and release gates](https://github.com/oldwinter/obsidian-nautilus-log/issues/11)

Functional baseline: upstream Nautilus Log `v1.0.2` at
[`973a041aa2f59f3b05bf31db8187efbfea07017a`](https://github.com/404KSG/roam-nautilus-log/tree/973a041aa2f59f3b05bf31db8187efbfea07017a).

This record defines when an Obsidian build may be called a private package and
when it may be called the first public parity release. It is an acceptance
contract, not an implementation design. It does not authorize production plugin
code or resolve the separate Markdown identity, persistence, platform-version,
performance-budget, or UI-placement decisions.

## Evidence used

All research was read at the exact commit named below. Branch heads were also
verified to resolve to those commits.

| Input | Exact artifact |
| --- | --- |
| Observable behavior inventory | [`docs/research/behavior-inventory.md` at `254976ab0c92611e59b8c9bb88d946d7b155212b`](https://github.com/oldwinter/obsidian-nautilus-log/blob/254976ab0c92611e59b8c9bb88d946d7b155212b/docs/research/behavior-inventory.md) |
| Scheduler and parser semantics | [`docs/research/scheduler-semantics.md` at `d0d1c100f863a3cea43c0a37407670aa1a3997a4`](https://github.com/oldwinter/obsidian-nautilus-log/blob/d0d1c100f863a3cea43c0a37407670aa1a3997a4/docs/research/scheduler-semantics.md) |
| Execution Layer state machines | [`docs/research/execution-layer.md` at `a43ae669a40799468e6473c6e8f8baac36143b1f`](https://github.com/oldwinter/obsidian-nautilus-log/blob/a43ae669a40799468e6473c6e8f8baac36143b1f/docs/research/execution-layer.md) |
| Visual and interaction contract | [`docs/research/visual-interaction.md` at `bce308843b3579f1be0afc5a2367e6b00e6feb9a`](https://github.com/oldwinter/obsidian-nautilus-log/blob/bce308843b3579f1be0afc5a2367e6b00e6feb9a/docs/research/visual-interaction.md) |
| Roam-to-Obsidian capability map | [`docs/research/roam-obsidian-capability-map.md` at `d906db8ea949c36a9255116b5a535bc9d0afa211`](https://github.com/oldwinter/obsidian-nautilus-log/blob/d906db8ea949c36a9255116b5a535bc9d0afa211/docs/research/roam-obsidian-capability-map.md) |

## Assumptions and boundaries

1. Desktop is the supported first-release platform. A narrow desktop leaf is
   still supported; it is not treated as mobile.
2. The functional baseline is frozen. Later upstream `main` behavior is excluded
   unless a separately approved decision changes the baseline.
3. The 114 IDs in the observable behavior inventory are the complete upstream
   requirement universe. A public release may not silently omit any of them.
4. Obsidian-native keyboard, accessibility, theme, and write-safety improvements
   are permitted only when scheduling semantics, state meaning, information
   hierarchy, and the core workflow remain unchanged.
5. Exact Roam host chrome is not a pixel target. Plugin-owned geometry and state
   are targets; Obsidian settings, notices, menus, titlebars, and sidebars are
   accepted by state and workflow evidence.
6. The minimum supported Obsidian version and numerical performance budgets are
   owned by separate decisions. This record uses the tokens `MIN_SUPPORTED` and
   `CURRENT_STABLE`; an unresolved token blocks a public candidate at Gate 0.
7. Initial Obsidian visual goldens do not yet exist. They must be approved from
   fixed-baseline evidence plus the HITL prototype, then frozen before they can
   gate a release.
8. A private-vault package may declare a smaller scope. It is not a parity
   release and may not hide its out-of-scope requirements behind deviations.

## Decision summary

Acceptance is requirement-based, not test-count-based. Every Release Candidate
must link stable requirements to exact-source evidence, named fixtures, tests,
environments, and immutable candidate evidence. All mandatory evidence passes
with zero skipped or quarantined checks. Private packages may be explicitly
scope-limited; the first public package requires a disposition and passing
evidence for all 114 upstream requirements and every active Obsidian requirement.

## Stable identifiers

### Requirement IDs

- `UP-<inventory-id>` names a frozen upstream requirement. For example,
  `UP-SCH-01` refers to `SCH-01` in the exact behavior-inventory artifact. The
  prefix supplies a namespace; it does not rename the source ID.
- `OBS-<area>-NNN` names an Obsidian adaptation or cross-cutting acceptance
  requirement. Areas are `TRACE`, `HOST`, `VIS`, `A11Y`, `SAFE`, `LIFE`,
  `I18N`, and `LOCAL`.
- `REL-NNN` names a packaging or release-process requirement.
- `DEV-NNN` names an intentional deviation. A deviation is not a requirement
  and cannot replace one; it records why the linked requirement is satisfied by
  an approved adaptation.
- `FX-01` through `FX-16` retain the minimum fixture identities defined in the
  behavior inventory. Additional fixtures use `OFX-NNN`.

An ID is never reassigned. Editorial clarification keeps the ID. A change to
observable meaning creates a new ID and marks the old one `retired`, with
`superseded_by` pointing to the new ID. Retired requirements remain in history.

### Evidence IDs

Each evidence run receives an immutable key:

`E-<candidate-sha12>-<environment-id>-<kind>-NNN`

Kinds are `UNIT`, `CONTRACT`, `INTEGRATION`, `VAULT`, `SCREENSHOT`, `KEYBOARD`,
`A11Y`, `LIFECYCLE`, `PACKAGE`, and `MANUAL`. The full 40-character commit SHA,
package SHA-256, tool versions, environment values, start/end timestamps, and
result belong inside the Evidence Record; the 12-character segment is only a
readable key.

### Source requirement universe

The following selectors expand to exactly 114 IDs. Expansion is inclusive and
must be machine-checked against the frozen inventory:

| Selector | Count | Subject |
| --- | ---: | --- |
| `UP-INS-01..05`, `UP-SET-01..13` | 18 | Install, lifecycle, settings |
| `UP-PAR-01..12` | 12 | Input, parsing, classification |
| `UP-SCH-01..07`, `UP-DAY-01..04`, `UP-HIS-01..05` | 16 | Scheduling, day relation, history |
| `UP-VIS-01..07`, `UP-CTL-01..05`, `UP-CMP-01..03` | 15 | Planner visuals, controls, responsive states |
| `UP-EXE-01..13`, `UP-CLK-01..10` | 23 | Execution views and CLOCK state |
| `UP-CMD-01..02`, `UP-PER-01..02` | 4 | Commands and persistence |
| `UP-ERR-01..09`, `UP-ERX-01..08` | 17 | Failures, warnings, exact error outcomes |
| `UP-DRF-01..09` | 9 | Contradictions and later-main exclusions |

Every ID gets one of four dispositions: `exact`, `host-adapted`,
`approved-improvement`, or `not-applicable`. `not-applicable` requires a reason
and reviewer approval; it is expected only for a Roam-only contract such as the
conflicting Depot installation route in `UP-INS-01`. `unknown`, `unmapped`, and
`deferred` are failing public-release states.

## Initial Obsidian requirements

These requirements are fixed by this decision and must exist in the future
machine-readable requirement manifest.

| ID | Requirement |
| --- | --- |
| `OBS-TRACE-001` | All 114 upstream IDs have exactly one current disposition and no dangling source, fixture, test, environment, evidence, or deviation reference. |
| `OBS-HOST-001` | Obsidian-owned chrome may differ visually, but command availability, conditional actions, notice meaning, navigation result, and plugin state match the linked upstream workflow. |
| `OBS-VIS-001` | The planner switches to compact at content widths 520 px and below and to wide above 520 px; 519, 520, and 521 px are explicit gates. |
| `OBS-VIS-002` | Plugin-owned surfaces preserve semantic hierarchy and distinguish every required state in default light and dark themes without overlap, clipping, or inaccessible reliance on color alone. |
| `OBS-A11Y-001` | Pointer actions have keyboard equivalents, focus is visible and deterministic, the Execution dialog/tab pattern is complete, status changes are announced, and reduced motion removes nonessential delay and animation. |
| `OBS-SAFE-001` | Visual planning performs no write. Every vault write follows an explicit user action, revalidates the exact target, preserves unowned Markdown, and fails closed on conflict. |
| `OBS-LIFE-001` | Repeated enable, disable, open, close, reload, and unload leave no duplicate command, view, listener, timer, or post-unload mutation. |
| `OBS-I18N-001` | English and Simplified Chinese have identical stable message-key sets and expose the same actions, states, and geometry. |
| `OBS-LOCAL-001` | The plugin initiates no network request and emits no telemetry in any acceptance fixture. |
| `REL-001` | A Release Candidate is one clean, pushed 40-character Git commit plus deterministic package assets whose SHA-256 values are recorded. |
| `REL-002` | A private package declares its included requirement IDs and may not claim full v1.0.2 parity. |
| `REL-003` | The first public package includes every active requirement, every approved deviation, Community Plugins policy evidence, and final human sign-off on the exact candidate commit. |

## Traceability contract

Implementation must introduce one structured source of truth at
`docs/parity/requirements.json`. Each active requirement row has these fields:

The initial machine-checkable ownership projection and its normative field
schema are published now as
[requirement-owners.json](../parity/requirement-owners.json) and
[requirement-owners.schema.json](../parity/requirement-owners.schema.json).
Ticket #22 owns both schemas and the future full manifest. Ticket #17 only
bootstraps and consumes the generated contract; it does not own either schema.

| Field | Rule |
| --- | --- |
| `id` | One stable requirement ID. Unique across active and retired rows. |
| `owner_ticket` | Exactly one primary implementation ticket. Required on every active row. |
| `owner_module` | Exactly one owning module/file boundary inside that ticket. Required on every active row. |
| `evidence_contributors` | Optional secondary tickets that produce evidence without becoming another implementation owner. |
| `statement` | One observable pass/fail statement, not a feature label. |
| `source_refs` | One or more immutable commit/path/anchor references or accepted decision references. |
| `disposition` | `exact`, `host-adapted`, `approved-improvement`, or `not-applicable`. |
| `fixtures` | One or more fixture IDs, or a reviewed reason that no runtime fixture applies. |
| `tests` | Stable automated or manual test-case IDs. No anonymous checklist item. |
| `environments` | Every environment profile required for this row. |
| `evidence` | Evidence IDs for the current candidate only. Stale-candidate evidence cannot pass. |
| `deviation_id` | Required for `host-adapted` or `approved-improvement`; absent for `exact`. |
| `status` | `active` or `retired`, with `superseded_by` when retired. |

The candidate Evidence Index is generated for the exact commit and stored with
the release evidence bundle. It contains the reverse links from every Evidence
Record back to requirements and tests. The bundle is immutable, has a SHA-256
manifest, and is attached to a durable GitHub release or release-tracking issue.
The release sign-off comment links the bundle and records its hash.

Traceability passes only when all of these are true:

- 114 of 114 upstream IDs are present exactly once.
- 100% of active Obsidian and release IDs are present exactly once.
- Zero IDs required by the candidate scope have missing or failing evidence.
- A private scope manifest lists every excluded active ID; the mandatory
  `OBS-SAFE`, `OBS-LIFE`, `OBS-LOCAL`, `REL-001`, and `REL-002` requirements
  cannot be excluded.
- A public scope manifest excludes zero active IDs.
- Zero references are dangling, duplicated under different meanings, or tied to
  another candidate SHA.
- Zero `not-applicable` or deviation dispositions lack the required approval.
- Zero tests are skipped, quarantined, marked expected-failure, or passed only by
  retry. Gate runs use zero automatic retries.

## Evidence matrix

| Requirement family | Minimum fixtures | Mandatory evidence | Release gates |
| --- | --- | --- | --- |
| Install, settings, lifecycle (`UP-INS`, `UP-SET`, `OBS-LIFE`) | `FX-01`, `FX-02` | Unit, host integration, lifecycle, package, manual | G1, G4, G7, G8 |
| Parser and scheduler (`UP-PAR`, `UP-SCH`, `UP-DAY`) | `FX-03` to `FX-06` | Unit and pure contract for every grammar branch, boundary, ordering rule, warning, and exact output | G1, G2 |
| History (`UP-HIS`) | `FX-08` | Unit, vault fixture, integration across day/time-zone boundaries | G2, G3 |
| Planner visuals and controls (`UP-VIS`, `UP-CTL`, `UP-CMP`, `OBS-VIS`) | `FX-07`, `FX-09` | State assertions, interaction, screenshot, light/dark, width boundary, reduced motion, manual | G4, G5, G6 |
| Primary and Execution views (`UP-EXE`) | `FX-10`, `FX-13`, `FX-14` | Contract, host integration, keyboard, screenshot, lifecycle | G2, G4, G5, G6 |
| CLOCK and persistence (`UP-CLK`, `UP-PER`, `OBS-SAFE`) | `FX-11`, `FX-12`, `FX-13` | Unit, serialized-race contract, before/after vault diff, conflict/failure injection, reload/unload | G2, G3, G4 |
| Commands, menus, navigation (`UP-CMD`, `OBS-HOST`) | `FX-15` | Host integration, keyboard, manual state/result evidence; host chrome excluded from pixel comparison | G4, G5 |
| Errors and warnings (`UP-ERR`, `UP-ERX`) | `FX-16` | Failure injection, no-write assertions, localized state/copy, notice/status accessibility | G2, G3, G4, G5 |
| Drift ledger (`UP-DRF`) | Linked fixture for the affected requirement | Negative tests proving excluded later-main behavior plus the approved disposition | G0, G2, G8 |
| Localization (`OBS-I18N`) | All UI fixtures | Key-set equality, both locales on canonical visuals, text-fit checks on every host OS | G1, G5, G6 |
| Local-only operation (`OBS-LOCAL`) | `FX-01` to `FX-16` | Network instrumentation showing zero plugin-initiated requests and zero telemetry payloads | G4, G7 |

## Objective pass/fail thresholds

| Evidence area | Passing threshold |
| --- | --- |
| Build and static checks | Zero compiler, type, lint, manifest, or bundling errors. Warnings require an explicit allowlist entry with owner and rationale; the public allowlist is empty unless approved through the deviation process. |
| Unit and contract tests | 100% pass, zero skipped/quarantined/retried tests. Every documented parser branch, scheduler boundary, state-machine transition, precedence rule, contradiction, and excluded-main behavior has at least one direct assertion. Code-coverage percentage alone is not acceptance evidence. |
| Vault fixtures and mutations | 100% of declared before/after file diffs match the exact allowlist. Conflict, stale-target, malformed-data, read failure, write failure, and non-action paths produce zero changed bytes. Zero file outside the fixture allowlist changes. |
| Lifecycle | Ten consecutive enable/disable plus view open/close cycles, one reload with an active CLOCK, and one unload during a queued action. After queues settle: zero duplicate registrations, zero live owned timers/listeners/observers, zero detached owned DOM nodes, and zero post-unload writes. |
| Interaction | Every named pointer action has the specified result; every required keyboard path has the same result. Zero keyboard traps, unreachable controls, unexpected focus loss, uncaught exceptions, or plugin console errors. |
| Responsive geometry | At 519 and 520 CSS px the compact contract passes; at 521 CSS px the wide contract passes. At 320 and 360 px all controls and text remain reachable. Bounding-box assertions allow at most 1 CSS px rounding variance and zero unintended overlap or clipping. |
| Screenshot regression | Canonical, plugin-owned crops use a pinned browser, fonts, DPR 1, 100% zoom, fake clock, and approved goldens. Dimensions must match. At most 0.2% of pixels may exceed a per-channel delta of 16. Any changed semantic state, missing control, text clipping, or overlap fails even below the numerical threshold. Host-owned chrome is cropped out. |
| Theme and contrast | Default light and dark pass on every host OS. Normal text contrast is at least 4.5:1; large text and non-text controls/state boundaries are at least 3:1. A high-contrast theme and a heavily customized community theme have zero unreadable, invisible, or state-collapsing plugin elements. |
| Accessibility | Zero automated critical or serious violations in plugin-owned surfaces; 100% of the manual keyboard and screen-reader script passes; every status/notice has an accessible name or announcement; all nonessential animation and delay are disabled under reduced motion. |
| Localization | English and Simplified Chinese key sets are exactly equal; zero missing/fallback/raw keys. All canonical states render in both locales with zero clipped or hidden actions at 100% and 200% zoom. |
| Local-only behavior | Zero plugin-initiated network requests in all fixtures, including first load, settings, failure paths, and package update checks. Zero telemetry collection or persistence. |
| Package | Two clean builds from the same candidate produce byte-identical release assets and matching SHA-256 values. Manifest, tag, package, and documented version agree. The asset allowlist is `main.js`, `manifest.json`, and optional `styles.css`; root README and LICENSE satisfy Community Plugins review. |
| Defects | Any failed mandatory requirement fails the gate regardless of severity. Both private and public candidates have zero known data-loss, data-corruption, security, or privacy defects. The public candidate has zero unresolved defects against an active requirement. |

Screenshot thresholds detect regression against an approved Obsidian rendering;
they do not manufacture a baseline. The initial golden set requires human parity
approval. Dynamic time, caret, and OS window chrome must be controlled by the
fixture, not broadly masked. A mask is allowed only for an irreducible host-owned
region documented in the Evidence Record.

## Environment profiles

Every Evidence Record expands symbolic versions to exact values. `latest` alone
is not an acceptable recorded value.

| ID | Required environment |
| --- | --- |
| `ENV-PURE` | Pinned repository toolchain and lockfile on the CI Linux image, fake clock, locales `en` and `zh-CN`, and time zones `UTC`, `Asia/Shanghai`, and `America/New_York`, including both DST transition boundaries. |
| `ENV-VIS` | Pinned Playwright Chromium on Ubuntu 24.04 LTS, DPR 1, 100% zoom, 1440 x 1000 viewport, controlled fonts and fake clock. Plugin content widths: 900, 521, 520, 519, 360, and 320 CSS px. Default light/dark and reduced-motion variants. |
| `ENV-HOST-PRIVATE` | The exact Obsidian, Electron, Chromium, OS, locale, and theme versions of the intended private-vault installation. Runs the full in-scope host, safety, lifecycle, and package smoke suite. |
| `ENV-HOST-MIN` | `MIN_SUPPORTED` Obsidian on one supported desktop OS, with the exact app, Electron, Chromium, and OS versions recorded. Runs the full host integration and vault-safety suite. |
| `ENV-HOST-MAC` | `CURRENT_STABLE` Obsidian on the current supported macOS major version, default light/dark, English/Chinese, 80%, 100%, and 200% zoom. |
| `ENV-HOST-WIN` | `CURRENT_STABLE` Obsidian on Windows 11, default light/dark, English/Chinese, 80%, 100%, and 200% zoom. |
| `ENV-HOST-LINUX` | `CURRENT_STABLE` Obsidian on Ubuntu 24.04 LTS, default light/dark, English/Chinese, 80%, 100%, and 200% zoom. |
| `ENV-THEME` | Canonical current-stable host plus one high-contrast theme and one heavily customized community theme, with theme names, versions, and checksums recorded. |
| `ENV-A11Y` | Current macOS with VoiceOver for the manual screen-reader script, plus automated accessibility checks in `ENV-VIS`. Reduced motion and 200% zoom are mandatory. |

Private acceptance requires `ENV-PURE`, applicable `ENV-VIS` evidence, and
`ENV-HOST-PRIVATE`. Public acceptance adds every remaining profile.
`MIN_SUPPORTED` runs on one OS because its purpose is API-floor verification.
`CURRENT_STABLE` runs on all three OS families because font metrics, window
chrome, menus, and filesystem behavior differ. Pixel comparison is only within
`ENV-VIS`; host profiles use state, geometry, contrast, and manual evidence so
cross-platform font rasterization cannot create false passes or failures.

## Visual acceptance rules

1. Fixed-SHA markup, CSS, tests, and the baseline image define the source. The
   mutable README image and supplementary `main` image cannot override it.
2. Goldens are organized by fixture, state, locale, theme, width, and golden
   revision. Replacing a golden requires a reviewed reason and before/after image.
3. Plugin-owned planner and Execution surfaces are cropped to stable bounds.
   Obsidian settings, command palette, context menu, notice, titlebar, and
   sidebar chrome are tested by state and workflow, not Roam pixel equality.
4. Semantic geometry is asserted separately from pixels: timeline positions,
   label order, breakpoint branch, control presence, disclosure state, focus
   order, and accessible names must be exact.
5. Required capture sets include light/dark wide planner; widths 521/520/519/360/
   320; temporal and playback states; tooltip edges; dense labels; every topbar
   state; Timing/Plan/Review empty, working, error, confirmation, and long-list
   states; both locales; and reduced motion.
6. Obsidian/Lucide icons, inherited host fonts, improved focus treatment, and
   contrast-corrected theme tokens are accepted only through linked deviations.
   Their meaning, hit-area stability, state, and information hierarchy remain
   requirements.

## Intentional deviation process

### Allowed classes

| Class | Allowed scope |
| --- | --- |
| `HOST` | Replace an unsupported Roam host insertion, menu, settings, notice, navigation, or sidebar mechanism with a public Obsidian equivalent while preserving the workflow result. |
| `A11Y` | Add correct keyboard activation, tab/dialog behavior, focus visibility/restoration, screen-reader semantics, or reduced-motion behavior. |
| `THEME` | Map colors, fonts, and icons to Obsidian variables/assets to maintain contrast and semantic roles across themes. |
| `SAFETY` | Fail closed, require explicit action, revalidate a Markdown target, or avoid an automatic write when the upstream behavior is unsafe in mutable Markdown. |

A deviation may not approve a changed parser or scheduler result, a changed
state-machine meaning, a missing v1.0.2 feature, a hidden error, a new network
dependency, or a core-workflow omission. Those require a new Wayfinder decision
that explicitly changes the baseline.

### Required ledger entry

Each `DEV-NNN` is a durable Markdown record under `docs/deviations/` containing:

- status (`proposed`, `approved`, `rejected`, or `superseded`), owner, and dates;
- class and linked requirement IDs;
- exact upstream observation and immutable evidence;
- Obsidian behavior, user-visible impact, and why exact reproduction is
  unsupported or worse;
- alternatives considered and the narrowest chosen adaptation;
- automated and manual acceptance tests, environments, screenshots where
  visual, and rollback/revisit conditions;
- parity reviewer approval and product/release-owner approval.

Until both approvals exist, the linked requirement fails. Approved deviations
still require passing evidence on every candidate. Expected failures, snapshot
updates without review, comments in tests, and private scope exclusions are not
deviation records.

## Release gate order

Gates run in this order so an expensive or subjective gate never hides a cheap,
deterministic failure. A material code, test, requirement, golden, dependency,
build, or package change invalidates all later gates and requires them to rerun
on the new exact commit.

All reusable release scripts, fixtures, scanners, schemas, and templates are
candidate inputs owned and delivered by ticket #22 before hardening. After the
last material change, ticket #30 pushes one clean commit, runs G0-G6 against
that remote SHA, records its deterministic package identity, and freezes it as
the sole candidate. Ticket #31 runs and signs G7-G9 on that identical SHA. It
owns no repository file and must not commit or modify source, tests, build,
package, or release-input files. Any required change returns to its owning
ticket and invalidates the freeze; #30 must then rerun G0-G6 on the replacement
SHA before #31 restarts.

| Gate | Decision | Required result |
| --- | --- | --- |
| G0 - Candidate and baseline lock | Is the thing being judged immutable and fully mapped? | Clean pushed commit; exact upstream baseline; 114/114 upstream IDs and all active Obsidian IDs present; candidate scope frozen; every in-scope deviation approved. Public scope also requires resolved `MIN_SUPPORTED`, `CURRENT_STABLE`, and performance requirements. |
| G1 - Build and static integrity | Can the candidate be built and checked deterministically? | Static checks, manifest validation, key-set equality, and clean build all pass with zero skipped checks. |
| G2 - Semantic parity | Do pure behavior and state transitions match? | Parser, scheduler, capacity, day, history, Execution, CLOCK/POMO precedence, errors, contradictions, and negative drift tests all pass. |
| G3 - Data and mutation safety | Can explicit writes preserve user Markdown under failure and concurrency? | Vault fixtures, exact diff allowlists, stale/conflict/malformed/failure injection, serialization, recovery, and no-write paths all pass. |
| G4 - Obsidian host integration | Does the plugin work in the supported host matrix? | Commands, menus, ItemView, notices, navigation, settings, reload, time zones, local-only instrumentation, and lifecycle pass on minimum/current profiles. Imported performance thresholds pass here. |
| G5 - Interaction, accessibility, and localization | Can every supported user complete every workflow? | Pointer/keyboard parity, focus, screen reader, reduced motion, English/Chinese, zoom, and error-announcement scripts pass. |
| G6 - Visual parity | Does the plugin-owned UI preserve the approved contract? | State/geometry assertions, screenshot threshold, light/dark, exact width boundaries, dense/edge cases, and theme resilience all pass; parity reviewer signs the initial or changed goldens. |
| G7 - Package and policy | Is the installable artifact the reviewed artifact? | Two byte-identical clean builds, asset hashes, install/upgrade/uninstall smoke, licenses/attribution, root metadata, and Community Plugins policy checklist pass. |
| G8 - Private-vault acceptance | Is a declared-scope package safe and useful for private use? | All requirements in its scope pass G0-G7; all `OBS-SAFE`, `OBS-LIFE`, `OBS-LOCAL`, `REL-001`, and `REL-002` requirements pass regardless of scope; open requirements are listed as out of scope. |
| G9 - Public parity sign-off | May this exact package be called the first public v1.0.2 parity release? | G8 was completed with the public scope; five representative manual workflows over at least two local calendar dates pass; all 114 upstream and all active Obsidian requirements pass; no unresolved requirement defects; final sign-off is complete. |

The five public manual workflows are: first install/settings; ordinary planning
through overflow and progress; CLOCK switch/complete/reload; standalone POMO and
warning thresholds; and past/current/future Review across a Daily Note rollover.
They use the exact G7 package, not a development build.

## Private versus public acceptance

### Private-vault package

- Carries an explicit scope manifest listing included requirement IDs.
- May omit unfinished requirement families only by listing them as out of scope.
- Passes every safety, lifecycle, local-only, and package requirement even when
  the associated feature family is otherwise out of scope.
- Has zero known data-loss, corruption, security, or privacy defect.
- Passes `ENV-PURE`, applicable `ENV-VIS` evidence, and
  `ENV-HOST-PRIVATE`; other public host profiles may remain out of scope.
- Is labelled `private preview` or `private milestone`, never `parity`, `complete`,
  or a Community Plugins candidate.
- Records the exact commit, package hash, environment, open requirements, and
  approved deviations in its sign-off.

### First public Community Plugins release

- Has no scope exclusion for an active requirement.
- Passes every environment profile in this record.
- Has a reviewed disposition for all 114 upstream IDs and passing evidence for
  all active Obsidian and release requirements.
- Preserves every known v1.0.2 behavior unless a permitted, approved deviation
  says exactly how and why it differs.
- Includes no unapproved golden change, expected failure, skipped test, retry-only
  pass, unresolved contradiction, or stale-candidate evidence.
- Uses the exact G7 package and a non-draft release/tag whose commit and remote
  head match the signed candidate.

## Sign-off

Automated status is necessary but cannot approve visuals, deviations, or a
release. A person may fill more than one human role in this repository, but each
attestation remains separate and named; authorship cannot substitute for missing
evidence.

| Role | Attestation |
| --- | --- |
| Candidate owner | The requirement manifest, implementation, fixtures, tests, and package all come from the stated clean commit; known failures and scope exclusions are disclosed. |
| CI/evidence controller | G0-G7 results belong to the exact commit and package hash; the evidence bundle is complete, internally linked, and hash-verified. |
| Data-safety reviewer | Vault diffs, conflict/failure paths, lifecycle, and backup/rollback instructions satisfy `OBS-SAFE-001` and `OBS-LIFE-001`. |
| Parity reviewer | Functional dispositions, keyboard/accessibility behavior, visual goldens/diffs, locales, themes, and all `DEV-NNN` records preserve the approved parity boundary. |
| Release owner | Private scope is accurately labelled, or public scope is complete; policy evidence and manual workflows pass; the exact candidate is approved Go. |

The final sign-off is one durable GitHub release-tracking comment containing:

- release type and version;
- full candidate commit SHA and remote-head confirmation;
- package filename and SHA-256;
- requirement-manifest revision and `114/114` public count;
- G0-G9 result links, exact Evidence Index link, and bundle SHA-256;
- approved deviation IDs and private scope exclusions, if any;
- named attestations with timestamps; and
- final `GO` or `NO-GO`.

Any missing field is `NO-GO`. A later commit, rebuilt package, changed golden,
new requirement, changed deviation, or changed dependency invalidates the prior
sign-off.

## Consequences

- Test quantity cannot conceal an unmapped behavior: public acceptance is
  114/114 plus all active port requirements.
- Private dogfood can start before full parity without weakening or obscuring the
  public standard.
- Visual comparison is strict where the plugin owns pixels and semantic where
  Obsidian owns chrome.
- Native accessibility, theme, and safety improvements are reviewable rather
  than silently mixed into parity claims.
- Release evidence is reproducible, exact-commit-bound, and invalidated by any
  material change.
