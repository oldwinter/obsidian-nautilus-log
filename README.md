# Spiral Day

An unofficial, independently maintained Obsidian desktop plugin project aiming
for observable behavior and visual parity with Roam Nautilus Log, while using
Obsidian-native internals.

## Product Identity

- Project, manifest, and Community directory name: **Spiral Day**
- Stable plugin ID and installation folder: `spiral-day`
- `Nautilus Log` identifies the upstream lineage, not an alternate name for
  this plugin.

Spiral Day is not affiliated with or endorsed by Obsidian or the upstream
project maintainers. The governing naming, attribution, notice, and migration
rules are recorded in the
[product naming and attribution decision](docs/decisions/community-compliant-product-naming-and-attribution.md).

## Baseline

- Functional baseline: upstream `v1.0.2` at
  [`973a041`](https://github.com/404KSG/roam-nautilus-log/tree/973a041aa2f59f3b05bf31db8187efbfea07017a)
- Supplementary documentation and screenshots: upstream `main` at
  [`08892f9`](https://github.com/404KSG/roam-nautilus-log/tree/08892f948c63e4cacd3fc1cc100a600dd38c21f8)
- License boundary: reuse portable MIT-licensed logic where it is advantageous;
  rewrite Roam APIs and ClojureScript UI in TypeScript; preserve attribution and
  applicable license notices.

The [implementation dossier](docs/implementation-dossier.md) is the single
canonical specification and source index. It resolves the frozen research,
accepted decisions, prototype evidence boundary, implementation task graph, and
release gates without requiring a reader to reconstruct precedence.

## Product Boundary

- Daily Notes and ordinary Markdown remain the canonical user data.
- The planner is a dockable Obsidian `ItemView`; notes remain normal Markdown.
- No hard dependency on Tasks, Dataview, or another community plugin.
- Desktop parity comes first. Mobile parity and Roam graph import are outside
  the first release.
- Local-only operation: no telemetry or network dependency.
- Planning is read-only. Vault writes happen only after explicit user actions.
- English and Simplified Chinese ship from the first public release.

## Credits and Provenance

- [Roam Nautilus Log](https://github.com/404KSG/roam-nautilus-log) by
  `404KSG` is the direct functional baseline.
- [Nautilus](https://github.com/tombarys/roam-depot-nautilus) by Tomas Baranek
  is the original project and concept lineage.
- [Nautilus Enhanced](https://github.com/hopeserena/nautilus-enhanced) by
  `hopeserena` is the intermediate fork lineage.
- [Roam Depot Render Template](https://github.com/8bitgentleman/roam-depot-render-template)
  by Matt Vogel is part of the license-notice lineage.
- [Roam Logbook](https://github.com/forrestchang/roam-logbook) by Jiayuan
  Zhang informs the CLOCK/LOGBOOK compatibility and provenance boundary.

Credits do not replace required license notices. Before copied or substantially
ported code enters the project, the applicable verbatim notices and per-file
provenance must be recorded as required by the decision above.

Production implementation starts only through the root issue linked by the
canonical dossier. The throwaway prototype is evidence and is not a source tree
for the plugin.
