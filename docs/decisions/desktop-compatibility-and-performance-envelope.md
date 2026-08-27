# Desktop compatibility and performance envelope

Status: Accepted on 2026-08-28

Decision ticket: [Decide: desktop compatibility and performance envelope](https://github.com/oldwinter/obsidian-nautilus-log/issues/12)

## Decision

The first release supports Obsidian Desktop 1.7.7 or later on official Windows,
macOS, and Linux desktop packages. Its qualified runtime floor is Electron
32.2.5, the installer runtime shipped with public Obsidian 1.7.7. The plugin
must use only public Obsidian and browser APIs: it must not import Electron or
Node APIs, inspect private host DOM, or vary behavior by Electron version.

The supported data envelope is a bounded planning input, not a promise to scan
an arbitrarily large vault synchronously. At the boundary fixture, the plugin
must handle a 20,000-Markdown-file / 2 GiB Markdown vault, 3,650 Daily Notes,
25,000 CLOCK records, a 2 MiB active Daily Note with a 1 MiB eligible region,
1,000 Plan Items, and a 16 KiB individual Plan Item. It must meet the numerical
budgets below, keep foreground work incremental and cancellable, and fail closed
instead of showing a partial schedule or writing through a stale projection.

These numbers are acceptance budgets for the future implementation, not
measurements of production code. This Wayfinder phase does not implement the
plugin.

## Inputs and verified platform facts

The decision uses the two ticket inputs at their immutable commits:

- [v1.0.2 observable behavior inventory at `254976a`](https://github.com/oldwinter/obsidian-nautilus-log/blob/254976ab0c92611e59b8c9bb88d946d7b155212b/docs/research/behavior-inventory.md), including its 16-fixture behavioral corpus.
- [Roam-to-Obsidian capability map at `d906db8`](https://github.com/oldwinter/obsidian-nautilus-log/blob/d906db8ea949c36a9255116b5a535bc9d0afa211/docs/research/roam-obsidian-capability-map.md).

Current Obsidian facts were rechecked on 2026-08-28 against official primary
sources:

- The current public desktop release is
  [Obsidian 1.13.7](https://obsidian.md/changelog/2026-08-12-desktop-v1.13.7/).
- The current installer line uses Electron 43.3.0, introduced in
  [Obsidian 1.13.6](https://obsidian.md/changelog/2026-08-10-desktop-v1.13.6/).
- Public [Obsidian 1.7.7](https://obsidian.md/changelog/2024-11-18-desktop-v1.7.7/)
  shipped installer Electron 32.2.5.
- The current official API package is `obsidian` 1.13.2 at
  [`cc1744324150c632416857c98964f87b1574a5fc`](https://github.com/obsidianmd/obsidian-api/tree/cc1744324150c632416857c98964f87b1574a5fc).
  Its public typings mark `Vault.process` and `ItemView.addAction` as available
  since 1.1.0, and `Workspace.ensureSideLeaf`, awaited `revealLeaf`, and
  `Plugin.onUserEnable` as available since 1.7.2. The new declarative settings
  API is 1.13.0-only.
- The official [download page](https://obsidian.md/download) supplies Windows
  Universal, Mac Universal, Linux AppImage/Snap/Deb, and Linux ARM64 AppImage
  packages; Flatpak is explicitly community-maintained.
- Official [Daily Notes help](https://github.com/obsidianmd/obsidian-help/blob/a3985b585904ddb9f109bd80849b378085308c15/en/Plugins/Daily%20notes.md)
  confirms root `YYYY-MM-DD` as the default and configurable folder and Moment
  date formats, including formats that create subfolders. The current public
  API typings expose no Daily Notes configuration contract.

## Assumptions

1. The implementation needs the 1.7.2-era side-leaf and lifecycle APIs. We set
   the floor to 1.7.7 because it is a public release with a documented installer
   runtime, rather than an early-access build.
2. Settings use the imperative `PluginSettingTab.display()` pattern. The 1.13
   declarative API is optional enhancement work and cannot raise the first
   release floor.
3. Performance measurements use a local vault on a local SSD with Sync idle,
   no other community plugins enabled, the production bundle, and DevTools
   closed. Network drives, on-demand cloud files, antivirus pauses, and active
   sync transfer time are reported separately and do not redefine plugin CPU
   budgets.
4. Attachments do not enter the Markdown index and do not count toward the 2 GiB
   Markdown limit. Host-level vault opening time is outside the plugin budget.
5. The Markdown grammar, eligible-region rule, identity policy, LOGBOOK shape,
   and cross-note history scope are decided by their own tickets. The fixtures
   below treat their outputs as resolved Plan Items and CLOCK records so this
   ticket does not pre-empt those decisions.
6. The canonical clock is an injected wall-clock value in tests. Timers record
   absolute start instants; elapsed time is never derived by counting ticks.
7. Budgets apply on a reference machine with at least four physical CPU cores,
   8 GiB RAM, and a local SSD. Every result artifact records exact CPU, memory,
   OS, architecture, package, Obsidian, Electron, theme, and plugin commit.

## Compatibility matrix

### App and runtime

| Contract | Required lane | Release treatment |
| --- | --- | --- |
| Obsidian app floor | Desktop 1.7.7 | `manifest.json.minAppVersion` is `1.7.7`; lower app versions are unsupported. |
| Installer/runtime floor | Electron 32.2.5 | Qualify on an official 1.7.7 installer. Older Electron runtimes are unsupported even if an in-app update produced a newer app version. |
| Current lane | Latest public desktop release; 1.13.7 / Electron 43.3.0 when this decision was recorded | Must pass before every release; update the lane as public Obsidian and its installer advance. |
| API surface | Public Obsidian/browser APIs only | Direct Node/Electron imports, private DOM selectors, or undocumented globals are release blockers. |
| Settings API | Imperative settings compatible with 1.7.7 | Declarative 1.13 settings may be added only behind a compatible path and cannot be required. |
| Mobile | Not loaded | `isDesktopOnly: true`; mobile parity remains outside the first release. |

Obsidian can update the app independently of its installer. Compatibility
reports must therefore record both versions from the external test harness and
installer metadata; production logic must not probe or branch on Electron.
Release documentation tells users below the runtime floor to install a current
official installer.

### Operating systems and packages

The supported OS families are Windows, macOS, and Linux on versions that can run
an official Obsidian installer satisfying both floors. The plugin has no
OS-specific product behavior.

Release-blocking smoke coverage is:

- Windows using the official Universal package;
- macOS Universal on Apple Silicon and Intel;
- Linux x64 using an official AppImage or Deb package; and
- Linux ARM64 using the official ARM64 AppImage.

Snap must remain functionally compatible, but a packaging-only Snap failure may
be waived with a linked upstream Obsidian/package issue after the same plugin
build passes the Linux canonical AppImage lane. Community Flatpak, distro
repackages, Wine, WSL GUI, and modified Electron shells are best-effort and are
not release gates.

### Themes, layout, and accessibility environment

- Obsidian Default theme in both light and dark mode is release-blocking at the
  app floor and current lane.
- The plugin must consume public Obsidian CSS variables, scope all CSS beneath
  its view, and remain operable under custom themes. Pixel parity is not
  promised for a custom theme, but unreadable text, lost focus indicators,
  clipped commands, overlap, or missing controls is a compatibility bug.
- A theme-stress fixture changes base font size to 12, 16, and 24 px, zoom to
  100%, 125%, and 200%, accent/background contrast, reduced motion, and narrow
  pane widths 360, 520, and 521 px. Default light/dark screenshots and all
  interaction assertions are release gates; the variable stress run is a
  functional gate, not a pixel-diff gate.
- System font substitution and font loading must not invalidate cached text
  measurements. A font, theme, zoom, or pane-size change invalidates geometry
  and triggers a fresh layout.

### Daily Notes conventions

Nautilus owns two settings: Daily Note folder and Moment date format. Defaults
are vault root and `YYYY-MM-DD`, matching Obsidian's documented defaults. The
core Daily Notes plugin does not need to be enabled, and Nautilus never reads
its private settings.

Supported conventions include a configured folder and a date format that emits
nested folders. Resolution constructs one normalized vault-relative `.md` path
for a logical local date. The format must round-trip that date and must not map
two supported dates to the same file. Filename-only global search and silent
fallback to root `YYYY-MM-DD.md` are forbidden.

If configuration is invalid, the file is missing when creation was not
explicitly requested, or resolution is ambiguous, the planner shows a
noninteractive configuration state. Execution actions and every Markdown write
remain disabled. A timezone, locale, folder, or date-format change invalidates
all Daily Note and day-relation caches.

## Scale fixtures

All fixtures include the 16 behavioral cases from the inventory. Scale data
must mix unfinished and completed items, fixed events, overflow, long labels,
nested lists, malformed records, cross-midnight CLOCK records, and repeated
external edits; repeated identical rows alone are not representative.

| Dimension | Small functional | Reference | Supported boundary | Over-limit probe |
| --- | ---: | ---: | ---: | ---: |
| Markdown files in vault | 100 | 5,000 | 20,000 | 20,001 |
| Total Markdown bytes | 10 MiB | 500 MiB | 2 GiB | 2 GiB + 1 byte |
| Resolved Daily Notes | 30 | 730 | 3,650 | 3,651 |
| Total recognized CLOCK records | 100 | 5,000 | 25,000 | 25,001 |
| Active Daily Note bytes | 64 KiB | 256 KiB | 2 MiB | 2 MiB + 1 byte |
| Eligible-region bytes | 32 KiB | 192 KiB | 1 MiB | 1 MiB + 1 byte |
| Plan Items in eligible region | 25 | 250 | 1,000 | 1,001 |
| Largest Plan Item source span | 1 KiB | 2 KiB | 16 KiB | 16 KiB + 1 byte |
| Maximum supported list depth | 4 | 8 | 16 | 17 |
| Open Nautilus ItemViews | 1 | 2 | 4 | 5 |

Vault size limits apply only to features that enumerate or index across Daily
Notes. A vault beyond the boundary may still use today's planner when its
resolved note and eligible region are within the local limits; cross-note
totals cannot silently become partial.

## Measurement protocol

1. Build the production release bundle at the exact candidate commit. Seed each
   fixture deterministically and record its content hash.
2. Run the floor and current Obsidian/Electron lanes. Run absolute performance
   budgets on the recorded reference machine; run functional and regression
   ratios on every supported OS lane.
3. Disable Sync and other community plugins, close DevTools, use Default light
   theme, connect AC power, and wait for Obsidian MetadataCache readiness before
   starting plugin marks. Record host vault-open time separately.
4. Instrument plugin boundaries with `performance.mark()` and
   `performance.measure()`. A view is interactive only after its committed DOM
   has completed two animation frames, focusable controls respond, and its
   projection revision equals the latest source/settings revision.
5. Cold-open runs close the ItemView and reload Obsidian between samples: 5
   warm-up runs followed by 30 measured runs. Incremental, scheduling, tick, and
   write runs use 10 warm-ups followed by 100 measured runs. Report p50, p95,
   maximum, and raw samples.
6. Incremental tests replace one source line near the start, middle, and end;
   insert/delete/reorder 10 contiguous items; change one setting; rename a Daily
   Note; and apply an external-file edit during a pending refresh. They assert
   the final revision, not only elapsed time.
7. Write latency starts at an accepted explicit action and ends only after the
   Editor transaction or `Vault.process()` completes, the written source is
   reparsed and confirmed, and the authoritative view revision is interactive.
   Each write sample starts from a clean fixture clone.
8. Observe main-thread tasks with `PerformanceObserver`. Measure retained JS
   heap through the Electron DevTools protocol after an explicit collection at
   baseline and after 100 open/close plus 100 refresh cycles. Compare against a
   plugin-disabled vault on the same process/runtime.
9. The candidate must not regress any p95 by more than 20% from the last accepted
   exact-commit baseline even when it remains under the absolute ceiling. A
   material fixture, toolchain, or hardware change establishes a new baseline
   in a separately reviewed evidence artifact; it never rewrites old results.

## Numerical budgets

All time values are wall-clock milliseconds. A p95 budget is evaluated over the
sample counts above. A hard-cap breach is reproducible when it recurs in at
least one of two clean reruns after the original run; a single unexplained host
outlier does not qualify.

| Operation | Reference p95 | Boundary p95 | Hard cap / invariant |
| --- | ---: | ---: | --- |
| Plugin activation with no ItemView open | 50 ms | 75 ms | 150 ms; no Daily Note read or view opened automatically |
| Cold ItemView open to interactive first projection | 400 ms | 1,000 ms | 1,500 ms |
| Parse and project one active Daily Note | 25 ms | 150 ms | 250 ms |
| Pure deterministic scheduling after projection | 10 ms | 50 ms | 100 ms and identical output hash |
| DOM commit through painted interactive view | 100 ms | 250 ms | 500 ms; no individual plugin task over 100 ms |
| One-line incremental edit to fresh interactive projection, including debounce | 300 ms | 600 ms | 1,000 ms and latest revision wins |
| Explicit write to confirmed fresh projection | 300 ms | 750 ms | 1,500 ms; no duplicate/partial write |
| Optional first cross-note history index | 1,500 ms | 5,000 ms | 10 s; never blocks today's planner and yields every 50 ms or less |
| Visible CLOCK/POMO display tick CPU time | 4 ms | 8 ms | 16 ms; zero vault reads/writes per tick |
| Additional retained JS heap after stable use | 32 MiB | 64 MiB | 96 MiB and no unbounded growth |

Additional invariants:

- No plugin-caused main-thread task may exceed 50 ms in the reference fixture or
  100 ms at the supported boundary.
- Retained heap growth after the 100-cycle leak sequence must be at most 2 MiB
  over the post-warm-up baseline.
- An invisible planner with no visible timing indicator must average under 0.5%
  plugin-attributed CPU over five minutes, issue no polling vault reads, and
  stop its per-second rendering tick within two seconds.
- Cache memory is included in the heap budget. Memory pressure or an explicit
  cache clear may discard every derived value without changing Markdown or
  plugin settings.

## Refresh, cancellation, and cache rules

1. Active Editor changes use a 150 ms trailing debounce with a 500 ms maximum
   wait. Vault/MetadataCache bursts use a 250 ms trailing debounce. Explicit
   actions, Daily Note switches, settings changes, and visibility restoration
   bypass the debounce.
2. Each read snapshot receives a monotonically increasing revision containing
   the normalized path, source fingerprint, relevant settings version, logical
   date/time bucket, and projection-grammar version. Parse, schedule, history,
   and render work carries that revision.
3. A newer revision cancels queued work. Synchronous work that cannot be
   interrupted may finish but its result must be discarded before commit. At
   most one commit per ItemView can be in flight; last input wins.
4. A source or settings invalidation immediately makes the visible projection
   nonauthoritative and disables all mutation controls. The stale schedule is
   removed rather than left interactive. A new revision must be complete before
   controls re-enable.
5. Cache entries are derived only. They are keyed by source fingerprint and all
   semantic settings, bounded by the heap budget, and invalidated on modify,
   rename, delete, metadata change, external settings change, locale/timezone
   change, logical-day rollover, font/theme/zoom change (geometry only), and
   plugin unload.
6. MetadataCache lag must not overwrite a newer active-Editor snapshot. The
   Editor is authoritative for unsaved active text; the later metadata event is
   a reconciliation signal and must compare revisions.
7. Write commands never trust the projection cache. They re-read/revalidate the
   target inside the Editor transaction or `Vault.process()` transform, then
   reparse and confirm the result.

## Background and hidden-view behavior

A planner is backgrounded when its leaf is deferred, detached, or not visible,
or when its owning window/document is hidden. On backgrounding it cancels
playback, animation frames, layout measurement, and per-view time ticks. Vault,
metadata, editor, settings, and day-rollover events set a dirty flag without
building a hidden DOM projection.

CLOCK and POMO state persists absolute start instants, so suspending ticks loses
no time. A separately visible status indicator may share one plugin-global
one-second display tick; it may not read the vault on that tick. Before a hidden
view becomes visible or accepts a command, it performs an immediate
authoritative refresh. Until that refresh commits, no old schedule or write
control is interactive.

## Degradation behavior

- If the active note, eligible region, Plan Item count, item span, or nesting
  depth exceeds its boundary, the planner fails closed for that Daily Note. It
  shows the actual value and supported limit, renders no partial schedule, and
  disables Execution and write actions. It never samples, truncates, or treats
  omitted Plan Items as free time.
- If vault-wide Daily Note or CLOCK indexing exceeds its boundary, today's
  within-limit planner remains available. Cross-note Review/history becomes
  explicitly unavailable until scope is narrowed; incomplete totals are never
  labelled complete.
- If four Nautilus ItemViews already exist, an attempt to open a fifth reveals
  an existing planner leaf instead of allocating another projection and cache.
- If a refresh breaches its hard cap, replace the projection with a recoverable
  performance state and offer retry. Do not keep a stale projection
  interactive. Diagnostics contain counts and durations only, never note text.
- If a write remains pending past 1,000 ms, keep the action disabled and show a
  pending Notice. Do not retry automatically. Resolve only from the returned
  operation and authoritative re-read; ambiguous completion fails closed.
- Invalid Daily Note resolution, malformed identity, competing open CLOCKs,
  external edits during a mutation, and source-confirmation failure always
  block the write with a specific Notice. Planning remains read-only where its
  source can still be resolved safely.
- Cache eviction, memory pressure, sleeping, wall-clock jumps, DST transitions,
  and restored background tabs trigger a fresh derivation from Markdown and
  absolute timestamps. Derived state is disposable.

## Release blockers

A release is blocked by any of the following:

1. Failure of behavior fixtures on Obsidian 1.7.7/Electron 32.2.5 or the latest
   public Obsidian/current installer lane.
2. Failure of a supported Windows, macOS, Linux x64, or Linux ARM64 smoke lane,
   except for the narrowly documented Snap packaging waiver above.
3. Default light/dark functional or screenshot failure, or any theme-stress
   result that makes a control unreadable, unreachable, clipped, or overlapping.
4. A p95 budget breach in two clean runs, a reproducible hard-cap breach, a
   greater-than-20% p95 regression from the accepted exact-commit baseline, a
   main-thread task above the stated limit, or retained heap above its budget.
5. Unbounded full-vault work on plugin activation, ItemView open, a foreground
   edit, or a one-second timing tick; a history index that blocks today's plan
   or fails to yield within 50 ms.
6. Any stale projection becoming interactive, a cancelled revision committing,
   hidden views polling or rendering continuously, or a settings/external edit
   failing to invalidate the affected projection.
7. A partial, duplicate, mis-targeted, automatic, or unconfirmed Markdown write;
   loss of unknown Markdown suffixes; retry without explicit user action; or an
   over-limit input leaving mutations enabled.
8. Silent truncation, sampling, incomplete totals presented as complete, or an
   over-limit/invalid configuration state without actionable actual-versus-limit
   feedback.
9. A direct Electron/Node dependency, private Obsidian DOM/API dependency,
   network dependency, telemetry, or mobile loading in the first-release build.
10. Missing raw benchmark samples, fixture hash, exact plugin commit, or recorded
    machine/OS/Obsidian/Electron/theme metadata for a claimed performance pass.

## Grilled alternatives rejected

- **Obsidian 1.1.0 floor:** safest background writes are available, but current
  side-leaf/lifecycle helpers are not. Supporting legacy sidebar paths adds
  compatibility code without product value.
- **Obsidian 1.13.0 floor:** declarative settings are convenient, but excluding
  the public 1.7 line for settings search alone is not justified.
- **Unlimited vault support:** it cannot produce measurable release gates and
  invites foreground scans. The selected envelope keeps today's plan local and
  makes cross-note scope explicit.
- **Best-effort partial schedules above the limit:** omission changes capacity
  and scheduling semantics. Failing closed is safer and legible.
- **Render every change immediately:** rapid Editor and MetadataCache events can
  duplicate work and commit out of order. Bounded debounce plus revisions gives
  deterministic freshness.
- **Keep hidden views ticking:** elapsed time comes from absolute instants, so
  background rendering adds cost without improving correctness.

## Domain-language effect

No glossary change is required. Daily Note, Plan Item, Scheduler, Execution
Layer, CLOCK, and LOGBOOK already have canonical definitions in `CONTEXT.md`.
Terms introduced here such as p95, hard cap, cache revision, and supported
boundary are measurement mechanics, not product-domain concepts.

## One-line map gist

Support official desktop Obsidian 1.7.7+/Electron 32.2.5+ with bounded,
cancellable, fail-closed planning: 1,000 Plan Items at the scale boundary,
1-second p95 cold open, and 600 ms p95 incremental refresh.
