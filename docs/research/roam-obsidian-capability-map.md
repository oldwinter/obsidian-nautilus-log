# Roam to Obsidian Capability Map

## Question

For every Roam-specific API, data, lifecycle, command, settings, sidebar,
browser, DOM, CSS, and mutation contract in Nautilus Log v1.0.2, what is the
supported Obsidian equivalent, and where is there a real capability gap?

## Scope and evidence

This is a platform capability study, not an architecture decision. The source
baseline is upstream v1.0.2 at commit
[`973a041aa2f59f3b05bf31db8187efbfea07017a`][u-tree]. Current platform evidence
was read on 2026-08-28 from:

- official `obsidian` API typings 1.13.2 at
  [`cc1744324150c632416857c98964f87b1574a5fc`][o-api-package];
- official Obsidian Developer Docs at
  [`c56c7e770ba25dd0ea392aacf4588f9425970d36`][o-docs-tree]; and
- official Obsidian Help at
  [`a3985b585904ddb9f109bd80849b378085308c15`][o-help-tree].

The upstream source and official Obsidian sources are the only evidence used.
An exhaustive source search covered `roamAlphaAPI`, `extensionAPI`, the injected
Roam ClojureScript namespaces, `window` globals, storage, observers, DOM queries,
events, timers, animation frames, and host CSS selectors.

Classification used below:

- **Direct**: a public Obsidian API provides the same user-observable capability.
- **Adapted**: the outcome is supported, but the data or lifecycle contract must
  change.
- **Unsupported**: public Obsidian APIs do not provide the exact host capability.
- **Decision**: multiple supported alternatives change user-visible behavior or
  persistence semantics, so a product decision is required.

## Executive answer

The port is feasible without a hard dependency on another community plugin.
The deterministic scheduling core is host-independent. Obsidian directly
supports a dockable `ItemView`, commands, a ribbon entry, settings persistence,
settings UI, workspace events, notices, Markdown reads, and guarded writes.

The main mismatch is the storage model. Roam gives every block a stable UID,
ordered child relationships, global Datalog queries, and reactive pulls.
Obsidian exposes Markdown files, line/offset positions, cached list metadata,
and file/editor events. It does not assign a stable public identity to every
list item. Obsidian block IDs (`^id`) can provide durable identity, but adding
one changes the user's Markdown and therefore requires an explicit product
decision. [Obsidian documents block IDs and their placement in list
items][o-block-ids]; the API exposes list item positions and optional block IDs,
not Roam-like entities. [The current typings show that contract][o-list-cache].

Three exact Roam host behaviors have no public Obsidian equivalent:

1. reading the built-in Daily Notes plugin's configured folder and date format;
2. injecting a control into Roam's top bar at a particular navigation-button
   position; and
3. opening, deduplicating, reordering, and expanding an arbitrary block as a
   native right-sidebar block window.

Each has supported alternatives, but they are not mechanically equivalent. The
Daily Note resolver, stable Plan Item identity, Execution trigger location, and
right-sidebar behavior must remain explicit downstream decisions.

## Exhaustive upstream call-site map

### Lifecycle, rendering, settings, and persisted runtime state

| Upstream call site and contract | Obsidian public equivalent | Class | Risk or unresolved point |
| --- | --- | --- | --- |
| [`src/index.js:454-486`][u-index-load] receives Roam Depot `onload({ extensionAPI })`, initializes settings, panel, render scaffold, and optional Execution Layer. | `Plugin.onload()`, `loadData()`, `addSettingTab()`, `registerView()`, commands, and ribbon registration are public. [`Plugin` API][o-plugin-api] and the [view guide][o-views] define the lifecycle. | Direct | Do not open a view automatically on every load. The current API offers `onUserEnable()` for first explicit enable, but the chosen command/ribbon workflow can avoid any startup UI side effect. |
| [`src/index.js:489-508`][u-index-unload] calls Execution teardown, updates globals, and intentionally leaves graph scaffold untouched. | `Plugin`/`Component` unload automatically removes registered commands, events, DOM listeners, and intervals; `ItemView.onClose()` owns view resources. [Lifecycle guide][o-lifecycle]. | Adapted | Obsidian plugin data and user Markdown are already separate. Unload must not rewrite Daily Notes or close a running CLOCK unless that policy is separately approved. Official guidance says not to detach custom leaves during `onunload`. [Plugin guidelines][o-plugin-guidelines]. |
| [`src/index.js:455-461`][u-index-load-bridge], [`116-129`][u-index-bridge], and [`190-208`][u-index-timing-flag] publish scheduler functions, settings, status, and CLOCK context through `window.nautilusLogCore` and `window.nautilusLogExtensionData`; [`src/component.cljs:297-316`][u-component-bridge] consumes the core and CLOCK bridges. | Ordinary imported TypeScript modules plus plugin/view-owned state; multiple open views can be found with `Workspace.getLeavesOfType()`. [View guide][o-views]. | Adapted | No global `window` bridge should be needed. State ownership must still handle more than one ItemView instance; Obsidian warns not to retain view-instance references. |
| [`src/index.js:170-209`][u-index-timing-lifecycle] starts runtime, topbar, and commands transactionally and tears down partial startup on failure. | A child `Component` can own the Execution Layer; `addChild()`/`removeChild()` and registered resources give deterministic cleanup. [Component API][o-component-api]. | Direct | Preserve all-or-nothing enablement and failure rollback. |
| [`src/index.js:96-167`][u-index-settings], [`212-246`][u-index-settings-tracking], and [`307-450`][u-index-panel] repeatedly use `extensionAPI.settings.get/set`, create/recreate the settings panel, and migrate defaults. | `Plugin.loadData()`/`saveData()` persist `data.json`; `PluginSettingTab` provides controls. [Settings guide][o-settings]. | Direct | Declarative settings require Obsidian 1.13.0; imperative `display()` supports older versions. This is a minimum-version decision, not a capability gap. |
| [`src/timing-runtime.js:22-77`][u-runtime-persist] and [`114-149`][u-runtime-persist-writes] persist task-bound and standalone POMO state through extension settings. | `loadData()`/`saveData()` can persist the same JSON state. [Plugin API][o-plugin-data]. | Direct | CLOCK records belong in user Markdown; transient POMO state belongs in plugin data. Save only on state transitions, not on the one-second display tick. |
| [`src/timing-runtime.js:26-186`][u-runtime-settings-reads] and [`344-478`][u-runtime-settings-actions], plus [`src/timing-topbar.js:67-137`][u-topbar-settings-reads], [`259-369`][u-topbar-settings-review], and [`581-622`][u-topbar-settings-pomo], read planner, locale, retention, warning, sidebar, and POMO settings during refresh/render/actions. | Load plugin settings into validated in-memory state and notify views/components after `saveData()`. [Settings guide][o-settings]. | Direct | Validate persisted data again at load; official docs warn that UI validation alone is not a data invariant. [Validation guidance][o-settings-validation]. Avoid repeated disk reads during render/ticks. |
| [`src/component.cljs:1357-1368`][u-component-storage] stores per-render-block collapse state in browser `localStorage`, keyed by Roam block UID. | Plugin `data.json` or `ItemView` state can hold vault-scoped/view-scoped UI preferences. | Adapted | There is no Roam block UID key. Decide whether collapse is global, per Daily Note path, or per workspace leaf. Do not use browser-global storage as the canonical vault setting. |
| [`src/index.js:116-129`][u-index-settings-event], [`src/component.cljs:1697-1700,1815-1822`][u-component-cleanup], and [`src/timing-topbar.js:711-734`][u-topbar-cleanup] broadcast and consume a custom `window` settings event. | Update plugin-owned state and notify existing ItemViews; Obsidian `Events`/registered callbacks can be owned by a `Component`. Registered resources are cleaned automatically. [Lifecycle guide][o-lifecycle]. | Adapted | The replacement must update every open view and stop emitting after unload. |
| [`webpack.config.js:2-29`][u-webpack] declares Roam `window.React` and `window.ChronoNode` externals, loads ClojureScript as text, and emits Depot's ESM output. | An Obsidian plugin ships bundled `main.js`; `styles.css` and `manifest.json` are release assets. [Submission guide][o-submit]. | Adapted | Do not depend on undocumented host globals. Portable scheduling code can be bundled; the Roam ClojureScript renderer must be rewritten for the ItemView. |

### Graph reads, reactive data, and Plan Item projection

| Upstream call site and contract | Obsidian public equivalent | Class | Risk or unresolved point |
| --- | --- | --- | --- |
| [`src/entry-helpers.js:44-46`][u-entry-api] and [`src/timing-roam.js:57-59`][u-timing-api] retrieve `window.roamAlphaAPI`. | `Plugin.app` exposes `vault`, `metadataCache`, and `workspace`; official guidelines require using this reference rather than a global app. [Plugin guidelines][o-plugin-guidelines]. | Direct | All host access should flow from the plugin/view instance. |
| [`src/timing-roam.js:138-158`][u-timing-query] selects `data.fast.q`, root `q`, or `data.q` and normalizes Datalog results. | There is no public graph-query engine. Resolve one Daily Note file, use `MetadataCache.getFileCache()`, and read its Markdown with `Vault.cachedRead()` for display. [Metadata API][o-metadata-api] [Vault guide][o-vault-guide]. | Adapted | A global LOGBOOK query requires scanning/indexing candidate Markdown files. Limit the read scope or maintain a derived cache; do not invent a second task database. |
| [`src/component.cljs:4-6`][u-component-ns] imports Roam-only `roam.datascript`, `roam.block`, and `roam.datascript.reactive`. | `Vault`, `MetadataCache`, `Editor`, workspace events, and `Component` replace these host modules. [Vault API][o-vault-api] [Metadata API][o-metadata-api] [Editor API][o-editor-api] [Component API][o-component-api]. | Adapted | None of these ClojureScript namespaces are portable. |
| [`src/component.cljs:337-344`][u-component-reactive-children], [`1332-1335`][u-component-reactive], and [`1723-1737`][u-component-root-children] use reactive pulls for ordered direct children plus referenced strings. | `CachedMetadata.listItems` provides list positions, task state, parent line, and optional block ID; raw Markdown supplies exact text. `metadataCache.changed`, vault events, and `workspace.editor-change` can invalidate the view. [Cached metadata][o-cached-metadata] [metadata events][o-metadata-api] [workspace events][o-workspace-events]. | Adapted | Metadata may lag unsaved editor text. A view that reflects the active file must consume editor-change data or the active Editor, then reconcile after indexing. |
| [`src/component.cljs:346-379`][u-component-queries] queries page title, owning page, and block string by UID. | A Plan Item can be located by `TFile.path` plus a current Markdown range. `Vault.getFileByPath()`/`getAbstractFileByPath()` resolve files; `Editor` exposes line, offset, and range methods. [Vault API][o-vault-api] [Editor API][o-editor-api]. | Adapted | File path plus line is not durable when surrounding text changes. Stable identity is a separate decision. |
| [`src/component.cljs:120-124`][u-component-refs] replaces one level of Roam `((uid))` references with referenced block strings. | Obsidian supports links to `[[file#^block-id]]`; `MetadataCache` resolves links, while exact target text still requires reading the target file. [Block link help][o-block-ids] [Metadata API][o-metadata-api]. | Decision | Decide whether Plan Item parsing expands block links, embeds, aliases, or none. Cross-file expansion adds I/O and cycle/error cases and is not required for basic Markdown parity. |
| [`src/timing-roam.js:19-29,185-224`][u-primary-plan-query] uses a Daily Note title to retrieve its entire Roam block tree and select the first Primary Plan in tree order. | Read one resolved Daily Note Markdown file and reconstruct list hierarchy from list-item positions/parents plus source lines. [List metadata contract][o-list-cache]. | Adapted | Markdown has headings and lists rather than one page block tree. Eligibility boundary and Primary Plan marker are product decisions. |
| [`src/timing-roam.js:31-55,227-255`][u-entry-queries] globally queries `task -> LOGBOOK drawer -> CLOCK`, or filters by task UIDs. | Parse LOGBOOK/CLOCK syntax from Markdown. The current Daily Note can be read directly; cross-note history requires candidate-file discovery or a derived index based on vault/metadata events. [Vault guide][o-vault-guide] [metadata events][o-metadata-api]. | Adapted | There is no indexed parent-child entity join. Bound the scan, tolerate malformed Markdown, and never hide unparseable records. |
| [`src/timing-roam.js:257-273`][u-read-block] pulls a single block string by UID with a Datalog fallback. | Active note: `Editor.getLine/getRange`; background note: `Vault.read()` before a planned write or `cachedRead()` for display. [Editor API][o-editor-api] [Vault guide][o-vault-guide]. | Adapted | Requires a validated file/range/identity. A stale line number must fail closed, not update a different list item. |
| [`src/timing-roam.js:283-296`][u-read-children] reads ordered direct children by UID. | Use Markdown indentation and `ListItemCache.parent` to reconstruct list hierarchy and source order. [List metadata contract][o-list-cache]. | Adapted | Cache positions are a parsing aid, not an immutable identity. Preserve source order exactly. |
| [`src/component.cljs:1686,1722-1737`][u-component-root] receives the `roam/render` block UID and treats that block's direct children as planning input. | The dedicated ItemView can bind to a resolved Daily Note file and an explicitly defined eligible Markdown region. [ItemView API][o-itemview-api]. | Decision | The source file and eligible region must be specified. An ItemView has no intrinsic parent list item equivalent. |
| [`src/timing-core.js:192-224`][u-primary-plan-select] treats the first recognized renderer in tree order as the Primary Plan. | Search the resolved Daily Note for a canonical marker/section and choose deterministically. | Decision | Exact marker grammar and duplicate handling belong in the Markdown data-contract ticket. |

### Writes and write confirmation

| Upstream call site and contract | Obsidian public equivalent | Class | Risk or unresolved point |
| --- | --- | --- | --- |
| [`src/entry-helpers.js:48-105,116-166`][u-entry-scaffold] creates/repairs a `roam/render` page, title block, template block, renderer invocation, code header, and ClojureScript source block. | Register and open a custom ItemView; Obsidian loads plugin code from `main.js`, not user notes. [View guide][o-views] [Submission guide][o-submit]. | Adapted | Do not port these graph writes. There is no need to place executable plugin source or render scaffolding in a Daily Note. |
| [`src/entry-helpers.js:168-186`][u-entry-template-update] queries and rewrites every matching renderer invocation when settings change. | Persist settings in plugin data and refresh open ItemViews. [Settings guide][o-settings]. | Adapted | Settings changes must not rewrite Daily Notes. The upstream prefix/render-argument behavior has no meaning in a dedicated view unless separately specified. |
| [`src/component.cljs:478-510`][u-component-progress], its reactive [`666` call site][u-component-progress-done-call], and click [`844,864` call sites][u-component-progress-clicks] directly update task progress/TODO/DONE text and remove stale progress on DONE items. | For the active note, use an explicit Editor transaction/range replacement. For a background note, use `Vault.process()`. Official guidelines require Editor for active files and atomic `Vault.process` for background writes. [Write guidelines][o-write-guidelines]. | Adapted | The upstream reactive cleanup performs a write without a direct click. That conflicts with the standing requirement that planning is read-only and all vault writes require explicit user action. Do not port automatic cleanup. |
| [`src/timing-roam.js:160-170`][u-timing-mutation-resolution] resolves create/update/delete APIs and generates UIDs; [`298-319`][u-graph-mutations] performs and confirms mutations. | Insert/replace/remove Markdown ranges through Editor or atomic `Vault.process`; use a generated Obsidian block ID only if the identity decision authorizes it. | Adapted | `Vault.delete()` deletes a file and is not the equivalent of removing a LOGBOOK line. Every mutation must revalidate the exact Markdown target. |
| [`src/timing-roam.js:321-351`][u-clock-create] creates a `LOGBOOK::` child and a running CLOCK child at order 0, then parses the new block to confirm it. | Explicitly insert LOGBOOK/CLOCK Markdown under the selected list item, then parse the written result. | Decision | Markdown nesting shape, indentation, block IDs, and insertion order are part of the data contract. `Vault.process()` is atomic but only accepts a synchronous transform. [Vault API][o-vault-process]. |
| [`src/timing-roam.js:354-370`][u-clock-close] re-reads the exact running CLOCK UID, closes it, and re-reads to confirm. | Re-read/revalidate the selected CLOCK line inside Editor or the `Vault.process()` callback, replace only if it still represents the same open CLOCK, then parse the returned/written content. | Adapted | This safety invariant is mandatory. File/range alone cannot prove identity after edits; a stable ID or content fingerprint policy is needed. |
| [`src/timing-roam.js:372-386`][u-clock-delete-complete] deletes only the current running CLOCK and rewrites TODO to DONE, both with confirmation. | Remove/replace the exact Markdown range after explicit user confirmation; use active Editor or background `Vault.process`. | Adapted | The current task syntax may be standard `- [ ]` or an optionally recognized variant. Preserve all unrelated text and third-party metadata. |
| [`src/timing-runtime.js:304-341,344-422`][u-runtime-mutations] serializes overlap repair, Clock In/Out, completion, and delete operations. | An internal promise queue can serialize explicit mutations; vault/editor events trigger authoritative refreshes. | Direct | Retain the queue and revalidation. Automatic legacy-overlap repair is a write and therefore requires explicit approval in the Obsidian product. |

### Daily Note resolution and identity

| Upstream call site and contract | Obsidian public equivalent | Class | Risk or unresolved point |
| --- | --- | --- | --- |
| [`src/component.cljs:365-369`][u-daily-component] and [`src/timing-roam.js:172-187`][u-daily-timing] call `util.dateToPageTitle()` to identify today's page. | The core Daily Notes plugin defaults to `YYYY-MM-DD`, but users can configure both folder and Moment date format. [Official Daily Notes help][o-daily-notes]. The public API can resolve a computed normalized path through `Vault.getFileByPath()`. | Decision | An exact-symbol search of the current public [`obsidian.d.ts`][o-api-file] found no `DailyNote`/`dailyNote` configuration API. A zero-dependency port must own settings for folder/format or define another deterministic resolution rule. Never assume the default filename. |
| [`src/index.js:76-93`][u-page-title-date] calls `util.pageTitleToDate()` and derives local day bounds for CLOCK clipping. | Once a file has been resolved as a Daily Note, parse its date using the same configured format and local timezone. Obsidian exports Moment, but the resolver still needs the format. | Decision | File basename alone is ambiguous when custom formats omit year/month or use folders. Store/derive the logical date explicitly. |
| Roam reads and writes identify entities by immutable `:block/uid`, including [plan projection][u-primary-plan-query], [single-block reads][u-read-block], and [mutations][u-graph-mutations]. | Obsidian list metadata supplies mutable positions and optional explicit block IDs. A list line can carry `^id`; official help documents this syntax. [Block IDs][o-block-ids] [List metadata][o-list-cache]. | Decision | Options include explicit `^id`, file+range plus content fingerprint, or a plugin-owned mapping. The last option risks becoming a second hidden task database. This decision gates safe CLOCK persistence. |

### Commands, menus, workspace, sidebar, and notices

| Upstream call site and contract | Obsidian public equivalent | Class | Risk or unresolved point |
| --- | --- | --- | --- |
| [`src/timing-commands.js:43-57,74-80`][u-commands-palette] adds/removes three command-palette commands and deliberately omits default hotkeys. | `Plugin.addCommand()` registers commands and automatically scopes IDs; use `checkCallback`/`editorCheckCallback` for conditional availability. [Command guide][o-commands]. | Direct | Keep no default hotkeys. Obsidian's review guidance agrees. |
| [`src/timing-commands.js:47,59-69,81-84`][u-commands-context] adds conditional block context-menu commands. | Register `workspace.on('editor-menu')`, inspect Editor cursor/current line, and add `MenuItem`s; register the event for cleanup. [Workspace events][o-workspace-events] [Menu API][o-menu-notice]. | Adapted | Obsidian provides editor context, not a stable block UID/string pair. Re-evaluate eligibility when the item is clicked. Reading-mode list-item menus have no equivalent event in the public contract. |
| [`src/timing-roam.js:275-281`][u-focused-block] calls `ui.getFocusedBlock()` for a block UID. | `editorCallback` supplies the active Editor; `getCursor()` and `getLine()` locate the current Markdown line. [Command guide][o-commands] [Editor API][o-editor-api]. | Adapted | Cursor line is not durable identity. The command must fail closed if the line changes before the write. |
| [`src/timing-roam.js:389-407`][u-open-main] opens a block in the main window. [`src/timing-roam.js:394-399`][u-locate-dom] then queries `[data-uid]`, scrolls, and highlights it. | `Workspace.openLinkText()`/`WorkspaceLeaf.openFile()` can open a file or `#^block-id`; Editor can `scrollIntoView()` a known range. [Workspace API][o-workspace-api] [Editor API][o-editor-api]. | Adapted | Exact navigation requires a durable block ID or a validated range. Querying private editor DOM is not an acceptable fallback. |
| [`src/timing-roam.js:114-136`][u-right-sidebar-queue] and [`414-595`][u-right-sidebar] read native block windows, open the right sidebar, deduplicate a task window, move it to order 0, expand it, and serialize rapid intents. | `getRightLeaf()` or `ensureSideLeaf()` can create/reveal a right-sidebar leaf; `setViewState()` can load either a custom view or Markdown file. [Views guide][o-views] [Workspace API][o-workspace-api]. | Decision | Obsidian has no public native block-window stack or window-order API. Options are a dedicated Active Task view, a Markdown leaf opened at a block link, or keeping the task inside the main planner ItemView. None exactly matches Roam. |
| [`src/timing-roam.js:608-614`][u-toast] calls Roam `renderToast` and falls back to console. | `new Notice(message, duration)` is the public notification component. [Notice API][o-menu-notice]. | Direct | Map warning/danger visual intent through copy and duration; `Notice` has no severity argument. |
| [`src/index.js:249-450`][u-index-panel] exposes planner and Execution settings, including conditional Execution rows. | `PluginSettingTab` supports controls and conditional visibility. Current declarative settings are 1.13.0+; legacy imperative settings remain supported. [Settings guide][o-settings]. | Direct | Manifest minimum version determines which settings API is allowed. |

### DOM, browser scheduling, topbar, rendering context, and CSS

| Upstream call site and contract | Obsidian public equivalent | Class | Risk or unresolved point |
| --- | --- | --- | --- |
| [`src/entry-helpers.js:5-42`][u-entry-dom-context] identifies breadcrumb duplicates and right-sidebar renders through Roam-private selectors; [`extension.css:72-87`][u-css-breadcrumb] repeats suppression in CSS. | A dedicated ItemView has an explicit leaf and does not render duplicate inline ancestors. Workspace APIs expose the leaf placement. [Views guide][o-views]. | Adapted | Remove all Roam selectors. If multiple ItemViews are allowed, handle them through view state rather than DOM ancestry guesses. |
| [`src/component.cljs:1638-1684`][u-component-resize] probes host context and uses `ResizeObserver` for compact rendering. | Keep `ResizeObserver` scoped to `ItemView.contentEl`, or use the workspace `resize` event. Register/disconnect it with view lifecycle. [Workspace events][o-workspace-events] [Lifecycle guide][o-lifecycle]. | Direct | Narrow desktop sidebars still require compact layout even though mobile is out of scope. |
| [`src/component.cljs:32-61`][u-component-mobile] reads `roamAlphaAPI.platform.isMobile` once, while [`1686-1756`][u-component-render-dimensions] chooses mobile dimensions/fonts. | `manifest.json.isDesktopOnly` declares platform boundary; responsive CSS/container queries can still handle narrow desktop panes. [Manifest][o-manifest]. | Adapted | If the first release is intentionally desktop-only, mobile behavior should not silently load a partial UI. |
| [`src/timing-topbar.js:29-45`][u-topbar-anchor] and [`647-709`][u-topbar-host] locate `.rm-topbar`, heuristically insert after navigation, and use nested `MutationObserver`s to recover after host rerenders. | Public alternatives are `addStatusBarItem()`, ribbon icons, `ItemView.addAction()`, or controls inside the ItemView. [Plugin API][o-plugin-api] [ItemView API][o-itemview-api]. | Unsupported | There is no public topbar insertion slot. Do not query Obsidian private DOM to simulate one. Trigger placement is a product decision. |
| [`src/timing-topbar.js:13-16`][u-topbar-icon] relies on Blueprint `bp3-icon-*` font classes. | Obsidian accepts Lucide icon names through `addRibbonIcon`, `ItemView.addAction`, and `MenuItem.setIcon`. [Plugin API][o-plugin-api] [Menu API][o-menu-notice]. | Direct | Replace Blueprint classes; do not ship copied Blueprint glyph plumbing. |
| [`src/timing-topbar.js:86-100`][u-topbar-popover-listeners] and [`520-572`][u-topbar-popover] append a fixed popover to `document.body`, position it from viewport geometry, and register capture listeners for outside click/Escape. | A view-owned DOM surface is direct. If a body-level floating surface is retained, its DOM listeners and node must be owned and removed by a `Component`; Obsidian also exposes `Modal` for modal interactions. [Lifecycle guide][o-lifecycle]. | Adapted | Exact topbar-anchored geometry disappears if the trigger moves. Avoid undocumented host containers. |
| [`src/component.cljs:470-476`][u-component-portal] uses the host `window.ReactDOM.createPortal()` to render a body-level tooltip. | Render ordinary DOM inside the ItemView or create a view-owned body portal and register teardown. [Lifecycle guide][o-lifecycle]. | Adapted | Do not depend on Obsidian's internal React or globals. Tooltip placement must remain accessible and theme-safe. |
| [`src/timing-topbar.js:7-45`][u-topbar-owned-dom], [`119-190`][u-topbar-owned-dom-header], [`311-426`][u-topbar-owned-dom-review], and [`488-640`][u-topbar-owned-dom-trigger] create plugin-owned controls, query inside those controls, and bind click handlers; [`531-544`][u-topbar-style-probe] also globally queries Nautilus elements to copy font style. | Normal DOM helpers/DOM APIs inside `ItemView.contentEl` are supported; element-owned listeners die with their nodes, while long-lived listeners must be registered. [Lifecycle guide][o-lifecycle]. | Adapted | Scope queries to the owning view. Do not use a global first-match query when multiple planner leaves may exist. |
| [`src/timing-roam.js:603-605`][u-legacy-logbook] detects another Roam extension through DOM selectors and `window` globals, then blocks timing startup. | An exact-symbol audit of the public [`obsidian.d.ts`][o-api-file] found no API to introspect arbitrary community-plugin runtime state. A parser can detect overlapping open CLOCK records in Markdown. | Unsupported | Exact competing-writer detection is impossible without a declared integration. With no hard dependency, fail open for plugin presence but fail closed on ambiguous/multiple running CLOCK data. |
| [`src/component.cljs:1385-1403`][u-component-raf] runs playback with `requestAnimationFrame` and [`1815-1822`][u-component-raf-cleanup] cancels it on unmount. [`src/timing-runtime.js:214-253`][u-runtime-scheduling] uses idle callback/timeout and [`442-505`][u-runtime-teardown] runs and clears a one-second interval plus all pending handles. | Browser timers/RAF remain available; `Component.registerInterval()` and `register()` provide automatic cleanup. [Component API][o-component-api]. | Direct | `requestIdleCallback` still needs a fallback and explicit cancellation registration. No timer may survive view/plugin unload. |
| [`src/log-core.js:949-960`][u-log-canvas] measures text with an offscreen canvas and has a non-DOM fallback. | Canvas 2D measurement is available in the desktop renderer and is independent of Obsidian private APIs. | Direct | Keep the tested fallback for unit tests and non-rendering environments. Cache only the context, not theme-dependent measurements across CSS changes. |
| [`src/timing-topbar.js:677-742`][u-topbar-cleanup] removes observers, global listeners, RAF/timeouts, subscription, popover, and injected container. | `Component` and `ItemView.onClose()` provide matching ownership. [Lifecycle guide][o-lifecycle]. | Direct | Teardown tests should prove no duplicate controls/listeners after enable-disable-enable. |
| [`extension.css:4-47`][u-css-theme], [`601-607`][u-css-dark-selectors], and [`1371-1407`][u-css-exec-dark] define a palette under `:root` and Roam/Blueprint dark-theme selectors. Blueprint icon overrides appear at [`964-966`][u-css-blueprint], [`1028-1033`][u-css-blueprint-complete], and [`1260-1263`][u-css-blueprint-plan]. | Scope styles under the plugin view and derive values from Obsidian CSS variables; official guidelines require classes and theme variables instead of hardcoded inline styling. [CSS guidance][o-css-guidance]. | Adapted | Remove `.bp3-*`, `.roam-*`, and private host selectors. Preserve light/dark observable contrast using Obsidian variables, with plugin-local fallback variables only where no host token exists. |

## Optional Tasks and Dataview syntax recognition

No Tasks or Dataview API is required to implement fail-open recognition:

1. `Vault.cachedRead()` provides the full Markdown source for display.
2. `CachedMetadata.listItems` provides standard Markdown task state, list
   hierarchy, source positions, and optional block IDs. [The official
   interface][o-list-cache] explicitly describes those fields.
3. A pure parser may recognize additional tokens in a line when present.
4. Unknown or malformed third-party syntax must remain ordinary Markdown text;
   the plugin must not reject the note, hide the Plan Item, or strip metadata.
5. Writes must preserve all unowned suffixes/fields byte-for-byte. No API import,
   runtime plugin lookup, or network request is needed.

This capability is **adapted**, not direct: Obsidian's metadata cache does not
define third-party semantics. Exactly which Tasks/Dataview tokens count as
duration, date, status, or metadata is a separate grammar decision. A missing
third-party plugin must not change Nautilus parsing or writing behavior.

## Write-safety constraints derived from the platform

These are platform invariants, not a final storage design:

1. The visual plan performs no writes.
2. A write begins only from an explicit command or control action.
3. For the active file, use the supplied `Editor` and one transaction/range
   replacement so cursor, selection, folds, and undo history remain coherent.
   Official review guidance explicitly prefers Editor over `Vault.modify()` for
   active notes. [Write guidelines][o-write-guidelines].
4. For a background file, use `Vault.process()`, which atomically reads,
   transforms, and saves and is available since Obsidian 1.1.0. [Vault
   API][o-vault-process].
5. Inside the transform, revalidate the task/CLOCK identity and expected current
   text. If validation fails, make no change and show a `Notice`.
6. Serialize Clock In, Clock Out, complete, delete, and overlap-repair intents.
7. Reparse the resulting text to confirm the requested state before updating the
   UI.
8. Never use a cached line number as sole mutation authority.
9. Never remove unknown task suffixes, Dataview fields, tags, block IDs, or
   indentation while updating an owned token.
10. Subscribe through `registerEvent()` to metadata/vault/workspace events and
    register every timer/DOM listener for cleanup. [Lifecycle guide][o-lifecycle].

The unresolved stable-identity decision is the largest write-safety blocker.
Roam's UID makes a targeted re-read unambiguous. Obsidian can reach equivalent
safety only by using explicit block IDs or by defining a conservative validation
and conflict policy for mutable Markdown positions.

## API stability and minimum-version implications

The official 1.13.2 typings attach the following version floors:

| Capability | Introduced | Consequence |
| --- | ---: | --- |
| `ItemView`, `registerView`, commands, settings tab, basic Vault/events | 0.9.7 | Core planner shell has a very old floor. [Plugin API][o-plugin-api] [ItemView API][o-itemview-api] [Vault API][o-vault-api] |
| `Editor` range operations and `Vault.getAbstractFileByPath` | 0.11.11 | Sufficient for active-line reads and portable path lookup. [Editor API][o-editor-api] [Vault API][o-vault-api] |
| `Vault.process`, `editor-menu`, `ItemView.addAction` | 1.1.0 | Atomic background writes and editor context commands make 1.1.0 the practical safety floor. [Vault process][o-vault-process] [Workspace events][o-workspace-events] [ItemView API][o-itemview-api] |
| `getFileByPath` | 1.5.7 | Can be avoided by using `getAbstractFileByPath` plus `instanceof TFile`. [Vault API][o-vault-api] |
| `ensureSideLeaf`, awaited `revealLeaf`, `removeCommand`, `onUserEnable` | 1.7.2 | Using current sidebar convenience/lifecycle APIs raises the floor to 1.7.2. [Workspace API][o-workspace-api] [Plugin API][o-plugin-api] |
| Declarative `PluginSettingTab.getSettingDefinitions()` and typed `Plugin.settings` | 1.13.0 | Choosing the current declarative settings API raises the floor to 1.13.0. [Settings guide][o-settings] |

Supported choices therefore include an imperative-settings build at a lower
floor, a 1.7.2+ build using current sidebar helpers, or a 1.13.0+ build using
declarative settings. The manifest must state the actual minimum and
`versions.json` must change when that minimum changes. [Versioning guide][o-versions].
This research does not select one.

## Community Plugins requirements that affect parity

- `manifest.json` requires `id`, `name`, `version`, `minAppVersion`,
  `description`, and `isDesktopOnly`. `nautilus-log` satisfies the ID character
  rule. [Manifest reference][o-manifest].
- The current planned display name "Nautilus Log for Obsidian" conflicts with
  the official manifest naming rule that plugin names must not contain the word
  "Obsidian". The Community directory name should be "Nautilus Log"; the README
  may still explain that it is the Obsidian port. This is a required product
  correction, not an implementation preference. [Manifest naming
  rules][o-manifest].
- Set `minAppVersion` to the lowest version actually supported; if unknown, the
  requirement says to use the latest stable build. [Submission
  requirements][o-submission-requirements].
- `isDesktopOnly` is required. Node/Electron use forces `true`, but this port
  needs neither Node nor Electron for the mapped capabilities. The product's
  desktop-only first-release boundary still needs to be reflected consistently
  in manifest and tests. [Submission requirements][o-submission-requirements].
- Community release assets are `main.js`, `manifest.json`, and optional
  `styles.css`; README, LICENSE, and manifest must exist at repository root.
  [Submission guide][o-submit].
- Client-side telemetry, self-install/update behavior, and undisclosed network
  use are prohibited. The local-only product boundary aligns with these
  policies. [Developer policies][o-developer-policies].
- A LICENSE is required, and reused upstream MIT code must preserve applicable
  license and attribution. [Developer policies][o-developer-policies].
- CSS must be scoped and use Obsidian variables. Inline/hardcoded user-facing
  styles and private host selectors create review and theme risks. [Plugin
  guidelines][o-css-guidance].

## Capability gaps and downstream decisions

The following questions remain genuinely unresolved by platform research:

1. **Daily Note resolution:** plugin-owned folder/date-format settings, an
   explicit file binding, or another deterministic resolver.
2. **Plan Item identity:** explicit Obsidian block IDs versus a conservative
   file/range/fingerprint scheme. A hidden identity database would violate the
   canonical-Markdown boundary unless narrowly justified.
3. **Eligible planning region:** whole note, one heading, one marked list, or
   another source rule that replaces the Roam renderer's child boundary.
4. **LOGBOOK Markdown shape:** indentation, insertion point, stable IDs, and how
   to preserve third-party suffix fields.
5. **Execution trigger placement:** status bar, ribbon, ItemView action, or
   in-view header. Exact Roam topbar placement is unsupported.
6. **Active Task sidebar behavior:** dedicated Active Task view, Markdown leaf at
   a block link, or state inside the planner view. Exact Roam block-window order
   is unsupported.
7. **Cross-note history scope:** today's note only, configured Daily Note files,
   or a derived cache over the vault. There is no Datalog index.
8. **External CLOCK writers:** fail closed on ambiguous data without trying to
   inspect another plugin's private runtime.
9. **Minimum Obsidian version:** 1.1.0, 1.7.2, or 1.13.0 depending on selected
   settings/sidebar APIs.
10. **Community display name:** use manifest name "Nautilus Log" to satisfy the
    current rule while retaining "for Obsidian" only in descriptive prose.

## Conclusion

There is no platform blocker to an Obsidian-native planner and Execution Layer.
The host-independent scheduler can be reused or ported, while `ItemView`, Vault,
MetadataCache, Editor, Workspace, commands, settings, and Notice cover the main
user workflows. The non-negotiable adaptation is from stable graph blocks to
mutable Markdown. The project should not begin write-capable implementation
until Daily Note resolution, Plan Item identity, eligible region, and LOGBOOK
shape are decided together; otherwise the port can look correct while writing
to the wrong line after an ordinary edit.

[u-tree]: https://github.com/404KSG/roam-nautilus-log/tree/973a041aa2f59f3b05bf31db8187efbfea07017a
[u-index-load]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L454-L486
[u-index-unload]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L489-L508
[u-index-bridge]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L116-L129
[u-index-load-bridge]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L454-L461
[u-index-timing-flag]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L190-L208
[u-index-timing-lifecycle]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L170-L209
[u-index-settings]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L96-L167
[u-index-settings-tracking]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L212-L246
[u-index-settings-event]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L116-L129
[u-index-panel]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L249-L450
[u-page-title-date]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/index.js#L76-L93
[u-runtime-persist]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L22-L77
[u-runtime-persist-writes]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L114-L149
[u-runtime-settings-reads]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L26-L186
[u-runtime-settings-actions]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L344-L478
[u-runtime-mutations]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L304-L422
[u-runtime-scheduling]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L214-L253
[u-runtime-teardown]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-runtime.js#L442-L505
[u-entry-api]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/entry-helpers.js#L44-L105
[u-entry-scaffold]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/entry-helpers.js#L48-L166
[u-entry-template-update]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/entry-helpers.js#L168-L186
[u-entry-dom-context]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/entry-helpers.js#L5-L42
[u-timing-api]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L57-L59
[u-timing-query]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L138-L170
[u-timing-mutation-resolution]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L160-L170
[u-primary-plan-query]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L19-L224
[u-entry-queries]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L31-L255
[u-read-block]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L257-L273
[u-read-children]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L283-L296
[u-graph-mutations]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L298-L319
[u-clock-create]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L321-L351
[u-clock-close]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L354-L370
[u-clock-delete-complete]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L372-L386
[u-daily-timing]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L168-L224
[u-focused-block]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L275-L281
[u-open-main]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L389-L407
[u-locate-dom]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L394-L399
[u-right-sidebar]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L414-L595
[u-right-sidebar-queue]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L114-L136
[u-legacy-logbook]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L603-L605
[u-toast]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-roam.js#L608-L614
[u-commands-palette]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-commands.js#L43-L80
[u-commands-context]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-commands.js#L47-L84
[u-component-ns]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1-L6
[u-component-bridge]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L297-L316
[u-component-refs]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L118-L124
[u-component-queries]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L332-L379
[u-daily-component]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L365-L369
[u-component-progress]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L478-L510
[u-component-progress-done-call]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L655-L666
[u-component-progress-clicks]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L837-L865
[u-component-storage]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1357-L1368
[u-component-raf]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1385-L1403
[u-component-raf-cleanup]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1815-L1822
[u-component-portal]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L468-L476
[u-component-resize]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1638-L1684
[u-component-root]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1686-L1737
[u-component-root-children]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1723-L1737
[u-component-mobile]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L32-L61
[u-component-render-dimensions]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1686-L1756
[u-component-reactive]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1332-L1335
[u-component-reactive-children]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L337-L344
[u-component-cleanup]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/component.cljs#L1691-L1822
[u-primary-plan-select]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-core.js#L192-L224
[u-topbar-host]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L647-L709
[u-topbar-settings-reads]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L67-L137
[u-topbar-settings-review]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L259-L369
[u-topbar-settings-pomo]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L581-L622
[u-topbar-anchor]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L29-L45
[u-topbar-icon]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L13-L16
[u-topbar-popover]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L520-L572
[u-topbar-popover-listeners]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L86-L100
[u-topbar-owned-dom]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L7-L45
[u-topbar-owned-dom-header]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L119-L190
[u-topbar-owned-dom-review]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L311-L426
[u-topbar-owned-dom-trigger]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L488-L640
[u-topbar-style-probe]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L531-L544
[u-topbar-cleanup]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/timing-topbar.js#L677-L742
[u-log-canvas]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/src/log-core.js#L949-L960
[u-css-theme]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L4-L47
[u-css-dark-selectors]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L601-L607
[u-css-exec-dark]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L1371-L1407
[u-css-breadcrumb]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L72-L87
[u-css-blueprint]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L964-L966
[u-css-blueprint-complete]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L1028-L1033
[u-css-blueprint-plan]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/extension.css#L1260-L1263
[u-webpack]: https://github.com/404KSG/roam-nautilus-log/blob/973a041aa2f59f3b05bf31db8187efbfea07017a/webpack.config.js#L1-L29

[o-api-package]: https://github.com/obsidianmd/obsidian-api/blob/cc1744324150c632416857c98964f87b1574a5fc/package.json#L1-L18
[o-api-file]: https://github.com/obsidianmd/obsidian-api/blob/cc1744324150c632416857c98964f87b1574a5fc/obsidian.d.ts
[o-docs-tree]: https://github.com/obsidianmd/obsidian-developer-docs/tree/c56c7e770ba25dd0ea392aacf4588f9425970d36
[o-help-tree]: https://github.com/obsidianmd/obsidian-help/tree/a3985b585904ddb9f109bd80849b378085308c15
[o-plugin-api]: https://github.com/obsidianmd/obsidian-api/blob/cc1744324150c632416857c98964f87b1574a5fc/obsidian.d.ts#L4897-L4974
[o-plugin-data]: https://github.com/obsidianmd/obsidian-api/blob/cc1744324150c632416857c98964f87b1574a5fc/obsidian.d.ts#L5050-L5064
[o-component-api]: https://github.com/obsidianmd/obsidian-api/blob/cc1744324150c632416857c98964f87b1574a5fc/obsidian.d.ts#L1835-L1912
[o-itemview-api]: https://github.com/obsidianmd/obsidian-api/blob/cc1744324150c632416857c98964f87b1574a5fc/obsidian.d.ts#L3586-L3605
[o-cached-metadata]: https://github.com/obsidianmd/obsidian-api/blob/cc1744324150c632416857c98964f87b1574a5fc/obsidian.d.ts#L1402-L1463
[o-list-cache]: https://github.com/obsidianmd/obsidian-api/blob/cc1744324150c632416857c98964f87b1574a5fc/obsidian.d.ts#L3743-L3770
[o-metadata-api]: https://github.com/obsidianmd/obsidian-api/blob/cc1744324150c632416857c98964f87b1574a5fc/obsidian.d.ts#L4404-L4471
[o-editor-api]: https://github.com/obsidianmd/obsidian-api/blob/cc1744324150c632416857c98964f87b1574a5fc/obsidian.d.ts#L2398-L2577
[o-vault-api]: https://github.com/obsidianmd/obsidian-api/blob/cc1744324150c632416857c98964f87b1574a5fc/obsidian.d.ts#L7331-L7436
[o-vault-process]: https://github.com/obsidianmd/obsidian-api/blob/cc1744324150c632416857c98964f87b1574a5fc/obsidian.d.ts#L7476-L7526
[o-workspace-api]: https://github.com/obsidianmd/obsidian-api/blob/cc1744324150c632416857c98964f87b1574a5fc/obsidian.d.ts#L7890-L8045
[o-workspace-events]: https://github.com/obsidianmd/obsidian-api/blob/cc1744324150c632416857c98964f87b1574a5fc/obsidian.d.ts#L8068-L8150
[o-menu-notice]: https://github.com/obsidianmd/obsidian-api/blob/cc1744324150c632416857c98964f87b1574a5fc/obsidian.d.ts#L4242-L4330
[o-views]: https://github.com/obsidianmd/obsidian-developer-docs/blob/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Plugins/User%20interface/Views.md#L1-L99
[o-lifecycle]: https://github.com/obsidianmd/obsidian-developer-docs/blob/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Plugins/Guides/Manage%20plugin%20lifecycle.md#L60-L115
[o-settings]: https://github.com/obsidianmd/obsidian-developer-docs/blob/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Plugins/User%20interface/Settings.md#L1-L148
[o-settings-validation]: https://github.com/obsidianmd/obsidian-developer-docs/blob/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Plugins/User%20interface/Settings.md#L284-L303
[o-vault-guide]: https://github.com/obsidianmd/obsidian-developer-docs/blob/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Plugins/Vault.md#L23-L94
[o-commands]: https://github.com/obsidianmd/obsidian-developer-docs/blob/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Plugins/User%20interface/Commands.md#L1-L123
[o-plugin-guidelines]: https://github.com/obsidianmd/obsidian-developer-docs/blob/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Plugins/Releasing/Plugin%20guidelines.md#L96-L189
[o-write-guidelines]: https://github.com/obsidianmd/obsidian-developer-docs/blob/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Plugins/Releasing/Plugin%20guidelines.md#L192-L226
[o-css-guidance]: https://github.com/obsidianmd/obsidian-developer-docs/blob/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Plugins/Releasing/Plugin%20guidelines.md#L309-L339
[o-submission-requirements]: https://github.com/obsidianmd/obsidian-developer-docs/blob/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Community%20directory/Submission%20requirements%20for%20plugins.md#L17-L62
[o-developer-policies]: https://github.com/obsidianmd/obsidian-developer-docs/blob/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Community%20directory/Developer%20policies.md#L9-L61
[o-submit]: https://github.com/obsidianmd/obsidian-developer-docs/blob/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Plugins/Releasing/Submit%20your%20plugin.md#L18-L59
[o-manifest]: https://github.com/obsidianmd/obsidian-developer-docs/blob/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Reference/Manifest.md#L5-L45
[o-versions]: https://github.com/obsidianmd/obsidian-developer-docs/blob/c56c7e770ba25dd0ea392aacf4588f9425970d36/en/Reference/Versions.md#L5-L38
[o-daily-notes]: https://github.com/obsidianmd/obsidian-help/blob/a3985b585904ddb9f109bd80849b378085308c15/en/Plugins/Daily%20notes.md#L5-L22
[o-block-ids]: https://github.com/obsidianmd/obsidian-help/blob/a3985b585904ddb9f109bd80849b378085308c15/en/Linking%20notes%20and%20files/Internal%20links.md#L98-L140
