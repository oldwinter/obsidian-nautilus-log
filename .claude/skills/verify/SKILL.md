---
name: verify
description: Prove the Spiral Day Obsidian plugin (`spiral-day`) still behaves the way a user sees it — build the shipped bundle, drive a real disposable Obsidian host with Playwright/CDP, and read the run's assertions and screenshots. Use for "verify the plugin", after changing Planner, Execution, Review, or Settings behavior, or before cutting a release candidate.
---

# Verify Spiral Day

Spiral Day is an Obsidian **desktop plugin** (`manifest.json`, `main.js`,
`styles.css` dropped into `<vault>/.obsidian/plugins/spiral-day/`). The user
surface is the Obsidian window: a Planner view, an Execution side panel with
Timing / Plan / Review tabs, an Active Task view, three commands, and one
settings tab. There is no server and no web app; "launch" means "build the
bundle and let the host runner start its own Obsidian".

This skill owns two lanes. Run the code lane for every change; run the host
lane whenever the change is user-visible, and always before quoting a release
candidate.

## Launch

```bash
cd <repo>
mise exec node@24.20.0 -- npm ci          # once per clone; the runner and npm test pin 24.20.0
mise exec node@24.20.0 -- npm run build    # writes main.js, manifest.json, styles.css at the repo root
```

`npm run build` runs `npm run check` first (tsc, manifest/package/provenance
validation) and refuses to emit a bundle when the contract checks fail. The
repo root doubles as the `--plugin-dir` the host runner copies from.

The host lane is the launch for a drive:

```bash
.claude/skills/verify/scripts/host-lane.sh probe   # ~40 s, read-only
.claude/skills/verify/scripts/host-lane.sh full    # ~2 min, adds lifecycle + CLOCK writes
.claude/skills/verify/scripts/host-lane.sh review  # ~5 min, adds the Review rendering matrix
```

The helper builds unless `SKIP_BUILD=1`, then runs
`tests/host-matrix/run.mjs`. That runner creates a fresh profile, a fresh vault
and its own fixture Daily Notes, enables the plugin through the host's own API,
and terminates only the Obsidian child process it started. It never opens a
configured user vault.

## Doctor

`host-lane.sh` prints one line per check before driving anything:

```
ok   node: v24.20.0
ok   obsidian: /Applications/Obsidian.app/Contents/MacOS/Obsidian
ok   playwright: /path/to/node_modules/playwright
ok   package: main.js manifest.json styles.css present
```

Any `fail` line stops the run with exit 1 before a host process starts. The
three things that actually break: the shell is not on Node 24.20.0, Obsidian is
not installed where `OBSIDIAN_BIN`/the default expects it, and no `playwright`
module is resolvable. The repo has no Playwright dependency of its own — the
helper auto-discovers an installed copy under `~/Code/*`, `~/Code/*/*` and
`~/.local/state/gt-e2e-verify-sweep/*/work/*`; otherwise export
`PLAYWRIGHT_MODULE=$(node -p "require.resolve('playwright')")` from a project
that has one.

## Drive

| Lane | What the run exercises |
| --- | --- |
| `probe` (`--planner-tooltip-only`) | isolation guards, activation leaves Markdown byte-identical, Planner SVG accessible name, real hover → delayed host tooltip, no page/console errors, no plugin-attributed network, plugin bytes unchanged, deadline |
| `full` | everything in `probe`, plus Planner `Collapse/Expand planner` and `Hide/Show completed items`, Execution panel open, `Escape` focus return, Timing→Plan keyboard tabs, source navigation, ten clean disable/enable cycles, one CLOCK write with reload |
| `review` | everything in `full`, plus the Review matrix (12 rendering states, zoom, themes, focus, read-only navigation) and a real one-minute CLOCK |

A fourth lane covers the Review surface without Obsidian, in plain Chromium with
deterministic snapshots (13 scenarios, 109 assertions, 11 screenshots):

```bash
PLAYWRIGHT_MODULE=$(node -p "require.resolve('playwright')") \
mise exec node@24.20.0 -- node tests/ui/review/run.mjs \
  --report .codex/runtime/verify/<RUN_NAME>/review-browser/report.json
```

It is not part of `npm test`, so call it explicitly when the change touches the
Review tab, its search/filter, or its focus handling.

Read the summary the helper prints at the end: it lists every assertion id with
PASS/FAIL and names the failing ones. Feature files map user-facing features to
the assertions that prove them.

The code lane:

```bash
mise exec node@24.20.0 -- npm run verify
```

`npm run verify` = `clean` → `tsc` + `validate` → `test` → `build`. `test` runs
the foundation/provenance checks, the negative provenance tests, the runtime
import policy, the 10-cycle lifecycle test, deterministic-bundle comparison, and
every focused suite under `tests/**` (each directory with `.test.ts` files must
own a `run.mjs`).

## Evidence

Everything lands under `.codex/runtime/verify/<RUN_NAME>/` (gitignored):

```
host-probe/evidence/report.json      # every assertion, host metadata, driver file hashes
host-probe/evidence/isolation.json   # the isolation guards
host-probe/evidence/planner.png ...  # CDP screenshots (viewport, fromSurface)
host-probe/evidence/electron-netlog.json
host-probe.log                       # runner stdout/stderr
```

`RUN_NAME` defaults to a UTC timestamp; set it to the change you are proving.
A proof is the report plus its screenshots: quote the assertion ids that prove
the feature, not the exit code. The report records the host app version,
Electron version, package hashes and fixture hashes, so a later failure can be
told apart from a host upgrade.

## Cleanup

The runner owns its child process and closes it (SIGTERM, then SIGKILL and
deadline cancellation on failure); do not kill Obsidian by name. On failure the
profile, vault and evidence stay for inspection. Evidence is the part worth
keeping — it lives inside the gitignored `.codex/runtime/` tree, so deleting an
old run directory costs nothing else. `mise exec node@24.20.0 -- npm run clean`
removes only the generated `main.js` and `styles.css`.

## Helpers

- `scripts/host-lane.sh [probe|full|review]` — doctor, build, drive, summarize.
  Env: `RUN_NAME`, `OBSIDIAN_BIN`, `PLAYWRIGHT_MODULE`, `SKIP_BUILD=1`.
- `scripts/summarize-report.mjs <report.json>` — host identity, each assertion,
  screenshots; exits 1 when any assertion failed.

Both are executable and safe to call from a fresh shell.

## Known failures and limits (2026-10-29, Obsidian 1.14.5 / Electron 43.8.3)

- The `full` lane fails at `execution-escape-restores-trigger`: after
  `Escape`, the Execution panel stays open and focus does not return to
  `.spiral-day-execution-trigger` (screenshot
  `.codex/runtime/verify/<run>/host-full/evidence/failure.png`). Treat it as a
  product/host-compatibility finding — record it, do not delete the assertion
  or weaken the journey.
- The Settings tab and the first-run card are not driven by the host runner.
  Their proof today is the focused suites (`npm run test`) plus the host's
  `data.json` and label assertions; see `features/settings-and-commands.md`.
- The runner reads private Obsidian host interfaces (`app.plugins`,
  `app.commands`, `app.workspace`) from the external test process. A host
  upgrade can break the driver without proving a plugin regression.

## Map

`features/` is the maintained verification source: `planner.md`,
`execution-timing.md`, `plan-tab.md`, `review.md`,
`settings-and-commands.md`. Add a file when a new user-facing surface ships.
Keep the map honest with `/maintain-verification-skill`.
