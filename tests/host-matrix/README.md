# Real Obsidian host smoke evidence

Run the shipped plugin bytes inside a new profile and disposable vault using an
installed official Obsidian desktop executable. The script records one host
lane. Its successful exit does not qualify issue #30 or freeze a release.

Use Node 24.20.0 and an installed Playwright package. No downloaded browser is
needed. Keep Playwright outside the plugin package if it is not already in your
development environment.

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/node_modules/playwright \
node tests/host-matrix/run.mjs \
  --executable /Applications/Obsidian.app/Contents/MacOS/Obsidian \
  --plugin-dir /absolute/path/to/built/plugin \
  --output /private/tmp/spiral-day-host-new-run \
  --candidate-sha 0123456789012345678901234567890123456789
```

`--candidate-sha` is optional and accepts a full lowercase SHA. It is an operator
label, not a Git verification result. The package SHA256 values identify the
tested bytes. The runner copies only `main.js`, `manifest.json`, and `styles.css`.
It supplies its own `data.json` with Execution enabled and English plugin labels.
The host may use a different system language.

The output directory must not exist. Each invocation creates a new `profile`,
`vault`, and `evidence` directory. The runner passes its profile to the executable
and discovers CDP only through that profile's `DevToolsActivePort` file. Before
enabling the plugin or accepting the disposable vault's trust dialog, it checks
the renderer's actual profile argument, actual vault path, and empty community
plugin set. It never opens a configured user vault, reads global Obsidian
settings, changes the installed application, or controls an existing process.
It terminates only the child process it launched. The 180-second deadline bounds
the automated run. Output remains available for inspection after exit.

The fixture contains three generated Daily Notes around the runner's local date.
Their content and hashes are recorded. The checks cover Planner collapse and
completed visibility, Execution keyboard tab selection, Escape focus restoration,
source navigation, and ten clean Planner/Execution open-close-disable-enable
cycles. Each cycle records plugin presence, commands, ribbon triggers, panels,
and planner leaves. An explicit CLOCK action then waits for the host to save the
record to disk, reloads the renderer, confirms the active task and unchanged
record, and clocks out the same record. Markdown hashes before activation, after
navigation, after lifecycle use, and after CLOCK writes distinguish read-only
use from the intentional write. CLOCK checks also preserve the note's text
outside the Plan Region.

Read `evidence/report.json` for assertion results, errors, package hashes, host
metadata, source hashes, renderer requests and their initiators, and screenshot
hashes. `isolation.json` records the guards. `clock-sources.json` records the
synthetic source around reload. Screenshots, process logs, and Electron's default
redacted `electron-netlog.json` remain beside the report. On macOS, the report
also records code-signature verification, signer identity, installer version,
and installed app archive hashes. Signature output is evidence for review and
does not replace obtaining an official installer.

The runner uses private Obsidian host interfaces only in the external test
process to enable plugins and inspect lifecycle registrations. The production
bundle remains unchanged. A future host change can break this driver without
proving a plugin regression. A failed assertion or automation error returns a
nonzero exit and retains the report and available screenshots. After verified
isolation, failures also capture the plugin's rendered diagnostic text and
current Markdown hashes. This reads the existing Active Task details disclosure
and does not inspect private production fields or press a retry control.

The retained evidence has these limits.

- It covers the installed runtime and small fixture only. Minimum Obsidian,
  other operating systems, Intel, and other architectures require their own
  official installed host runs. Emulation does not establish those lanes.
- Keyboard DOM behavior is not a VoiceOver or screen-reader transcript. Manual
  acceptance, theme/zoom/locale matrices, and visual parity remain separate.
- The ten clean cycles do not test unload during queued or entered mutations,
  hidden CPU, timer or event-listener ownership, retained heap, performance
  budgets, or the 100-cycle leak sequence.
- CDP observes renderer requests after attachment and before plugin enablement.
  Requests with a Spiral Day initiator are marked `pluginAttributed`. A zero
  count alone cannot rule out host-mediated `requestUrl` traffic. The process
  NetLog includes host traffic and requires separate attribution review.
- The optional SHA does not prove a clean checkout, remote equality,
  implementation completeness, G0-G6, or identical-byte G7-G9 sign-off.

Run again in a fresh output directory after any material candidate change. Keep
reports immutable and bind their package hashes to the separately verified
candidate before using them as a contribution to release evidence.
