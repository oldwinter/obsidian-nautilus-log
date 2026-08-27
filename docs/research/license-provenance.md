# License, provenance, and reusable-code boundary

> Status: frozen engineering provenance evidence. The [canonical implementation dossier](../implementation-dossier.md)
> records current product identity, reuse boundaries, and release gates.

Status: research finding for upstream `v1.0.2` at commit
[`973a041aa2f59f3b05bf31db8187efbfea07017a`](https://github.com/404KSG/roam-nautilus-log/tree/973a041aa2f59f3b05bf31db8187efbfea07017a).

This is an engineering provenance audit, not legal advice. It records what the
repositories and package artifacts say, separates observations from
recommendations, and leaves unresolved rights questions explicit.

## Executive decision

Use a **hybrid port**:

- Port the dependency-free scheduling and timing rules, together with their
  behavioral tests, and record exact upstream paths and commit in a provenance
  ledger.
- Reimplement the Roam adapters, ClojureScript/Reagent UI, Blueprint icon use,
  DOM orchestration, CSS integration, and documentation in Obsidian-native
  TypeScript/CSS.
- Do not redistribute the upstream screenshot or a generated upstream
  `extension.js`.
- Preserve the upstream MIT notice verbatim in every distribution that contains
  copied or substantially ported code. Keep broader project credits separate
  from the license notice so neither is lost.
- If timing source is copied or ported, also preserve Jiayuan Zhang's Roam
  Logbook MIT notice; otherwise reimplement only the compatible CLOCK/LOGBOOK
  behavior without translating the source.

This boundary keeps the high-value deterministic behavior close to its tested
source while avoiding a line-by-line translation of the host-coupled UI.

## Observed license and provenance

### Repository declaration

- The fixed baseline has a root [`LICENSE`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/LICENSE)
  containing the MIT License and the notice `Copyright (c) 2022 Matt Vogel`.
  Its stated condition is that the copyright and permission notice be included
  in all copies or substantial portions of the software.
  Its [`package.json`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/package.json)
  also declares `MIT`, while naming `404KSG` as package author.
- No source, test, documentation, or asset file has an SPDX identifier or a
  file-level copyright/license header. The opening comment in
  [`extension.css`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css)
  is functional, not a license notice. The repository therefore relies on its
  root license for the declared licensing context.
- GitHub records `404KSG/roam-nautilus-log` as a fork of
  [`hopeserena/nautilus-enhanced`](https://github.com/hopeserena/nautilus-enhanced).
  The fork's first commit is the same
  [`1b0b031`](https://github.com/hopeserena/nautilus-enhanced/commit/1b0b03188b0f68be177c97eb7e7d2653dc0cd77a)
  commit still present in the fixed baseline. That commit imports the initial
  ClojureScript renderer, Roam entry/adapters, CSS, build files, README, and the
  unchanged MIT license.
- Nautilus Enhanced describes itself as an enhanced fork of Tomáš Baránek's
  [`roam-depot-nautilus`](https://github.com/tombarys/roam-depot-nautilus).
  The fixed Nautilus Log README repeats that chain and credits Nautilus,
  Nautilus Enhanced, and Roam Logbook in its
  [Credits and inspiration section](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/README.md#credits-and-inspiration).
- The same LICENSE blob and Matt Vogel notice appear in the original Nautilus
  repository's
  [`LICENSE`](https://github.com/tombarys/roam-depot-nautilus/blob/e499bb60443abe879d762cbab8c901331d0d0295/LICENSE).
  Its README says the
  [`Roam Depot Render Template`](https://github.com/8bitgentleman/roam-depot-render-template)
  was adopted and credits Matt Vogel for that template. This explains the
  notice's lineage, but does not by itself enumerate every contributor's
  copyright interest.
- At the fixed baseline, repository history names `hopeserena` for the imported
  base and `404KSG` for later development. The original Nautilus history and
  README name Tomáš Baránek and also record Baibhav Bista contributions. The
  root notice does not list those names. Preserve the notice exactly and add
  human-readable credits rather than replacing one with the other. The
  [`1b0b031...973a041` comparison](https://github.com/404KSG/roam-nautilus-log/compare/1b0b03188b0f68be177c97eb7e7d2653dc0cd77a...973a041aa2f59f3b05bf31db8187efbfea07017a)
  is the primary file-level evidence for the later additions and modifications
  summarized below.
- The README calls Roam Logbook an inspiration, while the
  [timing integration design](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/docs/plans/2026-08-22-nautilus-log-timing-integration-design.md#L6)
  explicitly targets compatible `LOGBOOK::`/`CLOCK:` storage. A fixed-source
  comparison against Roam Logbook at
  [`7673391`](https://github.com/forrestchang/roam-logbook/tree/76733914acf03ca260fa6734f1e1e877b1f61a92)
  found two non-trivial syntax fragments and one query/mapping fragment that are
  textually the same, plus adjacent functions with closely matching structure:

  - the drawer label/regex in Nautilus
    [`timing-roam.js`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L3-L4)
    and Logbook
    [`org.js`](https://github.com/forrestchang/roam-logbook/blob/76733914acf03ca260fa6734f1e1e877b1f61a92/src/org.js#L22-L26);
  - the CLOCK parser regex in Nautilus
    [`timing-core.js`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-core.js#L11-L14)
    and Logbook
    [`org.js`](https://github.com/forrestchang/roam-logbook/blob/76733914acf03ca260fa6734f1e1e877b1f61a92/src/org.js#L27-L30); and
  - the direct-child Datalog query/tuple mapping in Nautilus
    [`timing-roam.js`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L285-L295)
    and Logbook
    [`roam.js`](https://github.com/forrestchang/roam-logbook/blob/76733914acf03ca260fa6734f1e1e877b1f61a92/src/roam.js#L126-L139).

  This is narrower than a whole-file copy finding, but it is enough to make
  single-source attribution unsafe for a direct timing port. Roam Logbook's
  fixed [`LICENSE`](https://github.com/forrestchang/roam-logbook/blob/76733914acf03ca260fa6734f1e1e877b1f61a92/LICENSE)
  is MIT with `Copyright 2026 Jiayuan Zhang`.

### Assets and generated output

- The only tracked binary asset is
  [`docs/assets/nautilus-log-overview.png`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/docs/assets/nautilus-log-overview.png),
  added in commit
  [`c4afe07`](https://github.com/404KSG/roam-nautilus-log/commit/c4afe07c949fd9c1dcdd98b18e71e4d5fc2df47d).
  It is a 3022 x 1900 screenshot of Nautilus Log inside the Roam interface. It
  has no embedded creation/copyright metadata visible to the local PNG metadata
  tools, and the repository supplies no asset-specific notice.
- No logo, font file, standalone SVG, third-party JavaScript bundle, or source
  map is tracked at the fixed commit. `component.cljs` names several local or
  system font fallbacks but does not bundle them. Blueprint icons are requested
  by `bp3-icon-*` class names in
  [`timing-topbar.js`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js),
  rather than stored as asset files.
- [`.gitignore`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/.gitignore)
  excludes `*extension.js`, and the fixed tree contains no built bundle. The
  [`webpack.config.js`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/webpack.config.js)
  generates a production `extension.js`, embeds the tracked CSS and
  ClojureScript text, and leaves `react` and `chrono-node` as host globals.
  There is a `v1.0.2` tag but no GitHub Release artifact.
- A clean local build of the fixed commit produced a 210 KiB minified
  `extension.js`. Webpack's module report showed the application sources plus
  `css-loader/dist/runtime/api.js` and `noSourceMaps.js`; the minified bundle did
  not retain `api.js`'s ordinary MIT comment. This makes a generated upstream
  bundle a worse reuse input than the reviewed source files.

## File-area provenance and disposition

`Port with attribution` means the target may mechanically translate or adapt
substantial implementation, but must record the exact source and preserve the
notice. `Behavioral reimplementation` means use observable behavior and tests as
the specification, without line-by-line translation.

| Upstream area | Observed provenance/coupling | Recommendation | Required record |
| --- | --- | --- | --- |
| Root `LICENSE` | Unchanged MIT text with Matt Vogel notice across the template/Nautilus/Nautilus Enhanced/Nautilus Log chain | **Copy exactly**; do not replace the upstream notice with the port author's notice | Root license or third-party notice containing the verbatim upstream text |
| `src/log-core.js` | Added by 404KSG after the fork point; explicitly dependency-free, with scheduling/parser/geometry helpers and a small browser text-measurement seam | **Port with attribution** for pure rules; rewrite the browser measurement seam for Obsidian | Source path, fixed SHA, target path, port notes, source blob/hash |
| `src/timing-core.js` | Added by 404KSG; pure CLOCK/LOGBOOK, Primary Plan, metrics, and label rules; contains a CLOCK regex identical to Roam Logbook and structurally similar time/entry helpers | **Port with dual attribution** to Nautilus Log and Roam Logbook, or clean-room behavioral reimplementation | Record both fixed sources/notices for copied timing logic |
| `test/log-core.test.js`, `test/timing-core.test.js` | Added by 404KSG; executable behavioral examples for the portable cores | **Port with attribution**, adapting only the test harness and Obsidian vocabulary | Record each source test file and which target tests cover it |
| `src/timing-runtime.js` | Added by 404KSG; mixes generic timer transitions with Roam reads/writes, sidebar behavior, DOM events, and polling | **Behavioral reimplementation** of orchestration; port only isolated pure transitions that are separately attributed | Link target state-machine tests to upstream cases |
| `src/timing-commands.js`, `src/timing-roam.js` | Added by 404KSG; command palette, block menu, `roamAlphaAPI`, graph mutation, and right-sidebar adapter; `timing-roam.js` contains drawer/query fragments shared with Roam Logbook | **Behavioral reimplementation** using Obsidian commands, Vault/Editor APIs, and workspace leaves. If any timing adapter source is ported, use dual attribution | Behavior-parity reference only for a clean-room rewrite; both notices for copied source |
| `src/index.js`, `src/entry-helpers.js` | Imported from Nautilus Enhanced and heavily modified; Roam render scaffolding, settings, templates, extension lifecycle, globals, and CSS loading | **Behavioral reimplementation** | Cite upstream lifecycle/settings behavior in parity tests |
| `src/component.cljs` | Imported from Nautilus Enhanced, derived from original Nautilus, then heavily modified; combines parsing, data queries, Reagent UI, spiral geometry, and Roam namespaces | **Behavioral/visual reimplementation** in TypeScript. Port isolated math only when it materially reduces parity risk, and attribute any such port | Ledger entry for every mechanically translated formula/module |
| `src/timing-topbar.js` | Added by 404KSG; direct DOM construction plus Roam Blueprint class/icon assumptions | **Behavioral/visual reimplementation** with Obsidian components and Lucide icons | Screenshot/state parity evidence, not copied DOM/CSS |
| `extension.css` | Imported from Nautilus Enhanced and substantially rewritten by 404KSG; targets Roam and Blueprint selectors | **Behavioral/visual reimplementation** with Obsidian CSS variables. If substantial declarations are copied, classify as a port and attribute them | Ledger entry if copied; otherwise visual-reference citation |
| Contract/scaffold/command/runtime tests | Added by 404KSG but many assert Roam source strings, bundle shape, Blueprint classes, or mocked `roamAlphaAPI` | **Behavioral reimplementation** into host-independent contract and Obsidian integration tests | Upstream-test-to-target-test parity map |
| README, guides, changelog, design plans | Mixed imported and 404KSG-authored prose; useful functional record under the repository license | **Behavioral reimplementation** of user docs; quote sparingly and attribute copied prose/examples | Documentation provenance entry for any copied passage |
| `docs/assets/nautilus-log-overview.png` | 404KSG commit provenance; screenshot includes Roam UI and host icons; no asset-specific rights metadata | **Exclude from releases**. Keep the upstream URL only as a research reference; create new Obsidian screenshots | Record new screenshot author/date/test vault; no upstream binary in artifacts |
| `package*.json`, webpack config, `build.sh` | Roam/Webpack build tooling, all npm packages declared as development dependencies | **Exclude** from target implementation; create an Obsidian-native toolchain and audit its own lockfile | Target SBOM/license report, independent of this upstream inventory |
| Generated `extension.js` | Not tracked; reproducible bundle embeds source and css-loader runtime while dropping the runtime's ordinary license comment | **Exclude**; never vendor it as source | Release bundle must be built from target source and scanned for notices |
| `commit.txt` and upstream repository history | Narrative/provenance evidence, not runtime input | **Exclude from release**, retain linked evidence in the provenance ledger | Fixed commit and fork-chain links |

## Upstream dependency-license inventory

The baseline
[`package-lock.json`](https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/package-lock.json)
contains 126 resolved package instances, all marked `dev: true`; there is no
production `dependencies` section. The four direct build dependencies are:

| Package | Locked version | Declared license | Distribution relevance |
| --- | --- | --- | --- |
| `css-loader` | 6.11.0 | MIT ([exact license](https://github.com/webpack/css-loader/blob/v6.11.0/LICENSE)) | Its `api.js` and `noSourceMaps.js` runtime modules enter the generated upstream bundle |
| `text-loader` | 0.0.1 | ISC ([exact package metadata](https://github.com/dfenstermaker/text-loader/blob/v0.0.1/package.json)) | Build-time transform; package contains no separate license file |
| `webpack` | 5.109.2 | MIT ([exact license](https://github.com/webpack/webpack/blob/v5.109.2/LICENSE)) | Build tool and generated runtime, not a declared runtime dependency |
| `webpack-cli` | 4.10.0 | MIT ([exact license](https://github.com/webpack/webpack-cli/blob/webpack-cli@4.10.0/LICENSE)) | Build-time CLI |

The lockfile omits a `license` field for 53 package instances, so its fields
alone are not a complete inventory. Installing the integrity-pinned artifacts
with scripts disabled and reading each package's own `package.json` produces the
following complete grouping (duplicates reflect distinct resolved versions):

### Apache-2.0 (3)

`@webassemblyjs/leb128@1.13.2`, `@xtuc/long@4.2.2`,
`baseline-browser-mapping@2.11.18`

### BSD-2-Clause (5)

`eslint-scope@5.1.1`, `esrecurse@4.3.0`, `estraverse@5.3.0`,
`estraverse@4.3.0`, `terser@5.50.0`

### BSD-3-Clause (5)

`@xtuc/ieee754@1.2.0`, `fast-uri@3.1.5`, `flat@5.0.2`,
`source-map@0.6.1`, `source-map-js@1.2.1`

### CC-BY-4.0 (1)

[`caniuse-lite@1.0.30001809`](https://registry.npmjs.org/caniuse-lite/1.0.30001809)

### ISC (13)

`electron-to-chromium@1.5.412`, `graceful-fs@4.2.11`,
`icss-utils@5.1.0`, `isexe@2.0.0`, `lru-cache@6.0.0`,
`picocolors@1.1.1`, `postcss-modules-extract-imports@3.1.0`,
`postcss-modules-scope@3.2.1`, `postcss-modules-values@4.0.0`,
`semver@7.5.4`, `text-loader@0.0.1`, `which@2.0.2`, `yallist@4.0.0`

### MIT (99)

`@discoveryjs/json-ext@0.5.7`, `@jridgewell/gen-mapping@0.3.13`,
`@jridgewell/resolve-uri@3.1.2`, `@jridgewell/source-map@0.3.11`,
`@jridgewell/sourcemap-codec@1.5.5`, `@jridgewell/trace-mapping@0.3.31`,
`@types/estree@1.0.9`, `@types/json-schema@7.0.15`, `@types/node@26.2.0`,
`@webassemblyjs/ast@1.14.1`, `@webassemblyjs/floating-point-hex-parser@1.13.2`,
`@webassemblyjs/helper-api-error@1.13.2`, `@webassemblyjs/helper-buffer@1.14.1`,
`@webassemblyjs/helper-numbers@1.13.2`,
`@webassemblyjs/helper-wasm-bytecode@1.13.2`,
`@webassemblyjs/helper-wasm-section@1.14.1`, `@webassemblyjs/ieee754@1.13.2`,
`@webassemblyjs/utf8@1.13.2`, `@webassemblyjs/wasm-edit@1.14.1`,
`@webassemblyjs/wasm-gen@1.14.1`, `@webassemblyjs/wasm-opt@1.14.1`,
`@webassemblyjs/wasm-parser@1.14.1`, `@webassemblyjs/wast-printer@1.14.1`,
`@webpack-cli/configtest@1.2.0`, `@webpack-cli/info@1.5.0`,
`@webpack-cli/serve@1.7.0`, `acorn@8.18.0`, `ajv@8.20.0`,
`ajv-formats@2.1.1`, `ajv-keywords@5.1.0`, `browserslist@4.28.8`,
`buffer-from@1.1.2`, `chrome-trace-event@1.0.3`, `clone-deep@4.0.1`,
`colorette@2.0.20`, `commander@2.20.3`, `cross-spawn@7.0.6`,
`css-loader@6.11.0`, `cssesc@3.0.0`, `enhanced-resolve@5.24.5`,
`envinfo@7.11.0`, `es-module-lexer@2.3.2`, `escalade@3.2.0`,
`events@3.3.0`, `fast-deep-equal@3.1.3`, `fastest-levenshtein@1.0.16`,
`find-up@4.1.0`, `function-bind@1.1.2`, `has-flag@4.0.0`, `hasown@2.0.0`,
`import-local@3.1.0`, `interpret@2.2.0`, `is-core-module@2.13.1`,
`is-plain-object@2.0.4`, `isobject@3.0.1`, `jest-worker@27.5.1`,
`json-schema-traverse@1.0.0`, `kind-of@6.0.3`, `locate-path@5.0.0`,
`merge-stream@2.0.0`, `mime-db@1.54.0`, `minimizer-webpack-plugin@5.6.1`,
`nanoid@3.3.18`, `neo-async@2.6.2`, `node-releases@2.0.53`,
`p-limit@2.3.0`, `p-locate@4.1.0`, `p-try@2.2.0`, `path-exists@4.0.0`,
`path-key@3.1.1`, `path-parse@1.0.7`, `pkg-dir@4.2.0`, `postcss@8.5.26`,
`postcss-modules-local-by-default@4.2.0`, `postcss-selector-parser@7.1.5`,
`postcss-value-parser@4.2.0`, `rechoir@0.7.1`, `require-from-string@2.0.2`,
`resolve@1.22.8`, `resolve-cwd@3.0.0`, `resolve-from@5.0.0`,
`schema-utils@4.3.3`, `shallow-clone@3.0.1`, `shebang-command@2.0.0`,
`shebang-regex@3.0.0`, `source-map-support@0.5.21`, `supports-color@8.1.1`,
`supports-preserve-symlinks-flag@1.0.0`, `tapable@2.3.3`,
`undici-types@8.3.0`, `update-browserslist-db@1.3.1`,
`util-deprecate@1.0.2`, `watchpack@2.5.2`, `webpack@5.109.2`,
`webpack-cli@4.10.0`, `commander@7.2.0`, `webpack-merge@5.10.0`,
`webpack-sources@3.5.1`, `wildcard@2.0.1`

No resolved package reported an unknown or copyleft license after consulting
the integrity-pinned package metadata. The CC-BY and Apache packages are
transitive build inputs; they are not reasons to copy the upstream build graph
into the target.

Four installed package roots have a license field but no separate license file:
`cssesc@3.0.0`, `esrecurse@4.3.0`, `postcss-selector-parser@7.1.5`, and
`text-loader@0.0.1`. If any target release actually redistributes their code,
source the corresponding notice from the exact package/repository version
rather than treating the upstream lockfile as the notice artifact.

These are **upstream build dependencies, not a proposed Obsidian dependency
set**. The target must inventory its own resolved production and development
dependencies. The only upstream npm code observed in the reproduced bundle was
the css-loader runtime; excluding the generated bundle avoids inheriting the
rest of this build graph as a reuse surface.

### Host-provided and implicit dependencies

- `webpack.config.js` externalizes `react` and `chrono-node` to unversioned
  `window.React` and `window.ChronoNode` globals. Neither is present in the
  lockfile, so the fixed baseline does not establish exact versions or notices.
- `component.cljs` imports Reagent and Roam namespaces; `timing-roam.js`,
  `entry-helpers.js`, and `index.js` depend on `window.roamAlphaAPI`; and the
  timing UI relies on Blueprint `bp3-icon-*` classes. Those are host contracts,
  not vendored upstream dependencies.
- The Obsidian port should therefore use Obsidian's documented APIs and icon
  surface, and must make a fresh, pinned decision if it adds `chrono-node` or
  another parser. Do not infer a dependency version or license from Roam's
  globals.

## Provenance ledger and release artifacts

Create one canonical `PROVENANCE.md` before implementation starts. Each copied
or ported target file/section should have one row with:

1. target path and symbol/line scope;
2. disposition: `copied`, `ported`, `behavioral-reimplementation`, or `excluded`;
3. upstream repository, fixed commit, source path, and source blob SHA;
4. upstream creation/import commit when known;
5. license/notice source and credited authors/projects;
6. summary of target modifications and the parity test that covers them;
7. reviewer and last verification date; and
8. whether the material enters `main.js`, `styles.css`, docs, tests, or no
   release artifact.

For mechanically ported source, add a short file header such as `Ported from
404KSG/roam-nautilus-log <path> at 973a041...; MIT; see LICENSE and
THIRD_PARTY_NOTICES.md`. Do not add that header to clean-room behavioral
reimplementations; their ledger rows should instead identify the tests/specs
used as references.

Before every public release, require these artifacts/checks:

- Root `LICENSE` containing the port's chosen license and the unchanged upstream
  Matt Vogel copyright/permission notice wherever the chosen structure places
  third-party notices.
- `THIRD_PARTY_NOTICES.md`, generated or checked against `PROVENANCE.md`, with
  the verbatim upstream MIT notice plus notices for code actually present in
  the release bundle. Include Jiayuan Zhang's Roam Logbook MIT notice when
  timing implementation is copied/ported, and the JS Foundation notice when
  the chosen target bundler embeds relevant Webpack/css-loader runtime. Do not
  blindly copy all 126 upstream build dependencies.
- README `Credits` identifying Tomáš Baránek / Nautilus,
  `hopeserena` / Nautilus Enhanced, `404KSG` / Nautilus Log, Matt Vogel / Roam
  Depot Render Template, and Jiayuan Zhang / Roam Logbook. Label the port
  unofficial unless the relevant maintainers authorize stronger wording, and
  distinguish code provenance from general inspiration.
- A production bundle license scan and target lockfile/SBOM report. Verify that
  minification preserves required `/*! ... */` banners.
- GitHub release assets for `manifest.json`, `main.js`, `styles.css` (when
  present), `LICENSE`, and `THIRD_PARTY_NOTICES.md`. Obsidian's
  [`Submit your plugin`](https://docs.obsidian.md/plugins/releasing/submit-plugin)
  documentation says the Community installer downloads only `main.js`,
  `manifest.json`, and `styles.css`; it does not download separate notice files.
  Therefore also retain the upstream notice inside a minifier-preserved
  `main.js` banner when copied or ported upstream code is present.
- A source-release link at the exact target tag/commit and a parity report that
  maps each ported upstream test area to target tests.

Obsidian's current
[`Community plugin developer policies`](https://docs.obsidian.md/community-directory/developer-policies)
require a license, compliance with reused-code licenses/attribution, and respect
for Obsidian's trademark policy. These release checks align with that stated
submission requirement; they are not a substitute for project-specific legal
review.

## Unresolved risks and decisions

1. **Contributor/notice completeness.** The repository-level MIT notice names
   Matt Vogel, while the history and credits identify additional authors in the
   derivative chain. The repositories do not explain whether those contributors
   expect added copyright notices. Keep the existing notice and credits; ask
   the upstream maintainers before public release if a more complete notice is
   desired.
2. **Name and implied affiliation.** The upstream license does not discuss the
   `Nautilus Log` name or trademarks. `Nautilus Log for Obsidian` should be
   described as an unofficial port unless permission or endorsement is obtained.
   Obsidian's [brand guidelines](https://obsidian.md/brand) identify its name,
   logo, and app icon as trademarks; do not ship an Obsidian logo-derived plugin
   icon without confirming the permitted use.
3. **Screenshot rights.** Commit history identifies who added the PNG, not who
   owns every visible Roam UI/icon element or whether the image may be reused as
   target marketing material. Excluding it from the target repository/release
   removes that avoidable uncertainty.
4. **YNAB references.** The upstream README says the philosophy is inspired by
   YNAB and disclaims affiliation. If the target repeats YNAB wording or the
   `Give every minute a job` slogan, retain a clear inspiration/non-affiliation
   statement and review the current
   [YNAB terms](https://www.ynab.com/terms) before release. No YNAB marks or
   assets are needed for functional parity.
5. **Roam Logbook lineage.** There is no vendored subtree or declared package
   dependency, and no whole-file copy was found. However, the fixed-source
   comparison found exact drawer/CLOCK syntax and child-query fragments plus
   structurally similar timing helpers. A direct timing port should carry
   Jiayuan Zhang's complete MIT notice alongside the Nautilus notice. The lower
   coupling option is a clean-room reimplementation from compatibility behavior
   and tests, while retaining a clear provenance credit.
6. **Unversioned host libraries.** Roam's React, ChronoNode, Reagent, Datascript,
   and Blueprint versions are not fixed by this repository. They cannot be
   carried into an Obsidian dependency inventory by implication.
7. **Future upstream drift.** This audit covers only `v1.0.2` at `973a041`.
   Reusing later upstream changes requires a new provenance row and license diff
   before porting them.

## Reproduction notes

The inventory and bundle observations were reproduced from a detached checkout
of the fixed commit with Node/npm available:

```sh
git checkout --detach 973a041aa2f59f3b05bf31db8187efbfea07017a
npm ci --ignore-scripts --no-audit --no-fund
npm run build
git ls-tree -r --name-only HEAD
```

The dependency counts come from `package-lock.json` package entries and each
integrity-pinned installed package's own `package.json`. File-header findings
were checked across tracked `src/`, `test/`, documentation, CSS, and build files.
