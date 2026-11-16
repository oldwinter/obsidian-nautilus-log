# Settings and commands

The configuration surface and the editor/command entry points that exist only
while Execution Layer is on.

## Sub-features

- Settings → **Spiral Day**: language (English / 简体中文), Daily Note folder,
  Daily Note date format, default task duration, **Execution Layer** toggle.
- First-run card: explanation, **Insert into today's Daily Note**,
  **Copy sample task**, and the pointer to the Execution ribbon once enabled.
- Invalid input handling: a folder that does not exist snaps back to the last
  accepted value; a date format without year/month/day tokens is rejected.
- Commands (only while Execution Layer is on):
  `Spiral Day: 1. Clock in current task`, `2. Clock out current task`,
  `3. Locate Primary Plan` — plus the editor context menu entries
  **Spiral Day: Clock in** / **Clock out**.
- Language change relabels Planner, the Execution panel, the commands and the
  editor menu immediately.

## How to get to it (user POV)

Settings (gear) → **Spiral Day** in the left list. Commands via the command
palette (`Cmd/Ctrl+P` → type `Spiral Day`), or right-click an eligible task.

## Driving it with the host runner

The host runner does **not** open the Settings tab today. What it does prove
about this surface:

- `lifecycle-<n>-loaded` — exactly the 3 commands (`spiral-day:execution-1..3`)
  are registered after enablement, and zero after disable (`lifecycle-<n>-unloaded`),
  so the command lifecycle matches the Execution Layer contract.
- `host-startup-settings-dismissed` (when the host leaves the community-plugin
  settings modal open) — the run's own Escape path is exercised.
- The runner supplies its own `data.json` with Execution enabled and English
  labels (`tests/lifecycle/real-host.mjs` + `tests/host-matrix/run.mjs`), which
  is the same schema the Settings tab writes.

Drive the rest from the focused suites, which `npm run verify` runs:

```bash
mise exec node@24.20.0 -- npm run test
```

- `tests/ui/execution/settings-onboarding.test.ts`, `first-run.test.ts`,
  `first-run-notice.test.ts`, `daily-note-setting.test.ts`,
  `insert-notice.test.ts` — settings persistence, language defaults, first-run
  cards, insert/sample-task notices.
- `tests/ui/execution/locate-primary.test.ts` — the `Locate Primary Plan`
  command path.
- `tests/runtime/execution/commands.test.ts`, `tests/ui/execution/host-adapters.test.ts`
  — command registration/removal on enable and disable, and the host adapter
  contracts behind the settings surface.

To prove the Settings UI in a real host today, extend
`tests/host-matrix/run.mjs` with a settings scenario (open
`.mod-settings`, pick Spiral Day, flip a value, re-read `data.json`); that is a
harness change in the product's test suite, not something this skill owns.

## Gotchas

- Changing the language through Settings writes `data.json`; a run that does it
  must restore the prior value or use a disposable profile (the host runner's
  profile already is disposable).
- The commands only exist after enablement. A command-palette drive before that
  is a false failure.
- `Insert into today's Daily Note` is the only path that creates the Plan
  Region; Settings shows the same button until the markers exist.
