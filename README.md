# Nautilus Log for Obsidian

An Obsidian desktop plugin project aiming for observable behavior and visual
parity with Roam Nautilus Log, while using Obsidian-native internals.

## Baseline

- Functional baseline: upstream `v1.0.2` at
  [`973a041`](https://github.com/404KSG/roam-nautilus-log/tree/973a041aa2f59f3b05bf31db8187efbfea07017a)
- Supplementary documentation and screenshots: upstream `main` at
  [`08892f9`](https://github.com/404KSG/roam-nautilus-log/tree/08892f948c63e4cacd3fc1cc100a600dd38c21f8)
- License boundary: reuse portable MIT-licensed logic where it is advantageous;
  rewrite Roam APIs and ClojureScript UI in TypeScript; preserve attribution and
  applicable license notices.

## Product Boundary

- Daily Notes and ordinary Markdown remain the canonical user data.
- The planner is a dockable Obsidian `ItemView`; notes remain normal Markdown.
- No hard dependency on Tasks, Dataview, or another community plugin.
- Desktop parity comes first. Mobile parity and Roam graph import are outside
  the first release.
- Local-only operation: no telemetry or network dependency.
- Planning is read-only. Vault writes happen only after explicit user actions.
- English and Simplified Chinese ship from the first public release.

Implementation begins only after the Wayfinder map has resolved the behavior,
data-contract, architecture, and parity-acceptance decisions.
