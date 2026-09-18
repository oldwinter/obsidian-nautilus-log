# Spiral Day

Spiral Day is an unofficial, independently maintained Obsidian plugin for
spiral planning and lightweight time tracking. It brings the Nautilus Log v1.0.2
workflow to Obsidian with native Markdown, Planner and Execution surfaces.

Version `0.1.0` is a desktop development preview. The plugin is local-only. It
uses Obsidian workspace and file APIs, sends no network requests, and has no
telemetry service.

Foundation version: `0.1.0`

## What you can do

- Plan a day from a bounded Primary Plan in the Daily Note.
- Place fixed events and flexible tasks on a deterministic spiral schedule.
- Advance progress, complete tasks, hide completed items, and copy a plan summary.
- See remaining and original planned duration on scheduled Plan tasks that
  already have progress. The task currently being timed keeps its Current task
  indicator.
- Track one active task with CLOCK, CLOCK Out, task POMO, and standalone POMO.
- Compare planned and recorded time in Review, search task titles, filter to completed overruns, and
  recover from stale, conflicting, or unavailable timing data. The Review
  summary still covers the whole day.
- Open the Planner and Active Task surfaces from Obsidian's workspace and sidebar.

Spiral Day never writes a Markdown file during a read-only refresh. It writes
only after an explicit action such as Clock In, Clock Out, progress, Complete, or
CLOCK deletion. Every write re-reads the source and fails closed when the source
changed or the target is ambiguous.

## Install

Spiral Day requires Obsidian desktop `1.7.7` or later. Mobile loading is
intentionally disabled.

To install a local build:

1. Run `npm ci && npm run build` in a clean checkout.
2. Create `<vault>/.obsidian/plugins/spiral-day/`.
3. Copy `manifest.json`, `main.js`, and `styles.css` into that directory.
4. In Obsidian, enable **Spiral Day** under **Settings → Community plugins**.

The plugin ID and folder are permanently `spiral-day`. They are separate from
the old `nautilus-log` plugin. Spiral Day never reads, moves, or overwrites that
folder.

## Start your first day

After you enable the plugin, the only new control is the shell ribbon icon
**Open Spiral Day**. Timing, Plan, Review, and commands stay hidden until you
turn on **Execution Layer**. A Daily Note without the markers below opens an
empty Planner that now lists the next action.

1. Open **Settings → Spiral Day**. First enable copies Obsidian's language and
   the core Daily Notes folder/format when present. **Insert into today's Daily
   Note** or any Settings change saves that snapshot so later host changes do
   not overwrite those fields. Otherwise leave the defaults, or set **Daily
   Note folder** and **Daily Note date format** to match your journal.
2. Click **Insert into today's Daily Note** in Planner, Settings, the Plan
   tab, or Review (today). That creates today's note if needed (default
   `YYYY-MM-DD.md` at the vault root) and writes the markers plus one sample
   task. Opening Planner
   never inserts them by itself. You can still create the note yourself and
   paste this plan starter at column zero:

   ```markdown
   <!-- nautilus-log:plan/v1 -->
   - [ ] 09:00-09:30 Stand-up
   - [ ] Write the release note 45m
   <!-- /nautilus-log:plan -->
   ```

3. Click the **Open Spiral Day** ribbon icon. The Planner reads that Primary
   Plan. If the markers are missing, it shows the plan starter again and offers
   **Copy plan starter** and **Insert into today's Daily Note**.
4. Enable **Execution Layer** when you want CLOCK, POMO, Timing, Plan, Review,
   the Active Task sidebar, and `Spiral Day:` command-palette actions.

Complete manuals:

- English: [User guide](docs/user-guide.md)
- 简体中文：[使用手册](docs/user-guide.zh.md)

Use the [Markdown grammar reference](docs/reference/markdown-grammar-v1.md) for
every token, the [settings reference](docs/reference/settings.md) for Daily Note
paths and timing policy, and [troubleshooting](docs/troubleshooting.md) when a
surface is empty, stale, blocked, or unavailable.

## Entry points

- **Planner:** the ribbon icon named **Open Spiral Day**. The Planner shows
  capacity, scheduled slots, overflow, progress controls, completed visibility,
  playback, and summary copy.
- **Execution:** enable **Execution Layer** in settings, then use the timer
  ribbon entry. The panel contains **Timing**, **Plan**, and **Review** tabs.
  Timing and Plan are the active task workflows. Scheduled Plan tasks with
  partial progress show remaining and original planned duration below the time
  range. Review compares planned and
  recorded time; select **Only completed overruns** to focus on completed tasks
  whose recorded time exceeded their plan. The summary still covers the whole
  day.
- **Active Task:** the singleton view in the right sidebar. It follows the
  current task, opens its source line, copies an Obsidian block link, and offers
  Clock Out when a valid CLOCK is running.
- **Command palette:** the three commands begin with `Spiral Day:` and Clock
  in the current task, Clock out the current task, or locate the Primary Plan.
- **Editor menu:** with Execution enabled, right-click an eligible plan item to
  Clock In or Clock Out. Use the Planner or the Plan tab for progress and
  completion actions.

## Data and safety

The planner projects only the Primary Plan in the configured Daily Note. A
vault-wide read-only index also scans Markdown files for durable IDs and CLOCK
records so execution actions can fail closed when another note owns the fact.
The Plan Region uses the exact `nautilus-log:plan/v1` marker pair. Only direct
unordered list items are eligible. Standard Markdown checkboxes replace Roam
TODO and DONE macros. Plan Item IDs are durable block IDs; they keep actions
attached to the same task when its wording moves.

CLOCK and LOGBOOK records stay in Markdown. Plugin settings and POMO start times
stay in Obsidian plugin data. The write queue serializes mutations per vault and
keeps byte-preserving source edits. If the source, CLOCK index, or settings are
ambiguous, the UI explains the blocked action and offers a read-only recovery
path.

## Development

```sh
npm ci
npm run verify
```

`npm run verify` cleans generated assets, type-checks, validates the manifest and
provenance, runs the default test gate, and builds the exact package assets.
The production package allowlist is `manifest.json`, `main.js`, and
`styles.css`.

The internal [implementation dossier](docs/implementation-dossier.md),
[architecture decisions](docs/decisions/), and [context glossary](CONTEXT.md)
record the design contracts behind the user-facing behavior. They are reference
material for maintainers, not installation instructions.

## Provenance and credits

Spiral Day follows the
[community-compliance decision](docs/decisions/community-compliant-product-naming-and-attribution.md)
and is implemented from the accepted [behavior dossier](docs/implementation-dossier.md),
not by copying the upstream or Issue #13 prototype implementation.
Requirement and ticket ownership remain defined by the
[requirement-owner registry](docs/parity/requirement-owners.json) and
[ticket boundaries](docs/parity/ticket-boundaries.json). Local compliance records
are `PROVENANCE.md`, `THIRD_PARTY_NOTICES.md`, and `LICENSE`.

The project credits these behavioral sources and inspirations without implying
their authors maintain, own, or endorse Spiral Day:

- [404KSG / Roam Nautilus Log](https://github.com/404KSG/roam-nautilus-log), the
  fixed v1.0.2 behavioral baseline.
- [Tomas Baranek / Nautilus](https://github.com/tombarys/roam-depot-nautilus),
  the original spiral daily-planning project.
- [hopeserena / Nautilus Enhanced](https://github.com/hopeserena/nautilus-enhanced),
  the enhanced fork in the upstream lineage.
- [Matt Vogel / Roam Depot Render Template](https://github.com/8bitgentleman/roam-depot-render-template),
  the render-template lineage and preserved MIT notice source.
- [Jiayuan Zhang / Roam Logbook](https://github.com/forrestchang/roam-logbook),
  the compatible LOGBOOK and CLOCK behavior reference.

Obsidian is a trademark of Dynalist Inc. Spiral Day is not affiliated with or
endorsed by Dynalist Inc. or the upstream projects.
