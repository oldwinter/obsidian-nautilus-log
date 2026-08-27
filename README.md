# Spiral Day

Spiral Day is an unofficial, independently maintained, Obsidian-native parity
port of Roam Nautilus Log v1.0.2.

This branch contains only the deterministic desktop plugin and provenance
foundation. The plugin intentionally registers no commands, views, settings,
listeners, timers, DOM, network activity, telemetry, or Markdown writes.

Foundation version: `0.1.0`

## Requirements

- Obsidian desktop 1.7.7 or later
- Node.js 18 or later for development

Mobile loading is intentionally disabled.

## Build

```sh
npm ci
npm run verify
```

The production package allowlist is `manifest.json`, `main.js`, and optional
`styles.css`. This foundation emits only `manifest.json` and `main.js`.

## Install from a local build

1. Run `npm ci && npm run build` from a clean checkout.
2. Create `<vault>/.obsidian/plugins/spiral-day/`.
3. Copy `manifest.json` and `main.js` into that folder.
4. In Obsidian, enable Spiral Day under **Settings -> Community plugins**.

The plugin ID and installed folder are permanently `spiral-day`. Spiral Day is
not an upgrade or migration target for the separately registered
`nautilus-log` plugin. Both folders can coexist; Spiral Day never reads, moves,
or overwrites `.obsidian/plugins/nautilus-log/`.

The upstream English and Chinese v1.0.2 documentation names conflicting Roam
Depot preview routes (`1430` and `1428`). That conflict is retained as
`UP-INS-01` / `UP-DRF-01` research evidence and is not applicable to Obsidian
installation. Neither route is a Spiral Day install mechanism.

## Provenance and credits

Spiral Day is implemented from the accepted behavior dossier, not by copying
the upstream or Issue #13 prototype implementation. See [PROVENANCE.md](PROVENANCE.md),
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md), and [LICENSE](LICENSE).

The project credits these behavioral sources and inspirations without implying
their authors maintain, own, or endorse Spiral Day:

- [404KSG / Roam Nautilus Log](https://github.com/404KSG/roam-nautilus-log),
  the fixed v1.0.2 behavioral baseline.
- [Tomas Baranek / Nautilus](https://github.com/tombarys/roam-depot-nautilus),
  the original spiral daily-planning project.
- [hopeserena / Nautilus Enhanced](https://github.com/hopeserena/nautilus-enhanced),
  the enhanced fork in the upstream lineage.
- [Matt Vogel / Roam Depot Render Template](https://github.com/8bitgentleman/roam-depot-render-template),
  the render-template lineage and preserved MIT notice source.
- [Jiayuan Zhang / Roam Logbook](https://github.com/forrestchang/roam-logbook),
  the compatible LOGBOOK/CLOCK behavior reference.

Obsidian is a trademark of Dynalist Inc. Spiral Day is not affiliated with or
endorsed by Dynalist Inc. or the upstream projects.
