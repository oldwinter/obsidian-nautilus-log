# Dockable planner prototype

> Throwaway evidence for issue 13. This is not production architecture.

Question: can a dockable Obsidian ItemView preserve the Nautilus Log planning
hierarchy, adapt natively to Obsidian, and demonstrate one conflict-safe
Markdown write and reload-derived recovery?

The human delegated the choice among variants. The prototype therefore defaults
to the parity-led option, evaluates all three against the accepted decisions and
visual research, and records the final selection in the evidence index instead
of pausing for a preference vote.

From the repository root:

```sh
npm install
npm run prototype:check
npm run prototype:build
```

Copy `manifest.json`, `main.js`, and `styles.css` into an isolated disposable
vault under `.obsidian/plugins/spiral-day-planner-prototype/`. Enable it only in
that disposable profile, then run `Open Spiral Day planner prototype`.

Variants are held in memory and switched with the fixed bottom control or the
Left/Right arrow keys while no input or editable element is focused.
